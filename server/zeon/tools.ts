// Zeon's tools: read-only lookups plus two "suggestions" (open a page, prepare a complaint form).
// Every lookup calls the app's own API with the *signed-in person's* session token, so the existing role checks decide what comes back:
// a customer's tools only reach the portal API, and anything their login may not see is refused by the server, not by this file.
import type { Role } from '@shared/permissions';
import { COMPLAINT_TYPES } from '@shared/params';
import { canNavigate, complaintFormPath, pagesFor, type ZeonAction } from '@shared/zeon';

type Json = Record<string, unknown>;
export interface ToolCtx { role: Role; base: string; auth: string; actions: ZeonAction[] }
export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  run: (input: Json, ctx: ToolCtx) => Promise<unknown>;
}

const MAX_RESULT_CHARS = 7000;
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)).slice(0, max);
const pick = (o: unknown, keys: string[]): Json => Object.fromEntries(keys.filter((k) => o && typeof o === 'object' && (o as Json)[k] !== undefined && (o as Json)[k] !== null).map((k) => [k, (o as Json)[k]]));
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const bareLot = (v: unknown): string => str(v, 20).replace(/^lot[\s-]*/i, '').trim();
const complaintKey = (v: unknown): string => { const s = str(v, 40).trim(); const m = /^(\d{1,4})\s*\/\s*(\d{4})$/.exec(s); return m ? `CMP-${m[1]}-${m[2]}` : s; };

