import express, { type NextFunction, type Request, type Response } from 'express';
import type { DB } from './db';
import { getSettings } from './db';
import type { LedgerService } from './ledger/types';
import { createRuntime } from './contracts/runtime';
import type { ContractRuntime } from './contracts/types';
import { ROLE_LABEL, ROLE_ORG } from '@shared/permissions';
import { COMPLAINT_TYPES, COMPLAINT_TYPE_LABEL, MASTER_LABEL, MASTER_PLAIN, PARAMS, STAGE_INFO, STAGES } from '@shared/params';
import { config } from './config';
import { randomHex } from './lib/hash';
import { nowIso } from './lib/clock';
import { act, fail, notFound, ok, wrapAsync, type ApiCtx, type AuthedRequest, type AuthedUser } from './api/common';
import { lotsRouter } from './api/lots';
import { mastersRouter } from './api/masters';
import { complaintsRouter } from './api/complaints';
import { portalRouter } from './api/portal';
import { devRouter } from './api/dev';
import { buildPassport } from './domain/lots';
import { forwardTrace } from './domain/overview';
import { demoContext } from './domain/demoContext';

type Row = Record<string, unknown>;
const userOf = (row: Row): AuthedUser => ({ id: String(row.id), username: String(row.username), name: String(row.name), role: row.role as AuthedUser['role'], org: String(row.org), customerId: (row.customer_id as string) ?? null });
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export interface AppOptions { reset?: () => Promise<void> }

