import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDb } from '../../server/db';
import { SimulatedLedger } from '../../server/ledger/simulated';
import { seedDatabase } from '../../server/seed/loader';
import { createApp } from '../../server/app';
import { createRuntime } from '../../server/contracts/runtime';
import type { DB } from '../../server/db';

let db: DB | undefined;
afterEach(() => { db?.close(); db = undefined; });

describe('TexTrace API foundation', () => {
  it('logs in and serves seeded dashboard and traceability records', async () => {
    db = openDb(':memory:');
    const ledger = new SimulatedLedger(db);
    ledger.init();
    seedDatabase(db, ledger);
    const app = createApp(db, ledger);
    const login = await request(app).post('/api/auth/login').send({ username: 'qa' }).expect(200);
    const token = login.body.data.token as string;
    expect(login.body.trace.invocations[0].contract).toBe('Access');
    const [summary, lots, complaints, standards, activity] = await Promise.all([
      request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${token}`).expect(200),
      request(app).get('/api/lots').set('Authorization', `Bearer ${token}`).expect(200),
      request(app).get('/api/complaints').set('Authorization', `Bearer ${token}`).expect(200),
      request(app).get('/api/standards?countId=30CH').set('Authorization', `Bearer ${token}`).expect(200),
      request(app).get('/api/dashboard/activity').set('Authorization', `Bearer ${token}`).expect(200),
    ]);
    expect(summary.body.data.qualityAlerts.red).toBe(2);
    expect(lots.body.data.some((lot: { id: string }) => lot.id === 'LOT-182-2026')).toBe(true);
    expect(complaints.body.data.items[0].complaint_no).toBe('22/2026');
    expect(standards.body.data.some((standard: { id: string }) => standard.id === 'STD-30CH-RF-U')).toBe(true);
    expect(Array.isArray(activity.body.data)).toBe(true);
  });

  it('records unauthorized contract calls as invalid ledger transactions without writes', () => {
    db = openDb(':memory:');
    const ledger = new SimulatedLedger(db);
    ledger.init();
    seedDatabase(db, ledger, 'pre-demo');
    const runtime = createRuntime(db, ledger);
    const result = runtime.run({
      action: 'test.permission', label: 'Try restricted call',
      actor: { id: 'U-DISPATCH', username: 'dispatch', name: 'Dispatch User', role: 'DISPATCH', org: 'MillOrg' },
      request: { method: 'POST', path: '/api/test', query: {}, body: {} },
    }, (executor) => executor.call('Quality.recordConclusion', {}));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(ledger.getBlockTxs(ledger.height()).at(-1)?.status).toBe('INVALID');
    expect(ledger.getBlockTxs(ledger.height()).at(-1)?.fn).toBe('checkPermission');
    expect(db.prepare('SELECT COUNT(*) n FROM conclusions').get()).toMatchObject({ n: 0 });
  });

  it('registers, transitions, and closes a complaint through tracked contracts', async () => {
    db = openDb(':memory:');
    const ledger = new SimulatedLedger(db);
    ledger.init();
    seedDatabase(db, ledger);
    const app = createApp(db, ledger);
    const login = async (username: string) => (await request(app).post('/api/auth/login').send({ username }).expect(200)).body.data.token as string;
    const csToken = await login('cs');
    const created = await request(app).post('/api/complaints').set('Authorization', `Bearer ${csToken}`).send({
      complainantName: 'Textile QA Manager', type: 'EVENNESS', customerId: 'CUST-PDT', lotId: 'LOT-182-2026',
      description: 'Uneven streaking identified in knitted fabric.', receivedDate: '2026-10-15',
    }).expect(201);
    expect(created.body.data.complaint_no).toBe('23/2026');
    const id = String(created.body.data.id);
    await request(app).post(`/api/complaints/${id}/transition`).set('Authorization', `Bearer ${csToken}`).send({ to: 'UNDER_ANALYSIS', note: 'QA investigation started.' }).expect(200);
    const qaToken = await login('qa');
    const closed = await request(app).post(`/api/complaints/${id}/conclusion`).set('Authorization', `Bearer ${qaToken}`).send({
      conclusionHtml: '<p>Corrected <strong>roller setting</strong> and verified the retest results across all affected packages.</p><script>remove</script>',
      rootCause: 'Ring-frame drafting variation', correctiveAction: 'Reset and calibrate the drafting mechanism.', preventiveAction: 'Add break-draft verification to each shift handover.',
    }).expect(200);
    expect(closed.body.data.complaint.status).toBe('RESOLVED');
    expect(closed.body.data.conclusion.conclusion_html).not.toContain('<script>');
    expect(ledger.getBlockTxs(ledger.height()).every((tx) => tx.status === 'VALID')).toBe(true);
  });

  it('finds the planted RF-3 D2 fault and anchors the analysis result', async () => {
    db = openDb(':memory:');
    const ledger = new SimulatedLedger(db);
    ledger.init();
    seedDatabase(db, ledger);
    const app = createApp(db, ledger);
    const login = await request(app).post('/api/auth/login').send({ username: 'qa' }).expect(200);
    const token = login.body.data.token as string;
    const response = await request(app).post('/api/analysis/run').set('Authorization', `Bearer ${token}`).send({
      lotId: 'LOT-182-2026', complaintId: 'CMP-22-2026', comparisonLotIds: [],
      context: { source: 'heatmap', department: 'RF', machineId: 'RF-3', dayIndex: 2, date: '2026-10-01', parameter: 'U' },
    }).expect(201);
    expect(response.body.data.result.suspected.machineId).toBe('RF-3');
    expect(response.body.data.result.suspected.dayIndex).toBe(2);
    expect(response.body.data.result.rootCauses[0].id).toBe('RF_BREAK_DRAFT');
    expect(response.body.data.chain.verified).toBe(true);
    expect(db.prepare('SELECT status FROM complaints WHERE id=?').get('CMP-22-2026')).toMatchObject({ status: 'UNDER_ANALYSIS' });
  });

  it('gate-checks, dispatches packed yarn, and issues a public passport', async () => {
    db = openDb(':memory:');
    const ledger = new SimulatedLedger(db);
    ledger.init();
    seedDatabase(db, ledger);
    const app = createApp(db, ledger);
    const login = await request(app).post('/api/auth/login').send({ username: 'dispatch' }).expect(200);
    const token = login.body.data.token as string;
    const gate = await request(app).post('/api/dispatches/gate-check').set('Authorization', `Bearer ${token}`).send({ lotIds: ['LOT-182-2026'] }).expect(200);
    expect(gate.body.data.passed).toBe(true);
    expect(gate.body.data.lots[0].machineLevelRed.length).toBeGreaterThan(0);
    const dispatch = await request(app).post('/api/dispatches').set('Authorization', `Bearer ${token}`).send({
      customerId: 'CUST-PDT', countId: '30CH', dispatchDate: '2026-10-10', lots: [{ lotId: 'LOT-182-2026', quantityKg: 2200 }],
      packWeightKg: 50, conesCount: 1320, vehicleNo: 'TN 39 AB 4521', lrNo: 'LR/26/7810',
    }).expect(201);
    expect(dispatch.body.data.packsCount).toBe(44);
    expect(dispatch.body.data.passportCode).toMatch(/^PP-/);
    expect(dispatch.body.trace.invocations.map((entry: { fn: string }) => entry.fn)).toEqual(['evaluateGate','createDispatch','issuePassport']);
    const passport = await request(app).get(`/api/passports/${dispatch.body.data.passportCode}`).expect(200);
    expect(passport.body.data.dispatch_no).toBe(dispatch.body.data.dispatchNo);
    expect(passport.body.data.ledgerProof.verified).toBe(true);
    expect(passport.body.data.ledgerProof.blockNumber).toBe(dispatch.body.trace.blockNumber);
    expect(passport.body.data.journey.some((step: { label: string }) => step.label.startsWith('Cone packing'))).toBe(true);
  });

  it('creates, versions, and retires standards through QA permissions', async () => {
    db = openDb(':memory:');
    const ledger = new SimulatedLedger(db);
    ledger.init();
    seedDatabase(db, ledger, 'pre-demo');
    const app = createApp(db, ledger);
    const login = await request(app).post('/api/auth/login').send({ username: 'qa' }).expect(200);
    const token = login.body.data.token as string;
    const created = await request(app).post('/api/standards').set('Authorization', `Bearer ${token}`).send({
      countId: '30CH', department: 'RF', parameter: 'SPACER_MM', category: 'PROCESS', std: 3, lower: 2.75, upper: 3.25, unit: 'mm',
    }).expect(201);
    expect(created.body.data.version).toBe(1);
    const id = String(created.body.data.id);
    const updated = await request(app).put(`/api/standards/${id}`).set('Authorization', `Bearer ${token}`).send({ std: 3.1, lower: 2.8, upper: 3.4, reason: 'Updated for new frame setting' }).expect(200);
    expect(updated.body.data.version).toBe(2);
    const history = await request(app).get(`/api/standards/${id}/history`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.data).toHaveLength(2);
    const deleted = await request(app).delete(`/api/standards/${id}`).set('Authorization', `Bearer ${token}`).send({ reason: 'Retired pending calibration review' }).expect(200);
    expect(deleted.body.data.active).toBe(0);
  });

  it('tracks production writes and rejects out-of-order stages', async () => {
    db = openDb(':memory:');
    const ledger = new SimulatedLedger(db);
    ledger.init();
    seedDatabase(db, ledger, 'pre-demo');
    db.prepare("UPDATE lots SET status='PLANNED' WHERE id='LOT-183-2026'").run();
    const app = createApp(db, ledger);
    const login = await request(app).post('/api/auth/login').send({ username: 'operator' }).expect(200);
    const token = login.body.data.token as string;
    const event = await request(app).post('/api/production-events').set('Authorization', `Bearer ${token}`).send({
      lotId: 'LOT-183-2026', department: 'RM', eventDate: '2026-10-01', inputKg: 1000, outputKg: 995, wasteKg: 5, params: {}, notes: 'Raw material issued to line B',
    }).expect(201);
    expect(event.body.trace.invocations[0].contract).toBe('ProcessEvent');
    expect(db.prepare('SELECT status FROM lots WHERE id=?').get('LOT-183-2026')).toMatchObject({ status: 'IN_PRODUCTION' });
    const rejected = await request(app).post('/api/production-events').set('Authorization', `Bearer ${token}`).send({
      lotId: 'LOT-183-2026', department: 'CARD', machineId: 'CARD-1', eventDate: '2026-10-02', inputKg: 1000, outputKg: 990, wasteKg: 10, params: {},
    }).expect(422);
    expect(rejected.body.error.message).toContain('Stage order violation');
    expect(ledger.getBlockTxs(ledger.height()).at(-1)?.status).toBe('INVALID');
  });

  it('assigns consecutive non-overlapping pack serial ranges', async () => {
    db = openDb(':memory:');
    const ledger = new SimulatedLedger(db);
    ledger.init();
    seedDatabase(db, ledger);
    db.prepare(`INSERT INTO production_events(id,lot_id,department,machine_id,event_date,day_index,shift,input_kg,output_kg,waste_kg,params,notes,operator_id,created_at)
      VALUES('PE-AW-182','LOT-182-2026','AW','AW-1','2026-10-08',1,NULL,6000,5900,100,'{}','','U-OPERATOR','2026-10-08T16:00:00.000Z')`).run();
    const app = createApp(db, ledger);
    const login = await request(app).post('/api/auth/login').send({ username: 'dispatch' }).expect(200);
    const token = login.body.data.token as string;
    const first = await request(app).post('/api/packing').set('Authorization', `Bearer ${token}`).send({ lotId: 'LOT-182-2026', packDate: '2026-10-09', packWeightKg: 10, packsCount: 1, conesPerPack: 30 }).expect(201);
    const second = await request(app).post('/api/packing').set('Authorization', `Bearer ${token}`).send({ lotId: 'LOT-182-2026', packDate: '2026-10-09', packWeightKg: 10, packsCount: 1, conesPerPack: 30 }).expect(201);
    expect(first.body.data.pack_from).toBe('P182-0001');
    expect(second.body.data.pack_from).toBe('P182-0002');
  });
});