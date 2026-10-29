// Customer portal API: every route is scoped to the signed-in customer's own orders, dispatches, lots and complaints.
import type { Router } from 'express';
import express from 'express';
import type { ApiCtx, AuthedRequest } from './common';
import { newRouter } from './common';
import { act, fail, notFound, ok, qs } from './common';
import { LotData, buildPassport, chainOf, judgeTestValues } from '../domain/lots';
import { MasterBook } from '../domain/masters';
import { nowIso } from '../lib/clock';
import { complaintDto, complaintRow } from './complaints';
import { COMPLAINT_TYPE_LABEL, STAGE_INFO, type ComplaintType, type Stage } from '@shared/params';
import type { LotPassport } from '@shared/domain';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Strip what a customer must not see: other customers' lots/complaints and staff names. */
export function portalPassport(p: LotPassport, customerId: string): LotPassport {
  return {
    ...p,
    lot: { ...p.lot, qaReleaseBy: p.lot.qaReleaseBy ? 'Quality department' : null },
    mix: { ...p.mix, otherLots: [] },
    journey: p.journey.map((s) => ({ ...s, machines: s.machines.map((m) => ({ ...m, operator: null })) })),
    quality: p.quality.map((q) => ({ ...q, samples: q.samples.map((s) => ({ ...s, by: '', byName: 'Quality lab', remarks: '' })) })),
    production: p.production.map((s) => ({ ...s, runs: s.runs.map((r) => ({ ...r, operator: null, operatorName: null, notes: '' })) })),
    packing: p.packing ? { ...p.packing, packer: '', packerName: 'Packing hall' } : null,
    dispatch: p.dispatch && p.dispatch.customerId === customerId ? { ...p.dispatch, alsoInDispatch: [], driverPhone: '' } : null,
    complaints: p.complaints.filter((c) => c.customerName === p.dispatch?.customerName),
  };
}

