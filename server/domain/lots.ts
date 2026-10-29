// Lot read-models: bulk loader, journey / current location, per-record judgement and the Lot Passport.
import type { DB } from '../db';
import { recordHashOf } from '../db/entities';
import { evaluate, worstColor, COLOR_LABEL, type QualityColor } from '@shared/quality';
import { STAGES, STAGE_INFO, PARAMS, PROCESS_STAGES, MACHINE_STAGES, MASTER_TYPES, paramDef, routeFor, type Stage, type MasterType } from '@shared/params';
import { istDate } from '@shared/format';
import type {
  Judged, JourneyStage, LotLocation, LotPassport, LotSummary, PassportAccessoryRow, PassportBale, PassportDispatch, PassportPacking, PassportProductionStage, PassportQualityStage, PassportRun, PassportSample,
} from '@shared/domain';
import type { OnChainRef } from '@shared/types';
import { MasterBook, type JudgeMode } from './masters';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r1 = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const parse = <T,>(v: unknown, d: T): T => { try { return typeof v === 'string' ? (JSON.parse(v) as T) : d; } catch { return d; } };

export function chainOf(type: string, row: Row): OnChainRef {
  let verified = false;
  try { verified = !!row.record_hash && recordHashOf(type, row) === row.record_hash; } catch { verified = false; }
  return { txHash: (row.tx_hash as string) ?? null, blockNumber: (row.block_number as number) ?? null, recordHash: (row.record_hash as string) ?? null, version: num(row.version) || 1, verified };
}

export interface LotBundle {
  lot: Row;
  mix: Row | null;
  count: Row;
  runs: Row[];
  tests: Row[];
  packing: Row | null;
  dispatches: Row[]; // dispatches containing the lot (with lot qty merged as _lot_kg)
  complaintCount: number;
}

export class LotData {
  lots = new Map<string, LotBundle>();
  machines = new Map<string, Row>();
  users = new Map<string, Row>();
  customers = new Map<string, Row>();
  counts = new Map<string, Row>();
  mixes = new Map<string, Row>();

  static async load(db: DB, lotIds?: string[]): Promise<LotData> {
    const d = new LotData();
    const filter = lotIds && lotIds.length ? ` WHERE lot_id IN (${lotIds.map(() => '?').join(',')})` : '';
    const args = lotIds ?? [];
    const [lots, runs, tests, packs, dls, machines, users, customers, counts, mixes, cmp] = await Promise.all([
      db.prepare(`SELECT * FROM lots${lotIds && lotIds.length ? ` WHERE id IN (${lotIds.map(() => '?').join(',')})` : ''} ORDER BY seq`).all<Row>(...args),
      db.prepare(`SELECT * FROM stage_runs${filter} ORDER BY in_at, id`).all<Row>(...args),
      db.prepare(`SELECT * FROM test_results${filter} ORDER BY tested_at, id`).all<Row>(...args),
      db.prepare(`SELECT * FROM packing${filter}`).all<Row>(...args),
      db.prepare(`SELECT d.*, dl.lot_id AS _lot_id, dl.quantity_kg AS _lot_kg FROM dispatch_lots dl JOIN dispatches d ON d.id=dl.dispatch_id${filter ? ` WHERE dl.lot_id IN (${args.map(() => '?').join(',')})` : ''} ORDER BY d.dispatched_at`).all<Row>(...args),
      db.prepare('SELECT * FROM machines').all<Row>(),
      db.prepare('SELECT id,username,name,role,title,customer_id FROM users').all<Row>(),
      db.prepare('SELECT * FROM customers').all<Row>(),
      db.prepare('SELECT * FROM counts').all<Row>(),
      db.prepare('SELECT * FROM mixes').all<Row>(),
      db.prepare('SELECT lot_id, COUNT(*) n FROM complaints GROUP BY lot_id').all<Row>(),
    ]);
    machines.forEach((m) => d.machines.set(str(m.id), m)); users.forEach((u) => d.users.set(str(u.id), u)); customers.forEach((c) => d.customers.set(str(c.id), c));
    counts.forEach((c) => d.counts.set(str(c.id), c)); mixes.forEach((m) => d.mixes.set(str(m.id), m));
    const cm = new Map(cmp.map((c) => [str(c.lot_id), num(c.n)]));
    for (const lot of lots) {
      d.lots.set(str(lot.id), {
        lot, mix: d.mixes.get(str(lot.mix_id)) ?? null, count: d.counts.get(str(lot.count_id)) as Row,
        runs: runs.filter((r) => r.lot_id === lot.id), tests: tests.filter((t) => t.lot_id === lot.id), packing: packs.find((p) => p.lot_id === lot.id) ?? null,
        dispatches: dls.filter((x) => x._lot_id === lot.id), complaintCount: cm.get(str(lot.id)) ?? 0,
      });
    }
    return d;
  }