export function createApp(db: DB, ledger: LedgerService, runtime: ContractRuntime = createRuntime(db, ledger), options: AppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  wrapAsync(app as never);
  app.use(express.json({ limit: '2mb' }));
  const c: ApiCtx = { db, ledger, runtime };

  app.get('/api/health', async (_req, res) => ok(res, { millName: (await getSettings(db)).millName, ledger: await ledger.stats(), now: nowIso() }));
  app.get('/api/meta', async (_req, res) => ok(res, {
    millName: (await getSettings(db)).millName, now: nowIso(), businessDate: (await getSettings(db)).businessDate,
    counts: await db.prepare('SELECT id,label,display,ne,uses_comber AS usesComber FROM counts ORDER BY ne,id').all(),
    stages: STAGES.map((s) => STAGE_INFO[s]), params: PARAMS, masterLabels: MASTER_LABEL, masterPlain: MASTER_PLAIN, complaintTypes: COMPLAINT_TYPES.map((t) => ({ key: t, label: COMPLAINT_TYPE_LABEL[t] })),
    roles: Object.entries(ROLE_LABEL).map(([role, label]) => ({ role, label })), ai: { llmEnabled: config.ai.enabled, provider: config.ai.enabled ? config.ai.provider : null, model: config.ai.enabled ? config.ai.model : null },
    ledger: { adapter: ledger.adapter, validators: ledger.validators(), policy: ledger.policy() },
  }));
  // the public login screen lists the demo accounts
  app.get('/api/auth/demo-users', async (_req, res) => ok(res, (await db.prepare('SELECT username,name,role,title,customer_id AS customerId FROM users WHERE username NOT LIKE \'op%\' AND username NOT LIKE \'lab%\' AND username NOT LIKE \'pack%\' ORDER BY CASE role WHEN \'BUYER\' THEN 2 ELSE 1 END, name').all<Row>()).map((u) => ({ ...u, roleLabel: ROLE_LABEL[u.role as keyof typeof ROLE_LABEL], org: ROLE_ORG[u.role as keyof typeof ROLE_ORG] }))));
  // …and describes the mill and its featured lot, all read from the database
  app.get('/api/auth/demo-context', async (_req, res) => ok(res, await demoContext(db)));

  app.post('/api/auth/login', async (req, res) => {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const row = await db.prepare('SELECT * FROM users WHERE username = ?').get<Row>(username);
    if (!row) return fail(res, 401, 'UNAUTHENTICATED', 'Unknown user');
    const actor = userOf(row);
    const action = await runtime.run({ action: 'auth.login', label: `Sign in: ${actor.name} (${actor.role})`, actor, request: { method: 'POST', path: req.path, query: {}, body: { username } } }, (x) => x.call('Access.login', { userId: actor.id }));
    if (!action.ok) return res.status(action.status).json({ ok: false, error: action.error, trace: action.trace });
    const token = randomHex(24);
    await db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, actor.id, nowIso());
    res.json({ ok: true, data: { token, user: { id: actor.id, username: actor.username, name: actor.name, role: actor.role, org: actor.org, title: row.title, customerId: actor.customerId } }, trace: action.trace });
  });

  // ---- public QR passport: a dispatch passport (PP-XXXXXXXX) or a carton code (C-101-007)
  app.get('/api/passports/:code', async (req, res) => {
    const code = req.params.code.toUpperCase();
    const carton = /^C-(\d+)-(\d+)$/.exec(code);
    let dispatchId: string | null = null; let lotId: string | null = null; let cartonNo: number | null = null;
    if (carton) {
      const lot = await db.prepare('SELECT id FROM lots WHERE lot_no=?').get<Row>(carton[1]);
      const pk = lot ? await db.prepare('SELECT cartons FROM packing WHERE lot_id=?').get<Row>(str(lot.id)) : undefined;
      if (!lot || !pk || Number(carton[2]) < 1 || Number(carton[2]) > Number(pk.cartons)) return notFound(res, 'Carton');
      lotId = str(lot.id); cartonNo = Number(carton[2]);
      dispatchId = str((await db.prepare('SELECT dispatch_id FROM dispatch_lots WHERE lot_id=?').get<Row>(lotId))?.dispatch_id) || null;
    } else {
      const p = await db.prepare('SELECT dispatch_id FROM passports WHERE code=?').get<Row>(code);
      if (!p) return notFound(res, 'Passport');
      dispatchId = str(p.dispatch_id);
    }
    const d = dispatchId ? await db.prepare('SELECT d.*, c.name customer_name FROM dispatches d JOIN customers c ON c.id=d.customer_id WHERE d.id=?').get<Row>(dispatchId) : undefined;
    const lotIds = lotId ? [lotId] : (await db.prepare('SELECT lot_id FROM dispatch_lots WHERE dispatch_id=?').all<Row>(dispatchId as string)).map((x) => str(x.lot_id));
    const lots = [];
    for (const id of lotIds) {
      const p = await buildPassport(db, id, 'asOf', nowIso());
      if (!p) continue;
      const lotTests = p.quality.flatMap((q) => q.samples.flatMap((s) => s.values));
      lots.push({
        lotNo: p.lot.lotNo, countDisplay: p.lot.countDisplay, mixNo: p.mix.mixNo, recipe: p.mix.recipe.map((r) => ({ label: r.label, pct: r.pct })), baleCount: p.bales.length, origins: [...new Set(p.bales.map((b) => `${b.variety} — ${b.supplier}, ${b.station}`))],
        journey: p.journey.filter((s) => s.inAt).map((s) => ({ stage: s.stage, label: s.label, plain: s.plain, inAt: s.inAt, outAt: s.outAt, state: s.state })),
        quality: { samples: p.quality.reduce((n, q) => n + q.samples.length, 0), readings: lotTests.length, withinSpec: lotTests.filter((j) => j.color === 'green' || j.color === 'yellow').length, lotComposite: p.quality.flatMap((q) => q.samples.filter((s) => s.type === 'LOT').flatMap((s) => s.values.filter((v) => ['U', 'CV', 'IPI', 'H', 'CSP', 'COUNT'].includes(v.key)).map((v) => ({ stage: q.stage, key: v.key, label: v.label, value: v.value, unit: v.unit, color: v.color, plain: v.plain })))) },
        packing: p.packing ? { cartons: p.packing.cartons, cones: p.packing.conesPacked, netKg: p.packing.netKg, coneColor: p.packing.colorActual, colorOk: p.packing.colorOk, colorHex: p.packing.colorHex, packedAt: p.packing.packedAt } : null,
        ledger: p.ledger, packingChain: p.packing?.chain ?? null, lotChain: p.lot.chain,
      });
    }
    const proofRow = carton ? await db.prepare('SELECT tx_hash, block_number, id FROM packing WHERE lot_id=?').get<Row>(lotId as string) : await db.prepare('SELECT tx_hash, block_number, code id FROM passports WHERE code=?').get<Row>(code);
    const txHash = str(proofRow?.tx_hash); const blockNumber = Number(proofRow?.block_number);
    const block = txHash ? await ledger.getBlock(blockNumber) : null; const proof = txHash ? await ledger.getMerkleProof(txHash) : []; const tx = txHash ? await ledger.getTx(txHash) : null;
    const verified = !!block && !!tx && ledger.verifyMerkleProof(txHash, proof, block.merkleRoot) && tx.entityRefs.some((ref) => ref.id === str(proofRow?.id));
    ok(res, { code, kind: carton ? 'carton' : 'dispatch', cartonNo, customerName: d ? str(d.customer_name) : null, dispatchNo: d ? str(d.dispatch_no) : null, dispatchedAt: d ? d.dispatched_at : null, deliveredAt: d ? d.delivered_at : null, netKg: d ? d.net_kg : null, lots, ledgerProof: { txHash, blockNumber, blockHash: block?.hash ?? null, merkleRoot: block?.merkleRoot ?? null, merkleProof: proof, approvals: block?.approvals ?? [], verified, verifiedAt: nowIso() } });
  });

  // ---- everything below needs a session
  app.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const row = token ? await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get<Row>(token) : undefined;
    if (!row) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in to continue');
    req.actor = userOf(row);
    // customers only ever reach the portal API (and the shared meta / document-file routes)
    if (req.actor.role === 'BUYER' && !/^\/api\/(portal\/|auth\/|meta|documents(\/[^/]+\/file)?$|passports\/)/.test(req.path)) return fail(res, 403, 'PERMISSION_DENIED', 'Customers can only use the customer portal');
    next();
  });
  app.get('/api/auth/me', async (req: AuthedRequest, res) => ok(res, await db.prepare('SELECT id,username,name,role,org,title,customer_id AS customerId FROM users WHERE id=?').get(req.actor?.id)));
  app.get('/api/notifications', async (_req, res) => ok(res, await db.prepare('SELECT id,severity,title,body,link,created_at AS createdAt,read FROM notifications ORDER BY created_at DESC LIMIT 50').all()));
  app.get('/api/dashboard/activity', async (req, res) => ok(res, await db.prepare("SELECT action_id AS id,timestamp AS at,COALESCE(username,'system') AS actorName,COALESCE(role,'SYSTEM') AS actorRole,action,label,accepted,block_number AS blockNumber FROM audit_log ORDER BY timestamp DESC LIMIT ?").all(Math.min(Number(req.query.limit) || 10, 100))));
  app.use('/api', lotsRouter(c), mastersRouter(c), complaintsRouter(c), portalRouter(c), devRouter(c, options.reset ?? (async () => { throw new Error('Reset is not configured'); })));

  app.use((_req, res) => fail(res, 404, 'NOT_FOUND', 'API route not found'));
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error(`[api] ${req.method} ${req.path} failed:`, error);
    if (res.headersSent) return;
    const status = (error as { type?: string }).type === 'entity.parse.failed' ? 400 : 500;
    fail(res, status, status === 400 ? 'BAD_REQUEST' : 'INTERNAL', status === 400 ? 'Malformed request body' : 'Internal server error');
  });
  void act; void forwardTrace;
  return app;
}
