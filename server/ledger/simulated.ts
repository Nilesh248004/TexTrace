// SimulatedLedger — a SQLite-backed permissioned blockchain (SPEC §5).
//
//   tx      txHash = sha256(canonicalJson({ contract, fn, payload, actorId, actorRole, status, reason, entityRefs, timestamp, nonce }))
//           nonce  = sha256(prevBlockHash + ':' + index).slice(0, 16)
//           field_digests: sha256(canonicalJson(value)) of every top-level tx field and every top-level payload key
//           ('payload.<key>'), so validateLedger() can name the field an attacker edited.
//   block   hash   = sha256(canonicalJson({ number, timestamp, prevHash, merkleRoot, txCount, proposer }))
//           merkleRoot over the tx hashes (merkle.ts); proposer = orderer-1
//   consensus  every validator (validators.ts) re-verifies the proposal and signs the block hash; 3-of-4 required.
//
// No chain state is cached in memory: the DB can be wiped and re-seeded under us (wipeDb keeps the connection),
// so head/height/counts are always read from SQLite. Only prepared statements are cached (they survive DROP/CREATE).
import type { EntityRef, IntegrityIssue, LedgerBlock, LedgerStats, LedgerTx, MerkleProofStep, ValidatorApproval } from '@shared/types';
import type Database from 'better-sqlite3';
import { CONTRACTS } from '@shared/permissions';
import { shortHash } from '@shared/format';
import type { DB } from '../db';
import { canonicalJson, canonicalize, sha256Hex, ZERO_HASH } from '../lib/hash';
import { merkleProof, merkleRoot, verifyMerkleProof } from './merkle';
import { POLICY, QUORUM, VALIDATORS, collectApprovals, explainApproval, signBlockHash } from './validators';
import type { CommitResult, LedgerService, LedgerValidation, PendingTx } from './types';

export const NETWORK_NAME = 'textrace-permissioned';
export const PROPOSER = 'orderer-1';
/** Genesis time when init() is called without a timestamp — before any seeded history, and deterministic. */
export const GENESIS_TIMESTAMP = '2026-01-01T00:00:00.000Z';

/** Top-level fields covered by the tx hash, in the order validateLedger() reports them. */
export const TX_HASH_FIELDS = ['contract', 'fn', 'payload', 'actorId', 'actorRole', 'status', 'reason', 'entityRefs', 'timestamp', 'nonce'] as const;
type TxField = (typeof TX_HASH_FIELDS)[number];

export interface TxContent {
  contract: string;
  fn: string;
  payload: unknown;
  actorId: string;
  actorRole: string;
  status: string;
  reason: string | null;
  entityRefs: unknown;
  timestamp: string;
  nonce: string;
}

export interface BlockHeader {
  number: number;
  timestamp: string;
  prevHash: string;
  merkleRoot: string;
  txCount: number;
  proposer: string;
}

export interface SimulatedLedgerOptions {
  /** Validators that do not answer endorsement requests (fault-injection for tests / demos). */
  offlineValidators?: string[];
}

interface BlockRow {
  number: number;
  timestamp: string;
  prev_hash: string;
  merkle_root: string;
  hash: string;
  tx_count: number;
  proposer: string;
  approvals: string;
}

interface TxRow {
  tx_hash: string;
  block_number: number;
  idx: number;
  timestamp: string;
  contract: string;
  fn: string;
  payload: string;
  actor_id: string;
  actor_role: string;
  status: string;
  reason: string | null;
  entity_refs: string;
  nonce: string;
  field_digests: string;
}

interface HeadRow {
  number: number;
  hash: string;
  timestamp: string;
}

interface SealedTx {
  index: number;
  content: TxContent;
  canon: Record<string, unknown>;
  txHash: string;
  digests: Record<string, string>;
}

// ------------------------------------------------------------------------------------------------ pure helpers
export function txNonce(prevBlockHash: string, index: number): string {
  return sha256Hex(`${prevBlockHash}:${index}`).slice(0, 16);
}

