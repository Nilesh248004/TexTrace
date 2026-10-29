// Cross-lot read-models: live lot board, trace (forward/backward), alerts, owner dashboard, heatmaps, universal search.
import type { DB } from '../db';
import { evaluate, worstColor, type QualityColor } from '@shared/quality';
import { ACCESSORY_INFO, PARAMS, STAGE_INFO, PROCESS_STAGES, MACHINE_STAGES, routeFor, paramDef, type Stage } from '@shared/params';
import { istDate } from '@shared/format';
import type { Alert, BackTrace, Completeness, ForwardTrace, Heatmap, HeatCell, LotSummary, OwnerDashboard, SearchHit, TraceBale } from '@shared/domain';
import { MasterBook } from './masters';
import { LotData, balanceOf, chainOf, judgeCustom, judgeTestValues, locate, summarize, type LotBundle } from './lots';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r1 = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const parse = <T,>(v: unknown, d: T): T => { try { return typeof v === 'string' ? (JSON.parse(v) as T) : d; } catch { return d; } };
const DAY = 86_400_000;

// ------------------------------------------------------------------ live board
export async function liveBoard(db: DB, nowIso: string) {
  const nowMs = Date.parse(nowIso);
  const [d, book] = await Promise.all([LotData.load(db), MasterBook.load(db)]);
  const lots: LotSummary[] = [...d.lots.values()].map((b) => summarize(b, d, book, nowMs)).sort((a, b) => Number(a.lotNo) - Number(b.lotNo));
  const bales = await db.prepare('SELECT bale_no,variety,bay,bin,status,mix_id,received_at,weight_kg FROM bales ORDER BY bale_no').all<Row>();
  const baleStore = { inStore: bales.filter((b) => b.status === 'IN_STORE').length, reserved: bales.filter((b) => b.status === 'IN_STORE' && b.mix_id).length, issued: bales.filter((b) => b.status === 'ISSUED').length, totalKg: r1(bales.filter((b) => b.status === 'IN_STORE').reduce((s, b) => s + num(b.weight_kg), 0), 0), byBay: [...new Set(bales.map((b) => str(b.bay)))].sort().map((bay) => ({ bay, bales: bales.filter((b) => b.bay === bay && b.status === 'IN_STORE').length })) };
  const running = [...d.lots.values()].flatMap((b) => b.runs.filter((r) => !r.out_at && r.machine_id).map((r) => ({ machineId: str(r.machine_id), machineLabel: str(d.machines.get(str(r.machine_id))?.label), stage: str(r.stage) as Stage, lotNo: str(b.lot.lot_no), lotId: str(b.lot.id), countDisplay: str(b.count.display), since: str(r.in_at), shift: (r.shift as string) ?? null })));
  return { asOf: nowIso, lots, baleStore, running };
}

// ------------------------------------------------------------------ trace
const traceBale = (x: Row, kgUsed: number, pct: number): TraceBale => ({ baleId: str(x.id), baleNo: str(x.bale_no), variety: str(x.variety), supplier: str(x.supplier), station: str(x.station), bay: str(x.bay), bin: str(x.bin), receivedAt: str(x.received_at), issuedAt: (x.issued_at as string) ?? null, status: str(x.status), kgUsed, pct });

export async function backTrace(db: DB, key: string): Promise<BackTrace | null> {
  const row = await db.prepare('SELECT id FROM lots WHERE id=? OR lot_no=? OR lot_code=?').get<{ id: string }>(key, key.replace(/^LOT-/i, ''), key);
  if (!row) return null;
  const d = await LotData.load(db, [row.id]);
  const b = d.lots.get(row.id) as LotBundle;
  const bales = await db.prepare('SELECT mb.kg_used, mb.pct, b.* FROM mix_bales mb JOIN bales b ON b.id=mb.bale_id WHERE mb.mix_id=? ORDER BY b.bale_no').all<Row>(str(b.lot.mix_id));
  const last = b.dispatches[b.dispatches.length - 1];
  const route = routeFor(!!num(b.count.uses_comber));
  const suppliers = new Map<string, { supplier: string; station: string; bales: number; kg: number }>();
  for (const x of bales) { const k = `${x.supplier}|${x.station}`; const s = suppliers.get(k) ?? { supplier: str(x.supplier), station: str(x.station), bales: 0, kg: 0 }; s.bales++; s.kg += num(x.kg_used); suppliers.set(k, s); }
  return {
    lotId: str(b.lot.id), lotNo: str(b.lot.lot_no),
    customer: last ? { id: str(last.customer_id), name: str(d.customers.get(str(last.customer_id))?.name) } : null,
    dispatch: last ? { id: str(last.id), dispatchNo: str(last.dispatch_no), dispatchedAt: str(last.dispatched_at), vehicleNo: str(last.vehicle_no), invoiceNo: str(last.invoice_no) } : null,
    packing: b.packing ? { id: str(b.packing.id), slipNo: str(b.packing.slip_no), cartons: num(b.packing.cartons), cartonFrom: str(b.packing.carton_from), cartonTo: str(b.packing.carton_to) } : null,
    stages: route.map((s) => { const rs = b.runs.filter((r) => r.stage === s); return { stage: s, label: STAGE_INFO[s].label, machines: rs.filter((r) => r.machine_id).map((r) => str(d.machines.get(str(r.machine_id))?.label)), batchRefs: rs.map((r) => str(r.batch_ref)).filter(Boolean), inAt: rs.length ? rs.map((r) => str(r.in_at)).sort()[0] : null, outAt: rs.length && rs.every((r) => r.out_at) ? rs.map((r) => str(r.out_at)).sort().pop() ?? null : null }; }).filter((s) => s.inAt),
    mix: { id: str(b.mix.id), mixNo: str(b.mix.mix_no), countId: str(b.mix.count_id), recipe: parse<{ label: string; pct: number }[]>(b.mix.recipe, []).map((r) => ({ label: r.label, pct: r.pct })) },
    bales: bales.map((x) => traceBale(x, num(x.kg_used), num(x.pct))),
    suppliers: [...suppliers.values()].map((s) => ({ ...s, kg: r1(s.kg, 0) })),
  };
}

