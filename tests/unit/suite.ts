// Shared API suite: runs against SQLite (default) and, opt-in, a disposable Postgres (see pg.test.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DB } from '../../server/db';
import { SimulatedLedger } from '../../server/ledger/simulated';
import { seedDatabase } from '../../server/seed/loader';
import { createApp } from '../../server/app';
import { createRuntime } from '../../server/contracts/runtime';
import { initClock } from '../../server/lib/clock';

export function defineSuite(name: string, open: () => Promise<DB>, skip = false): void {
  describe.skipIf(skip)(name, () => {
    let db: DB; let app: Express; let ledger: SimulatedLedger;
    const tokens: Record<string, string> = {};
    const as = async (u: string) => tokens[u] ??= (await request(app).post('/api/auth/login').send({ username: u }).expect(200)).body.data.token as string;
    const get = async (u: string, path: string) => request(app).get(path).set('Authorization', `Bearer ${await as(u)}`);
    const send = async (u: string, method: 'post' | 'put', path: string, body: unknown) => request(app)[method](path).set('Authorization', `Bearer ${await as(u)}`).send(body as object);

    beforeAll(async () => {
      db = await open();
      ledger = new SimulatedLedger(db);
      await ledger.init();
      await seedDatabase(db, ledger);
      await initClock(db);
      app = createApp(db, ledger, createRuntime(db, ledger));
    }, 120_000);
    afterAll(async () => { await db?.close(); });

    it('seeds a fully populated mill', async () => {
      const lots = (await get('qa', '/api/lots')).body.data as { lotNo: string; location: { stage: string } }[];
      expect(lots).toHaveLength(40);
      expect(new Set(lots.map((l) => l.location.stage)).size).toBeGreaterThanOrEqual(8); // every question "where is it now" has an answer
      const bales = (await get('qa', '/api/bales')).body.data as { status: string }[];
      expect(bales).toHaveLength(120);
      expect(bales.some((b) => b.status === 'IN_STORE') && bales.some((b) => b.status === 'ISSUED')).toBe(true);
      const overview = (await get('qa', '/api/masters/overview')).body.data;
      expect(overview.counts.map((c: { completeness: { overall: number } }) => c.completeness.overall)).toEqual([100, 100, 100, 100, 96.7, 100, 99.5, 96.7, 96.7, 96.7]); // by Ne: 16s 20s 24CH 30CH 30CP 34CH 40CH 40CP 50CP 60CP
    });

    it('answers a customer question about lot 101 on one screen', async () => {
      const p = (await get('qa', '/api/lots/101/passport')).body.data;
      expect(p.dispatch).toMatchObject({ vehicleNo: 'TN-39-AB-4521', invoiceNo: 'INV/26-27/0412', transporter: 'SRM Roadways', customerName: 'PD Textiles' });
      expect(p.packing).toMatchObject({ colorMaster: 'Green', colorOk: true });
      expect(p.mix.mixNo).toBe('M-001');
      expect(p.bales).toHaveLength(7);
      expect(p.bales.every((b: { bay: string; bin: string }) => b.bay && b.bin)).toBe(true);
      expect(p.journey.filter((s: { state: string; inAt: string | null; outAt: string | null }) => s.state === 'DONE' && s.inAt && (s.outAt || s.inAt)).length).toBeGreaterThanOrEqual(10);
      const rf6 = p.production.find((s: { stage: string }) => s.stage === 'RF').runs.find((r: { machineId: string }) => r.machineId === 'RF-6');
      expect(rf6.params.find((j: { key: string }) => j.key === 'SPINDLE_RPM')).toMatchObject({ color: 'red' });
      expect(p.accessories.find((a: { machineId: string }) => a.machineId === 'RF-6').items.find((j: { key: string }) => j.key === 'TRAVELLER_AGE_DAYS')).toMatchObject({ color: 'red' });
      const rfQuality = p.quality.find((q: { stage: string }) => q.stage === 'RF');
      expect(rfQuality.samples.filter((s: { machineId: string }) => s.machineId === 'RF-6').every((s: { values: { key: string; color: string }[] }) => s.values.find((v) => v.key === 'H')?.color === 'red')).toBe(true);
      expect(p.mix.fibre.find((j: { key: string }) => j.key === 'SFI')).toMatchObject({ color: 'red' });
      expect(p.ledger.verifiedRecords).toBe(p.ledger.totalRecords);
      const search = (await get('qa', '/api/search?q=101')).body.data as { kind: string; link: string }[];
      expect(search[0]).toMatchObject({ kind: 'lot', link: '/lots/LOT-101' });
    });

    it('judges results on the master version active on the production date, and re-judges on the latest', async () => {
      const h = (mode: string) => get('qa', `/api/lots/101/passport?mode=${mode}`).then((r) => r.body.data.quality.find((q: { stage: string }) => q.stage === 'RF').samples[0].values.find((v: { key: string }) => v.key === 'H'));
      expect(await h('asOf')).toMatchObject({ versionNo: 1, upper: 6.52 });
      expect(await h('latest')).toMatchObject({ versionNo: 2, upper: 6.42 });
    });

    it('records unauthorized contract calls as invalid ledger transactions without writes', async () => {
      const runtime = createRuntime(db, ledger);
      const before = Number((await db.prepare('SELECT COUNT(*) n FROM conclusions').get<{ n: number }>())?.n);
      const result = await runtime.run({ action: 'test.permission', label: 'Try restricted call', actor: { id: 'U-DISPATCH', username: 'dispatch', name: 'Dispatch', role: 'DISPATCH', org: 'MillOrg' }, request: { method: 'POST', path: '/api/test', query: {}, body: {} } }, (x) => x.call('Quality.recordConclusion', {}));
      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      const last = (await ledger.getBlockTxs(await ledger.height())).at(-1);
      expect(last).toMatchObject({ status: 'INVALID', fn: 'checkPermission' });
      expect(Number((await db.prepare('SELECT COUNT(*) n FROM conclusions').get<{ n: number }>())?.n)).toBe(before);
    });

    it('runs the lot 101 hairiness complaint end to end: portal → trace → AI → conclusion → customer view', async () => {
      expect((await get('pdt', '/api/lots')).status).toBe(403); // customers only reach the portal API
      expect((await get('pdt', '/api/portal/lots/110')).status).toBe(404); // another customer's lot
      const missing = await send('pdt', 'post', '/api/portal/complaints', { lotNo: '999', type: 'HAIRINESS', description: 'There is no such lot in the mill' });
      expect(missing.status).toBe(404);
      const foreign = await send('pdt', 'post', '/api/portal/complaints', { lotNo: '110', type: 'HAIRINESS', description: 'This lot was never delivered to us' });
      expect(foreign.status).toBe(422);
      const reg = await send('pdt', 'post', '/api/portal/complaints', { lotNo: '101', type: 'HAIRINESS', description: 'The lot 101 I bought yesterday has more hairiness than usual.' });
      expect(reg.status).toBe(201);
      const id = reg.body.data.id as string;
      const ws = (await get('qa', `/api/complaints/${id}`)).body.data;
      expect(ws.complaint.status).toBe('OPEN');
      expect(ws.passport.lot.lotNo).toBe('101');
      const an = (await send('qa', 'post', '/api/analysis/run', { complaintId: id })).body.data;
      const [first, second] = an.result.rootCauses;
      expect(first).toMatchObject({ machineId: 'RF-6', category: 'MACHINE_AND_ACCESSORY' });
      expect(first.evidence.some((e: { key: string; color: string }) => e.key === 'SPINDLE_RPM' && e.color === 'red')).toBe(true);
      expect(first.evidence.some((e: { key: string; color: string }) => e.key === 'TRAVELLER_AGE_DAYS' && e.color === 'red')).toBe(true);
      expect(second.category).toBe('MIX_FIBRE');
      expect(second.evidence.some((e: { text: string }) => e.text.includes('Bale 9005'))).toBe(true);
      expect(an.result.recallScope.lots.map((l: { lotNo: string }) => l.lotNo)).toEqual(expect.arrayContaining(['102', '110', '111', '112']));
      expect(an.llm.status).toBe('disabled'); // no API key: statistics only, nothing invented
      expect((await get('qa', `/api/complaints/${id}`)).body.data.complaint.status).toBe('UNDER_ANALYSIS');
      const premature = await send('cs', 'post', `/api/complaints/${id}/conclusion`, { conclusionHtml: '<p>x</p>', rootCause: 'x', correctiveAction: 'x', preventiveAction: 'x', customerReply: 'x' });
      expect(premature.status).toBe(403); // customer service cannot conclude
      const close = await send('qa', 'post', `/api/complaints/${id}/conclusion`, { conclusionHtml: '<p>Cause confirmed on RF-6 (spindle speed + overdue traveller) and the high-SFI mix.</p>', rootCause: 'RF-6 above spindle-speed master with an overdue traveller; high short-fibre mix.', correctiveAction: 'Reset speed, replace traveller, hold remaining lots.', preventiveAction: 'Traveller-age alert at 80% of life.', customerReply: 'We found the cause on one ring frame and have replaced the affected cartons.', analysisId: an.id });
      expect(close.status).toBe(200);
      const mine = (await get('pdt', `/api/portal/complaints/${id}`)).body.data;
      expect(mine.complaint.status).toBe('RESOLVED');
      expect(mine.summary.reply).toContain('replaced');
    });

    it('moves a master through draft → QA approved → active and re-judges', async () => {
      const bad = await send('operator', 'put', '/api/masters/versions/MV-30CH-PRODUCTION-2/items', { items: [{ scope: 'RF', parameter: 'SPINDLE_RPM', std: 17000, lower: 17500, upper: 18000 }] });
      expect(bad.status).toBe(422); // lower must be ≤ std
      expect((await send('operator', 'post', '/api/masters/versions/MV-30CH-PRODUCTION-2/approve', {})).status).toBe(403); // production cannot approve
      const ok = await send('qa', 'post', '/api/masters/versions/MV-30CH-PRODUCTION-2/approve-activate', {});
      expect(ok.status).toBe(200);
      const v2 = (await get('qa', '/api/masters/versions/MV-30CH-PRODUCTION-2')).body.data;
      expect(v2.version.status).toBe('ACTIVE');
      const v1 = (await get('qa', '/api/masters/versions/MV-30CH-PRODUCTION-1')).body.data;
      expect(v1.version.status).toBe('SUPERSEDED');
      expect(v1.version.effectiveTo).toBe(v2.version.effectiveFrom);
      const runs = (await get('qa', '/api/production?count=30CH&stage=RF&mode=latest')).body.data.items as { params: { key: string; std: number }[] }[];
      expect(runs[0].params.find((j) => j.key === 'SPINDLE_RPM')?.std).toBe(17200);
    });


    it('clones a master, validates a CSV import (dry run), imports it and exports it again', async () => {
      const created = await send('qa', 'post', '/api/masters/versions', { countId: '20S', masterType: 'QUALITY', cloneFrom: 'MV-20S-QUALITY-1', note: 'test clone' });
      expect(created.status).toBe(201);
      const vid = created.body.data.id as string;
      expect(vid).toBe('MV-20S-QUALITY-2');
      expect((await send('qa', 'post', '/api/masters/versions', { countId: '20S', masterType: 'QUALITY' })).status).toBe(409); // only one open draft per master
      const csv = (await request(app).get(`/api/masters/versions/${vid}/export`).set('Authorization', `Bearer ${await as('qa')}`).expect(200)).text;
      expect(csv.split('\n')[0]).toBe('scope,parameter,label,unit,std,lower,upper,frequency,instrument,note');
      const broken = 'scope,parameter,std,lower,upper\nRF,U,9.0,9.5,9.8\nRF,NOPE,1,0,2\n';
      const dry = (await send('qa', 'post', `/api/masters/versions/${vid}/import?dryRun=1`, { csv: broken })).body.data;
      expect(dry.ok).toBe(false);
      expect(dry.errors.join(' ')).toMatch(/Lower limit 9.5 must be ≤ standard 9/);
      expect(dry.errors.join(' ')).toMatch(/unknown parameter "NOPE"/);
      const good = await send('qa', 'post', `/api/masters/versions/${vid}/import`, { csv: 'scope,parameter,std,lower,upper\nRF,U,9.4,8.9,9.9\n' });
      expect(good.status).toBe(200);
      const items = (await get('qa', `/api/masters/versions/${vid}`)).body.data.items as { scope: string; parameter: string; std: number; lower: number; upper: number; prev: { std: number } | null }[];
      expect(items.find((i) => i.scope === 'RF' && i.parameter === 'U')).toMatchObject({ std: 9.4, lower: 8.9, upper: 9.9 });
      expect(items.find((i) => i.scope === 'RF' && i.parameter === 'U')?.prev?.std).toBeCloseTo(9.3, 1); // previous version shown for clone-and-adjust
      expect((await send('qa', 'post', `/api/masters/versions/${vid}/reject`, { reason: 'test cleanup' })).status).toBe(200);
    });

    it('blocks dispatch without QA release and on a QA hold; validates vehicle numbers', async () => {
      const ready = (await get('dispatch', '/api/dispatches/ready')).body.data as { lotId: string; lotNo: string; qaReleased: boolean }[];
      const hold = ready.find((l) => l.lotNo === '126');
      expect(hold).toBeTruthy();
      const body = { customerId: 'CUST-GGT', lots: [{ lotId: 'LOT-126' }], vehicleNo: 'TN-37-BC-1234', driverName: 'T', transporter: 'VRL', lrNo: 'LR1', invoiceNo: 'INV/1' };
      expect((await send('dispatch', 'post', '/api/dispatches', body)).status).toBe(422);
      expect((await send('dispatch', 'post', '/api/dispatches', { ...body, vehicleNo: 'NOT A PLATE' })).status).toBe(422);
    });

    it('detects tampering with the ledger and with records, pinpointing the field', async () => {
      expect((await send('dev', 'post', '/api/dev/validate', {})).body.data).toMatchObject({ valid: true, issues: [] });
      const test = (await get('dev', '/api/quality?lot=101&stage=RF&machine=RF-6')).body.data.items[0];
      const t = (await send('dev', 'post', '/api/dev/tamper', { kind: 'record', entityType: 'test_result', entityId: test.id, column: 'values_json', jsonKey: 'H', value: 6 })).body.data;
      const report = (await send('dev', 'post', '/api/dev/validate', {})).body.data;
      expect(report.valid).toBe(false);
      expect(report.issues[0]).toMatchObject({ kind: 'RECORD_HASH_MISMATCH', entityId: test.id, field: 'values_json.H' });
      await send('dev', 'post', `/api/dev/tamper/${t.id}/restore`, {});
      expect((await send('dev', 'post', '/api/dev/validate', {})).body.data.valid).toBe(true);
      const log = (await get('dev', '/api/dev/audit?lot=101&pageSize=200')).body.data;
      expect(log.total).toBeGreaterThan(30);
      expect(log.items.some((a: { action: string }) => a.action === 'complaint.register' || a.action.startsWith('quality.'))).toBe(true);
    });
  });
}