  userName(id: unknown): string { return str(this.users.get(str(id))?.name) || str(id); }
  machineLabel(id: unknown): string | null { return id ? str(this.machines.get(str(id))?.label) || str(id) : null; }
}

const stageIndex = (s: string) => STAGES.indexOf(s as Stage);

// ------------------------------------------------------------------ location + journey
export function locate(b: LotBundle, machines: Map<string, Row>, nowMs: number): LotLocation {
  const comber = !!num(b.count?.uses_comber);
  const route = routeFor(comber);
  const lotStatus = str(b.lot.status);
  const byStage = new Map<Stage, Row[]>();
  for (const r of b.runs) { const s = r.stage as Stage; if (!byStage.has(s)) byStage.set(s, []); byStage.get(s)!.push(r); }
  const present = route.filter((s) => byStage.has(s));
  const mk = (stage: Stage | null, state: LotLocation['state'], label: string, detail: string, since: string | null, rs: Row[] = []): LotLocation => {
    const next = stage ? route[route.indexOf(stage) + 1] ?? null : null;
    return { stage, state, label, detail, machines: rs.filter((r) => r.machine_id).map((r) => ({ id: str(r.machine_id), label: str(machines.get(str(r.machine_id))?.label) || str(r.machine_id) })), since, inStageMs: since ? nowMs - Date.parse(since) : null, nextStage: next };
  };
  if (!present.length) return mk('BALE', 'PLANNED', 'In bale store', 'Bales are reserved for this lot', null);
  const last = present[present.length - 1];
  const rs = byStage.get(last) as Row[];
  const running = rs.filter((r) => !r.out_at);
  const sinceIn = rs.map((r) => str(r.in_at)).sort()[0];
  if (last === 'DELIV') return mk('DELIV', 'DELIVERED', 'Delivered', `Received at ${str(rs[0].location)}`, str(rs[0].in_at), rs);
  if (last === 'DISP') return mk('DISP', 'IN_TRANSIT', 'Dispatched', 'On the road to the customer', str(rs[0].out_at ?? rs[0].in_at), rs);
  if (lotStatus === 'ON_HOLD' && (last === 'PACK' || last === 'FG')) return mk('FG', 'HOLD', 'On QA hold', 'Not released for dispatch', sinceIn, rs);
  if (running.length) {
    const label = last === 'FG' ? 'In finished-goods store' : last === 'PACK' ? 'Packing in progress' : STAGE_INFO[last].here;
    const detail = last === 'BALE' ? `Bales in ${str(rs[0].location)}` : last === 'FG' ? `Bay ${str(rs[0].location)}` : running.map((r) => str(machines.get(str(r.machine_id))?.label ?? r.location)).join(', ');
    return mk(last, last === 'BALE' ? 'PLANNED' : 'RUNNING', label, detail, str(running.map((r) => str(r.in_at)).sort()[0]), running);
  }
  const doneAt = rs.map((r) => str(r.out_at)).sort().pop() as string;
  const next = route[route.indexOf(last) + 1];
  return mk(last, 'WAITING', `Between ${STAGE_INFO[last].short} and ${next ? STAGE_INFO[next].short : 'next stage'}`, `${STAGE_INFO[last].label} complete — waiting for ${next ? STAGE_INFO[next].label : 'next stage'}`, doneAt, rs);
}