export async function forwardTrace(db: DB, key: string, nowIso: string): Promise<ForwardTrace | null> {
  const bale = await db.prepare('SELECT * FROM bales WHERE id=? OR bale_no=?').get<Row>(key, key.replace(/^BALE-/i, ''));
  if (!bale) return null;
  const nowMs = Date.parse(nowIso);
  const mix = bale.mix_id ? await db.prepare('SELECT * FROM mixes WHERE id=?').get<Row>(str(bale.mix_id)) : undefined;
  const link = mix ? await db.prepare('SELECT kg_used,pct FROM mix_bales WHERE mix_id=? AND bale_id=?').get<Row>(str(mix.id), str(bale.id)) : undefined;
  const lotRows = mix ? await db.prepare('SELECT id FROM lots WHERE mix_id=? ORDER BY seq').all<{ id: string }>(str(mix.id)) : [];
  const d = await LotData.load(db, lotRows.map((l) => l.id));
  const book = await MasterBook.load(db);
  const lots = [...d.lots.values()].map((b) => summarize(b, d, book, nowMs));
  const lotKg = lots.length && link ? r1(num(link.kg_used) / lots.length, 0) : null;
  const customers = new Map<string, { id: string; name: string; lots: string[]; kg: number }>();
  for (const l of lots) if (l.customerId) { const c = customers.get(l.customerId) ?? { id: l.customerId, name: l.customerName ?? '', lots: [], kg: 0 }; c.lots.push(l.lotNo); c.kg += lotKg ?? 0; customers.set(l.customerId, c); }
  const timeline: ForwardTrace['timeline'] = [{ label: 'Received into bale store', at: str(bale.received_at), detail: `${str(bale.bay)} / bin ${str(bale.bin)} from ${str(bale.supplier)}, ${str(bale.station)}` }];
  let location: ForwardTrace['location'];
  if (bale.status === 'IN_STORE') {
    location = { stage: 'BALE', state: bale.mix_id ? 'RESERVED' : 'IN_STORE', label: 'In bale store', detail: `${str(bale.bay)} / bin ${str(bale.bin)} since ${str(bale.received_at)}${mix ? ` · reserved for mix ${str(mix.mix_no)}` : ' · not yet reserved'}` };
  } else {
    timeline.push({ label: 'Issued from bale store', at: (bale.issued_at as string) ?? null, detail: mix ? `to mix ${str(mix.mix_no)} (${str(mix.blow_room_line)})` : '' });
    const first = lots[0];
    const br = d.lots.get(first.id)?.runs.find((r) => r.stage === 'BR');
    if (br) timeline.push({ label: 'Entered blow room', at: str(br.in_at), detail: `${str(d.machines.get(str(br.machine_id))?.label)} — blended with the other bales of the mix; traceability is now at mix level` });
    const cur = lots.find((l) => l.location.state !== 'DELIVERED') ?? lots[lots.length - 1];
    const loc = cur.location;
    timeline.push({ label: `Now: ${loc.label}`, at: loc.since, detail: `Lot ${cur.lotNo}${loc.machines.length ? ` · ${loc.machines.map((m) => m.label).join(', ')}` : ''}` });
    location = { stage: loc.stage, state: loc.state, label: `Blended in mix ${str(mix?.mix_no)} → lot ${cur.lotNo}: ${loc.label}`, detail: loc.detail };
  }
  return {
    bale: { ...traceBale(bale, num(link?.kg_used), num(link?.pct)), weightKg: num(bale.weight_kg), gin: str(bale.gin_lot) }, location, timeline,
    mix: mix ? { id: str(mix.id), mixNo: str(mix.mix_no), status: str(mix.status), countId: str(mix.count_id) } : null,
    lots: lots.map((l) => ({ lotId: l.id, lotNo: l.lotNo, status: l.status, location: l.location.label, customer: l.customerName, dispatchNo: l.dispatchNo, dispatchedAt: l.dispatchedAt, kg: lotKg })),
    customers: [...customers.values()].map((c) => ({ ...c, kg: r1(c.kg, 0) })),
  };
}