/** GET the app's own API as the signed-in person. Returns the data, or a short error the model can explain. */
async function get(ctx: ToolCtx, path: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${ctx.base}${path}`, { headers: { authorization: ctx.auth }, signal: AbortSignal.timeout(15_000) });
    const body = (await r.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: { message?: string } } | null;
    if (!r.ok || !body?.ok) return { ok: false, error: r.status === 404 ? 'Not found (or not visible to this login).' : r.status === 403 ? 'This login is not allowed to see that.' : (body?.error?.message ?? `The app answered ${r.status}.`) };
    return { ok: true, data: body.data };
  } catch { return { ok: false, error: 'The app did not answer in time.' }; }
}
const fetched = async <T,>(ctx: ToolCtx, path: string, shape: (d: unknown) => T): Promise<T | { error: string }> => { const r = await get(ctx, path); return r.ok ? shape(r.data) : { error: r.error }; };

// ---------------------------------------------------------------- shapes: trimmed so the model sees the facts, not the whole payload
function passportShape(d: unknown): Json {
  const p = d as Json; const lot = (p.lot ?? {}) as Json; const loc = (lot.location ?? null) as Json | null;
  const readings: Json[] = [];
  for (const q of arr(p.quality)) for (const s of arr(q.samples)) for (const v of arr(s.values)) {
    if (v.color !== 'red' && v.color !== 'yellow') continue;
    readings.push({ color: v.color, stage: q.label, machine: s.machineLabel ?? null, parameter: v.label, value: `${v.value} ${v.unit ?? ''}`.trim(), limits: `${v.lower ?? '–'} to ${v.upper ?? '–'} (standard ${v.std ?? '–'})` });
  }
  readings.sort((a, b) => (a.color === b.color ? 0 : a.color === 'red' ? -1 : 1));
  const summary = (p.summary ?? {}) as Json; const mix = (p.mix ?? null) as Json | null;
  return {
    lot: pick(lot, ['lotNo', 'countDisplay', 'mixNo', 'status', 'plannedKg', 'packedKg', 'realizationPct', 'customerName', 'dispatchNo', 'dispatchedAt', 'deliveredAt', 'worstColor', 'red', 'yellow', 'qaReleased', 'qaReleaseAt', 'complaints', 'startedAt']),
    location: loc ? { label: loc.label, detail: loc.detail, machines: arr(loc.machines).map((m) => m.label), since: loc.since, nextStage: loc.nextStage } : null,
    journey: arr(p.journey).map((j) => ({ stage: j.label, state: j.state, worst: j.worst, machines: arr(j.machines).map((m) => m.label), inAt: j.inAt, outAt: j.outAt, wastePct: j.wastePct })),
    readingsOutsideOrNearLimits: { total: readings.length, shown: readings.slice(0, 10) },
    realization: summary.realization ? pick(summary.realization, ['value', 'std', 'color']) : null,
    mix: mix ? { mixNo: mix.mixNo, totalKg: mix.totalKg, recipe: arr(mix.recipe).map((r) => `${r.label} ${r.pct}%`) } : null,
    packing: p.packing ? pick(p.packing, ['packedAt', 'cartons', 'netKg', 'conesPacked', 'colorActual', 'colorOk', 'slipNo']) : null,
    dispatch: p.dispatch ? pick(p.dispatch, ['dispatchNo', 'dispatchedAt', 'deliveredAt', 'invoiceNo', 'vehicleNo', 'transporter', 'lrNo', 'destination', 'cartons', 'netKg', 'status']) : null,
  };
}
const lotRow = (l: Json): Json => ({ lotNo: l.lotNo, count: l.countDisplay, status: l.status, where: (l.location as Json | undefined)?.label, worst: l.worstColor, red: l.red, yellow: l.yellow, customer: l.customerName ?? undefined, dispatchNo: l.dispatchNo ?? undefined });
const complaintRow = (c: Json): Json => ({ id: c.id, complaintNo: c.complaintNo, type: c.typeLabel ?? c.type, status: c.status, customer: c.customerName, lotNo: c.lotNo, received: c.receivedDate, description: str(c.description, 160) });
function workspaceShape(d: unknown): Json {
  const w = d as Json; const analysis = arr(w.analyses)[0]?.result as Json | undefined; const conclusion = w.conclusion as Json | null;
  return {
    complaint: complaintRow((w.complaint ?? {}) as Json),
    analysis: analysis ? {
      headline: ((analysis.summary ?? {}) as Json).headline,
      likelyCauses: arr(analysis.rootCauses).slice(0, 2).map((c) => ({ cause: c.title, confidencePct: Math.round(Number(c.confidence ?? 0)), why: str(c.explanation, 300) })),
      lotsInScope: arr(((analysis.recallScope ?? {}) as Json).lots).map((l) => l.lotNo),
      correctiveActions: arr(((analysis.actions ?? {}) as Json).corrective).map((a) => str(a.text, 200)),
    } : null,
    qaConclusion: conclusion ? pick(conclusion, ['rootCause', 'correctiveAction', 'preventiveAction', 'customerReply', 'at']) : null,
  };
}
function dashboardShape(d: unknown): Json {
  const o = d as Json; const k = (o.kpis ?? {}) as Json;
  return {
    asOf: o.asOf,
    yarnSpunTodayKg: k.productionTodayKg, realization: pick(k.realization, ['actual', 'master', 'color']), qualityAlertsLast7Days: k.qualityAlerts, complaints: k.complaints, dispatches: k.dispatches,
    finishedStockKg: arr(k.finishedStock).filter((s) => Number(s.kg) > 0).map((s) => `${s.display}: ${s.kg} kg in ${s.lots} lot(s)`),
    wastePctByStage: arr(k.wasteByStage).filter((w) => w.actual !== null).map((w) => `${w.label}: ${w.actual}% (master ${w.master}%)`),
    topAlerts: arr(o.alerts).slice(0, 6).map((a) => ({ severity: a.severity, title: a.title, detail: str(a.detail, 160) })),
  };
}

// ---------------------------------------------------------------- tool sets
const lotArg = { lot: { type: 'string', description: 'Lot number such as "101" (a leading "Lot " is fine).' } };
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolDef['input_schema'] => ({ type: 'object', properties, required, additionalProperties: false });

const STAFF: ToolDef[] = [
  { name: 'search', description: 'Find lots, bales, mixes, machines, customers, dispatches, invoices, vehicles or complaints by a word or number.', input_schema: obj({ query: { type: 'string' } }, ['query']),
    run: (i, c) => fetched(c, `/api/search?q=${encodeURIComponent(str(i.query, 80))}`, (d) => arr(d).slice(0, 10).map((h) => pick(h, ['kind', 'title', 'subtitle', 'link']))) },
  { name: 'get_lot', description: 'Full status of one lot: where it is now, journey by stage, readings outside or near the master limits, packing, dispatch, mix and realization.', input_schema: obj(lotArg, ['lot']),
    run: (i, c) => fetched(c, `/api/lots/${encodeURIComponent(bareLot(i.lot))}/passport`, passportShape) },
  { name: 'list_lots', description: 'List lots, optionally by status (PLANNED, IN_PRODUCTION, PACKED, ON_HOLD, DISPATCHED, DELIVERED) and/or count (for example "40CH" or "40s CH").', input_schema: obj({ status: { type: 'string' }, count: { type: 'string' } }),
    run: (i, c) => fetched(c, '/api/lots', (d) => { const s = str(i.status, 20).toUpperCase(); const k = str(i.count, 20).toLowerCase(); const rows = arr(d).filter((l) => (!s || l.status === s) && (!k || String(l.countId).toLowerCase() === k || String(l.countDisplay).toLowerCase() === k)); return { total: rows.length, shown: rows.slice(0, 15).map(lotRow) }; }) },
  { name: 'list_complaints', description: 'List customer complaints, optionally by status (OPEN, UNDER_ANALYSIS, RESOLVED).', input_schema: obj({ status: { type: 'string' } }),
    run: (i, c) => fetched(c, '/api/complaints', (d) => { const s = str(i.status, 20).toUpperCase(); const rows = arr(d).filter((x) => !s || x.status === s); return { total: rows.length, shown: rows.slice(0, 12).map(complaintRow) }; }) },
  { name: 'get_complaint', description: 'One complaint with its AI analysis (likely causes, lots in scope, corrective actions) and the QA conclusion if signed. Accepts "21/2026" or "CMP-21-2026".', input_schema: obj({ complaint: { type: 'string' } }, ['complaint']),
    run: (i, c) => fetched(c, `/api/complaints/${encodeURIComponent(complaintKey(i.complaint))}`, workspaceShape) },
  { name: 'dashboard', description: 'The mill-wide picture today: production, realization, quality alerts, complaints, dispatches, stock, waste by stage and the top alerts.', input_schema: obj({}),
    run: (_i, c) => fetched(c, '/api/dashboard/owner', dashboardShape) },
  { name: 'alerts', description: 'Current alerts: out-of-master results, overdue accessories, mass-balance breaches, colour mismatches, dispatches without QA release.', input_schema: obj({}),
    run: (_i, c) => fetched(c, '/api/alerts', (d) => arr(d).slice(0, 12).map((a) => ({ severity: a.severity, kind: a.kind, title: a.title, detail: str(a.detail, 160), link: a.link }))) },
  { name: 'list_dispatches', description: 'Recent dispatches (newest first) with customer, lots, vehicle, QA release and delivery status.', input_schema: obj({}),
    run: (_i, c) => fetched(c, '/api/dispatches', (d) => arr(d).slice(0, 12).map((x) => ({ dispatchNo: x.dispatchNo, customer: x.customerName, lots: x.lotNos, dispatchedAt: x.dispatchedAt, status: x.status, qaReleased: x.qaReleased, vehicleNo: x.vehicleNo, netKg: x.netKg, link: `/dispatch/${x.id}` }))) },
];

const BUYER: ToolDef[] = [
  { name: 'my_summary', description: 'Your company at a glance: orders, kg ordered, lots, shipments on the way or delivered, and complaints.', input_schema: obj({}), run: (_i, c) => fetched(c, '/api/portal/summary', (d) => d) },
  { name: 'my_lots', description: 'The yarn lots you have bought, with shipment status and how many lab tests were within spec.', input_schema: obj({}),
    run: (_i, c) => fetched(c, '/api/portal/lots', (d) => arr(d).slice(0, 15).map((l) => ({ lotNo: l.lotNo, count: l.countDisplay, kg: l.kg, dispatchNo: l.dispatchNo, status: l.status, deliveredAt: l.deliveredAt, tests: l.tests, complaints: l.complaints }))) },
  { name: 'get_my_lot', description: 'What the mill recorded for one of your lots: journey, readings outside or near spec, packing and dispatch.', input_schema: obj(lotArg, ['lot']),
    run: (i, c) => fetched(c, `/api/portal/lots/${encodeURIComponent(bareLot(i.lot))}`, passportShape) },
  { name: 'my_complaints', description: 'The problems you have reported and their status.', input_schema: obj({}), run: (_i, c) => fetched(c, '/api/portal/complaints', (d) => arr(d).slice(0, 12).map(complaintRow)) },
  { name: 'my_dispatches', description: 'Your shipments with invoice, vehicle, transporter and delivery status.', input_schema: obj({}),
    run: (_i, c) => fetched(c, '/api/portal/dispatches', (d) => arr(d).slice(0, 12).map((x) => pick(x, ['dispatchNo', 'dispatchedAt', 'deliveredAt', 'invoiceNo', 'vehicleNo', 'transporter', 'lrNo', 'cartons', 'netKg']))) },
  { name: 'my_orders', description: 'Your purchase orders with quantity ordered, sent and status.', input_schema: obj({}), run: (_i, c) => fetched(c, '/api/portal/orders', (d) => arr(d).slice(0, 12).map((o) => pick(o, ['orderNo', 'poNo', 'countId', 'qtyKg', 'sentKg', 'dueDate', 'status']))) },
];

const COMMON: ToolDef[] = [
  { name: 'navigate', description: 'Offer the person a button that opens a page. Use only the paths in "Pages this person can open".', input_schema: obj({ path: { type: 'string', description: 'For example /production or /lots/101' }, label: { type: 'string', description: 'Button text, for example "Open lot 101"' } }, ['path', 'label']),
    run: async (i, c) => {
      const path = str(i.path, 400);
      if (!canNavigate(c.role, path)) return { error: 'That page is not available to this person. Pages they can open: ' + pagesFor(c.role).map((p) => p.path).join(', ') };
      c.actions.push({ type: 'navigate', path, label: str(i.label, 60) || 'Open' });
      return { ok: true, note: 'The person will see an Open button.' };
    } },
  { name: 'prepare_complaint_form', description: 'Prepare the complaint form with a lot, a type and a description filled in, behind a confirmation the person sees. Nothing is submitted: they review the form and send it themselves.',
    input_schema: obj({ lot: lotArg.lot, type: { type: 'string', enum: [...COMPLAINT_TYPES] }, description: { type: 'string', description: 'The problem in the customer\'s own words, up to 500 characters.' } }, ['lot', 'type', 'description']),
    run: async (i, c) => {
      const form = complaintFormPath(c.role, i);
      if (!form) return { error: 'This login cannot register a complaint, or the lot number or type is not valid. Complaint types: ' + COMPLAINT_TYPES.join(', ') };
      const exists = await get(c, c.role === 'BUYER' ? `/api/portal/lots/${encodeURIComponent(form.values.lot)}` : `/api/lots/${encodeURIComponent(form.values.lot)}/passport`);
      if (!exists.ok) return { error: c.role === 'BUYER' ? `Lot ${form.values.lot} is not one of this customer's lots.` : `Lot ${form.values.lot} was not found.` };
      c.actions.push({ type: 'open_form', form: 'complaint', path: form.path, label: `Open the complaint form for lot ${form.values.lot}`, summary: `${form.values.type.toLowerCase().replace(/_/g, ' ')} on lot ${form.values.lot}${form.values.description ? `: “${form.values.description}”` : ''}` });
      return { ok: true, note: 'The person will be asked to confirm before the form opens, and must send it themselves.' };
    } },
];

export const toolsFor = (role: Role): ToolDef[] => [...(role === 'BUYER' ? BUYER : STAFF), ...COMMON];

/** Run one tool call and return the text for the model. Unknown or unavailable tools are refused here as well as not being offered. */
export async function runTool(role: Role, name: string, input: unknown, ctx: ToolCtx): Promise<{ text: string; isError: boolean }> {
  const tool = toolsFor(role).find((t) => t.name === name);
  if (!tool) return { text: JSON.stringify({ error: `The tool "${name}" is not available for this login.` }), isError: true };
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  try {
    const out = await tool.run(input as Json, ctx);
    const text = JSON.stringify(out);
    return { text: text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…(truncated)` : text, isError: !!(out as Json | null)?.error };
  } catch { return { text: JSON.stringify({ error: 'The lookup failed unexpectedly.' }), isError: true }; }
}
