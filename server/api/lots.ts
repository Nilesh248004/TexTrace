// Read routes for lots, journey, passport, trace, live board, production, quality, accessories, packing, dispatch.
import type { Router } from 'express';
import express from 'express';
import type { ApiCtx, AuthedRequest } from './common';
import { newRouter } from './common';
import { act, notFound, ok, parseJson, qn, qs } from './common';
import { MasterBook } from '../domain/masters';
import { LotData, buildPassport, balanceOf, judgeRunAccessories, judgeRunParams, judgeTestValues, listLots, chainOf, packingChecks } from '../domain/lots';
import { accessoryStatuses, backTrace, buildAlerts, buildHeatmap, forwardTrace, liveBoard, ownerDashboard, search } from '../domain/overview';
import { evaluateGate } from '../domain/gate';
import { nowIso } from '../lib/clock';
import { istDate } from '@shared/format';
import { STAGES, STAGE_INFO, type Stage } from '@shared/params';
import { worstColor, type QualityColor } from '@shared/quality';
import type { Judged } from '@shared/domain';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => Number(v ?? 0);

export function lotsRouter(c: ApiCtx): Router {
  const r = newRouter();
  const { db } = c;
  const mode = (req: AuthedRequest) => (qs(req.query.mode) === 'latest' ? 'latest' as const : 'asOf' as const);

  r.get('/search', async (req, res) => ok(res, await search(db, qs(req.query.q))));
  r.get('/live', async (_req, res) => ok(res, await liveBoard(db, nowIso())));
  r.get('/alerts', async (_req, res) => ok(res, await buildAlerts(db, nowIso())));
  r.get('/dashboard/owner', async (_req, res) => ok(res, await ownerDashboard(db, nowIso())));
  r.get('/analytics/heatmap', async (req, res) => ok(res, await buildHeatmap(db, { stage: (qs(req.query.stage) || 'RF') as Stage, parameter: qs(req.query.parameter) || 'U', days: Math.min(60, qn(req.query.days, 21)), countId: qs(req.query.count) || null }, nowIso())));

  r.get('/lots', async (req, res) => {
    const count = qs(req.query.count); const status = qs(req.query.status); const q = qs(req.query.q).toLowerCase(); const stage = qs(req.query.stage);
    let lots = await listLots(db, Date.parse(nowIso()), mode(req));
    if (count && count !== 'ALL') lots = lots.filter((l) => l.countId === count);
    if (status) lots = lots.filter((l) => l.status === status);
    if (stage) lots = lots.filter((l) => l.location.stage === stage);
    if (q) lots = lots.filter((l) => `${l.lotNo} ${l.lotCode} ${l.mixNo} ${l.customerName ?? ''} ${l.dispatchNo ?? ''}`.toLowerCase().includes(q));
    ok(res, lots);
  });
  r.get('/lots/:id/passport', async (req, res) => { const p = await buildPassport(db, req.params.id, mode(req), nowIso()); return p ? ok(res, p) : notFound(res, 'Lot'); });
  r.get('/lots/:id/trace', async (req, res) => { const t = await backTrace(db, req.params.id); return t ? ok(res, t) : notFound(res, 'Lot'); });
  r.get('/bales', async (req, res) => {
    const rows = await db.prepare('SELECT * FROM bales ORDER BY bale_no').all<Row>();
    const q = qs(req.query.q).toLowerCase(); const status = qs(req.query.status); const variety = qs(req.query.variety);
    ok(res, rows.filter((b) => (!status || b.status === status) && (!variety || b.variety === variety) && (!q || `${b.bale_no} ${b.variety} ${b.supplier} ${b.bay} ${b.bin} ${b.mix_id ?? ''}`.toLowerCase().includes(q)))
      .map((b) => ({ id: b.id, baleNo: b.bale_no, variety: b.variety, supplier: b.supplier, station: b.station, ginLot: b.gin_lot, weightKg: b.weight_kg, receivedAt: b.received_at, issuedAt: b.issued_at, bay: b.bay, bin: b.bin, status: b.status, mixId: b.mix_id, fibre: parseJson(b.fibre, {}), chain: chainOf('bale', b) })));
  });
  r.get('/bales/:id/trace', async (req, res) => { const t = await forwardTrace(db, req.params.id, nowIso()); return t ? ok(res, t) : notFound(res, 'Bale'); });
  r.get('/mixes/:id', async (req, res) => {
    const mix = await db.prepare('SELECT * FROM mixes WHERE id=? OR mix_no=?').get<Row>(req.params.id, req.params.id);
    if (!mix) return notFound(res, 'Mix');
    const bales = await db.prepare('SELECT mb.kg_used,mb.pct,b.* FROM mix_bales mb JOIN bales b ON b.id=mb.bale_id WHERE mb.mix_id=? ORDER BY b.bale_no').all<Row>(str(mix.id));
    const lots = await db.prepare('SELECT id,lot_no,status FROM lots WHERE mix_id=? ORDER BY seq').all<Row>(str(mix.id));
    ok(res, { id: mix.id, mixNo: mix.mix_no, countId: mix.count_id, status: mix.status, totalKg: mix.total_kg, plannedAt: mix.planned_at, issuedAt: mix.issued_at, blowRoomLine: mix.blow_room_line, recipe: parseJson(mix.recipe, []), fibre: parseJson(mix.fibre, {}), bales: bales.map((b) => ({ baleNo: b.bale_no, variety: b.variety, bay: b.bay, bin: b.bin, kgUsed: b.kg_used, pct: b.pct, status: b.status })), lots });
  });
  r.get('/machines', async (_req, res) => ok(res, (await db.prepare('SELECT id,department,machine_no,label,line,make,model,spindles FROM machines ORDER BY department, machine_no').all<Row>()).map((m) => ({ id: m.id, stage: m.department, machineNo: m.machine_no, label: m.label, line: m.line, make: m.make, model: m.model, spindles: m.spindles }))));
  r.get('/users', async (_req, res) => ok(res, await db.prepare('SELECT id,username,name,role,org,title,customer_id AS customerId FROM users ORDER BY name').all()));
  r.get('/customers', async (_req, res) => {
    const rows = await db.prepare('SELECT * FROM customers ORDER BY name').all<Row>();
    const [lots, disp, cmp, ord] = await Promise.all([
      db.prepare('SELECT d.customer_id c, COUNT(DISTINCT dl.lot_id) n FROM dispatch_lots dl JOIN dispatches d ON d.id=dl.dispatch_id GROUP BY d.customer_id').all<Row>(),
      db.prepare('SELECT customer_id c, COUNT(*) n, COALESCE(SUM(quantity_kg),0) kg FROM dispatches GROUP BY customer_id').all<Row>(),
      db.prepare('SELECT customer_id c, status, type, COUNT(*) n FROM complaints GROUP BY customer_id,status,type').all<Row>(),
      db.prepare('SELECT customer_id c, COUNT(*) n, COALESCE(SUM(qty_kg),0) kg FROM orders GROUP BY customer_id').all<Row>(),
    ]);
    ok(res, rows.map((x) => ({ id: x.id, code: x.code, name: x.name, city: x.city, contactName: x.contact_name, email: x.email, phone: x.phone, address: x.address,
      lots: num(lots.find((l) => l.c === x.id)?.n), dispatches: num(disp.find((l) => l.c === x.id)?.n), dispatchedKg: num(disp.find((l) => l.c === x.id)?.kg), orders: num(ord.find((l) => l.c === x.id)?.n), orderedKg: num(ord.find((l) => l.c === x.id)?.kg),
      complaints: { open: cmp.filter((l) => l.c === x.id && l.status === 'OPEN').reduce((s, l) => s + num(l.n), 0), inProgress: cmp.filter((l) => l.c === x.id && l.status === 'UNDER_ANALYSIS').reduce((s, l) => s + num(l.n), 0), closed: cmp.filter((l) => l.c === x.id && l.status === 'RESOLVED').reduce((s, l) => s + num(l.n), 0),
        repeat: [...new Set(cmp.filter((l) => l.c === x.id && num(l.n) >= 1).map((l) => str(l.type)))].filter((t) => cmp.filter((l) => l.c === x.id && l.type === t).reduce((s, l) => s + num(l.n), 0) >= 2) } })));
  });
  r.get('/orders', async (req, res) => ok(res, await db.prepare('SELECT o.*, c.name customer_name FROM orders o JOIN customers c ON c.id=o.customer_id WHERE (?=\'\' OR o.customer_id=?) ORDER BY o.ordered_at DESC').all(qs(req.query.customer), qs(req.query.customer))));

  // ---------------------------------------------------------------- production runs (judged)
  r.get('/production', async (req, res) => {
    const [d, book] = await Promise.all([LotData.load(db), MasterBook.load(db)]);
    const f = { count: qs(req.query.count), stage: qs(req.query.stage), machine: qs(req.query.machine), lot: qs(req.query.lot), from: qs(req.query.from), to: qs(req.query.to), q: qs(req.query.q).toLowerCase(), color: qs(req.query.color) };
    const out: Row[] = [];
    for (const b of d.lots.values()) {
      if (f.count && f.count !== 'ALL' && b.lot.count_id !== f.count) continue;
      if (f.lot && !(b.lot.lot_no === f.lot || b.lot.id === f.lot)) continue;
      for (const run of b.runs) {
        if (!['BR', 'CARD', 'DFB', 'DFF', 'COMB', 'FF', 'RF', 'AW', 'PACK'].includes(str(run.stage))) continue;
        if (f.stage && run.stage !== f.stage) continue; if (f.machine && run.machine_id !== f.machine) continue;
        const day = istDate(str(run.in_at)); if ((f.from && day < f.from) || (f.to && day > f.to)) continue;
        const params = judgeRunParams(book, str(b.lot.count_id), run, mode(req)); const acc = judgeRunAccessories(book, str(b.lot.count_id), run, mode(req)); const bal = balanceOf(run);
        const worst = worstColor([...params, ...acc].map((j) => j.color).concat(bal ? [bal.color] : []));
        if (f.color && worst !== f.color) continue;
        const row = { id: run.id, lotId: b.lot.id, lotNo: b.lot.lot_no, countId: b.lot.count_id, countDisplay: b.count.display, stage: run.stage, stageLabel: STAGE_INFO[str(run.stage) as Stage].label, machineId: run.machine_id, machineLabel: d.machineLabel(run.machine_id), shift: run.shift, operator: d.userName(run.operator_id), inAt: run.in_at, outAt: run.out_at, running: !run.out_at, inKg: run.input_kg, outKg: run.output_kg, wasteKg: run.waste_kg, wastePct: num(run.input_kg) ? Math.round((num(run.waste_kg) / num(run.input_kg)) * 10000) / 100 : null, batchRef: run.batch_ref, balance: bal, worst, params, accessories: acc, chain: chainOf('stage_run', run) };
        if (f.q && !`${row.lotNo} ${row.machineLabel} ${row.operator} ${row.batchRef} ${row.stageLabel}`.toLowerCase().includes(f.q)) continue;
        out.push(row);
      }
    }
    out.sort((a, b) => Date.parse(str(b.inAt)) - Date.parse(str(a.inAt)));
    ok(res, { items: out.slice(0, 500), total: out.length, capped: out.length > 500 });
  });
  r.get('/quality', async (req, res) => {
    const [d, book] = await Promise.all([LotData.load(db), MasterBook.load(db)]);
    const f = { count: qs(req.query.count), stage: qs(req.query.stage), machine: qs(req.query.machine), lot: qs(req.query.lot), from: qs(req.query.from), to: qs(req.query.to), q: qs(req.query.q).toLowerCase(), color: qs(req.query.color), type: qs(req.query.type) };
    const out: Row[] = [];
    for (const b of d.lots.values()) {
      if (f.count && f.count !== 'ALL' && b.lot.count_id !== f.count) continue;
      if (f.lot && !(b.lot.lot_no === f.lot || b.lot.id === f.lot)) continue;
      for (const t of b.tests) {
        if (f.stage && t.stage !== f.stage) continue; if (f.machine && t.machine_id !== f.machine) continue;
        if (f.type && t.sample_type !== f.type) continue;
        const day = str(t.test_date); if ((f.from && day < f.from) || (f.to && day > f.to)) continue;
        const values: Judged[] = judgeTestValues(book, str(b.lot.count_id), t, mode(req));
        const worst = worstColor(values.map((j) => j.color));
        if (f.color && worst !== f.color) continue;
        const row = { id: t.id, sampleId: t.sample_id, lotId: b.lot.id, lotNo: b.lot.lot_no, countId: b.lot.count_id, countDisplay: b.count.display, stage: t.stage, stageLabel: STAGE_INFO[str(t.stage) as Stage].label, machineId: t.machine_id, machineLabel: d.machineLabel(t.machine_id) ?? 'Lot composite', type: t.sample_type, pos: t.pos, testedAt: t.tested_at, shift: t.shift, by: d.userName(t.tested_by), instrument: t.instrument, values, worst, red: values.filter((j) => j.color === 'red').length, yellow: values.filter((j) => j.color === 'yellow').length, chain: chainOf('test_result', t) };
        if (f.q && !`${row.sampleId} ${row.lotNo} ${row.machineLabel} ${row.by} ${row.stageLabel}`.toLowerCase().includes(f.q)) continue;
        out.push(row);
      }
    }
    out.sort((a, b) => Date.parse(str(b.testedAt)) - Date.parse(str(a.testedAt)));
    ok(res, { items: out.slice(0, 500), total: out.length, capped: out.length > 500 });
  });

  // ---------------------------------------------------------------- accessories + packing
  r.get('/accessories', async (_req, res) => ok(res, await accessoryStatuses(db, nowIso())));
  r.get('/accessory-changes', async (req, res) => ok(res, (await db.prepare('SELECT a.*, m.label machine_label FROM accessory_changes a JOIN machines m ON m.id=a.machine_id WHERE (?=\'\' OR a.machine_id=?) ORDER BY a.changed_at DESC LIMIT 200').all<Row>(qs(req.query.machine), qs(req.query.machine))).map((a) => ({ id: a.id, machineId: a.machine_id, machineLabel: a.machine_label, kind: a.kind, spec: a.spec, value: a.value, changedAt: a.changed_at, changedBy: a.changed_by, note: a.note, chain: chainOf('accessory_change', a) }))));
  r.get('/packing', async (req, res) => {
    const [d, book] = await Promise.all([LotData.load(db), MasterBook.load(db)]);
    const rows: Row[] = [];
    for (const b of d.lots.values()) { if (!b.packing) continue; const p = b.packing; const at = istDate(str(p.packed_at)); const cartons = num(p.cartons); const cid = str(b.lot.count_id);
      const checks: Judged[] = packingChecks(book, cid, p, mode(req));
      const colorMeta = book.color(cid, at)?.meta;
      rows.push({ id: p.id, lotId: b.lot.id, lotNo: b.lot.lot_no, countId: cid, countDisplay: b.count.display, packedAt: p.packed_at, packer: d.userName(p.packer_id), packageType: p.package_type, cones: p.cones_packed, partialCones: p.partial_cones, cartons, netKg: p.net_kg, tareKg: p.tare_kg, grossKg: p.gross_kg, avgConeKg: p.avg_cone_kg, slipNo: p.slip_no, cartonFrom: p.carton_from, cartonTo: p.carton_to, colorActual: p.color_actual, colorMaster: p.color_master, colorOk: !!num(p.color_ok), colorHex: colorMeta?.hex ?? null, fgLocation: p.fg_location, labelTemplate: p.label_template, checks, worst: worstColor(checks.map((j) => j.color).concat(num(p.color_ok) ? [] : ['red'] as QualityColor[])), chain: chainOf('packing', p) }); }
    const q = qs(req.query.q).toLowerCase(); const count = qs(req.query.count);
    ok(res, rows.filter((x) => (!count || count === 'ALL' || x.countId === count) && (!q || `${x.lotNo} ${x.slipNo} ${x.packer} ${x.colorActual}`.toLowerCase().includes(q))).sort((a, b) => Date.parse(str(b.packedAt)) - Date.parse(str(a.packedAt))));
  });
  r.get('/color-codes', async (_req, res) => { const book = await MasterBook.load(db); const counts = await db.prepare('SELECT id,display FROM counts ORDER BY ne,id').all<Row>(); ok(res, counts.map((c) => ({ countId: c.id, display: c.display, ...(book.color(str(c.id), '9999-12-31', 'latest')?.meta ?? {}) }))); });

  // ---------------------------------------------------------------- dispatch
  r.get('/dispatches', async (req, res) => {
    const rows = await db.prepare('SELECT d.*, c.name customer_name, o.order_no FROM dispatches d JOIN customers c ON c.id=d.customer_id LEFT JOIN orders o ON o.id=d.order_id ORDER BY d.dispatched_at DESC').all<Row>();
    const lotRows = await db.prepare('SELECT dl.dispatch_id, l.lot_no FROM dispatch_lots dl JOIN lots l ON l.id=dl.lot_id ORDER BY l.seq').all<Row>();
    const q = qs(req.query.q).toLowerCase(); const count = qs(req.query.count);
    ok(res, rows.map((x) => ({ id: x.id, dispatchNo: x.dispatch_no, customerId: x.customer_id, customerName: x.customer_name, orderNo: x.order_no, countId: x.count_id, lotNos: lotRows.filter((l) => l.dispatch_id === x.id).map((l) => str(l.lot_no)), dispatchedAt: x.dispatched_at, invoiceNo: x.invoice_no, vehicleNo: x.vehicle_no, driverName: x.driver_name, transporter: x.transporter, lrNo: x.lr_no, destination: x.destination, cartons: x.cartons, conesCount: x.cones_count, netKg: x.net_kg, grossKg: x.gross_kg, deliveredAt: x.delivered_at, status: x.status, qaReleased: !!num(x.qa_released), passportCode: x.passport_code, remarks: x.remarks, chain: chainOf('dispatch', x) }))
      .filter((x) => (!count || count === 'ALL' || x.countId === count) && (!q || `${x.dispatchNo} ${x.customerName} ${x.invoiceNo} ${x.vehicleNo} ${x.lrNo} ${x.lotNos.join(' ')}`.toLowerCase().includes(q))));
  });
  r.get('/dispatches/ready', async (_req, res) => {
    const d = await LotData.load(db); const book = await MasterBook.load(db); const out: Row[] = [];
    for (const b of d.lots.values()) { if (!b.packing || ['DISPATCHED', 'DELIVERED'].includes(str(b.lot.status))) continue; const sent = b.dispatches.reduce((s, x) => s + num(x._lot_kg), 0); out.push({ lotId: b.lot.id, lotNo: b.lot.lot_no, countId: b.lot.count_id, countDisplay: b.count.display, netKg: b.packing.net_kg, availableKg: Math.round((num(b.packing.net_kg) - sent) * 10) / 10, cartons: b.packing.cartons, status: b.lot.status, qaReleased: !!b.lot.qa_release_at, colorOk: !!num(b.packing.color_ok) }); }
    void book; ok(res, out);
  });
  r.get('/dispatches/:id', async (req, res) => {
    const row = await db.prepare('SELECT d.*, c.name customer_name, c.city, c.address, o.order_no, o.po_no FROM dispatches d JOIN customers c ON c.id=d.customer_id LEFT JOIN orders o ON o.id=d.order_id WHERE d.id=? OR d.dispatch_no=?').get<Row>(req.params.id, req.params.id);
    if (!row) return notFound(res, 'Dispatch');
    const lots = await db.prepare('SELECT dl.lot_id lotId,l.lot_no lotNo,l.lot_code lotCode,dl.quantity_kg quantityKg,dl.cartons FROM dispatch_lots dl JOIN lots l ON l.id=dl.lot_id WHERE dl.dispatch_id=? ORDER BY l.seq').all(str(row.id));
    ok(res, { ...row, chain: chainOf('dispatch', row), gate: parseJson(row.gate, null), overrideIds: parseJson(row.override_ids, []), lots });
  });
  r.post('/dispatches/gate-check', async (req, res) => ok(res, await evaluateGate(db, Array.isArray(req.body?.lotIds) ? req.body.lotIds.map(String) : [], nowIso())));

  // ---------------------------------------------------------------- write actions
  r.post('/production-events', async (req: AuthedRequest, res) => act(c, req, res, { action: 'production.log-stage-run', label: 'Log production stage run', created: true, run: (x) => x.call('ProcessEvent.logStageRun', req.body) }));
  r.post('/mixes/:id/issue', async (req: AuthedRequest, res) => act(c, req, res, { action: 'bale-store.issue', label: `Issue bales of ${req.params.id} to blow room`, body: { mixId: req.params.id }, run: (x) => x.call('ProcessEvent.issueBales', { mixId: req.params.id }) }));
  r.post('/mixes', async (req: AuthedRequest, res) => act(c, req, res, { action: 'mix.register', label: 'Form cotton mix', created: true, run: async (x) => { const mix = await x.call<Row>('AssetID.registerMix', req.body); const lots = Math.max(1, Math.min(4, Number(req.body?.lots ?? 2))); const ids: string[] = []; for (let i = 0; i < lots; i++) { const lot = await x.call<Row>('AssetID.registerLot', { mixId: mix.id, plannedKg: Math.round(Number(mix.total_kg) / lots) }); ids.push(String(lot.id)); } return { mix, lots: ids }; } }));
  r.post('/test-results', async (req: AuthedRequest, res) => act(c, req, res, { action: 'quality.record-test', label: 'Record laboratory test result', created: true, run: (x) => x.call('Quality.recordTestResult', req.body) }));
  r.post('/accessory-changes', async (req: AuthedRequest, res) => act(c, req, res, { action: 'accessories.record-change', label: 'Record accessory change', created: true, run: (x) => x.call('ProcessEvent.recordAccessoryChange', req.body) }));
  r.post('/packing', async (req: AuthedRequest, res) => act(c, req, res, { action: 'packing.record', label: 'Record packing of a lot', created: true, run: (x) => x.call('ProcessEvent.recordPacking', req.body) }));
  r.post('/lots/:id/release', async (req: AuthedRequest, res) => act(c, req, res, { action: 'quality.release-lot', label: `QA release of ${req.params.id}`, body: { lotId: req.params.id, ...req.body }, run: (x) => x.call('Quality.releaseLot', { lotId: req.params.id, note: req.body?.note }) }));
  r.post('/lots/:id/override', async (req: AuthedRequest, res) => act(c, req, res, { action: 'quality.override', label: `QA override for ${req.params.id}`, created: true, body: { lotId: req.params.id, ...req.body }, run: (x) => x.call('Quality.recordOverride', { lotId: req.params.id, reason: req.body?.reason }) }));
  r.post('/dispatches', async (req: AuthedRequest, res) => act(c, req, res, { action: 'dispatch.create', label: 'Create customer dispatch', created: true, run: async (x) => { const d = await x.call<Row>('Transfer.createDispatch', req.body); await x.call('AssetID.issuePassport', { dispatchId: d.id }); return d; } }));
  r.post('/dispatches/:id/deliver', async (req: AuthedRequest, res) => act(c, req, res, { action: 'dispatch.deliver', label: `Confirm delivery ${req.params.id}`, body: { dispatchId: req.params.id }, run: (x) => x.call('Transfer.markDelivered', { dispatchId: req.params.id, deliveredAt: req.body?.deliveredAt }) }));
  void STAGES;
  return r;
}