// ------------------------------------------------------------------ accessories on machines
export interface AccessoryStatus { machineId: string; machineLabel: string; stage: Stage; countId: string | null; kind: string; kindLabel: string; param: string; spec: string; changedAt: string; ageDays: number | null; value: number | null; std: number | null; upper: number | null; color: QualityColor; text: string; overdueDays: number | null }

export async function accessoryStatuses(db: DB, nowIso: string): Promise<AccessoryStatus[]> {
  const book = await MasterBook.load(db);
  const nowMs = Date.parse(nowIso);
  const changes = await db.prepare('SELECT machine_id,kind,spec,value,changed_at FROM accessory_changes ORDER BY changed_at').all<Row>();
  const machines = await db.prepare('SELECT id,label,department FROM machines').all<Row>();
  const lastRun = await db.prepare('SELECT s.machine_id, l.count_id FROM stage_runs s JOIN lots l ON l.id=s.lot_id WHERE s.machine_id IS NOT NULL ORDER BY s.in_at').all<Row>();
  const countOf = new Map<string, string>(); for (const r of lastRun) countOf.set(str(r.machine_id), str(r.count_id));
  const last = new Map<string, Row>(); for (const c of changes) last.set(`${c.machine_id}|${c.kind}`, c);
  const out: AccessoryStatus[] = [];
  for (const m of machines) {
    const stage = str(m.department) as Stage;
    for (const [kind, info] of Object.entries(ACCESSORY_INFO)) {
      if (!info.stages.includes(stage)) continue;
      const c = last.get(`${m.id}|${kind}`);
      if (!c) continue;
      const countId = countOf.get(str(m.id)) ?? null;
      const age = kind === 'SPACER' ? null : Math.floor((nowMs - Date.parse(str(c.changed_at))) / DAY);
      const value = kind === 'SPACER' ? num(c.value) : age;
      const j = countId ? book.judge(countId, 'ACCESSORIES', stage, info.param, value, istDate(nowIso), 'latest') : null;
      out.push({ machineId: str(m.id), machineLabel: str(m.label), stage, countId, kind, kindLabel: info.label, param: info.param, spec: str(c.spec), changedAt: str(c.changed_at), ageDays: age, value, std: j?.std ?? null, upper: j?.upper ?? null, color: j?.color ?? 'none', text: j?.text ?? 'No standard', overdueDays: j && j.upper !== null && value !== null && value > j.upper ? Math.round(value - j.upper) : null });
    }
  }
  return out.sort((a, b) => a.machineId.localeCompare(b.machineId, undefined, { numeric: true }) || a.kind.localeCompare(b.kind));
}