export function journeyOf(b: LotBundle, machines: Map<string, Row>, users: Map<string, Row>, stageColor: Map<string, QualityColor>): JourneyStage[] {
  const comber = !!num(b.count?.uses_comber);
  const route = routeFor(comber);
  const out: JourneyStage[] = [];
  let prevOut: number | null = null;
  let currentAssigned = false;
  for (const stage of route) {
    const rs = b.runs.filter((r) => r.stage === stage);
    const info = STAGE_INFO[stage];
    const inAt = rs.length ? rs.map((r) => str(r.in_at)).sort()[0] : null;
    const finished = rs.length > 0 && rs.every((r) => !!r.out_at);
    const outAt = finished ? rs.map((r) => str(r.out_at)).sort().pop() ?? null : null;
    let state: JourneyStage['state'] = 'PENDING';
    if (rs.length && (finished || stage === 'DELIV')) state = 'DONE';
    else if (rs.length) { state = 'CURRENT'; currentAssigned = true; }
    else if (!currentAssigned && out.length && out[out.length - 1].state === 'DONE' && !out.some((s) => s.state === 'NEXT')) state = 'NEXT';
    const kgIn = rs.reduce((s, r) => s + num(r.input_kg), 0); const kgOut = rs.reduce((s, r) => s + num(r.output_kg), 0); const kgW = rs.reduce((s, r) => s + num(r.waste_kg), 0);
    out.push({
      stage, label: info.label, plain: info.plain, state, inAt, outAt, dwellBeforeMs: inAt && prevOut !== null ? Math.max(0, Date.parse(inAt) - prevOut) : null,
      durationMs: inAt && outAt ? Date.parse(outAt) - Date.parse(inAt) : null,
      machines: rs.filter((r) => r.machine_id).map((r) => ({ id: str(r.machine_id), label: str(machines.get(str(r.machine_id))?.label), shift: (r.shift as string) ?? null, operator: r.operator_id ? str(users.get(str(r.operator_id))?.name) : null, inAt: str(r.in_at), outAt: (r.out_at as string) ?? null })),
      location: rs.length ? str(rs[0].location) || null : null, kgIn: r1(kgIn), kgOut: r1(kgOut), wasteKg: r1(kgW), wastePct: kgIn > 0 && rs.length && stage !== 'BALE' && stage !== 'FG' && stage !== 'DISP' && stage !== 'DELIV' ? r1((kgW / kgIn) * 100, 2) : null,
      worst: stageColor.get(stage) ?? 'none', batchRefs: rs.map((r) => str(r.batch_ref)).filter(Boolean),
    });
    if (outAt) prevOut = Date.parse(outAt);
    else if (stage === 'DELIV' && inAt) prevOut = Date.parse(inAt);
  }
  return out;
}

// ------------------------------------------------------------------ judgement helpers
export function judgeCustom(key: string, label: string, unit: string, value: number | null, std: number | null, lower: number | null, upper: number | null, warn = 0.2): Judged {
  const ev = evaluate(value, std === null ? null : { std, lower, upper }, warn);
  return { key, label, unit, decimals: 1, value, std, lower, upper, color: ev.color, text: value === null ? 'No data' : COLOR_LABEL[ev.color], side: ev.side, deviation: ev.deviation, deviationPct: ev.deviationPct, versionNo: null, versionId: null, masterType: 'COUNT_MIX', plain: '' };
}

const day = (iso: string) => istDate(iso);

export function judgeRunParams(book: MasterBook, countId: string, run: Row, mode: JudgeMode): Judged[] {
  const params = parse<Record<string, number>>(run.params, {});
  const at = day(str(run.in_at));
  const stage = run.stage as Stage;
  return PARAMS.filter((p) => p.kind === 'PRODUCTION' && p.key in params).map((p) => book.judge(countId, 'PRODUCTION', stage, p.key, params[p.key], at, mode));
}
export function judgeRunAccessories(book: MasterBook, countId: string, run: Row, mode: JudgeMode): (Judged & { spec?: string })[] {
  const acc = parse<Record<string, unknown>>(run.accessories, {});
  const specs = (acc.specs ?? {}) as Record<string, string>;
  const at = day(str(run.in_at));
  const stage = run.stage as Stage;
  const kindOfParam: Record<string, string> = { TRAVELLER_AGE_DAYS: 'TRAVELLER', COT_BUFF_AGE_DAYS: 'COT_BUFF', COT_AGE_DAYS: 'COT', APRON_AGE_DAYS: 'APRON', SPACER_MM: 'SPACER', WIRE_AGE_DAYS: 'CARD_WIRE', FLAT_GRIND_AGE_DAYS: 'FLAT_GRIND' };
  return PARAMS.filter((p) => p.kind === 'ACCESSORY' && p.key in acc).map((p) => ({ ...book.judge(countId, 'ACCESSORIES', stage, p.key, Number(acc[p.key]), at, mode), spec: specs[kindOfParam[p.key]] }));
}
export function judgeTestValues(book: MasterBook, countId: string, test: Row, mode: JudgeMode): Judged[] {
  const values = parse<Record<string, number>>(test.values_json, {});
  const at = str(test.test_date);
  const stage = test.stage as Stage;
  const order = PARAMS.filter((p) => (p.kind === 'QUALITY' || p.kind === 'FIBRE') && p.key in values);
  return order.map((p) => book.judge(countId, 'QUALITY', stage, p.key, values[p.key], at, mode));
}
const worstOfJudged = (js: Judged[]): QualityColor => worstColor(js.map((j) => j.color));
const countColors = (js: Judged[]) => ({ red: js.filter((j) => j.color === 'red').length, yellow: js.filter((j) => j.color === 'yellow').length });

