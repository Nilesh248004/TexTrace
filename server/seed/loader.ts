// Loads the deterministic plan into the database and anchors every row on the simulated ledger:
//   1. plain tables (users, counts, orders, settings, sequences, notifications)
//   2. entity rows in dependency order (final state; version = 1 + history steps)
//   3. one ledger block per production day; every version of every entity is a tx (masters bundle their items)
//   4. anchor columns + entity_anchors back-filled, and one audit-log entry per tx so the Developer Console is populated
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import type { LedgerService, PendingTx } from '../ledger/types';
import type { DbChange, DevTrace, EntityRef, Role } from '@shared/types';
import { config } from '../config';
import { entityDef, recordHashOf, snapshotOf } from '../db/entities';
import { extractRefs } from '../lib/refs';
import { invalidateMasters } from '../domain/masters';
import { initClock } from '../lib/clock';
import { istDate } from '@shared/format';
import { generatePlan, type Plan, type SeedRow } from './generate';
import { runEngine } from '../analysis/engine';
import { narrate } from '../analysis/narrative';
import { hashObject } from '../lib/hash';

const ORDER = ['customer', 'machine', 'bale', 'mix', 'mix_bale', 'lot', 'master_version', 'master_item', 'lens', 'accessory_change', 'stage_run', 'test_result', 'packing', 'qa_override', 'dispatch', 'dispatch_lot', 'passport', 'document', 'complaint', 'complaint_event', 'analysis', 'conclusion'];

interface Tx {
  at: number; seq: number; actor: string; contract: string; fn: string; label: string; method: string; path: string;
  refs: EntityRef[]; changes: DbChange[]; payload: Record<string, unknown>;
}

function payloadOf(type: string, row: Record<string, unknown>, steps: string[]): Record<string, unknown> {
  const pick = (...keys: string[]) => Object.fromEntries(keys.filter((k) => row[k] !== undefined && row[k] !== null).map((k) => [k, row[k]]));
  const base: Record<string, unknown> = { entity: type, id: row[entityDef(type).idColumn] };
  switch (type) {
    case 'stage_run': return { ...base, ...pick('lot_id', 'stage', 'machine_id', 'in_at', 'out_at', 'input_kg', 'output_kg', 'waste_kg', 'batch_ref') };
    case 'test_result': return { ...base, ...pick('sample_id', 'lot_id', 'stage', 'machine_id', 'sample_type', 'tested_at'), values: JSON.parse(String(row.values_json)) };
    case 'accessory_change': return { ...base, ...pick('machine_id', 'kind', 'spec', 'changed_at') };
    case 'bale': return { ...base, ...pick('bale_no', 'variety', 'bay', 'bin', 'status', 'mix_id'), step: steps[0] };
    case 'mix': return { ...base, ...pick('mix_no', 'count_id', 'status', 'total_kg') };
    case 'lot': return { ...base, ...pick('lot_no', 'count_id', 'mix_id', 'status') };
    case 'packing': return { ...base, ...pick('lot_id', 'cartons', 'net_kg', 'color_actual', 'color_master', 'color_ok') };
    case 'dispatch': return { ...base, ...pick('dispatch_no', 'customer_id', 'quantity_kg', 'vehicle_no', 'invoice_no', 'status') };
    case 'complaint': return { ...base, ...pick('complaint_no', 'type', 'customer_id', 'lot_id', 'status') };
    case 'master_version': return { ...base, ...pick('master_type', 'count_id', 'version_no', 'status', 'effective_from') };
    default: return base;
  }
}