export function hashTxContent(content: TxContent): string {
  return sha256Hex(canonicalJson(content));
}

export function hashBlockHeader(h: BlockHeader): string {
  return sha256Hex(
    canonicalJson({ number: h.number, timestamp: h.timestamp, prevHash: h.prevHash, merkleRoot: h.merkleRoot, txCount: h.txCount, proposer: h.proposer }),
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Digests of an already-canonicalized tx content (JSON.stringify of a canonical value === canonicalJson of it). */
function digestsOfCanon(canon: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of TX_HASH_FIELDS) out[f] = sha256Hex(JSON.stringify(canon[f] ?? null));
  const payload = canon.payload;
  if (isPlainObject(payload)) for (const k of Object.keys(payload)) out[`payload.${k}`] = sha256Hex(JSON.stringify(payload[k] ?? null));
  return out;
}

/** sha256(canonicalJson(value)) per top-level tx field and per top-level payload key ('payload.<key>'). */
export function fieldDigestsOf(content: TxContent): Record<string, string> {
  return digestsOfCanon(canonicalize(content) as Record<string, unknown>);
}

function sealTx(content: TxContent, index: number): SealedTx {
  const canon = canonicalize(content) as Record<string, unknown>;
  return { index, content, canon, txHash: sha256Hex(JSON.stringify(canon)), digests: digestsOfCanon(canon) };
}

function parseLoose(raw: string | null): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // unparseable JSON: hashing the raw text guarantees a mismatch is reported
  }
}

function parseOr<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function contentOfRow(r: TxRow): TxContent {
  return {
    contract: r.contract,
    fn: r.fn,
    payload: parseLoose(r.payload),
    actorId: r.actor_id,
    actorRole: r.actor_role,
    status: r.status,
    reason: r.reason ?? null,
    entityRefs: parseLoose(r.entity_refs),
    timestamp: r.timestamp,
    nonce: r.nonce,
  };
}

function normHash(h: string): string {
  const s = String(h ?? '').trim().toLowerCase();
  return s.startsWith('0x') ? s.slice(2) : s;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function toIso(ts: string, what: string): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) throw new Error(`${what}: invalid timestamp "${ts}" (expected ISO-8601, e.g. 2026-10-09T10:30:00.000Z)`);
  return new Date(t).toISOString();
}

function assertPendingTx(p: PendingTx, i: number): void {
  const where = `Ledger commit: tx #${i}`;
  if (!p || typeof p !== 'object') throw new Error(`${where} is not an object`);
  if (typeof p.contract !== 'string' || !p.contract) throw new Error(`${where} has no contract name`);
  if (typeof p.fn !== 'string' || !p.fn) throw new Error(`${where} (${p.contract}) has no function name`);
  const label = `${where} (${p.contract}.${p.fn})`;
  if (!isPlainObject(p.payload)) throw new Error(`${label}: payload must be a JSON object`);
  if (typeof p.actorId !== 'string' || !p.actorId) throw new Error(`${label}: actorId is required`);
  if (typeof p.actorRole !== 'string' || !p.actorRole) throw new Error(`${label}: actorRole is required`);
  if (p.status !== 'VALID' && p.status !== 'INVALID') throw new Error(`${label}: status must be VALID or INVALID, got "${String(p.status)}"`);
  if (!Array.isArray(p.entityRefs)) throw new Error(`${label}: entityRefs must be an array`);
  if (p.status === 'INVALID') {
    if (typeof p.reason !== 'string' || !p.reason.trim()) throw new Error(`${label}: an INVALID tx must carry the rejection reason`);
    if (p.entityRefs.length > 0) {
      throw new Error(`${label}: an INVALID tx must not anchor entities (got ${p.entityRefs.length} entity ref(s)) — its writes were rolled back`);
    }
  }
}