export function portalRouter(c: ApiCtx): Router {
  const r = newRouter();
  const { db } = c;
  const me = (req: AuthedRequest) => req.actor?.customerId as string;
  r.use('/portal', (req: AuthedRequest, res, next) => (req.actor?.role === 'BUYER' && req.actor.customerId ? next() : fail(res, 403, 'PERMISSION_DENIED', 'The customer portal is for customer logins')));

  const myLotIds = async (customerId: string) => (await db.prepare('SELECT DISTINCT dl.lot_id id FROM dispatch_lots dl JOIN dispatches d ON d.id=dl.dispatch_id WHERE d.customer_id=?').all<Row>(customerId)).map((x) => str(x.id));

  r.get('/portal/summary', async (req: AuthedRequest, res) => {
    const id = me(req);
    const [cust, orders, disp, cmp, lots] = await Promise.all([db.prepare('SELECT * FROM customers WHERE id=?').get<Row>(id), db.prepare('SELECT COUNT(*) n, COALESCE(SUM(qty_kg),0) kg FROM orders WHERE customer_id=?').get<Row>(id), db.prepare('SELECT status, COUNT(*) n, COALESCE(SUM(quantity_kg),0) kg FROM dispatches WHERE customer_id=? GROUP BY status').all<Row>(id), db.prepare('SELECT status, COUNT(*) n FROM complaints WHERE customer_id=? GROUP BY status').all<Row>(id), myLotIds(id)]);
    const n = (rows: Row[], status: string, col = 'n') => Number(rows.find((x) => x.status === status)?.[col] ?? 0);
    ok(res, { customer: { id: cust?.id, name: cust?.name, city: cust?.city, contactName: cust?.contact_name }, orders: Number(orders?.n ?? 0), orderedKg: Number(orders?.kg ?? 0), lots: lots.length, inTransit: n(disp, 'DISPATCHED'), delivered: n(disp, 'DELIVERED'), deliveredKg: n(disp, 'DELIVERED', 'kg') + n(disp, 'DISPATCHED', 'kg'), complaints: { open: n(cmp, 'OPEN'), inProgress: n(cmp, 'UNDER_ANALYSIS'), closed: n(cmp, 'RESOLVED') } });
  });
  r.get('/portal/orders', async (req: AuthedRequest, res) => {
    const rows = await db.prepare('SELECT o.*, (SELECT COALESCE(SUM(d.quantity_kg),0) FROM dispatches d WHERE d.order_id=o.id) sent FROM orders o WHERE o.customer_id=? ORDER BY o.ordered_at DESC').all<Row>(me(req));
    ok(res, rows.map((o) => ({ id: o.id, orderNo: o.order_no, poNo: o.po_no, countId: o.count_id, qtyKg: o.qty_kg, sentKg: Math.round(Number(o.sent) * 10) / 10, orderedAt: o.ordered_at, dueDate: o.due_date, status: o.status })));
  });
  r.get('/portal/dispatches', async (req: AuthedRequest, res) => {
    const rows = await db.prepare('SELECT d.*, o.order_no FROM dispatches d LEFT JOIN orders o ON o.id=d.order_id WHERE d.customer_id=? ORDER BY d.dispatched_at DESC').all<Row>(me(req));
    const lots = await db.prepare('SELECT dl.dispatch_id, l.id lot_id, l.lot_no, dl.quantity_kg FROM dispatch_lots dl JOIN lots l ON l.id=dl.lot_id JOIN dispatches d ON d.id=dl.dispatch_id WHERE d.customer_id=? ORDER BY l.seq').all<Row>(me(req));
    ok(res, rows.map((d) => ({ id: d.id, dispatchNo: d.dispatch_no, orderNo: d.order_no, countId: d.count_id, dispatchedAt: d.dispatched_at, deliveredAt: d.delivered_at, invoiceNo: d.invoice_no, vehicleNo: d.vehicle_no, transporter: d.transporter, lrNo: d.lr_no, destination: d.destination, cartons: d.cartons, conesCount: d.cones_count, netKg: d.net_kg, grossKg: d.gross_kg, status: d.status, passportCode: d.passport_code, lots: lots.filter((l) => l.dispatch_id === d.id).map((l) => ({ lotId: l.lot_id, lotNo: l.lot_no, kg: l.quantity_kg })) })));
  });
  r.get('/portal/lots', async (req: AuthedRequest, res) => {
    const ids = await myLotIds(me(req));
    if (!ids.length) return ok(res, []);
    const [d, book] = await Promise.all([LotData.load(db, ids), MasterBook.load(db)]);
    ok(res, [...d.lots.values()].map((b) => {
      let reds = 0; let yellows = 0; let total = 0;
      for (const t of b.tests.filter((x) => x.sample_type === 'LOT')) for (const j of judgeTestValues(book, str(b.lot.count_id), t, 'asOf')) { total++; if (j.color === 'red') reds++; else if (j.color === 'yellow') yellows++; }
      const disp = b.dispatches.find((x) => x.customer_id === me(req)) as Row;
      return { id: b.lot.id, lotNo: b.lot.lot_no, countId: b.lot.count_id, countDisplay: b.count.display, kg: disp?._lot_kg, dispatchNo: disp?.dispatch_no, dispatchedAt: disp?.dispatched_at, deliveredAt: disp?.delivered_at, status: disp?.status, cartonFrom: b.packing?.carton_from, cartonTo: b.packing?.carton_to, tests: { total, withinSpec: total - reds - yellows, warning: yellows, outOfSpec: reds }, complaints: b.complaintCount, chain: chainOf('lot', b.lot) };
    }).sort((a, b) => Date.parse(str(b.dispatchedAt)) - Date.parse(str(a.dispatchedAt))));
  });
  r.get('/portal/lots/:id', async (req: AuthedRequest, res) => {
    const key = req.params.id.replace(/^LOT-/i, '');
    const lot = await db.prepare('SELECT id FROM lots WHERE id=? OR lot_no=?').get<Row>(req.params.id, key);
    if (!lot || !(await myLotIds(me(req))).includes(str(lot.id))) return notFound(res, 'Lot');
    const p = await buildPassport(db, str(lot.id), 'asOf', nowIso());
    ok(res, p ? portalPassport(p, me(req)) : null);
  });
  r.get('/portal/complaints', async (req: AuthedRequest, res) => {
    const rows = await db.prepare(`SELECT cp.*, cu.name customer_name, l.lot_no, l.lot_code, l.count_id, u.name created_by_name FROM complaints cp JOIN customers cu ON cu.id=cp.customer_id JOIN lots l ON l.id=cp.lot_id JOIN users u ON u.id=cp.created_by WHERE cp.customer_id=? ORDER BY cp.year DESC, cp.seq DESC`).all<Row>(me(req));
    ok(res, rows.map((x) => complaintDto(x, 0)));
  });
  r.get('/portal/complaints/:id', async (req: AuthedRequest, res) => {
    const x = await complaintRow(c, req.params.id);
    if (!x || x.customer_id !== me(req)) return notFound(res, 'Complaint');
    const [events, conclusion, doc] = await Promise.all([db.prepare('SELECT * FROM complaint_events WHERE complaint_id=? ORDER BY at').all<Row>(str(x.id)), db.prepare('SELECT * FROM conclusions WHERE complaint_id=?').get<Row>(str(x.id)), x.document_id ? db.prepare('SELECT * FROM documents WHERE id=?').get<Row>(str(x.document_id)) : Promise.resolve(undefined)]);
    ok(res, { complaint: complaintDto(x, 0), steps: events.map((e) => ({ at: e.at, status: e.to_status, text: e.to_status === 'OPEN' ? 'We received your complaint' : e.to_status === 'UNDER_ANALYSIS' ? 'Our quality team started the investigation' : 'Your complaint was closed with our findings' })),
      summary: conclusion && x.status === 'RESOLVED' ? { rootCause: conclusion.root_cause, correctiveAction: conclusion.corrective_action, reply: conclusion.customer_reply, closedAt: conclusion.concluded_at } : null, document: doc ? { id: doc.id, filename: doc.filename, mimeType: doc.mime_type, url: `/api/documents/${doc.id}/file` } : null });
  });
  r.post('/portal/complaints', async (req: AuthedRequest, res) => {
    const b = req.body as { lotNo?: string; lotId?: string; type?: ComplaintType; description?: string; documentId?: string | null };
    const lot = await db.prepare('SELECT id FROM lots WHERE id=? OR lot_no=?').get<Row>(str(b.lotId ?? b.lotNo), str(b.lotNo ?? b.lotId).replace(/^LOT-/i, ''));
    if (!lot) return fail(res, 404, 'NOT_FOUND', `We could not find lot ${str(b.lotNo ?? b.lotId)}. Please check the lot number on your carton label or invoice.`);
    await act(c, req, res, { action: 'complaint.register', label: 'Report a problem (customer portal)', created: true, body: { lotId: lot.id, type: b.type, description: b.description, documentId: b.documentId ?? null }, run: (x) => x.call('Quality.registerComplaint', { lotId: lot.id, type: b.type, description: b.description, documentId: b.documentId ?? null, source: 'PORTAL' }) });
  });
  r.get('/portal/lot-search', async (req: AuthedRequest, res) => {
    const q = qs(req.query.q).replace(/^LOT-/i, '').replace(/[%_]/g, '');
    if (!q) return ok(res, []);
    const rows = await db.prepare(`SELECT DISTINCT l.id, l.lot_no, c.display, d.dispatch_no, d.dispatched_at FROM dispatch_lots dl JOIN dispatches d ON d.id=dl.dispatch_id JOIN lots l ON l.id=dl.lot_id JOIN counts c ON c.id=l.count_id WHERE d.customer_id=? AND (l.lot_no LIKE ? OR d.invoice_no LIKE ? OR d.vehicle_no LIKE ?) ORDER BY l.lot_no LIMIT 8`).all<Row>(me(req), `${q}%`, `%${q}%`, `%${q}%`);
    ok(res, rows.map((x) => ({ lotId: x.id, lotNo: x.lot_no, countDisplay: x.display, dispatchNo: x.dispatch_no, dispatchedAt: x.dispatched_at })));
  });
  void COMPLAINT_TYPE_LABEL; void STAGE_INFO; void ({} as Stage);
  return r;
}