const CHECKS: Record<string, string[]> = {
  'AssetID.registerBale': ['bale-no-unique', 'hvi-present', 'bay-bin-present'],
  'AssetID.registerMix': ['bales-in-store', 'recipe-within-master-band', 'count-master-active'],
  'AssetID.registerLot': ['mix-exists', 'count-matches-mix', 'lot-no-unique'],
  'ProcessEvent.issueBales': ['bales-reserved-for-mix', 'bales-in-store'],
  'ProcessEvent.logStageRun': ['lot-exists', 'stage-order', 'machine-in-department', 'mass-balance', 'time-window'],
  'ProcessEvent.recordAccessoryChange': ['machine-exists', 'kind-valid-for-department'],
  'ProcessEvent.recordPacking': ['lot-exists', 'ring-and-winding-complete', 'color-code-verified'],
  'Quality.recordTestResult': ['lot-exists', 'stage-started', 'values-keys', 'values-sane', 'judged-against-active-master'],
  'Quality.releaseLot': ['lot-composite-tested', 'no-open-red'],
  'Quality.recordOverride': ['reason-required', 'qa-role'],
  'Quality.registerComplaint': ['customer-exists', 'lot-dispatched-to-customer', 'type-valid'],
  'Quality.transitionComplaint': ['complaint-exists', 'transition-allowed'],
  'Quality.recordConclusion': ['fields-required', 'status-under-analysis'],
  'Quality.upsertLens': ['type-valid', 'weights-valid'],
  'Master.createVersion': ['count-exists', 'previous-version-exists'],
  'Master.approve': ['status-draft', 'qa-role', 'completeness-checked'],
  'Master.activate': ['status-approved', 'supersede-active-version'],
  'Transfer.createDispatch': ['customer-exists', 'mass-balance-custody', 'qa-release', 'quality-gate', 'vehicle-format'],
  'Transfer.markDelivered': ['dispatch-exists', 'delivery-after-dispatch'],
  'AssetID.issuePassport': ['dispatch-exists', 'not-issued'],
  'AssetID.anchorDocument': ['sha256-recorded'],
  'AssetID.registerCustomer': ['name-required'], 'AssetID.registerMachine': ['department-valid'],
};