// ------------------------------------------------------------------------------------------------ ledger
export class SimulatedLedger implements LedgerService {
  readonly adapter = 'simulated';
  private readonly offline: Set<string>;
  // `ReturnType<DB['prepare']>` resolves the generic prepare overload to a single
  // object parameter. Ledger statements use positional bindings (including none),
  // so retain the variadic signature explicitly in the cache.
  private readonly stmtCache = new Map<string, Database.Statement<[...unknown[]], unknown>>();

  constructor(
    private readonly db: DB,
    opts: SimulatedLedgerOptions = {},
  ) {
    this.offline = new Set(opts.offlineValidators ?? []);
  }

  /** Mark validators as offline (they will not endorse new blocks). Pass [] to bring all back. */
  setOfflineValidators(ids: string[]): void {
    this.offline.clear();
    for (const id of ids) this.offline.add(id);
  }

  private stmt(sql: string): Database.Statement<[...unknown[]], unknown> {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }

  private head(): HeadRow | undefined {
    return this.stmt(`SELECT number, hash, timestamp FROM ledger_blocks ORDER BY number DESC LIMIT 1`).get() as HeadRow | undefined;
  }

  private inTx<T>(fn: () => T): T {
    return this.db.inTransaction ? fn() : this.db.transaction(fn)();
  }

  // ---------------------------------------------------------------------------------------------- writes
  init(opts?: { timestamp?: string }): void {
    this.inTx(() => {
      if (this.head()) return;
      const timestamp = toIso(opts?.timestamp ?? GENESIS_TIMESTAMP, 'Ledger genesis');
      const genesis: PendingTx = {
        contract: 'System',
        fn: 'genesis',
        payload: {
          network: NETWORK_NAME,
          adapter: this.adapter,
          validators: VALIDATORS.map((v) => ({ id: v.id, org: v.org })),
          policy: '3-of-4',
          contracts: [...CONTRACTS],
          createdAt: timestamp,
        },
        actorId: 'system',
        actorRole: 'SYSTEM',
        status: 'VALID',
        reason: null,
        entityRefs: [],
      };
      this.appendBlock([genesis], timestamp, undefined);
    });
  }

  commit(pending: PendingTx[], opts?: { timestamp?: string }): CommitResult {
    if (!Array.isArray(pending) || pending.length === 0) {
      throw new Error('Ledger commit rejected: a block must contain at least one transaction');
    }
    pending.forEach(assertPendingTx);
    const requestedMs = opts?.timestamp === undefined ? Date.now() : Date.parse(toIso(opts.timestamp, 'Ledger commit'));
    return this.inTx(() => {
      let head = this.head();
      if (!head) {
        // Defensive: a commit on an empty chain creates the genesis block first.
        const genesisMs = Math.min(requestedMs, Date.parse(GENESIS_TIMESTAMP));
        this.init({ timestamp: new Date(genesisMs).toISOString() });
        head = this.head() as HeadRow;
      }
      const headMs = Date.parse(head.timestamp);
      // Clock skew / historical replay: ledger time never goes backwards.
      const ts = new Date(Number.isFinite(headMs) && requestedMs < headMs ? headMs + 1 : requestedMs).toISOString();
      return this.appendBlock(pending, ts, head);
    });
  }