// ------------------------------------------------------------------ alerts
export async function buildAlerts(db: DB, nowIso: string): Promise<Alert[]> {
  const nowMs = Date.parse(nowIso);
  const [d, book] = await Promise.all([LotData.load(db), MasterBook.load(db)]);
  const alerts: Alert[] = [];
  for (const b of d.lots.values()) {
    const lotNo = str(b.lot.lot_no);
    if (b.lot.status === 'ON_HOLD') alerts.push({ id: `hold-${lotNo}`, kind: 'QA_HOLD', severity: 'red', title: `Lot ${lotNo} is on QA hold`, detail: 'Lot composite is out of master limits — dispatch is blocked until QA releases or overrides.', link: `/lots/${b.lot.id}`, at: null });
    if (b.packing && !num(b.packing.color_ok)) alerts.push({ id: `color-${lotNo}`, kind: 'COLOR_MISMATCH', severity: 'red', title: `Cone colour mismatch at packing — lot ${lotNo}`, detail: `Packed with ${str(b.packing.color_actual)} tip; master for ${str(b.count.display)} is ${str(b.packing.color_master)}.`, link: `/lots/${b.lot.id}`, at: str(b.packing.packed_at) });
    for (const r of b.runs) {
      const bal = balanceOf(r);
      if (bal && bal.color !== 'green') alerts.push({ id: `mb-${r.id}`, kind: 'MASS_BALANCE', severity: bal.color === 'red' ? 'red' : 'yellow', title: `Mass-balance breach — lot ${lotNo}, ${str(d.machines.get(str(r.machine_id))?.label)}`, detail: `${Math.abs(bal.diffKg)} kg (${bal.diffPct}%) of ${num(r.input_kg)} kg input is unaccounted (input − output − waste).`, link: `/lots/${b.lot.id}`, at: str(r.out_at) });
    }
  }
  for (const x of await db.prepare(`SELECT d.id,d.dispatch_no,d.dispatched_at,c.name FROM dispatches d JOIN customers c ON c.id=d.customer_id WHERE d.qa_released=0`).all<Row>())
    alerts.push({ id: `rel-${x.id}`, kind: 'NO_QA_RELEASE', severity: 'red', title: `Dispatch ${x.dispatch_no} left without QA release`, detail: `Sent to ${x.name} before QA sign-off — regularise or recall.`, link: `/dispatch/${x.id}`, at: str(x.dispatched_at) });
  for (const a of await accessoryStatuses(db, nowIso)) if (a.color === 'red' || a.color === 'yellow')
    alerts.push({ id: `acc-${a.machineId}-${a.kind}`, kind: 'ACCESSORY_OVERDUE', severity: a.color === 'red' ? 'red' : 'yellow', title: `${a.machineLabel}: ${a.kindLabel.toLowerCase()} ${a.color === 'red' ? 'overdue' : 'due soon'}`, detail: `Age ${a.ageDays} days vs master limit ${a.upper}${a.overdueDays ? ` — ${a.overdueDays} days overdue` : ''}. Worn accessories raise hairiness and count variation.`, link: '/accessories', at: a.changedAt });
  // out-of-master machine results in the last 5 days, grouped by machine + parameter
  const since = nowMs - 5 * DAY;
  const groups = new Map<string, { machine: string; label: string; red: number; n: number; lots: Set<string> }>();
  for (const b of d.lots.values()) for (const t of b.tests) {
    if (t.sample_type !== 'MACHINE' || Date.parse(str(t.tested_at)) < since) continue;
    for (const j of judgeTestValues(book, str(b.lot.count_id), t, 'asOf')) {
      const k = `${t.machine_id}|${j.key}`; const g = groups.get(k) ?? { machine: str(t.machine_id), label: j.label, red: 0, n: 0, lots: new Set<string>() };
      g.n++; if (j.color === 'red') { g.red++; g.lots.add(str(b.lot.lot_no)); } groups.set(k, g);
    }
  }
  for (const [k, g] of groups) if (g.red >= 3) alerts.push({ id: `oom-${k}`, kind: 'OUT_OF_MASTER', severity: 'red', title: `${str(d.machines.get(g.machine)?.label)}: ${g.label} out of master`, detail: `${g.red} of ${g.n} samples in the last 5 days are out of limits (lots ${[...g.lots].join(', ')}).`, link: `/analytics?stage=${str(d.machines.get(g.machine)?.department)}&machine=${g.machine}`, at: null });
  const cmp = await db.prepare(`SELECT customer_id,type,COUNT(*) n FROM complaints GROUP BY customer_id,type HAVING COUNT(*)>=2`).all<Row>();
  for (const c of cmp) alerts.push({ id: `rep-${c.customer_id}-${c.type}`, kind: 'REPEAT_COMPLAINT', severity: 'yellow', title: `Repeat complaint: ${str(d.customers.get(str(c.customer_id))?.name)} — ${str(c.type).toLowerCase().replace('_', ' ')}`, detail: `${c.n} complaints of the same type from this customer.`, link: '/complaints', at: null });
  for (const v of await db.prepare(`SELECT id,master_type,count_id,version_no,status FROM master_versions WHERE status IN ('DRAFT','QA_APPROVED')`).all<Row>())
    alerts.push({ id: `mv-${v.id}`, kind: 'MASTER_PENDING', severity: 'yellow', title: `Master ${str(v.master_type)} v${v.version_no} (${v.count_id}) is ${v.status === 'DRAFT' ? 'awaiting QA approval' : 'approved, waiting to be activated'}`, detail: 'Results keep being judged on the active version until it is activated.', link: '/masters', at: null });
  const rank = (a: Alert) => (a.severity === 'red' ? 0 : 1);
  return alerts.sort((a, b) => rank(a) - rank(b));
}