export async function seedDatabase(db: DB, ledger: LedgerService, _profile: 'full' | 'pre-demo' = 'full', plan: Plan = generatePlan()): Promise<Plan> {
  const userById = new Map(plan.users.map((u) => [String(u.id), u]));
  // ---- build final states + txs
  const txs: Tx[] = [];
  const bundleTx = new Map<string, Tx>();
  const finals: { type: string; row: Record<string, unknown> }[] = [];
  let seq = 0;
  const lastRef = new Map<string, { tx: Tx; ref: EntityRef }>();
  const allRefs: { tx: Tx; ref: EntityRef }[] = [];
  const mk = (type: string, state: Record<string, unknown>, version: number): EntityRef => {
    const row: Record<string, unknown> = { ...state, version };
    return { type, id: String(row[entityDef(type).idColumn]), version, recordHash: recordHashOf(type, row), snapshot: snapshotOf(type, row) };
  };
  const addRows = (rows: SeedRow[]): { type: string; row: Record<string, unknown> }[] => {
  const added: { type: string; row: Record<string, unknown> }[] = [];
  for (const sr of rows) {
    let state: Record<string, unknown> = { ...sr.row };
    const def = entityDef(sr.type);
    const id = String(state[def.idColumn]);
    // v1
    const ref1 = mk(sr.type, state, 1);
    const change1: DbChange = { table: def.table, op: 'insert', key: id, before: null, after: { ...state, version: 1 } };
    let tx: Tx | undefined = sr.bundle ? bundleTx.get(sr.bundle) : undefined;
    if (!tx) {
      tx = { at: Date.parse(sr.at), seq: seq++, actor: sr.actor, contract: sr.contract, fn: sr.fn, label: sr.label, method: sr.method ?? 'POST', path: sr.path ?? '/api/' + sr.type, refs: [], changes: [], payload: sr.payload ?? payloadOf(sr.type, state, [sr.fn]) };
      txs.push(tx);
      if (sr.bundle) bundleTx.set(sr.bundle, tx);
    } else if (sr.bundle) {
      tx.payload = { ...tx.payload, items: ((tx.payload.items as number) ?? 0) + 1 };
    }
    tx.refs.push(ref1); tx.changes.push(change1);
    allRefs.push({ tx, ref: ref1 }); lastRef.set(`${sr.type}|${id}`, { tx, ref: ref1 });
    let version = 1;
    for (const step of sr.history ?? []) {
      const before = { ...state, version };
      state = { ...state, ...step.patch };
      version += 1;
      const ref = mk(sr.type, state, version);
      const stx: Tx = { at: Date.parse(step.at), seq: seq++, actor: step.actor, contract: step.contract, fn: step.fn, label: step.label, method: 'POST', path: '/api/' + sr.type, refs: [ref], changes: [{ table: def.table, op: 'update', key: id, before, after: { ...state, version } }], payload: step.payload ?? { ...payloadOf(sr.type, state, [step.fn]), patch: step.patch } };
      txs.push(stx); allRefs.push({ tx: stx, ref }); lastRef.set(`${sr.type}|${id}`, { tx: stx, ref });
    }
    finals.push({ type: sr.type, row: { ...state, version } });
    added.push({ type: sr.type, row: { ...state, version } });
  }
  return added;
  };
  addRows(plan.rows);

  // ---- 1. plain tables + entity rows
  const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params);
  const insert = async (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    await run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((k) => row[k]));
  };
  await db.transaction(async () => {
    for (const u of plan.users) await insert('users', u);
    for (const c of plan.counts) await insert('counts', c);
    for (const t of ORDER) for (const f of finals.filter((x) => x.type === t)) if (t === 'customer') await insert(entityDef(t).table, f.row);
    for (const o of plan.orders) await insert('orders', o);
    for (const t of ORDER) if (t !== 'customer') for (const f of finals) if (f.type === t) await insert(entityDef(t).table, f.row);
    for (const [key, value] of Object.entries(plan.settings)) await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
    for (const [name, value] of Object.entries(plan.sequences)) await run('INSERT INTO sequences(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value', name, value);
    for (const n of plan.notifications) await run('INSERT INTO notifications(id,severity,title,body,link,created_at,read) VALUES(?,?,?,?,?,?,0)', n.id, n.severity, n.title, n.body, n.link, n.created_at);
  })();
  // AI analyses for complaints that are in progress (run through the same engine the product uses)
  invalidateMasters();
  const extra: SeedRow[] = [];
  for (const sr of plan.rows.filter((x) => x.type === 'complaint' && (x.history ?? []).some((h) => h.patch.status === 'UNDER_ANALYSIS') && !(x.history ?? []).some((h) => h.patch.status === 'RESOLVED'))) {
    const step = (sr.history ?? []).find((h) => h.patch.status === 'UNDER_ANALYSIS') as NonNullable<SeedRow['history']>[number];
    const at = new Date(Date.parse(step.at) - 5 * 60_000).toISOString();
    const base = await runEngine(db, { lotKey: String(sr.row.lot_id), complaintId: String(sr.row.id) }, at);
    if (!base) continue;
    const { result, llm } = await narrate(base);
    const id = `AN-0001-${result.lot.lotNo}`;
    const inputHash = hashObject({ lot: result.lot.id, complaint: sr.row.id, mode: result.mode, lens: result.lens, reference: result.referenceLots.map((r) => r.lotId), observations: result.parameters.map((p) => [p.stage, p.key, p.machineId, p.value, p.color]) });
    extra.push({ type: 'analysis', row: { id, complaint_id: sr.row.id, lot_id: sr.row.lot_id, run_no: 1, context: JSON.stringify({ mode: 'asOf', focus: null }), comparison_lot_ids: JSON.stringify(result.referenceLots.map((r) => r.lotId)), result: JSON.stringify(result), input_hash: inputHash, output_hash: hashObject(result), llm: JSON.stringify(llm), created_by: 'U-QA', created_at: at }, at, actor: 'U-QA', contract: 'Quality', fn: 'anchorAnalysis', label: `AI analysis ${id} for complaint ${String(sr.row.complaint_no)}`, method: 'POST', path: '/api/analysis/run', payload: { analysisId: id, complaintId: sr.row.id, lotId: sr.row.lot_id, runNo: 1, inputHash, outputHash: hashObject(result), engineVersion: result.engineVersion } });
  }
  if (extra.length) await db.transaction(async () => { for (const f of addRows(extra)) await insert(entityDef(f.type).table, f.row); })();
  for (const f of plan.files) {
    const full = path.join(config.uploadsDir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content);
  }

  // ---- 2. ledger: one block per IST day
  txs.sort((a, b) => a.at - b.at || a.seq - b.seq);
  const byDay = new Map<string, Tx[]>();
  for (const t of txs) { const d = istDate(new Date(t.at).toISOString()); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(t); }
  const committed = new Map<Tx, { txHash: string; block: number }>();
  const auditRows: Record<string, unknown>[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const group = byDay.get(day)!;
    const pending: PendingTx[] = group.map((t) => ({
      contract: t.contract as PendingTx['contract'], fn: t.fn, payload: t.payload, actorId: t.actor, actorRole: (userById.get(t.actor)?.role ?? 'SYSTEM') as Role | 'SYSTEM', status: 'VALID', reason: null, entityRefs: t.refs,
    }));
    const commit = await ledger.commit(pending, { timestamp: new Date(group[group.length - 1].at).toISOString() });
    commit.txs.forEach((ct, i) => {
      const t = group[i];
      committed.set(t, { txHash: ct.txHash, block: commit.block.number });
      const user = userById.get(t.actor);
      const trace: DevTrace = {
        actionId: randomUUID(), action: `${t.contract.toLowerCase()}.${t.fn}`, label: t.label, timestamp: ct.timestamp,
        user: user ? { id: String(user.id), username: String(user.username), name: String(user.name), role: user.role as Role } : null,
        request: { method: t.method, path: t.path, query: {}, body: t.payload }, response: { status: 200, body: { ok: true, entities: t.refs.map((r) => `${r.type}:${r.id}@v${r.version}`).slice(0, 12), count: t.refs.length } },
        invocations: [{ contract: t.contract as never, fn: t.fn, payload: t.payload, accepted: true, reason: null, checks: (CHECKS[`${t.contract}.${t.fn}`] ?? ['actor-permitted']).map((rule) => ({ rule, passed: true, detail: 'ok' })), txHash: ct.txHash, blockNumber: commit.block.number }],
        accepted: true, reason: null, txHashes: [ct.txHash], blockNumber: commit.block.number, validatorApprovals: commit.block.approvals,
        dbDiff: t.changes.length > 25 ? [...t.changes.slice(0, 25), { table: t.changes[0].table, op: 'insert', key: `…and ${t.changes.length - 25} more rows`, before: null, after: null }] : t.changes,
        durationMs: 18 + (i * 7) % 41, extra: null,
      };
      auditRows.push({
        action_id: trace.actionId, timestamp: trace.timestamp, user_id: user ? user.id : null, username: user ? user.username : null, role: user ? user.role : null, action: trace.action, label: t.label,
        method: t.method, path: t.path, accepted: 1, reason: null, contracts: JSON.stringify([`${t.contract}.${t.fn}`]), tx_hashes: JSON.stringify([ct.txHash]), block_number: commit.block.number,
        refs: extractRefs(t.label, t.refs.map((r) => r.snapshot)), trace: JSON.stringify(trace),
      });
    });
  }

  // ---- 3. anchors + audit
  await db.transaction(async () => {
    for (const { tx, ref } of allRefs) {
      const c = committed.get(tx) as { txHash: string; block: number };
      await run('INSERT INTO entity_anchors(entity_type,entity_id,version,record_hash,tx_hash,block_number,created_at) VALUES(?,?,?,?,?,?,?)', ref.type, ref.id, ref.version, ref.recordHash, c.txHash, c.block, new Date(tx.at).toISOString());
    }
    for (const { tx, ref } of lastRef.values()) {
      const c = committed.get(tx) as { txHash: string; block: number };
      const def = entityDef(ref.type);
      await run(`UPDATE ${def.table} SET tx_hash=?, block_number=?, record_hash=? WHERE ${def.idColumn}=?`, c.txHash, c.block, ref.recordHash, ref.id);
    }
    for (const a of auditRows) await insert('audit_log', a);
  })();
  invalidateMasters();
  await initClock(db);
  return plan;
}