  /** Seal, endorse (3-of-4) and persist one block on top of `head` (undefined => genesis). */
  private appendBlock(pending: PendingTx[], timestamp: string, head: HeadRow | undefined): CommitResult {
    const prevHash = head ? head.hash : ZERO_HASH;
    const number = head ? head.number + 1 : 0;

    const sealed = pending.map((p, i) =>
      sealTx(
        {
          contract: p.contract,
          fn: p.fn,
          payload: p.payload,
          actorId: p.actorId,
          actorRole: p.actorRole,
          status: p.status,
          reason: p.reason ?? null,
          entityRefs: p.entityRefs,
          timestamp,
          nonce: txNonce(prevHash, i),
        },
        i,
      ),
    );
    const header: BlockHeader = {
      number,
      timestamp,
      prevHash,
      merkleRoot: merkleRoot(sealed.map((t) => t.txHash)),
      txCount: sealed.length,
      proposer: PROPOSER,
    };
    const hash = hashBlockHeader(header);

    const approvals = collectApprovals(hash, (validatorId) => this.endorse(validatorId, header, hash, sealed));
    const approved = approvals.filter((a) => a.approved).length;
    if (approved < QUORUM) {
      const refusals = approvals
        .filter((a) => !a.approved)
        .map((a) => `${a.validator} (${a.org}): ${a.reason}`)
        .join('; ');
      throw new Error(
        `Endorsement policy not satisfied for block #${number}: ${approved} of ${VALIDATORS.length} validators signed, ` +
          `${QUORUM} required (${POLICY}). Refusals — ${refusals}`,
      );
    }

    this.stmt(
      `INSERT INTO ledger_blocks (number, timestamp, prev_hash, merkle_root, hash, tx_count, proposer, approvals)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(number, timestamp, prevHash, header.merkleRoot, hash, header.txCount, PROPOSER, JSON.stringify(approvals));
    const insTx = this.stmt(
      `INSERT INTO ledger_txs (tx_hash, block_number, idx, timestamp, contract, fn, payload, actor_id, actor_role, status, reason, entity_refs, nonce, field_digests)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const txs: LedgerTx[] = sealed.map((t) => {
      const c = t.content;
      const payload = t.canon.payload as Record<string, unknown>;
      const entityRefs = t.canon.entityRefs as EntityRef[];
      insTx.run(
        t.txHash, number, t.index, timestamp, c.contract, c.fn, JSON.stringify(payload), c.actorId, c.actorRole, c.status, c.reason,
        JSON.stringify(entityRefs), c.nonce, JSON.stringify(t.digests),
      );
      return {
        txHash: t.txHash,
        blockNumber: number,
        index: t.index,
        timestamp,
        contract: c.contract as LedgerTx['contract'],
        fn: c.fn,
        payload,
        actorId: c.actorId,
        actorRole: c.actorRole as LedgerTx['actorRole'],
        status: c.status as LedgerTx['status'],
        reason: c.reason,
        entityRefs,
        nonce: c.nonce,
      };
    });

    const block: LedgerBlock = { number, timestamp, prevHash, merkleRoot: header.merkleRoot, hash, txCount: header.txCount, proposer: PROPOSER, approvals };
    return { block, txs };
  }

  /**
   * One validator's independent verification of a proposed block. Reads the chain head itself and recomputes every
   * tx hash from the tx content, the Merkle root and the block hash. Returns null to endorse, else the refusal reason.
   */
  private endorse(validatorId: string, header: BlockHeader, blockHash: string, txs: SealedTx[]): string | null {
    if (this.offline.has(validatorId)) return 'validator offline — no endorsement response';
    const head = this.head();
    const expectedNumber = head ? head.number + 1 : 0;
    const expectedPrev = head ? head.hash : ZERO_HASH;
    if (header.number !== expectedNumber) return `block number #${header.number} does not follow the head (expected #${expectedNumber})`;
    if (header.prevHash !== expectedPrev) {
      return `prevHash ${shortHash(header.prevHash)} does not extend the current head ${shortHash(expectedPrev)}`;
    }
    if (head && Date.parse(header.timestamp) < Date.parse(head.timestamp)) {
      return `block time ${header.timestamp} is earlier than head block #${head.number} (${head.timestamp})`;
    }
    if (header.txCount !== txs.length) return `header declares ${header.txCount} txs but the proposal carries ${txs.length}`;
    for (const t of txs) {
      if (t.content.nonce !== txNonce(header.prevHash, t.index)) return `tx #${t.index} nonce is not derived from prevHash`;
      if (t.content.timestamp !== header.timestamp) return `tx #${t.index} timestamp differs from the block timestamp`;
      const recomputed = hashTxContent(t.content);
      if (recomputed !== t.txHash) return `tx #${t.index} hash ${shortHash(t.txHash)} does not match its content (${shortHash(recomputed)})`;
    }
    const root = merkleRoot(txs.map((t) => t.txHash));
    if (root !== header.merkleRoot) return `merkle root ${shortHash(header.merkleRoot)} does not match the txs (${shortHash(root)})`;
    if (hashBlockHeader(header) !== blockHash) return 'block hash does not match the block header';
    return null;
  }

  // ---------------------------------------------------------------------------------------------- reads
  height(): number {
    const head = this.head();
    return head ? head.number : -1;
  }

  getBlock(number: number): LedgerBlock | null {
    const row = this.stmt(`SELECT * FROM ledger_blocks WHERE number = ?`).get(number) as BlockRow | undefined;
    return row ? blockOf(row) : null;
  }

  listBlocks(offset: number, limit: number): { items: LedgerBlock[]; total: number } {
    const lim = clampInt(limit, 0, 1000, 25);
    const off = clampInt(offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const rows = this.stmt(`SELECT * FROM ledger_blocks ORDER BY number DESC LIMIT ? OFFSET ?`).all(lim, off) as BlockRow[];
    const total = (this.stmt(`SELECT COUNT(*) AS n FROM ledger_blocks`).get() as { n: number }).n;
    return { items: rows.map(blockOf), total };
  }

  getBlockTxs(number: number): LedgerTx[] {
    return (this.stmt(`SELECT * FROM ledger_txs WHERE block_number = ? ORDER BY idx ASC`).all(number) as TxRow[]).map(txOf);
  }

  getTx(txHash: string): LedgerTx | null {
    const row = this.stmt(`SELECT * FROM ledger_txs WHERE tx_hash = ?`).get(normHash(txHash)) as TxRow | undefined;
    return row ? txOf(row) : null;
  }

  getTxsByEntity(type: string, id: string): LedgerTx[] {
    const needle = `"id":${JSON.stringify(String(id))}`.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = this.stmt(
      `SELECT * FROM ledger_txs WHERE entity_refs LIKE ? ESCAPE '\\' ORDER BY block_number ASC, idx ASC`,
    ).all(`%${needle}%`) as TxRow[];
    return rows.map(txOf).filter((t) => Array.isArray(t.entityRefs) && t.entityRefs.some((r) => r && r.type === type && r.id === id));
  }

  listTxs(filter: { contract?: string; fn?: string; offset: number; limit: number }): { items: LedgerTx[]; total: number } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.contract) {
      where.push('contract = ?');
      params.push(filter.contract);
    }
    if (filter.fn) {
      where.push('fn = ?');
      params.push(filter.fn);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const lim = clampInt(filter.limit, 0, 1000, 25);
    const off = clampInt(filter.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const rows = this.stmt(`SELECT * FROM ledger_txs ${w} ORDER BY block_number DESC, idx DESC LIMIT ? OFFSET ?`).all(...params, lim, off) as TxRow[];
    const total = (this.stmt(`SELECT COUNT(*) AS n FROM ledger_txs ${w}`).get(...params) as { n: number }).n;
    return { items: rows.map(txOf), total };
  }

  getMerkleProof(txHash: string): MerkleProofStep[] {
    const h = normHash(txHash);
    const row = this.stmt(`SELECT block_number, idx FROM ledger_txs WHERE tx_hash = ?`).get(h) as { block_number: number; idx: number } | undefined;
    if (!row) throw new Error(`Merkle proof: transaction ${shortHash(h)} is not on the ledger`);
    const leaves = (this.stmt(`SELECT tx_hash FROM ledger_txs WHERE block_number = ? ORDER BY idx ASC`).all(row.block_number) as { tx_hash: string }[]).map(
      (r) => r.tx_hash,
    );
    return merkleProof(leaves, leaves.indexOf(h));
  }

  verifyMerkleProof(leafTxHash: string, proof: MerkleProofStep[], merkleRootHash: string): boolean {
    return verifyMerkleProof(normHash(leafTxHash), proof, normHash(merkleRootHash));
  }

  stats(): LedgerStats {
    const b = this.stmt(`SELECT COUNT(*) AS n FROM ledger_blocks`).get() as { n: number };
    const head = this.head();
    const t = this.stmt(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN status = 'VALID' THEN 1 ELSE 0 END), 0) AS valid,
              COALESCE(SUM(CASE WHEN status = 'INVALID' THEN 1 ELSE 0 END), 0) AS invalid
       FROM ledger_txs`,
    ).get() as { n: number; valid: number; invalid: number };
    const byContract = this.stmt(`SELECT contract, COUNT(*) AS count FROM ledger_txs GROUP BY contract ORDER BY count DESC, contract ASC`).all() as {
      contract: string;
      count: number;
    }[];
    return {
      height: head ? head.number : -1,
      blocks: b.n,
      transactions: t.n,
      validTx: t.valid,
      invalidTx: t.invalid,
      lastBlockAt: head ? head.timestamp : null,
      validators: this.validators(),
      policy: POLICY,
      byContract,
    };
  }

  validators(): { id: string; org: string }[] {
    return VALIDATORS.map((v) => ({ id: v.id, org: v.org }));
  }

  policy(): string {
    return POLICY;
  }

  // ---------------------------------------------------------------------------------------------- integrity
  validateLedger(): LedgerValidation {
    const blocks = this.stmt(`SELECT * FROM ledger_blocks ORDER BY number ASC`).all() as BlockRow[];
    const txRows = this.stmt(`SELECT * FROM ledger_txs ORDER BY block_number ASC, idx ASC`).all() as TxRow[];
    const issues: IntegrityIssue[] = [];
    const issue = (i: Omit<IntegrityIssue, 'entityType' | 'entityId'>) => issues.push({ entityType: null, entityId: null, ...i });

    // ---- genesis present
    if (blocks.length === 0) {
      issue({
        kind: 'PREV_HASH_BROKEN', blockNumber: 0, txHash: null, field: 'genesis', expected: 'block #0', actual: null,
        message: 'Genesis block #0 not found — the ledger is empty or was truncated',
      });
    } else if (blocks[0].number !== 0) {
      issue({
        kind: 'PREV_HASH_BROKEN', blockNumber: blocks[0].number, txHash: null, field: 'genesis', expected: 0, actual: blocks[0].number,
        message: `Genesis block #0 is missing — the chain starts at block #${blocks[0].number}`,
      });
    }

    let ti = 0;
    let prev: BlockRow | null = null;
    for (const b of blocks) {
      const tag = `Block #${b.number}`;

      // Txs of this block (both lists are sorted by block number). Txs of a block number with no block row are orphans.
      while (ti < txRows.length && txRows[ti].block_number < b.number) {
        const o = txRows[ti++];
        issue({
          kind: 'MERKLE_MISMATCH', blockNumber: o.block_number, txHash: o.tx_hash, field: 'block_number', expected: null, actual: o.block_number,
          message: `Tx ${shortHash(o.tx_hash)} (${o.contract}.${o.fn}) references block #${o.block_number}, which does not exist`,
        });
      }
      const txs: TxRow[] = [];
      while (ti < txRows.length && txRows[ti].block_number === b.number) txs.push(txRows[ti++]);

      // ---- prevHash link
      if (b.number === 0) {
        if (b.prev_hash !== ZERO_HASH) {
          issue({
            kind: 'PREV_HASH_BROKEN', blockNumber: 0, txHash: null, field: 'prev_hash', expected: ZERO_HASH, actual: b.prev_hash,
            message: `${tag} (genesis): prev_hash must be the zero hash, found ${shortHash(b.prev_hash)}`,
          });
        }
      } else if (prev && prev.number !== b.number - 1) {
        issue({
          kind: 'PREV_HASH_BROKEN', blockNumber: b.number, txHash: null, field: 'number', expected: b.number - 1, actual: prev.number,
          message: `${tag}: block #${b.number - 1} is missing — the chain jumps from #${prev.number} to #${b.number}`,
        });
      } else if (prev && b.prev_hash !== prev.hash) {
        issue({
          kind: 'PREV_HASH_BROKEN', blockNumber: b.number, txHash: null, field: 'prev_hash', expected: prev.hash, actual: b.prev_hash,
          message: `${tag}: prev_hash ${shortHash(b.prev_hash)} does not match the hash of block #${prev.number} (${shortHash(prev.hash)}) — chain link broken`,
        });
      }

      // ---- tx hashes
      for (const r of txs) {
        const content = contentOfRow(r);
        const canon = canonicalize(content) as Record<string, unknown>;
        const recomputed = sha256Hex(JSON.stringify(canon));
        if (recomputed !== r.tx_hash) issues.push(txMismatchIssue(b.number, r, canon, recomputed));
      }

      // ---- merkle root (over the recorded tx hashes, so an edited tx is reported once, as TX_HASH_MISMATCH)
      if (txs.length !== b.tx_count) {
        issue({
          kind: 'MERKLE_MISMATCH', blockNumber: b.number, txHash: null, field: 'tx_count', expected: b.tx_count, actual: txs.length,
          message: `${tag}: header records ${b.tx_count} tx(s) but ${txs.length} are stored — transactions were ${txs.length < b.tx_count ? 'removed' : 'added'}`,
        });
      }
      const root = merkleRoot(txs.map((r) => r.tx_hash));
      if (root !== b.merkle_root) {
        issue({
          kind: 'MERKLE_MISMATCH', blockNumber: b.number, txHash: null, field: 'merkle_root', expected: b.merkle_root, actual: root,
          message: `${tag}: merkle root recomputed from ${txs.length} tx hash(es) is ${shortHash(root)} but the header records ${shortHash(b.merkle_root)}`,
        });
      }

      // ---- block hash
      const recomputedHash = hashBlockHeader({
        number: b.number, timestamp: b.timestamp, prevHash: b.prev_hash, merkleRoot: b.merkle_root, txCount: b.tx_count, proposer: b.proposer,
      });
      if (recomputedHash !== b.hash) {
        issue({
          kind: 'BLOCK_HASH_MISMATCH', blockNumber: b.number, txHash: null, field: 'hash', expected: b.hash, actual: recomputedHash,
          message: `${tag}: header recomputes to ${shortHash(recomputedHash)} but the block records ${shortHash(b.hash)} — header fields (timestamp / prev_hash / merkle_root / tx_count / proposer) were altered`,
        });
      }

      // ---- validator signatures + quorum (against the recorded block hash that the validators signed)
      const approvals = parseOr<unknown>(b.approvals, null);
      const valid = new Set<string>();
      if (!Array.isArray(approvals)) {
        issue({
          kind: 'SIGNATURE_INVALID', blockNumber: b.number, txHash: null, field: 'approvals', expected: 'ValidatorApproval[]', actual: b.approvals,
          message: `${tag}: validator approvals are missing or unreadable`,
        });
      } else {
        approvals.forEach((a: ValidatorApproval, i: number) => {
          const why = explainApproval(a, b.hash);
          if (why === null) {
            valid.add(a.validator);
            return;
          }
          if (why === 'not approved' && a.approved === false) return; // a recorded refusal is legitimate; it just does not count
          const known = a && typeof a === 'object' && VALIDATORS.some((v) => v.id === a.validator);
          issue({
            kind: 'SIGNATURE_INVALID', blockNumber: b.number, txHash: null, field: `approvals[${i}].signature`,
            expected: known ? signBlockHash(a.validator, b.hash) : null,
            actual: a && typeof a === 'object' ? a.signature ?? null : a,
            message: `${tag}: ${why}${known ? ` ${shortHash(b.hash)} — approval forged or altered` : ''}`,
          });
        });
      }
      if (valid.size < QUORUM) {
        issue({
          kind: 'QUORUM_NOT_MET', blockNumber: b.number, txHash: null, field: 'approvals', expected: QUORUM, actual: valid.size,
          message: `${tag}: only ${valid.size} of ${VALIDATORS.length} validator signatures verify — endorsement policy ${POLICY.replace(' validator signatures', '')} not met`,
        });
      }

      prev = b;
    }
    while (ti < txRows.length) {
      const o = txRows[ti++];
      issue({
        kind: 'MERKLE_MISMATCH', blockNumber: o.block_number, txHash: o.tx_hash, field: 'block_number', expected: null, actual: o.block_number,
        message: `Tx ${shortHash(o.tx_hash)} (${o.contract}.${o.fn}) references block #${o.block_number}, which does not exist`,
      });
    }

    return { checkedBlocks: blocks.length, checkedTxs: txRows.length, issues };
  }
}