export function balanceOf(run: Row): { diffKg: number; diffPct: number; color: QualityColor } | null {
  const stage = run.stage as Stage;
  if (!run.out_at || !PROCESS_STAGES.includes(stage)) return null;
  const inKg = num(run.input_kg);
  if (inKg <= 0) return null;
  const diff = r1(inKg - num(run.output_kg) - num(run.waste_kg), 2);
  const pct = r1((Math.abs(diff) / inKg) * 100, 2);
  return { diffKg: diff, diffPct: pct, color: pct <= 0.3 ? 'green' : pct <= 0.6 ? 'yellow' : 'red' };
}

// ------------------------------------------------------------------ summaries
export function summarize(b: LotBundle, d: LotData, book: MasterBook, nowMs: number, mode: JudgeMode = 'asOf', judgedDetail?: { red: number; yellow: number; stageColor: Map<string, QualityColor> }): LotSummary {
  const countId = str(b.lot.count_id);
  const loc = locate(b, d.machines, nowMs);
  const det = judgedDetail ?? judgeLotAll(b, book, mode);
  const last = b.dispatches[b.dispatches.length - 1];
  const cust = last ? d.customers.get(str(last.customer_id)) : undefined;
  const brIn = b.runs.filter((r) => r.stage === 'BR').reduce((s, r) => s + num(r.input_kg), 0);
  const packed = b.packing ? num(b.packing.net_kg) : null;
  const first = b.runs.filter((r) => r.stage === 'BR').map((r) => str(r.in_at)).sort()[0] ?? null;
  return {
    id: str(b.lot.id), lotNo: str(b.lot.lot_no), lotCode: str(b.lot.lot_code), countId, countDisplay: str(b.count?.display), mixId: str(b.lot.mix_id), mixNo: str(b.mix?.mix_no), status: str(b.lot.status), plannedKg: num(b.lot.planned_kg),
    packedKg: packed, realizationPct: packed !== null && brIn > 0 ? r1((packed / brIn) * 100, 1) : null, location: loc, customerId: last ? str(last.customer_id) : null, customerName: cust ? str(cust.name) : null,
    dispatchNo: last ? str(last.dispatch_no) : null, dispatchedAt: last ? str(last.dispatched_at) : null, deliveredAt: last ? ((last.delivered_at as string) ?? null) : null,
    worstColor: det.red ? 'red' : det.yellow ? 'yellow' : 'green', red: det.red, yellow: det.yellow, qaReleased: !!b.lot.qa_release_at, complaints: b.complaintCount, startedAt: first, chain: chainOf('lot', b.lot),
  };
}

