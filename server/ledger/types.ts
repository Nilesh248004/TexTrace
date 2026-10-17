// LedgerService adapter interface. The built-in implementation is SimulatedLedger (server/ledger/simulated.ts):
// SHA-256 hash-chained blocks, Merkle root over tx hashes, 4 validators (one per org) signing each block hash
// with HMAC-SHA256, endorsement policy 3-of-4. A Hyperledger Fabric / Besu adapter can implement the same
// interface later (server/ledger/fabric.ts is a documented stub).
import type {
  EntityRef,
  IntegrityIssue,
  LedgerBlock,
  LedgerStats,
  LedgerTx,
  MerkleProofStep,
  Role,
  ContractName,
} from '@shared/types';

/** A transaction proposal produced by the contract runtime, before it is hashed and placed in a block. */
export interface PendingTx {
  contract: ContractName | 'System';
  fn: string;
  payload: Record<string, unknown>;
  actorId: string;
  actorRole: Role | 'SYSTEM';
  status: 'VALID' | 'INVALID';
  reason: string | null;
  entityRefs: EntityRef[];
}

export interface CommitResult {
  block: LedgerBlock;
  txs: LedgerTx[];
}

export interface LedgerValidation {
  checkedBlocks: number;
  checkedTxs: number;
  issues: IntegrityIssue[];
}

export interface LedgerService {
  /** 'simulated' | 'fabric' | 'besu' */
  readonly adapter: string;

  /** Create the genesis block (System.genesis tx with network config) if the chain is empty. Idempotent. */
  init(opts?: { timestamp?: string }): Promise<void>;

  /**
   * Hash, order and commit `pending` transactions as ONE new block: computes each txHash
   * (sha256 of canonical tx content incl. nonce + timestamp), the Merkle root, the block hash
   * (sha256 of canonical header), collects validator approvals (each validator re-verifies tx hashes +
   * merkle root + prevHash link and signs blockHash), enforces quorum, and persists to ledger_blocks/ledger_txs.
   * Synchronous; MUST be called inside the caller's SQLite transaction (it does not open its own).
   * `timestamp` overrides the block/tx time (used by the seeder to build history); must be >= previous block time.
   */
  commit(pending: PendingTx[], opts?: { timestamp?: string }): Promise<CommitResult>;

  height(): Promise<number>;
  getBlock(number: number): Promise<LedgerBlock | null>;
  /** Newest first. */
  listBlocks(offset: number, limit: number): Promise<{ items: LedgerBlock[]; total: number }>;
  getBlockTxs(number: number): Promise<LedgerTx[]>;
  getTx(txHash: string): Promise<LedgerTx | null>;
  /** All txs whose entityRefs include (type,id), oldest first. */
  getTxsByEntity(type: string, id: string): Promise<LedgerTx[]>;
  /** Newest first. */
  listTxs(filter: { contract?: string; fn?: string; offset: number; limit: number }): Promise<{ items: LedgerTx[]; total: number }>;

  getMerkleProof(txHash: string): Promise<MerkleProofStep[]>;
  verifyMerkleProof(leafTxHash: string, proof: MerkleProofStep[], merkleRoot: string): boolean;

  stats(): Promise<LedgerStats>;
  validators(): { id: string; org: string }[];
  policy(): string;

  /**
   * Chain-level integrity only (record re-hashing is done by services/integrity.ts):
   * genesis, prevHash links, block hash recomputation, merkle root recomputation, tx hash recomputation,
   * validator signature verification and quorum. Issues pinpoint blockNumber / txHash / field.
   */
  validateLedger(): Promise<LedgerValidation>;
}
