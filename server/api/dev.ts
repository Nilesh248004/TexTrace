// Developer Console API: action log with full traces, ledger explorer, chain validation, tamper simulation, lot ledger history.
import type { Router } from 'express';
import express from 'express';
import type { ApiCtx, AuthedRequest } from './common';
import { newRouter } from './common';
import { fail, notFound, ok, parseJson, qn, qs } from './common';
import { CONTRACT_FUNCTIONS, DEV_TOOL_ROLES, PERMISSIONS, type ContractFunction } from '@shared/permissions';
import { ENTITIES, entityDef } from '../db/entities';
import { validateAll } from '../domain/integrity';
import { invalidateMasters } from '../domain/masters';
import { randomUUID } from 'node:crypto';
import { nowIso } from '../lib/clock';
import { bus } from '../lib/events';
import { CONTRACT_MODULES } from '../contracts';
import type { DevTrace } from '@shared/types';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const allowed = (req: AuthedRequest, tool: keyof typeof DEV_TOOL_ROLES) => !!req.actor && (DEV_TOOL_ROLES[tool] as string[]).includes(req.actor.role);

export function devRouter(c: ApiCtx, reset: () => Promise<void>): Router {
  const r = newRouter();
  const { db, ledger, runtime } = c;

  r.get('/ledger/stats', async (_req, res) => ok(res, await ledger.stats()));
  r.get('/ledger/blocks', async (req, res) => { const page = Math.max(1, qn(req.query.page, 1)); const pageSize = Math.min(100, qn(req.query.pageSize, 20)); const { items, total } = await ledger.listBlocks((page - 1) * pageSize, pageSize); ok(res, { items, total, page, pageSize }); });
  r.get('/ledger/blocks/:n', async (req, res) => { const b = await ledger.getBlock(Number(req.params.n)); if (!b) return notFound(res, 'Block'); ok(res, { block: b, txs: await ledger.getBlockTxs(b.number) }); });
  r.get('/ledger/tx/:hash', async (req, res) => {
    const tx = await ledger.getTx(req.params.hash); if (!tx) return notFound(res, 'Transaction');
    const block = await ledger.getBlock(tx.blockNumber); const proof = await ledger.getMerkleProof(tx.txHash);
    ok(res, { tx, block, merkleProof: proof, proofValid: !!block && ledger.verifyMerkleProof(tx.txHash, proof, block.merkleRoot) });
  });

  r.get('/dev/audit', async (req, res) => {
    const page = Math.max(1, qn(req.query.page, 1)); const pageSize = Math.min(200, qn(req.query.pageSize, 50));
    const where: string[] = []; const args: unknown[] = [];
    const add = (cond: string, ...a: unknown[]) => { where.push(cond); args.push(...a); };
    if (qs(req.query.user)) add('username=?', qs(req.query.user));
    if (qs(req.query.action)) add('LOWER(action) LIKE ?', `%${qs(req.query.action).toLowerCase()}%`);
    if (qs(req.query.contract)) add('contracts LIKE ?', `%${qs(req.query.contract)}%`);
    if (qs(req.query.lot)) add('refs LIKE ?', `%LOT-${qs(req.query.lot).replace(/^LOT-/i, '')}%`);
    if (qs(req.query.ref)) add('LOWER(refs) LIKE ?', `%${qs(req.query.ref).toLowerCase()}%`);
    if (qs(req.query.from)) add('timestamp >= ?', `${qs(req.query.from)}T00:00:00.000Z`);
    if (qs(req.query.to)) add('timestamp <= ?', `${qs(req.query.to)}T23:59:59.999Z`);
    if (qs(req.query.accepted)) add('accepted=?', qs(req.query.accepted) === 'true' || qs(req.query.accepted) === '1' ? 1 : 0);
    if (qs(req.query.q)) { const t = `%${qs(req.query.q).toLowerCase()}%`; add('(LOWER(label) LIKE ? OR LOWER(refs) LIKE ? OR LOWER(action) LIKE ?)', t, t, t); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await db.prepare(`SELECT COUNT(*) n FROM audit_log ${w}`).get<{ n: number }>(...args))?.n ?? 0);
    const rows = await db.prepare(`SELECT action_id,timestamp,user_id,username,role,action,label,method,path,accepted,reason,contracts,tx_hashes,block_number,refs FROM audit_log ${w} ORDER BY timestamp DESC, action_id LIMIT ? OFFSET ?`).all<Row>(...args, pageSize, (page - 1) * pageSize);
    const users = await db.prepare('SELECT DISTINCT username FROM audit_log WHERE username IS NOT NULL ORDER BY username').all<Row>();
    ok(res, { items: rows.map((a) => ({ id: a.action_id, at: a.timestamp, username: a.username ?? 'system', role: a.role, action: a.action, label: a.label, method: a.method, path: a.path, accepted: !!a.accepted, reason: a.reason, contracts: parseJson<string[]>(a.contracts, []), txHashes: parseJson<string[]>(a.tx_hashes, []), blockNumber: a.block_number, refs: str(a.refs) })), total, page, pageSize, users: users.map((u) => str(u.username)) });
  });
  r.get('/dev/audit/:id', async (req, res) => { const a = await db.prepare('SELECT trace FROM audit_log WHERE action_id=?').get<{ trace: string }>(req.params.id); return a ? ok(res, parseJson(a.trace, null)) : notFound(res, 'Action'); });
  r.get('/dev/contracts', (_req, res) => ok(res, CONTRACT_MODULES.map((m) => ({ name: m.name, description: m.description, functions: Object.values(m.functions).map((f) => ({ key: f.key, description: CONTRACT_FUNCTIONS[f.key as ContractFunction] ?? f.description, rules: f.rules, roles: PERMISSIONS[f.key as ContractFunction] ?? [] })) }))));

  r.get('/dev/lot-ledger/:lot', async (req, res) => {
    const lot = await db.prepare('SELECT id,mix_id FROM lots WHERE id=? OR lot_no=?').get<Row>(req.params.lot, req.params.lot.replace(/^LOT-/i, ''));
    if (!lot) return notFound(res, 'Lot');
    const ids = new Map<string, string[]>();
    const add = (type: string, rows: Row[], col = 'id') => ids.set(type, rows.map((x) => str(x[col])));
    add('lot', [lot]); add('mix', [{ id: lot.mix_id }]);
    add('stage_run', await db.prepare('SELECT id FROM stage_runs WHERE lot_id=?').all<Row>(str(lot.id))); add('test_result', await db.prepare('SELECT id FROM test_results WHERE lot_id=?').all<Row>(str(lot.id)));
    add('packing', await db.prepare('SELECT id FROM packing WHERE lot_id=?').all<Row>(str(lot.id))); add('bale', await db.prepare('SELECT bale_id id FROM mix_bales WHERE mix_id=?').all<Row>(str(lot.mix_id)));
    add('mix_bale', await db.prepare('SELECT id FROM mix_bales WHERE mix_id=?').all<Row>(str(lot.mix_id))); add('dispatch', await db.prepare('SELECT dispatch_id id FROM dispatch_lots WHERE lot_id=?').all<Row>(str(lot.id)));
    add('complaint', await db.prepare('SELECT id FROM complaints WHERE lot_id=?').all<Row>(str(lot.id))); add('qa_override', await db.prepare('SELECT id FROM qa_overrides WHERE lot_id=?').all<Row>(str(lot.id)));
    add('analysis', await db.prepare('SELECT id FROM analyses WHERE lot_id=?').all<Row>(str(lot.id)));
    const hashes = new Map<string, { txHash: string; block: number; entities: Set<string> }>();
    for (const [type, list] of ids) for (let i = 0; i < list.length; i += 150) {
      const chunk = list.slice(i, i + 150); if (!chunk.length) continue;
      for (const a of await db.prepare(`SELECT entity_id,tx_hash,block_number,version FROM entity_anchors WHERE entity_type=? AND entity_id IN (${chunk.map(() => '?').join(',')})`).all<Row>(type, ...chunk)) {
        const h = hashes.get(str(a.tx_hash)) ?? { txHash: str(a.tx_hash), block: Number(a.block_number), entities: new Set<string>() }; h.entities.add(`${type}:${a.entity_id}@v${a.version}`); hashes.set(h.txHash, h);
      }
    }
    const list = [...hashes.values()]; const meta = new Map<string, Row>();
    for (let i = 0; i < list.length; i += 150) { const chunk = list.slice(i, i + 150).map((x) => x.txHash); for (const t of await db.prepare(`SELECT tx_hash,timestamp,contract,fn,actor_id,actor_role,status FROM ledger_txs WHERE tx_hash IN (${chunk.map(() => '?').join(',')})`).all<Row>(...chunk)) meta.set(str(t.tx_hash), t); }
    ok(res, { lotId: lot.id, txCount: list.length, items: list.map((h) => ({ txHash: h.txHash, blockNumber: h.block, timestamp: meta.get(h.txHash)?.timestamp, contract: meta.get(h.txHash)?.contract, fn: meta.get(h.txHash)?.fn, actor: meta.get(h.txHash)?.actor_id, status: meta.get(h.txHash)?.status, entities: [...h.entities].slice(0, 12), entityCount: h.entities.size })).sort((a, b) => a.blockNumber - b.blockNumber || str(a.timestamp).localeCompare(str(b.timestamp))) });
  });

  const nonLedger = (req: AuthedRequest, action: string, label: string, status: number, body: unknown, accepted: boolean, extra?: Record<string, unknown>, reason?: string) =>
    runtime.recordNonLedger({ action, label, actor: req.actor ?? null, request: { method: req.method, path: req.originalUrl.split('?')[0], query: {}, body: req.body }, accepted, reason, status, responseBody: body, extra });

  r.post('/dev/validate', async (req: AuthedRequest, res) => {
    if (!allowed(req, 'validateChain')) return fail(res, 403, 'PERMISSION_DENIED', 'Validate Chain needs the Developer, Admin or Auditor role');
    const report = await validateAll(db, ledger);
    const trace = await nonLedger(req, 'ledger.validate', `Validate chain: ${report.valid ? 'VALID' : `${report.issues.length} issue(s)`}`, 200, { valid: report.valid, checkedBlocks: report.checkedBlocks, checkedTxs: report.checkedTxs, checkedRecords: report.checkedRecords, issues: report.issues.slice(0, 10) }, true, { validator: 'Re-hash of every anchored record + hash links + Merkle roots + 3-of-4 signatures' });
    bus.publish({ type: 'integrity', data: report });
    ok(res, report); void trace;
  });
  r.get('/dev/tamper', async (req: AuthedRequest, res) => ok(res, (await db.prepare('SELECT * FROM tamper_log ORDER BY created_at DESC LIMIT 50').all<Row>()).map((t) => ({ id: t.id, createdAt: t.created_at, kind: t.kind, target: parseJson(t.target, {}), before: parseJson(t.before, null), after: parseJson(t.after, null), restored: !!t.restored }))));
  r.post('/dev/tamper', async (req: AuthedRequest, res) => {
    if (!allowed(req, 'tamper')) return fail(res, 403, 'PERMISSION_DENIED', 'Tamper simulation needs the Developer or Admin role');
    const b = req.body as { kind?: string; entityType?: string; entityId?: string; column?: string; jsonKey?: string; value?: unknown; txHash?: string; payloadKey?: string };
    let target: Record<string, unknown>; let before: unknown; let after: unknown;
    if (b.kind === 'tx') {
      const tx = await db.prepare('SELECT tx_hash,payload FROM ledger_txs WHERE tx_hash=?').get<Row>(str(b.txHash));
      if (!tx) return notFound(res, 'Transaction');
      const payload = parseJson<Record<string, unknown>>(tx.payload, {}); const key = b.payloadKey || 'tampered'; before = payload[key] ?? null; payload[key] = b.value ?? true; after = payload[key];
      await db.prepare('UPDATE ledger_txs SET payload=? WHERE tx_hash=?').run(JSON.stringify(payload), str(b.txHash));
      target = { kind: 'tx', txHash: b.txHash, payloadKey: key, originalPayloadPresent: before !== null };
    } else {
      if (!b.entityType || !b.entityId || !ENTITIES[b.entityType] || !b.column) return fail(res, 422, 'VALIDATION_FAILED', 'entityType, entityId and column are required');
      const def = entityDef(b.entityType);
      if (!/^[a-z_]+$/.test(b.column) || !def.fields.includes(b.column)) return fail(res, 422, 'VALIDATION_FAILED', `${b.column} is not a business column of ${b.entityType}`);
      const row = await db.prepare(`SELECT * FROM ${def.table} WHERE ${def.idColumn}=?`).get<Row>(b.entityId);
      if (!row) return notFound(res, b.entityType);
      let next: unknown = b.value;
      if (b.jsonKey) { const obj = parseJson<Record<string, unknown>>(row[b.column], {}); before = obj[b.jsonKey]; obj[b.jsonKey] = b.value; after = b.value; next = JSON.stringify(obj); }
      else { before = row[b.column]; after = b.value; }
      target = { kind: 'record', entityType: b.entityType, entityId: b.entityId, column: b.column, jsonKey: b.jsonKey ?? null, originalColumnValue: row[b.column] };
      await db.prepare(`UPDATE ${def.table} SET ${b.column}=? WHERE ${def.idColumn}=?`).run(next, b.entityId);
      if (def.table.startsWith('master_')) invalidateMasters();
    }
    const id = randomUUID();
    await db.prepare('INSERT INTO tamper_log(id,created_at,kind,target,before,after,restored) VALUES(?,?,?,?,?,?,0)').run(id, nowIso(), str(target.kind), JSON.stringify(target), JSON.stringify(before ?? null), JSON.stringify(after ?? null));
    await nonLedger(req, 'dev.tamper', `TAMPER (bypassing contracts): ${str(target.kind) === 'tx' ? `ledger tx ${str(b.txHash).slice(0, 10)}…` : `${b.entityType} ${b.entityId}.${b.jsonKey ?? b.column}`} ${JSON.stringify(before)} → ${JSON.stringify(after)}`, 200, { tamperId: id, before, after }, true, { bypassedContracts: true });
    ok(res, { id, target, before, after });
  });
  r.post('/dev/tamper/:id/restore', async (req: AuthedRequest, res) => {
    if (!allowed(req, 'tamper')) return fail(res, 403, 'PERMISSION_DENIED', 'Needs the Developer or Admin role');
    const t = await db.prepare('SELECT * FROM tamper_log WHERE id=?').get<Row>(req.params.id);
    if (!t) return notFound(res, 'Tamper record');
    if (t.restored) return fail(res, 409, 'CONFLICT', 'Already restored');
    const target = parseJson<Record<string, unknown>>(t.target, {});
    if (target.kind === 'tx') {
      const tx = await db.prepare('SELECT payload FROM ledger_txs WHERE tx_hash=?').get<Row>(str(target.txHash)); const payload = parseJson<Record<string, unknown>>(tx?.payload, {});
      const orig = parseJson<unknown>(t.before, null); if (orig === null) delete payload[str(target.payloadKey)]; else payload[str(target.payloadKey)] = orig;
      await db.prepare('UPDATE ledger_txs SET payload=? WHERE tx_hash=?').run(JSON.stringify(payload), str(target.txHash));
    } else { const def = entityDef(str(target.entityType)); await db.prepare(`UPDATE ${def.table} SET ${str(target.column)}=? WHERE ${def.idColumn}=?`).run(target.originalColumnValue, str(target.entityId)); if (def.table.startsWith('master_')) invalidateMasters(); }
    await db.prepare('UPDATE tamper_log SET restored=1 WHERE id=?').run(req.params.id);
    await nonLedger(req, 'dev.tamper-restore', `Restore tampered record (${str(target.kind)})`, 200, { tamperId: req.params.id }, true);
    ok(res, { restored: true });
  });
  r.post('/dev/reset', async (req: AuthedRequest, res) => {
    if (!allowed(req, 'resetDemo')) return fail(res, 403, 'PERMISSION_DENIED', 'Resetting the demo needs the Developer or Admin role');
    await reset();
    ok(res, { reset: true, relogin: true });
  });
  void ({} as DevTrace);
  return r;
}