/** Red/yellow counts + worst color per stage across quality tests, production parameters and accessories. */
export function judgeLotAll(b: LotBundle, book: MasterBook, mode: JudgeMode): { red: number; yellow: number; stageColor: Map<string, QualityColor> } {
  const countId = str(b.lot.count_id);
  let red = 0; let yellow = 0;
  const stageColor = new Map<string, QualityColor>();
  const add = (stage: string, js: Judged[]) => { const c = countColors(js); red += c.red; yellow += c.yellow; stageColor.set(stage, worstColor([stageColor.get(stage) ?? 'none', worstOfJudged(js)])); };
  for (const t of b.tests) add(str(t.stage), judgeTestValues(book, countId, t, mode));
  for (const r of b.runs) { if (r.params !== '{}') add(str(r.stage), judgeRunParams(book, countId, r, mode)); if (r.accessories !== '{}') add(str(r.stage), judgeRunAccessories(book, countId, r, mode)); const bal = balanceOf(r); if (bal && bal.color !== 'green') { stageColor.set(str(r.stage), worstColor([stageColor.get(str(r.stage)) ?? 'none', bal.color])); if (bal.color === 'red') red++; else yellow++; } }
  return { red, yellow, stageColor };
}

export async function listLots(db: DB, nowMs: number, mode: JudgeMode = 'asOf'): Promise<LotSummary[]> {
  const [d, book] = await Promise.all([LotData.load(db), MasterBook.load(db)]);
  return [...d.lots.values()].map((b) => summarize(b, d, book, nowMs, mode)).sort((a, b) => Number(b.lotNo) - Number(a.lotNo));
}


/** Per-carton figures judged on FULL cartons (a part-filled last carton is reported separately). */
export function packingMetrics(p: Row): { full: number; partial: number; conesPerCarton: number; netPerCarton: number; tarePerCarton: number; grossPerCarton: number } {
  const cones = num(p.cones_packed); const cartons = Math.max(1, num(p.cartons)); const partial = num(p.partial_cones);
  const full = Math.max(1, cartons - (partial > 0 ? 1 : 0));
  const tarePer = num(p.tare_kg) / cartons;
  const netPer = (num(p.net_kg) - partial * num(p.avg_cone_kg)) / full;
  return { full, partial, conesPerCarton: r1((cones - partial) / full, 1), netPerCarton: r1(netPer, 2), tarePerCarton: r1(tarePer, 2), grossPerCarton: r1(netPer + tarePer, 2) };
}
export function packingChecks(book: MasterBook, countId: string, p: Row, mode: JudgeMode): Judged[] {
  const at = istDate(str(p.packed_at)); const m = packingMetrics(p);
  return [
    book.judge(countId, 'ACCESSORIES', 'PACK', 'NET_WT_CONE', num(p.avg_cone_kg), at, mode), book.judge(countId, 'ACCESSORIES', 'PACK', 'CONES_PER_CARTON', m.conesPerCarton, at, mode),
    book.judge(countId, 'ACCESSORIES', 'PACK', 'CARTON_TARE', m.tarePerCarton, at, mode), book.judge(countId, 'ACCESSORIES', 'PACK', 'CARTON_NET', m.netPerCarton, at, mode),
    book.judge(countId, 'ACCESSORIES', 'PACK', 'CARTON_GROSS', m.grossPerCarton, at, mode),
  ];
}