// ------------------------------------------------------------------ heatmap
export async function buildHeatmap(db: DB, opts: { stage: Stage; parameter: string; days: number; countId?: string | null }, nowIso: string): Promise<Heatmap> {
  const [d, book] = await Promise.all([LotData.load(db), MasterBook.load(db)]);
  const nowMs = Date.parse(nowIso);
  const dates: string[] = [];
  for (let i = opts.days - 1; i >= 0; i--) dates.push(istDate(new Date(nowMs - i * DAY).toISOString()));
  const machines = [...d.machines.values()].filter((m) => m.department === opts.stage).map((m) => ({ id: str(m.id), label: str(m.label) })).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const acc = new Map<string, { values: number[]; lots: Set<string>; counts: Map<string, number> }>();
  for (const b of d.lots.values()) {
    if (opts.countId && b.lot.count_id !== opts.countId) continue;
    for (const t of b.tests) {
      if (t.sample_type !== 'MACHINE' || t.stage !== opts.stage) continue;
      const v = parse<Record<string, number>>(t.values_json, {})[opts.parameter];
      if (typeof v !== 'number') continue;
      const k = `${t.machine_id}|${t.test_date}`; const cell = acc.get(k) ?? { values: [], lots: new Set<string>(), counts: new Map<string, number>() };
      cell.values.push(v); cell.lots.add(str(b.lot.id)); cell.counts.set(str(b.lot.count_id), (cell.counts.get(str(b.lot.count_id)) ?? 0) + 1); acc.set(k, cell);
    }
  }
  const cells: HeatCell[] = [];
  for (const m of machines) for (const date of dates) {
    const c = acc.get(`${m.id}|${date}`);
    if (!c) { cells.push({ machineId: m.id, date, value: null, color: 'none', n: 0, lotIds: [], countId: null }); continue; }
    const value = c.values.reduce((s, x) => s + x, 0) / c.values.length;
    const countId = [...c.counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    cells.push({ machineId: m.id, date, value: r1(value, paramDef(opts.parameter)?.decimals ?? 2), color: book.judge(countId, 'QUALITY', opts.stage, opts.parameter, value, date).color, n: c.values.length, lotIds: [...c.lots], countId });
  }
  const def = paramDef(opts.parameter);
  return { stage: opts.stage, parameter: opts.parameter, label: def?.label ?? opts.parameter, unit: def?.unit ?? '', dates, machines, cells };
}

// ------------------------------------------------------------------ owner dashboard
export async function ownerDashboard(db: DB, nowIso: string): Promise<OwnerDashboard> {
  const nowMs = Date.parse(nowIso);
  const todayStr = istDate(nowIso);
  const [d, book] = await Promise.all([LotData.load(db), MasterBook.load(db)]);
  const countRows = [...d.counts.values()].sort((a, b) => num(a.ne) - num(b.ne) || str(a.id).localeCompare(str(b.id)));
  const display = (id: string) => str(d.counts.get(id)?.display);
  const lots = [...d.lots.values()];
  const summaries = new Map(lots.map((b) => [str(b.lot.id), summarize(b, d, book, nowMs)]));

  // yarn production per day (ring-frame output spread over each run)
  const byDay = new Map<string, Record<string, number>>();
  const dayList: string[] = []; for (let i = 6; i >= 0; i--) dayList.push(istDate(new Date(nowMs - i * DAY).toISOString()));
  for (const dd of dayList) byDay.set(dd, {});
  for (const b of lots) for (const r of b.runs.filter((x) => x.stage === 'RF')) {
    const start = Date.parse(str(r.in_at)); const end = r.out_at ? Date.parse(str(r.out_at)) : nowMs; const span = Math.max(end - start, 1);
    for (const dd of dayList) {
      const dayStart = Date.parse(`${dd}T00:00:00Z`) - 330 * 60_000; const ov = Math.min(end, dayStart + DAY) - Math.max(start, dayStart);
      if (ov > 0) { const rec = byDay.get(dd) as Record<string, number>; rec[str(b.lot.count_id)] = (rec[str(b.lot.count_id)] ?? 0) + (num(r.output_kg) * ov) / span; }
    }
  }
  const prodToday = byDay.get(todayStr) ?? {};
  // WIP
  const wip = new Map<Stage, { kg: number; lots: number }>();
  for (const b of lots) {
    const s = summaries.get(str(b.lot.id)) as LotSummary;
    const st = s.location.stage;
    if (!st || !PROCESS_STAGES.includes(st) && st !== 'PACK') continue;
    if (s.location.state === 'DELIVERED' || s.location.state === 'IN_TRANSIT') continue;
    const rs = b.runs.filter((r) => r.stage === st);
    const kg = s.location.state === 'RUNNING' ? rs.reduce((x, r) => x + num(r.input_kg), 0) : rs.reduce((x, r) => x + num(r.output_kg), 0);
    const w = wip.get(st) ?? { kg: 0, lots: 0 }; w.kg += kg; w.lots += 1; wip.set(st, w);
  }
  // realization (lots packed in the last 21 days)
  const realByCount = new Map<string, { net: number; cotton: number; lots: number }>();
  for (const b of lots) {
    if (!b.packing || nowMs - Date.parse(str(b.packing.packed_at)) > 21 * DAY) continue;
    const brIn = b.runs.filter((r) => r.stage === 'BR').reduce((x, r) => x + num(r.input_kg), 0); if (brIn <= 0) continue;
    const rec = realByCount.get(str(b.lot.count_id)) ?? { net: 0, cotton: 0, lots: 0 }; rec.net += num(b.packing.net_kg); rec.cotton += brIn; rec.lots++; realByCount.set(str(b.lot.count_id), rec);
  }
  const targetOf = (cid: string) => book.countMix(cid, '9999-12-31', 'latest')?.meta.targetRealizationPct ?? 86;
  const realRows = countRows.map((c) => { const r = realByCount.get(str(c.id)); const actual = r ? r1((r.net / r.cotton) * 100, 1) : null; const master = targetOf(str(c.id)); return { countId: str(c.id), display: str(c.display), actual, master, color: (actual === null ? 'none' : evaluate(actual, { std: master, lower: master - 1.5, upper: null }, 0.2).color) as QualityColor, lots: r?.lots ?? 0 }; });
  const totNet = [...realByCount.values()].reduce((s, r) => s + r.net, 0); const totCotton = [...realByCount.values()].reduce((s, r) => s + r.cotton, 0);
  const wMaster = totCotton ? [...realByCount.entries()].reduce((s, [cid, r]) => s + targetOf(cid) * r.cotton, 0) / totCotton : null;
  const realActual = totCotton ? r1((totNet / totCotton) * 100, 1) : null;
  // waste + efficiency (completed runs, last 14 / 7 days)
  const wasteRows = PROCESS_STAGES.filter((s) => s !== 'COMB' || countRows.some((c) => num(c.uses_comber))).map((stage) => {
    let inKg = 0; let wasteKg = 0; let sumStd = 0; let sumUp = 0;
    for (const b of lots) for (const r of b.runs) if (r.stage === stage && r.out_at && nowMs - Date.parse(str(r.out_at)) <= 14 * DAY) {
      const it = book.item(str(b.lot.count_id), 'PRODUCTION', stage, 'WASTE_PCT', istDate(str(r.in_at)));
      inKg += num(r.input_kg); wasteKg += num(r.waste_kg); sumStd += (it?.item.std ?? 0) * num(r.input_kg); sumUp += (it?.item.upper ?? 0) * num(r.input_kg);
    }
    const actual = inKg > 0 ? r1((wasteKg / inKg) * 100, 2) : null; const master = inKg > 0 ? r1(sumStd / inKg, 2) : null;
    return { stage, label: STAGE_INFO[stage].label, actual, master, color: (actual === null || master === null ? 'none' : evaluate(actual, { std: master, lower: null, upper: r1(sumUp / inKg, 2) }, 0.2).color) as QualityColor };
  });
  const effRows = PROCESS_STAGES.filter((s) => s !== 'COMB' || countRows.some((c) => num(c.uses_comber))).map((stage) => {
    let n = 0; let sum = 0; let sumStd = 0; let sumLo = 0;
    for (const b of lots) for (const r of b.runs) if (r.stage === stage && nowMs - Date.parse(str(r.in_at)) <= 7 * DAY) {
      const v = parse<Record<string, number>>(r.params, {}).EFF_PCT; if (typeof v !== 'number') continue;
      const it = book.item(str(b.lot.count_id), 'PRODUCTION', stage, 'EFF_PCT', istDate(str(r.in_at))); n++; sum += v; sumStd += it?.item.std ?? 0; sumLo += it?.item.lower ?? 0;
    }
    const actual = n ? r1(sum / n, 1) : null; const master = n ? r1(sumStd / n, 1) : null;
    return { stage, label: STAGE_INFO[stage].label, actual, master, color: (actual === null || master === null ? 'none' : evaluate(actual, { std: master, lower: r1(sumLo / n, 1), upper: null }, 0.2).color) as QualityColor };
  });
  // quality alerts 7 days
  let red = 0; let yellow = 0;
  for (const b of lots) for (const t of b.tests) if (t.sample_type === 'MACHINE' && nowMs - Date.parse(str(t.tested_at)) <= 7 * DAY) for (const j of judgeTestValues(book, str(b.lot.count_id), t, 'asOf')) { if (j.color === 'red') red++; else if (j.color === 'yellow') yellow++; }
  const cstat = await db.prepare('SELECT status, COUNT(*) n FROM complaints GROUP BY status').all<Row>();
  const cs = (s: string) => num(cstat.find((x) => x.status === s)?.n);
  // finished stock
  const stock = new Map<string, { kg: number; lots: number }>();
  for (const b of lots) { const s = summaries.get(str(b.lot.id)) as LotSummary; if (b.packing && ['PACKED', 'ON_HOLD'].includes(str(b.lot.status)) && s.location.stage !== 'DISP' && s.location.stage !== 'DELIV') { const x = stock.get(str(b.lot.count_id)) ?? { kg: 0, lots: 0 }; x.kg += num(b.packing.net_kg); x.lots++; stock.set(str(b.lot.count_id), x); } }
  const dsp = await db.prepare('SELECT dispatch_date, quantity_kg FROM dispatches').all<Row>();
  const month = todayStr.slice(0, 7);
  // count cards
  const cards = countRows.map((c) => {
    const cid = str(c.id); const meta = book.countMix(cid, '9999-12-31', 'latest')?.meta;
    const route = routeFor(!!num(c.uses_comber));
    const active = lots.filter((b) => b.lot.count_id === cid && ['PLANNED', 'IN_PRODUCTION', 'PACKED', 'ON_HOLD'].includes(str(b.lot.status)));
    const stages = route.filter((s) => s !== 'DELIV' && s !== 'DISP').map((stage) => ({ stage, label: STAGE_INFO[stage].short, lots: active.filter((b) => summaries.get(str(b.lot.id))?.location.stage === stage).map((b) => str(b.lot.lot_no)) }));
    const recent = lots.filter((b) => b.lot.count_id === cid).slice(-5);
    const lotLevel = (b: LotBundle): QualityColor => worstColor([...b.tests.filter((t) => t.sample_type === 'LOT').flatMap((t) => judgeTestValues(book, str(b.lot.count_id), t, 'asOf').map((j) => j.color)), ...(b.lot.status === 'ON_HOLD' ? (['red'] as QualityColor[]) : [])]);
    const worst = worstColor(recent.map(lotLevel));
    const color = book.color(cid, '9999-12-31', 'latest')?.meta;
    const real = realRows.find((r) => r.countId === cid);
    return { countId: cid, display: str(c.display), label: str(c.label), recipe: (meta?.recipe ?? []).map((r) => ({ label: r.label, pct: r.pct })), route, stages, lotsActive: active.length, worstColor: worst, realization: real?.actual ?? null, realizationMaster: real?.master ?? targetOf(cid), colorTip: color ? { colorName: color.colorName, hex: color.hex } : null, production7dKg: r1(dayList.reduce((s, dd) => s + ((byDay.get(dd) ?? {})[cid] ?? 0), 0), 0) };
  });
  const comp: Completeness[] = countRows.map((c) => book.completeness(str(c.id)));
  return {
    asOf: nowIso, businessDate: todayStr,
    kpis: {
      productionTodayKg: r1(Object.values(prodToday).reduce((s, x) => s + x, 0), 0),
      productionTodayByCount: countRows.map((c) => ({ countId: str(c.id), display: str(c.display), kg: r1(prodToday[str(c.id)] ?? 0, 0) })),
      production7d: dayList.map((dd) => ({ date: dd, byCount: Object.fromEntries(countRows.map((c) => [str(c.id), r1((byDay.get(dd) ?? {})[str(c.id)] ?? 0, 0)])) })),
      wipByStage: PROCESS_STAGES.concat(['PACK' as Stage]).filter((s) => s !== 'COMB' || wip.has('COMB')).map((stage) => ({ stage, label: STAGE_INFO[stage].label, kg: r1(wip.get(stage)?.kg ?? 0, 0), lots: wip.get(stage)?.lots ?? 0 })),
      realization: { actual: realActual, master: wMaster === null ? null : r1(wMaster, 1), color: realActual === null || wMaster === null ? 'none' : evaluate(realActual, { std: wMaster, lower: wMaster - 1.5, upper: null }, 0.2).color, byCount: realRows },
      wasteByStage: wasteRows, efficiency: effRows, qualityAlerts: { red, yellow, windowDays: 7 },
      complaints: { open: cs('OPEN'), inProgress: cs('UNDER_ANALYSIS'), closed: cs('RESOLVED') },
      finishedStock: countRows.map((c) => ({ countId: str(c.id), display: str(c.display), kg: r1(stock.get(str(c.id))?.kg ?? 0, 0), lots: stock.get(str(c.id))?.lots ?? 0 })),
      dispatches: { today: dsp.filter((x) => x.dispatch_date === todayStr).length, todayKg: r1(dsp.filter((x) => x.dispatch_date === todayStr).reduce((s, x) => s + num(x.quantity_kg), 0), 0), month: dsp.filter((x) => str(x.dispatch_date).startsWith(month)).length, monthKg: r1(dsp.filter((x) => str(x.dispatch_date).startsWith(month)).reduce((s, x) => s + num(x.quantity_kg), 0), 0) },
      masterCompleteness: comp,
    },
    counts: cards, alerts: await buildAlerts(db, nowIso),
  };
}

// ------------------------------------------------------------------ universal search
export async function search(db: DB, q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (!term) return [];
  const clean = term.replace(/[%_]/g, '').toLowerCase(); const like = `%${clean}%`; const prefix = `${clean}%`;
  const hits: SearchHit[] = [];
  const carton = /^C-(\d+)-\d+$/i.exec(term);
  if (carton) hits.push({ kind: 'carton', title: `Carton ${term.toUpperCase()}`, subtitle: `Lot ${carton[1]} — open the lot passport`, link: `/lots/LOT-${carton[1]}` });
  for (const l of await db.prepare(`SELECT l.id,l.lot_no,l.lot_code,l.status,c.display FROM lots l JOIN counts c ON c.id=l.count_id WHERE LOWER(l.lot_no) LIKE ? OR LOWER(l.lot_code) LIKE ? ORDER BY CASE WHEN l.lot_no=? THEN 0 ELSE 1 END, l.seq LIMIT 6`).all<Row>(prefix, like, term.trim()))
    hits.push({ kind: 'lot', title: `Lot ${l.lot_no}`, subtitle: `${l.display} · ${str(l.status).toLowerCase().replace('_', ' ')}`, link: `/lots/${l.id}` });
  for (const b of await db.prepare('SELECT id,bale_no,variety,bay,bin,status FROM bales WHERE LOWER(bale_no) LIKE ? ORDER BY bale_no LIMIT 5').all<Row>(prefix))
    hits.push({ kind: 'bale', title: `Bale ${b.bale_no}`, subtitle: `${b.variety} · ${b.bay} / ${b.bin} · ${str(b.status).toLowerCase().replace('_', ' ')}`, link: `/live?bale=${b.bale_no}` });
  for (const m of await db.prepare('SELECT id,mix_no,count_id,status FROM mixes WHERE LOWER(mix_no) LIKE ? OR LOWER(id) LIKE ? LIMIT 4').all<Row>(like, like))
    hits.push({ kind: 'mix', title: `Mix ${m.mix_no}`, subtitle: `${m.count_id} · ${str(m.status).toLowerCase()}`, link: `/live?mix=${m.id}` });
  for (const m of await db.prepare('SELECT id,label,department FROM machines WHERE LOWER(id) LIKE ? OR LOWER(label) LIKE ? LIMIT 4').all<Row>(like, like))
    hits.push({ kind: 'machine', title: `Machine ${m.label}`, subtitle: STAGE_INFO[str(m.department) as Stage]?.label ?? '', link: `/production?machine=${m.id}` });
  for (const c of await db.prepare('SELECT id,name,city FROM customers WHERE LOWER(name) LIKE ? OR LOWER(code) LIKE ? LIMIT 3').all<Row>(like, like))
    hits.push({ kind: 'customer', title: str(c.name), subtitle: `Customer · ${c.city}`, link: `/customers?c=${c.id}` });
  for (const x of await db.prepare('SELECT d.id,d.dispatch_no,d.invoice_no,d.vehicle_no,d.lr_no,c.name FROM dispatches d JOIN customers c ON c.id=d.customer_id WHERE LOWER(d.dispatch_no) LIKE ? OR LOWER(d.invoice_no) LIKE ? OR LOWER(d.vehicle_no) LIKE ? OR LOWER(d.lr_no) LIKE ? ORDER BY d.dispatched_at DESC LIMIT 6').all<Row>(like, like, like, like)) {
    const t = term.toLowerCase();
    const kind: SearchHit['kind'] = str(x.invoice_no).toLowerCase().includes(t) ? 'invoice' : str(x.vehicle_no).toLowerCase().includes(t) ? 'vehicle' : str(x.lr_no).toLowerCase().includes(t) ? 'lr' : 'dispatch';
    hits.push({ kind, title: kind === 'invoice' ? `Invoice ${x.invoice_no}` : kind === 'vehicle' ? `Vehicle ${x.vehicle_no}` : kind === 'lr' ? `LR ${x.lr_no}` : `Dispatch ${x.dispatch_no}`, subtitle: `${x.name} · ${x.dispatch_no}`, link: `/dispatch/${x.id}` });
  }
  for (const c of await db.prepare('SELECT cp.id,cp.complaint_no,cp.type,cu.name FROM complaints cp JOIN customers cu ON cu.id=cp.customer_id WHERE LOWER(cp.complaint_no) LIKE ? LIMIT 3').all<Row>(like))
    hits.push({ kind: 'complaint', title: `Complaint ${c.complaint_no}`, subtitle: `${c.name} · ${str(c.type).toLowerCase().replace('_', ' ')}`, link: `/complaints/${c.id}` });
  return hits.slice(0, 20);
}
void MACHINE_STAGES; void PARAMS; void chainOf; void judgeCustom; void locate;