// ------------------------------------------------------------------------------------------------ row mapping
function blockOf(r: BlockRow): LedgerBlock {
  return {
    number: r.number,
    timestamp: r.timestamp,
    prevHash: r.prev_hash,
    merkleRoot: r.merkle_root,
    hash: r.hash,
    txCount: r.tx_count,
    proposer: r.proposer,
    approvals: parseOr<ValidatorApproval[]>(r.approvals, []),
  };
}

function txOf(r: TxRow): LedgerTx {
  const payload = parseOr<unknown>(r.payload, {});
  const refs = parseOr<unknown>(r.entity_refs, []);
  return {
    txHash: r.tx_hash,
    blockNumber: r.block_number,
    index: r.idx,
    timestamp: r.timestamp,
    contract: r.contract as LedgerTx['contract'],
    fn: r.fn,
    payload: isPlainObject(payload) ? payload : { value: payload },
    actorId: r.actor_id,
    actorRole: r.actor_role as LedgerTx['actorRole'],
    status: r.status as LedgerTx['status'],
    reason: r.reason,
    entityRefs: Array.isArray(refs) ? (refs as EntityRef[]) : [],
    nonce: r.nonce,
  };
}

/** TX_HASH_MISMATCH pinpointing the edited field via the digests stored at commit time. */
function txMismatchIssue(blockNumber: number, r: TxRow, canon: Record<string, unknown>, recomputed: string): IntegrityIssue {
  const stored = parseOr<Record<string, string>>(r.field_digests, {});
  const hasDigests = isPlainObject(stored) && Object.keys(stored).length > 0;
  const current = digestsOfCanon(canon);
  const tag = `Block #${blockNumber}: tx ${shortHash(r.tx_hash)} (${r.contract}.${r.fn})`;
  const base = { kind: 'TX_HASH_MISMATCH' as const, blockNumber, txHash: r.tx_hash, entityType: null, entityId: null };

  if (hasDigests) {
    const payloadPaths = [...new Set([...Object.keys(stored), ...Object.keys(current)])].filter((k) => k.startsWith('payload.')).sort();
    for (const p of payloadPaths) {
      if (stored[p] === current[p]) continue;
      const change = stored[p] === undefined ? 'added' : current[p] === undefined ? 'removed' : 'changed';
      return { ...base, field: p, expected: stored[p] ?? null, actual: current[p] ?? null, message: `${tag} ${p} ${change} — hash no longer matches` };
    }
    for (const f of TX_HASH_FIELDS as readonly TxField[]) {
      if (stored[f] === current[f]) continue;
      return { ...base, field: f, expected: stored[f] ?? null, actual: current[f] ?? null, message: `${tag} ${f} changed — hash no longer matches` };
    }
  }
  return {
    ...base,
    field: 'tx',
    expected: r.tx_hash,
    actual: recomputed,
    message: `${tag}: content recomputes to ${shortHash(recomputed)} but the recorded hash is ${shortHash(r.tx_hash)} — ${
      hasDigests ? 'field digests were altered too' : 'no field digests recorded'
    }`,
  };
}