// ------------------------------------------------------------------ lot passport
export async function buildPassport(db: DB, key: string, mode: JudgeMode, nowIso: string): Promise<LotPassport | null> {
  const row = await db.prepare('SELECT id FROM lots WHERE id=? OR lot_no=? OR lot_code=?').get<{ id: string }>(key, key.replace(/^LOT-/i, ''), key);
  if (!row) return null;
  const [d, book] = await Promise.all([LotData.load(db, [row.id]), MasterBook.load(db)]);
  const b = d.lots.get(row.id) as LotBundle;
  const nowMs = Date.parse(nowIso);
  const countId = str(b.lot.count_id);
  const startDay = day(str(b.runs.find((r) => r.stage === 'BR')?.in_at ?? b.lot.created_at));
  const judged = judgeLotAll(b, book, mode);
  const summary = summarize(b, d, book, nowMs, mode, judged);
  const chains: OnChainRef[] = [chainOf('lot', b.lot)];
  const chain = (type: string, r: Row) => { const c = chainOf(type, r); chains.push(c); return c; };

  // bales
  const mixBales = await db.prepare('SELECT mb.kg_used, mb.pct, b.* FROM mix_bales mb JOIN bales b ON b.id=mb.bale_id WHERE mb.mix_id=? ORDER BY b.bale_no').all<Row>(str(b.lot.mix_id));
  const bales: PassportBale[] = mixBales.map((x) => ({
    id: str(x.id), baleNo: str(x.bale_no), variety: str(x.variety), supplier: str(x.supplier), station: str(x.station), ginLot: str(x.gin_lot), weightKg: num(x.weight_kg), kgUsed: num(x.kg_used), pct: num(x.pct),
    receivedAt: str(x.received_at), issuedAt: (x.issued_at as string) ?? null, bay: str(x.bay), bin: str(x.bin), status: str(x.status),
    hvi: PARAMS.filter((p) => p.kind === 'FIBRE').map((p) => book.judge(countId, 'COUNT_MIX', 'MIX', p.key, parse<Record<string, number>>(x.fibre, {})[p.key] ?? null, startDay, mode)),
    chain: chain('bale', x),
  }));
  const otherLots = await db.prepare('SELECT id,lot_no,status FROM lots WHERE mix_id=? AND id<>? ORDER BY seq').all<Row>(str(b.lot.mix_id), str(b.lot.id));
  const mixRecipe = parse<{ key: string; label: string; source: string; pct: number; kg: number; minPct: number; maxPct: number }[]>(b.mix?.recipe, []).map((c) => ({ ...c, color: (c.pct >= c.minPct && c.pct <= c.maxPct ? 'green' : c.pct >= c.minPct - 3 && c.pct <= c.maxPct + 3 ? 'yellow' : 'red') as QualityColor }));
  if (b.mix) chain('mix', b.mix);
  const fibre = PARAMS.filter((p) => p.kind === 'FIBRE').map((p) => book.judge(countId, 'COUNT_MIX', 'MIX', p.key, parse<Record<string, number>>(b.mix?.fibre, {})[p.key] ?? null, startDay, mode));

  // quality
  const machineOf = (id: unknown) => d.machineLabel(id);
  const quality: PassportQualityStage[] = [];
  for (const stage of MACHINE_STAGES) {
    const ts = b.tests.filter((t) => t.stage === stage);
    if (!ts.length) continue;
    const samples: PassportSample[] = ts.map((t) => {
      const values = judgeTestValues(book, countId, t, mode);
      return { id: str(t.id), sampleId: str(t.sample_id), testedAt: str(t.tested_at), shift: (t.shift as string) ?? null, pos: (t.pos as string) ?? null, machineId: (t.machine_id as string) ?? null, machineLabel: machineOf(t.machine_id), type: t.sample_type as 'LOT' | 'MACHINE', by: str(t.tested_by), byName: d.userName(t.tested_by), instrument: str(t.instrument), remarks: str(t.remarks), values, worst: worstOfJudged(values), chain: chain('test_result', t) };
    });
    const all = samples.flatMap((s) => s.values);
    quality.push({ stage, label: STAGE_INFO[stage].label, samples, worst: worstOfJudged(all), ...{ reds: countColors(all).red, yellows: countColors(all).yellow } });
  }

  // production
  const production: PassportProductionStage[] = [];
  for (const stage of [...PROCESS_STAGES]) {
    const rs = b.runs.filter((r) => r.stage === stage);
    if (!rs.length) continue;
    const runs: PassportRun[] = rs.map((r) => {
      const params = judgeRunParams(book, countId, r, mode);
      const bal = balanceOf(r);
      const inKg = num(r.input_kg);
      return {
        id: str(r.id), stage, machineId: (r.machine_id as string) ?? null, machineLabel: machineOf(r.machine_id), location: (r.location as string) ?? null, shift: (r.shift as string) ?? null, operator: (r.operator_id as string) ?? null, operatorName: r.operator_id ? d.userName(r.operator_id) : null,
        inAt: str(r.in_at), outAt: (r.out_at as string) ?? null, running: !r.out_at, inKg: num(r.input_kg), outKg: num(r.output_kg), wasteKg: num(r.waste_kg), wastePct: inKg > 0 ? r1((num(r.waste_kg) / inKg) * 100, 2) : null, wasteType: (r.waste_type as string) ?? null,
        batchRef: (r.batch_ref as string) ?? null, inputRefs: parse<string[]>(r.input_refs, []), params, balance: bal, worst: worstColor([worstOfJudged(params), bal?.color ?? 'none']), notes: str(r.notes), chain: chain('stage_run', r),
      };
    });
    const inKg = runs.reduce((s, r) => s + r.inKg, 0); const outKg = runs.reduce((s, r) => s + r.outKg, 0); const wasteKg = runs.reduce((s, r) => s + r.wasteKg, 0);
    const done = runs.every((r) => !r.running);
    const wastePct = inKg > 0 ? r1((wasteKg / inKg) * 100, 2) : null;
    const at = startDay;
    production.push({
      stage, label: STAGE_INFO[stage].label, runs, worst: worstColor(runs.map((r) => r.worst)),
      totals: { inKg: r1(inKg), outKg: r1(outKg), wasteKg: r1(wasteKg), wastePct, waste: done && wastePct !== null ? book.judge(countId, 'PRODUCTION', stage, 'WASTE_PCT', wastePct, at, mode) : null, yield: done && inKg > 0 ? book.judge(countId, 'PRODUCTION', stage, 'YIELD_PCT', r1((outKg / inKg) * 100, 1), at, mode) : null },
    });
  }

  // accessories (per machine run)
  const accessories: PassportAccessoryRow[] = [];
  for (const r of b.runs) {
    if (!r.machine_id || r.accessories === '{}') continue;
    const items = judgeRunAccessories(book, countId, r, mode);
    if (!items.length) continue;
    accessories.push({ runId: str(r.id), stage: r.stage as Stage, machineId: str(r.machine_id), machineLabel: machineOf(r.machine_id) ?? str(r.machine_id), at: str(r.in_at), items, worst: worstOfJudged(items) });
  }

  // packing
  let packing: PassportPacking | null = null;
  if (b.packing) {
    const p = b.packing; const at = day(str(p.packed_at));
    const colorMeta = book.color(countId, at, mode)?.meta; const accMeta = book.accessories(countId, at, mode)?.meta;
    const cones = num(p.cones_packed); const cartons = num(p.cartons);
    packing = {
      id: str(p.id), packedAt: str(p.packed_at), packer: str(p.packer_id), packerName: d.userName(p.packer_id), packageType: str(p.package_type), conesPacked: cones, cartons, netKg: num(p.net_kg), tareKg: num(p.tare_kg), grossKg: num(p.gross_kg), avgConeKg: num(p.avg_cone_kg),
      slipNo: str(p.slip_no), cartonFrom: str(p.carton_from), cartonTo: str(p.carton_to), labelTemplate: str(p.label_template), pallets: num(p.pallets), fgLocation: str(p.fg_location), colorActual: str(p.color_actual), colorMaster: str(p.color_master), colorOk: !!num(p.color_ok),
      colorHex: colorMeta?.hex ?? null, tip: colorMeta?.tip ?? null, coneType: accMeta?.coneType ?? null, cartonType: accMeta?.cartonType ?? null, polybag: accMeta?.polybag ?? null, strapping: accMeta?.strapping ?? null,
      checks: packingChecks(book, countId, p, mode), partialCones: num(p.partial_cones), fullCartons: packingMetrics(p).full,
      chain: chain('packing', p),
    };
  }

  // dispatch
  let dispatch: PassportDispatch | null = null;
  const dRow = b.dispatches[b.dispatches.length - 1];
  if (dRow) {
    const sharing = await db.prepare('SELECT l.id lotId, l.lot_no lotNo FROM dispatch_lots dl JOIN lots l ON l.id=dl.lot_id WHERE dl.dispatch_id=? AND dl.lot_id<>?').all<{ lotId: string; lotNo: string }>(str(dRow.id), str(b.lot.id));
    dispatch = {
      id: str(dRow.id), dispatchNo: str(dRow.dispatch_no), dispatchedAt: str(dRow.dispatched_at), invoiceNo: str(dRow.invoice_no), invoiceDate: str(dRow.invoice_date), vehicleNo: str(dRow.vehicle_no), driverName: str(dRow.driver_name), driverPhone: str(dRow.driver_phone),
      transporter: str(dRow.transporter), lrNo: str(dRow.lr_no), destination: str(dRow.destination), cartons: num(dRow.cartons), conesCount: num(dRow.cones_count), netKg: num(dRow.net_kg), grossKg: num(dRow.gross_kg), lotKg: num(dRow._lot_kg),
      deliveredAt: (dRow.delivered_at as string) ?? null, status: str(dRow.status), qaReleased: !!num(dRow.qa_released), remarks: str(dRow.remarks), passportCode: str(dRow.passport_code), customerId: str(dRow.customer_id), customerName: str(d.customers.get(str(dRow.customer_id))?.name),
      alsoInDispatch: sharing, chain: chain('dispatch', dRow),
    };
  }

  // summary / realization
  const mixMeta = book.countMix(countId, startDay, mode)?.meta;
  const brIn = b.runs.filter((r) => r.stage === 'BR').reduce((s, r) => s + num(r.input_kg), 0);
  const yarnKg = b.packing ? num(b.packing.net_kg) : null;
  const realization = yarnKg !== null && brIn > 0 && mixMeta ? judgeCustom('REALIZATION', 'Overall yarn realization', '%', r1((yarnKg / brIn) * 100, 1), mixMeta.targetRealizationPct, mixMeta.targetRealizationPct - 1.5, null) : null;
  const stageYield: LotPassport['summary']['stageYield'] = [];
  for (const stage of PROCESS_STAGES) {
    const rs = b.runs.filter((r) => r.stage === stage);
    if (!rs.length) continue;
    stageYield.push({ stage, label: STAGE_INFO[stage].label, cumulativePct: rs.every((r) => r.out_at) && brIn > 0 ? r1((rs.reduce((s, r) => s + num(r.output_kg), 0) / brIn) * 100, 1) : null });
  }

  // complaints
  const cmps = await db.prepare(`SELECT cp.*, c.name customer_name, cn.root_cause FROM complaints cp JOIN customers c ON c.id=cp.customer_id LEFT JOIN conclusions cn ON cn.complaint_id=cp.id WHERE cp.lot_id=? ORDER BY cp.created_at`).all<Row>(str(b.lot.id));

  // masters used
  const masters = MASTER_TYPES.map((type: MasterType) => {
    const v = book.versionAt(countId, type, startDay, mode);
    const latest = book.versionAt(countId, type, '9999-12-31', 'latest');
    return { type, versionId: v?.id ?? null, versionNo: v?.version_no ?? null, effectiveFrom: v?.effective_from ?? null, latestVersionNo: latest?.version_no ?? null };
  });
  const txs = new Set(chains.map((c) => c.txHash).filter(Boolean));
  const blocks = chains.map((c) => c.blockNumber).filter((x): x is number => typeof x === 'number');
  return {
    mode, generatedAt: nowIso,
    lot: { ...summary, startDate: str(b.lot.start_date), endDate: (b.lot.end_date as string) ?? null, qaReleaseAt: (b.lot.qa_release_at as string) ?? null, qaReleaseBy: b.lot.qa_release_by ? d.userName(b.lot.qa_release_by) : null, mixKg: num(b.mix?.total_kg) },
    masters,
    mix: { id: str(b.mix?.id), mixNo: str(b.mix?.mix_no) || 'Unavailable', formedAt: str(b.mix?.planned_at) || null, issuedAt: (b.mix?.issued_at as string) ?? null, totalKg: num(b.mix?.total_kg), blowRoomLine: (b.mix?.blow_room_line as string) ?? null, recipe: mixRecipe, fibre, otherLots: otherLots.map((l) => ({ lotId: str(l.id), lotNo: str(l.lot_no), status: str(l.status) })) },
    bales, journey: journeyOf(b, d.machines, d.users, judged.stageColor), quality, production, accessories, packing, dispatch,
    summary: { realization, targetRealizationPct: mixMeta?.targetRealizationPct ?? null, targetWastePct: mixMeta?.targetWastePct ?? null, wastePct: yarnKg !== null && brIn > 0 ? r1(100 - (yarnKg / brIn) * 100, 1) : null, cottonKg: r1(brIn), yarnKg, stageYield },
    complaints: cmps.map((c) => ({ id: str(c.id), complaintNo: str(c.complaint_no), type: c.type as never, status: c.status as never, customerName: str(c.customer_name), receivedDate: str(c.received_date), description: str(c.description), rootCause: (c.root_cause as string) ?? null })),
    ledger: { lotTxCount: txs.size, firstBlock: blocks.length ? Math.min(...blocks) : null, lastBlock: blocks.length ? Math.max(...blocks) : null, verifiedRecords: chains.filter((c) => c.verified).length, totalRecords: chains.length },
  };
}
void paramDef; void stageIndex;
