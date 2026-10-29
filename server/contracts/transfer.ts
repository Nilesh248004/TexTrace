// Transfer contract: dispatch (custody transfer to a customer) and delivery confirmation.
import { evaluateGate } from '../domain/gate';
import { sha256Hex } from '../lib/hash';
import type { ContractModule } from './types';

const r1 = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const isoOk = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const VEHICLE = /^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,3}[ -]?\d{3,4}$/i;

export const TransferContract: ContractModule = {
  name: 'Transfer',
  description: 'Transfer custody of packed yarn to customers',
  functions: {
    createDispatch: {
      key: 'Transfer.createDispatch', description: 'Create a QA-released, quality-gated customer dispatch', rules: ['customer-exists', 'lots-present', 'lot-count-match', 'lot-packed', 'qa-release', 'mass-balance-custody', 'quality-gate', 'vehicle-format', 'transport-details', 'dispatch-time'],
      async handler(ctx, args: { customerId: string; lots: { lotId: string; quantityKg?: number }[]; vehicleNo: string; driverName: string; driverPhone?: string; transporter: string; lrNo: string; invoiceNo: string; destination?: string; remarks?: string; orderId?: string | null; dispatchedAt?: string }) {
        const customer = await ctx.get<{ id: string; city: string; address: string }>('SELECT id,city,address FROM customers WHERE id=?', args.customerId);
        ctx.check('customer-exists', !!customer, `Customer ${args.customerId} does not exist`, 'NOT_FOUND');
        ctx.check('lots-present', Array.isArray(args.lots) && args.lots.length > 0 && new Set(args.lots.map((l) => l.lotId)).size === args.lots.length, 'Select at least one lot (each lot once)', 'VALIDATION_FAILED');
        ctx.check('vehicle-format', VEHICLE.test(String(args.vehicleNo ?? '').trim()), 'Vehicle number format is invalid (e.g. TN-39-AB-4521)', 'VALIDATION_FAILED');
        ctx.check('transport-details', [args.driverName, args.transporter, args.lrNo, args.invoiceNo].every((s) => String(s ?? '').trim().length > 0), 'Driver, transporter, LR number and invoice number are required', 'VALIDATION_FAILED');
        const at = args.dispatchedAt ?? ctx.timestamp;
        ctx.check('dispatch-time', isoOk(at) && Date.parse(at) <= Date.parse(ctx.timestamp) + 60_000, 'Dispatch time must be valid and not in the future', 'VALIDATION_FAILED');
        const entries: { entry: { lotId: string; quantityKg?: number }; lot: { id: string; lot_no: string; count_id: string; status: string; qa_release_at: string | null }; pack: { id: string; cartons: number; cones_packed: number; net_kg: number; tare_kg: number; packed_at: string }; qty: number }[] = [];
        for (const entry of args.lots) {
          const lot = await ctx.get<(typeof entries)[number]['lot']>('SELECT id,lot_no,count_id,status,qa_release_at FROM lots WHERE id=?', entry.lotId);
          ctx.check('lot-packed', !!lot, `Lot ${entry.lotId} does not exist`, 'NOT_FOUND');
          const pack = await ctx.get<(typeof entries)[number]['pack']>('SELECT id,cartons,cones_packed,net_kg,tare_kg,packed_at FROM packing WHERE lot_id=?', entry.lotId);
          ctx.check('lot-packed', !!pack, `Lot ${lot?.lot_no} is not packed yet`, 'CONTRACT_REJECTED');
          ctx.check('lot-open', lot!.status !== 'ON_HOLD', `Lot ${lot?.lot_no} is on QA hold`, 'CONTRACT_REJECTED');
          const sent = Number((await ctx.get<{ s: number }>('SELECT COALESCE(SUM(quantity_kg),0) s FROM dispatch_lots WHERE lot_id=?', entry.lotId))?.s ?? 0);
          const qty = r1(entry.quantityKg ?? pack!.net_kg - sent, 1);
          ctx.check('mass-balance-custody', qty > 0 && qty <= pack!.net_kg - sent + 0.05, `Lot ${lot?.lot_no}: ${r1(pack!.net_kg - sent)} kg packed & undispatched, requested ${qty} kg`, 'CONTRACT_REJECTED');
          ctx.check('dispatch-time', Date.parse(at) >= Date.parse(pack!.packed_at), `Dispatch of lot ${lot?.lot_no} cannot precede packing`, 'VALIDATION_FAILED');
          entries.push({ entry, lot: lot!, pack: pack!, qty });
        }
        const countIds = new Set(entries.map((e) => e.lot.count_id));
        ctx.check('lot-count-match', countIds.size === 1, 'All lots in one dispatch must have the same count', 'VALIDATION_FAILED');
        const gate = await evaluateGate(ctx.db, entries.map((e) => e.lot.id), ctx.timestamp);
        const unreleased = entries.filter((e) => !e.lot.qa_release_at && !gate.lots.find((g) => g.lotId === e.lot.id)?.overrideId);
        ctx.check('qa-release', unreleased.length === 0, `Dispatch without QA release is not allowed: lot ${unreleased.map((u) => u.lot.lot_no).join(', ')} has no QA release`, 'CONTRACT_REJECTED');
        ctx.check('quality-gate', gate.passed, `${gate.message} Record a QA override first.`, 'CONTRACT_REJECTED');
        const countId = [...countIds][0];
        const year = Number(at.slice(0, 4));
        const seq = await ctx.nextSeq(`dispatch:${year}`);
        const id = `DSP-${year}-${String(seq).padStart(4, '0')}`;
        const net = r1(entries.reduce((s, e) => s + e.qty, 0), 1);
        const cartons = Math.round(entries.reduce((s, e) => s + e.pack.cartons * (e.qty / e.pack.net_kg), 0));
        const cones = Math.round(entries.reduce((s, e) => s + e.pack.cones_packed * (e.qty / e.pack.net_kg), 0));
        const tare = entries.reduce((s, e) => s + e.pack.tare_kg * (e.qty / e.pack.net_kg), 0);
        const order = args.orderId ? await ctx.get<{ id: string }>('SELECT id FROM orders WHERE id=?', args.orderId) : await ctx.get<{ id: string }>(`SELECT id FROM orders WHERE customer_id=? AND count_id=? AND status<>'COMPLETE' ORDER BY ordered_at LIMIT 1`, args.customerId, countId);
        const dateStr = new Date(Date.parse(at) + 330 * 60_000).toISOString().slice(0, 10);
        const row = await ctx.insert('dispatch', {
          id, dispatch_no: `DSP/${year}/${String(seq).padStart(4, '0')}`, customer_id: args.customerId, order_id: order?.id ?? null, count_id: countId, quantity_kg: net, dispatch_date: dateStr, dispatched_at: at,
          invoice_no: args.invoiceNo.trim(), invoice_date: dateStr, vehicle_no: args.vehicleNo.trim().toUpperCase(), driver_name: args.driverName.trim(), driver_phone: args.driverPhone ?? '', transporter: args.transporter.trim(), lr_no: args.lrNo.trim(),
          destination: args.destination?.trim() || `${customer!.city} — ${customer!.address}`, cartons, cones_count: cones, net_kg: net, gross_kg: r1(net + tare, 1), delivered_at: null, gate: JSON.stringify(gate),
          override_ids: JSON.stringify(gate.lots.map((l) => l.overrideId).filter(Boolean)), qa_released: unreleased.length === 0 && entries.every((e) => e.lot.qa_release_at) ? 1 : 0, passport_code: `PP-${sha256Hex(id).slice(0, 8).toUpperCase()}`,
          status: 'DISPATCHED', remarks: args.remarks ?? '', created_by: ctx.actor.id, created_at: ctx.timestamp,
        });
        for (const e of entries) {
          await ctx.insert('dispatch_lot', { id: `DL-${id}-${e.lot.id}`, dispatch_id: id, lot_id: e.lot.id, quantity_kg: e.qty, cartons: Math.round(e.pack.cartons * (e.qty / e.pack.net_kg)) });
          const sentAfter = Number((await ctx.get<{ s: number }>('SELECT COALESCE(SUM(quantity_kg),0) s FROM dispatch_lots WHERE lot_id=?', e.lot.id))?.s ?? 0);
          if (sentAfter >= e.pack.net_kg - 0.05) {
            await ctx.update('lot', e.lot.id, { status: 'DISPATCHED' });
            const fg = await ctx.get<{ id: string; in_at: string }>(`SELECT id,in_at FROM stage_runs WHERE lot_id=? AND stage='FG' AND out_at IS NULL`, e.lot.id);
            const out = fg ? new Date(Math.max(Date.parse(fg.in_at), Date.parse(at) - 3600_000)).toISOString() : at;
            if (fg) await ctx.update('stage_run', fg.id, { out_at: out, notes: 'Released from FG store for dispatch' });
            await ctx.insert('stage_run', { id: await ctx.newId('SR'), lot_id: e.lot.id, stage: 'DISP', machine_id: null, location: 'Gate 2', shift: 'A', operator_id: ctx.actor.id, in_at: out, out_at: at, input_kg: e.qty, output_kg: e.qty, waste_kg: 0, waste_type: null, batch_ref: `PK-L${e.lot.lot_no}`, input_refs: '[]', params: '{}', accessories: '{}', notes: `Loaded on ${row.vehicle_no}`, created_at: ctx.timestamp });
          }
        }
        ctx.setPayload({ dispatchId: id, dispatchNo: row.dispatch_no, customerId: args.customerId, lots: entries.map((e) => ({ lotId: e.lot.id, kg: e.qty })), netKg: net, vehicleNo: row.vehicle_no, invoiceNo: args.invoiceNo, gate: { passed: gate.passed, overridden: gate.overridden } });
        ctx.notify({ severity: 'info', title: `Dispatch ${row.dispatch_no}`, body: `${net} kg to customer on ${row.vehicle_no}.`, link: `/dispatch/${id}` });
        return row;
      },
    },
    markDelivered: {
      key: 'Transfer.markDelivered', description: 'Confirm delivery at the customer', rules: ['dispatch-exists', 'status-dispatched', 'delivery-after-dispatch'],
      async handler(ctx, args: { dispatchId: string; deliveredAt?: string }) {
        const d = await ctx.get<{ id: string; dispatch_no: string; status: string; dispatched_at: string; customer_id: string }>('SELECT id,dispatch_no,status,dispatched_at,customer_id FROM dispatches WHERE id=?', args.dispatchId);
        ctx.check('dispatch-exists', !!d, `Dispatch ${args.dispatchId} does not exist`, 'NOT_FOUND');
        ctx.check('status-dispatched', d!.status === 'DISPATCHED', `Dispatch ${d?.dispatch_no} is already ${d?.status}`, 'CONFLICT');
        const at = args.deliveredAt ?? ctx.timestamp;
        ctx.check('delivery-after-dispatch', isoOk(at) && Date.parse(at) >= Date.parse(d!.dispatched_at) && Date.parse(at) <= Date.parse(ctx.timestamp) + 60_000, 'Delivery time must be after dispatch and not in the future', 'VALIDATION_FAILED');
        const row = await ctx.update('dispatch', d!.id, { status: 'DELIVERED', delivered_at: at });
        const customer = await ctx.get<{ name: string }>('SELECT name FROM customers WHERE id=?', d!.customer_id);
        const lots = await ctx.all<{ lot_id: string; quantity_kg: number }>('SELECT lot_id,quantity_kg FROM dispatch_lots WHERE dispatch_id=?', d!.id);
        for (const l of lots) {
          await ctx.update('lot', l.lot_id, { status: 'DELIVERED' });
          await ctx.insert('stage_run', { id: await ctx.newId('SR'), lot_id: l.lot_id, stage: 'DELIV', machine_id: null, location: customer?.name ?? 'Customer', shift: 'A', operator_id: ctx.actor.id, in_at: at, out_at: null, input_kg: l.quantity_kg, output_kg: l.quantity_kg, waste_kg: 0, waste_type: null, batch_ref: `PK-${l.lot_id}`, input_refs: '[]', params: '{}', accessories: '{}', notes: 'Received and signed by customer', created_at: ctx.timestamp });
        }
        ctx.setPayload({ dispatchId: d!.id, deliveredAt: at });
        return row;
      },
    },
  },
};
