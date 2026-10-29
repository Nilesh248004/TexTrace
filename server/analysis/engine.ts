// Deterministic complaint-analysis engine. Statistics first (master deviation, z-score against the last good lots of the same
// count, correlations, cross-lot recall scope); an optional LLM narrative sits on top (server/analysis/narrative.ts).
// Every number in the result is read from the database — nothing is invented.
//
// How a cause is found:
//   * the complaint type selects a "lens": the parameters (stage, machine, accessory, fibre …) that can explain it, with weights
//   * every lens parameter of the complaint lot is averaged per machine and judged against the master, then compared (z-score) with the
//     same machine-level averages of the last good lots of the same count (and earlier mixes)
//   * a CAUSE needs at least one causal reading (machine setting, accessory age, fibre property, packing spec) outside the master in the
//     adverse direction; hairiness / count / U% results that are bad on their own only tell WHERE the symptom shows up
//   * confidence grows with independent lines of evidence: causal readings out of limits, the symptom on the same machine, the same
//     deviation on other lots (cross-lot), a healthy sibling machine on the same lot, a strong correlation across all runs
import type { DB } from '../db';
import { evaluate, worstColor, type QualityColor } from '@shared/quality';
import { DEFAULT_LENS, STAGE_INFO, paramDef, type ComplaintType, type LensItem, type Stage } from '@shared/params';
import { istDate } from '@shared/format';
import type { AnalysisAction, AnalysisCause, AnalysisEvidenceItem, AnalysisObservation, AnalysisRecallLot, AnalysisResult, Judged } from '@shared/domain';
import { MasterBook, type JudgeMode } from '../domain/masters';
import { LotData, packingMetrics, summarize, type LotBundle } from '../domain/lots';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r1 = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const parse = <T,>(v: unknown, d: T): T => { try { return typeof v === 'string' ? (JSON.parse(v) as T) : d; } catch { return d; } };
const SEV = { red: 1, yellow: 0.5, green: 0, none: 0 } as const;
const CAUSAL = new Set(['PRODUCTION', 'ACCESSORY', 'FIBRE', 'PACK']);

export interface EngineInput { lotKey: string; complaintId?: string | null; comparisonLotIds?: string[]; mode?: JudgeMode; focus?: { stage?: Stage; machineId?: string; parameter?: string } | null }

async function loadLens(db: DB, type: ComplaintType): Promise<LensItem[]> {
  const row = await db.prepare('SELECT items FROM complaint_lens WHERE complaint_type=?').get<{ items: string }>(type);
  return row ? parse<LensItem[]>(row.items, DEFAULT_LENS[type]) : DEFAULT_LENS[type];
}

/** Raw (per reading) observations of one lens parameter for one lot. */
function observe(b: LotBundle, d: LotData, book: MasterBook, item: LensItem, mode: JudgeMode): AnalysisObservation[] {
  const countId = str(b.lot.count_id);
  const out: AnalysisObservation[] = [];
  const def = paramDef(item.key);
  if (!def) return out;
  const mk = (kind: AnalysisObservation['kind'], j: Judged, extra: Partial<AnalysisObservation>): AnalysisObservation => ({
    stage: item.stage, key: item.key, label: def.label, unit: def.unit, kind, machineId: null, machineLabel: null, runId: null, date: null, shift: null, value: j.value as number, std: j.std, lower: j.lower, upper: j.upper, color: j.color,
    weight: item.weight, why: item.why, refMean: null, refSd: null, z: null, refN: 0, n: 1, min: j.value as number, max: j.value as number, nRed: j.color === 'red' ? 1 : 0, nYellow: j.color === 'yellow' ? 1 : 0, dates: [], shifts: [], adverse: true, ...extra,
  });
  if (item.stage === 'PACK') {
    const p = b.packing; if (!p) return out;
    const at = istDate(str(p.packed_at)); const pm = packingMetrics(p);
    const val: Record<string, number | null> = { NET_WT_CONE: num(p.avg_cone_kg), CONES_PER_CARTON: pm.conesPerCarton, CARTON_NET: pm.netPerCarton, CARTON_TARE: pm.tarePerCarton, CARTON_GROSS: pm.grossPerCarton };
    if (val[item.key] == null) return out;
    out.push(mk('PACK', book.judge(countId, 'ACCESSORIES', 'PACK', item.key, val[item.key], at, mode), { runId: str(p.id), date: at, dates: [at] }));
    return out;
  }
  if (def.kind === 'FIBRE') {
    const mixVal = parse<Record<string, number>>(b.mix?.fibre, {})[item.key];
    const at = istDate(str(b.runs.find((r) => r.stage === 'BR')?.in_at ?? b.lot.created_at));
    if (typeof mixVal === 'number') out.push(mk('FIBRE', book.judge(countId, 'COUNT_MIX', 'MIX', item.key, mixVal, at, mode), { label: def.label, runId: str(b.mix?.id), date: at, dates: [at] }));
    return out;
  }
  if (def.kind === 'QUALITY') {
    for (const t of b.tests) {
      if (t.stage !== item.stage || t.sample_type !== 'MACHINE') continue;
      const v = parse<Record<string, number>>(t.values_json, {})[item.key];
      if (typeof v !== 'number') continue;
      out.push(mk('QUALITY', book.judge(countId, 'QUALITY', item.stage, item.key, v, str(t.test_date), mode), { machineId: (t.machine_id as string) ?? null, machineLabel: d.machineLabel(t.machine_id), runId: str(t.id), date: str(t.test_date), shift: (t.shift as string) ?? null, dates: [str(t.test_date)], shifts: t.shift ? [str(t.shift)] : [] }));
    }
    return out;
  }
  for (const r of b.runs) {
    if (r.stage !== item.stage) continue;
    const src = def.kind === 'PRODUCTION' ? parse<Record<string, number>>(r.params, {}) : parse<Record<string, number>>(r.accessories, {});
    const v = src[item.key];
    if (typeof v !== 'number') continue;
    const date = istDate(str(r.in_at));
    out.push(mk(def.kind === 'PRODUCTION' ? 'PRODUCTION' : 'ACCESSORY', book.judge(countId, def.kind === 'PRODUCTION' ? 'PRODUCTION' : 'ACCESSORIES', item.stage, item.key, v, date, mode), { machineId: (r.machine_id as string) ?? null, machineLabel: d.machineLabel(r.machine_id), runId: str(r.id), date, shift: (r.shift as string) ?? null, dates: [date], shifts: r.shift ? [str(r.shift)] : [] }));
  }
  return out;
}

/** Average readings per (stage, machine, parameter) and re-judge the mean against the master limits. */
function aggregate(list: AnalysisObservation[], warn: number): AnalysisObservation[] {
  const groups = new Map<string, AnalysisObservation[]>();
  for (const o of list) { const k = `${o.stage}|${o.machineId ?? ''}|${o.key}|${o.kind}`; if (!groups.has(k)) groups.set(k, []); (groups.get(k) as AnalysisObservation[]).push(o); }
  return [...groups.values()].map((g) => {
    const first = g[0]; const vals = g.map((o) => o.value); const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    const ev = evaluate(mean, first.std === null ? null : { std: first.std, lower: first.lower, upper: first.upper }, warn);
    const dec = paramDef(first.key)?.decimals ?? 2;
    return { ...first, value: r1(mean, dec + 1), min: Math.min(...vals), max: Math.max(...vals), n: g.length, nRed: g.filter((o) => o.color === 'red').length, nYellow: g.filter((o) => o.color === 'yellow').length, color: ev.color, runId: g.length === 1 ? first.runId : null, date: g.map((o) => o.date).filter(Boolean).sort()[0] ?? null, dates: [...new Set(g.flatMap((o) => o.dates))].sort(), shifts: [...new Set(g.flatMap((o) => o.shifts))] };
  });
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 5) return null;
  const mx = mean(xs); const my = mean(ys);
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0); const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0); const syy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
const fmt = (v: number | null | undefined, key: string) => (v === null || v === undefined ? '–' : v.toLocaleString('en-IN', { minimumFractionDigits: paramDef(key)?.decimals ?? 1, maximumFractionDigits: paramDef(key)?.decimals ?? 1 }));
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Is a deviation of `o` in the direction that can cause the complaint? lens `dir` wins, otherwise the parameter's better-direction. */
function adverseDir(o: AnalysisObservation, lensDir?: 'high' | 'low' | 'both'): boolean {
  const side = o.std !== null && o.value < o.std ? 'low' : 'high';
  if (lensDir && lensDir !== 'both') return lensDir === side;
  if (lensDir === 'both') return true;
  const better = paramDef(o.key)?.better ?? 'target';
  return better === 'lower' ? side === 'high' : better === 'higher' ? side === 'low' : true;
}

export async function runEngine(db: DB, input: EngineInput, nowIso: string): Promise<AnalysisResult | null> {
  const mode = input.mode ?? 'asOf';
  const lotRow = await db.prepare('SELECT id FROM lots WHERE id=? OR lot_no=? OR lot_code=?').get<{ id: string }>(input.lotKey, input.lotKey.replace(/^LOT-/i, ''), input.lotKey);
  if (!lotRow) return null;
  const [all, book] = await Promise.all([LotData.load(db), MasterBook.load(db)]);
  const target = all.lots.get(lotRow.id) as LotBundle;
  const nowMs = Date.parse(nowIso);
  const countId = str(target.lot.count_id);
  const complaint = input.complaintId ? await db.prepare('SELECT id,complaint_no,type FROM complaints WHERE id=? OR complaint_no=?').get<Row>(input.complaintId, input.complaintId) : undefined;
  const type = (complaint?.type as ComplaintType) ?? 'OTHER';
  let lens = await loadLens(db, type);
  if (input.focus?.parameter && input.focus.stage) lens = [{ stage: input.focus.stage, key: input.focus.parameter, weight: 3, why: 'Selected on the heatmap' }, ...lens.filter((l) => !(l.stage === input.focus!.stage && l.key === input.focus!.parameter))];
  const labelOf = (id: string | null): string | null => (id ? str(all.machines.get(id)?.label) || id : null);
  const lensOf = (o: { stage: Stage; key: string }) => lens.find((l) => l.stage === o.stage && l.key === o.key);
  const aggOf = (b: LotBundle) => aggregate(lens.flatMap((it) => observe(b, all, book, it, mode)), book.warnFraction);
  const isFlagged = (o: AnalysisObservation) => (o.color === 'red' || o.color === 'yellow') && adverseDir(o, lensOf(o)?.dir);
  const sevOf = (o: AnalysisObservation) => (isFlagged(o) ? o.weight * SEV[o.color] : 0);

  // ---- reference lots: last good lots of the same count (completed through winding), then earlier mixes of the same count
  const candidates = [...all.lots.values()].filter((b) => b.lot.id !== target.lot.id && b.lot.count_id === countId && b.runs.some((r) => r.stage === 'AW' && r.out_at));
  const scored = candidates.map((b) => ({ b, obs: aggOf(b) })).map((x) => ({ ...x, score: x.obs.reduce((s, o) => s + sevOf(o), 0) }));
  let refs: typeof scored;
  if (input.comparisonLotIds?.length) refs = scored.filter((s) => input.comparisonLotIds!.includes(str(s.b.lot.id)));
  else {
    const med = [...scored].map((s) => s.score).sort((a, b) => a - b)[Math.floor(scored.length / 2)] ?? 0;
    const threshold = Math.max(1.5, med * 1.2);
    refs = scored.filter((s) => s.score <= threshold).sort((a, b) => Number(b.b.lot.seq) - Number(a.b.lot.seq)).slice(0, 8);
    if (refs.length < 3) refs = [...scored].sort((a, b) => a.score - b.score).slice(0, 4);
  }
  const refVals = new Map<string, number[]>();
  for (const { obs } of refs) for (const o of obs) { const k = `${o.stage}|${o.key}`; if (!refVals.has(k)) refVals.set(k, []); (refVals.get(k) as number[]).push(o.value); }
  const refStats = new Map([...refVals].map(([k, xs]) => [k, { mean: mean(xs), sd: sd(xs), n: xs.length }]));

  // ---- target observations with z-scores
  const obs = aggOf(target).map((o) => {
    const st = refStats.get(`${o.stage}|${o.key}`);
    const half = o.upper !== null && o.lower !== null ? (o.upper - o.lower) / 2 : o.upper !== null && o.std !== null ? o.upper - o.std : o.lower !== null && o.std !== null ? o.std - o.lower : Math.abs(o.value) * 0.05;
    const sdv = st ? Math.max(st.sd, half / 6, 1e-9) : null;
    const lensItem = lensOf(o);
    return { ...o, adverse: adverseDir(o, lensItem?.dir), refMean: st ? r1(st.mean, (paramDef(o.key)?.decimals ?? 2) + 1) : null, refSd: sdv === null ? null : r1(sdv, 3), z: st && sdv ? r1((o.value - st.mean) / sdv, 1) : null, refN: st?.n ?? 0 };
  });
  const status = (o: AnalysisObservation) => (o.color === 'red' ? 'OUT OF LIMITS' : o.color === 'yellow' ? 'warning zone' : 'within limits');
  const text = (o: AnalysisObservation) => {
    const where = o.kind === 'FIBRE' ? 'Mix' : o.machineLabel ?? STAGE_INFO[o.stage].label;
    const val = o.n > 1 ? `${fmt(o.value, o.key)}${o.unit ? ` ${o.unit}` : ''} average of ${o.n} readings (${fmt(o.min, o.key)}–${fmt(o.max, o.key)})` : `${fmt(o.value, o.key)}${o.unit ? ` ${o.unit}` : ''}`;
    const lim = `master ${o.lower !== null ? fmt(o.lower, o.key) : '–'} … ${fmt(o.std, o.key)} … ${o.upper !== null ? fmt(o.upper, o.key) : '–'}`;
    const cnt = o.n > 1 ? `, ${o.nRed + o.nYellow} of ${o.n} readings outside the green zone` : '';
    const z = o.z !== null && o.refN ? `; ${o.z >= 0 ? '+' : ''}${o.z}σ vs the ${o.refN} reference ${plural(o.refN, 'average')} of good lots (mean ${fmt(o.refMean, o.key)})` : '';
    return `${where} · ${o.label}: ${val} vs ${lim} — ${status(o)}${cnt}${z}.`;
  };
  const evOf = (o: AnalysisObservation): AnalysisEvidenceItem => ({ text: text(o), label: o.label, unit: o.unit, color: o.color, stage: o.stage, key: o.key, machineId: o.machineId, value: o.value, std: o.std, lower: o.lower, upper: o.upper, z: o.z, refMean: o.refMean, sourceId: o.runId });
  const zBad = (o: AnalysisObservation) => o.z !== null && o.adverse && Math.abs(o.z) >= 3 && ((paramDef(o.key)?.better === 'higher') ? o.z < 0 : (paramDef(o.key)?.better === 'lower') ? o.z > 0 : true);
  const flagged = (o: AnalysisObservation) => isFlagged(o) || zBad(o);
  const sev = (o: AnalysisObservation) => o.weight * (isFlagged(o) ? SEV[o.color] : 0) + (zBad(o) ? o.weight * 0.3 : 0);

  // ---- suspects: one per (stage, machine); one for the mix; one for packing
  type Suspect = { key: string; stage: Stage; machineId: string | null; obs: AnalysisObservation[] };
  const suspects = new Map<string, Suspect>();
  for (const o of obs) {
    const key = o.kind === 'FIBRE' ? 'MIX' : o.kind === 'PACK' ? 'PACK' : `${o.stage}|${o.machineId ?? 'LOT'}`;
    const s = suspects.get(key) ?? { key, stage: o.stage, machineId: o.machineId, obs: [] }; s.obs.push(o); suspects.set(key, s);
  }
  const symptomKeys = new Set(lens.filter((l) => paramDef(l.key)?.kind === 'QUALITY' && l.weight >= 3).map((l) => l.key));
  type Cause = AnalysisCause & { _suspect: Suspect };
  const causes: Cause[] = [];
  const symptomAt = new Map<string, string[]>();
  for (const s of suspects.values()) {
    const machineLabel = labelOf(s.machineId);
    const symptomBad = s.obs.filter((o) => o.kind === 'QUALITY' && flagged(o));
    if (symptomBad.length) symptomAt.set(s.key, symptomBad.map((o) => `${o.label} ${fmt(o.value, o.key)}`));
    const causal = s.obs.filter((o) => CAUSAL.has(o.kind) && flagged(o));
    if (!causal.length) continue;
    const bad = [...causal, ...symptomBad].sort((a, b) => sev(b) - sev(a));
    const prod = causal.filter((o) => o.kind === 'PRODUCTION' && o.key !== 'RH_PCT'); const acc = causal.filter((o) => o.kind === 'ACCESSORY');
    let category: AnalysisCause['category']; let title: string;
    if (s.key === 'MIX') { category = 'MIX_FIBRE'; title = `Cotton mix ${str(target.mix?.mix_no) || 'Unavailable'}: ${causal.map((o) => o.label.toLowerCase()).slice(0, 2).join(' and ')} outside the master`; }
    else if (s.key === 'PACK') { category = 'PACKING'; title = `Packing: ${causal.map((o) => o.label.toLowerCase()).slice(0, 2).join(' and ')} outside the master`; }
    else {
      category = prod.length && acc.length ? 'MACHINE_AND_ACCESSORY' : acc.length ? 'ACCESSORY_WEAR' : prod.length ? 'MACHINE_SETTING' : 'ENVIRONMENT';
      const names = (prod.length || acc.length ? [...prod, ...acc] : causal).slice(0, 2).map((o) => o.label.toLowerCase());
      title = `${machineLabel} (${STAGE_INFO[s.stage].label.toLowerCase()}): ${names.join(' and ')} outside the master`;
    }
    const contrast: string[] = [];
    if (s.machineId) for (const o of causal.concat(symptomBad)) {
      const sib = obs.filter((x) => x.stage === o.stage && x.key === o.key && x.machineId && x.machineId !== s.machineId && x.color === 'green');
      if (sib.length && !contrast.some((c) => c.includes(o.label))) contrast.push(`Same lot on ${[...new Set(sib.map((x) => x.machineLabel))].join(', ')}: ${o.label} ${sib.map((x) => fmt(x.value, x.key)).join(' / ')} — within limits, so this is specific to ${machineLabel}.`);
    }
    causes.push({ id: s.key === 'MIX' ? 'MIX_FIBRE' : s.key === 'PACK' ? 'PACKING' : `${s.stage}_${s.machineId}`, rank: 0, title, category, stage: s.stage, machineId: s.machineId, confidence: 0, score: r1(s.obs.reduce((x, o) => x + sev(o), 0), 2), evidence: bad.slice(0, 8).map(evOf), contrast, affected: { machines: machineLabel ? [machineLabel] : [], shifts: [...new Set(bad.flatMap((o) => o.shifts))], dates: [...new Set(bad.flatMap((o) => o.dates))].sort(), lots: [str(target.lot.lot_no)] }, symptomAt: symptomBad.map((o) => `${o.machineLabel ?? STAGE_INFO[o.stage].label}: ${o.label} ${fmt(o.value, o.key)}`), explanation: '', _suspect: s });
  }

  // ---- bale-level origin of a fibre cause (backward trace to the supplier)
  const mixCause = causes.find((c) => c.id === 'MIX_FIBRE');
  if (mixCause) {
    const bales = await db.prepare('SELECT mb.kg_used, b.* FROM mix_bales mb JOIN bales b ON b.id=mb.bale_id WHERE mb.mix_id=? ORDER BY b.bale_no').all<Row>(str(target.lot.mix_id));
    const seen = new Set<string>();
    for (const fo of mixCause._suspect.obs.filter((o) => o.kind === 'FIBRE' && flagged(o))) for (const b of bales) {
      const v = parse<Record<string, number>>(b.fibre, {})[fo.key];
      const j = book.judge(countId, 'COUNT_MIX', 'MIX', fo.key, typeof v === 'number' ? v : null, istDate(str(b.received_at)), mode);
      if ((j.color === 'red') && adverseDir({ ...fo, value: v, std: j.std } as AnalysisObservation, lensOf(fo)?.dir) && !seen.has(`${b.bale_no}|${fo.key}`)) {
        seen.add(`${b.bale_no}|${fo.key}`);
        mixCause.evidence.push({ text: `Bale ${b.bale_no} (${b.variety}, ${b.supplier}, ${b.station}; store ${b.bay} / ${b.bin}): ${fo.label.replace(' of the mix', '')} ${fmt(v, fo.key)}${fo.unit ? ` ${fo.unit}` : ''} vs mix limit ${j.upper !== null ? fmt(j.upper, fo.key) : fmt(j.lower, fo.key)} — ${j.text.toUpperCase()}.`, label: `Bale ${b.bale_no} ${fo.label}`, unit: fo.unit, color: 'red', stage: 'BALE', key: fo.key, machineId: null, value: v, std: j.std, lower: j.lower, upper: j.upper, z: null, refMean: null, sourceId: str(b.id) });
      }
    }
    const sup = new Map<string, number>(); for (const e of mixCause.evidence.filter((x) => x.stage === 'BALE')) { const m = /\(([^,]+), ([^,]+), ([^;]+);/.exec(e.text); if (m) sup.set(`${m[2]}, ${m[3]}`, (sup.get(`${m[2]}, ${m[3]}`) ?? 0) + 1); }
    if (sup.size) mixCause.contrast.push(`Likely source: ${[...sup.keys()].join(' and ')} — ${[...sup.values()].reduce((s, x) => s + x, 0)} bale reading(s) outside the mix limits. Other bales of the mix are within limits.`);
  }

  // ---- special cases that are not numeric lens parameters
  const pk = target.packing;
  if ((type === 'PACKING_COLOR' || type === 'SHADE') && pk && !num(pk.color_ok)) {
    causes.push({ id: 'PACKING_COLOR', rank: 0, title: `Packing: cones of the wrong colour code (${str(pk.color_actual)} instead of ${str(pk.color_master)})`, category: 'PACKING', stage: 'PACK', machineId: null, confidence: 0, score: 9, evidence: [{ text: `Packing record ${str(pk.id)} (slip ${str(pk.slip_no)}, packed ${istDate(str(pk.packed_at))}): ${str(pk.color_actual)}-tip cones were packed; the Color Code master for ${str(target.count.display)} is ${str(pk.color_master)}. Color-code verification failed at packing.`, label: 'Cone colour', unit: '', color: 'red', stage: 'PACK', key: 'COLOR', machineId: null, value: null, std: null, lower: null, upper: null, z: null, refMean: null, sourceId: str(pk.id) }], contrast: [], affected: { machines: [], shifts: [], dates: [istDate(str(pk.packed_at))], lots: [str(target.lot.lot_no)] }, symptomAt: [], explanation: '', _suspect: { key: 'PACK', stage: 'PACK', machineId: null, obs: [] } });
  }
  const unexplained = [...symptomAt.entries()].filter(([k]) => !causes.some((c) => c._suspect.key === k));
  if (!causes.length && unexplained.length) {
    const [k, list] = unexplained[0]; const [stage, machine] = k.split('|') as [Stage, string];
    causes.push({ id: `${stage}_${machine}_UNEXPLAINED`, rank: 0, title: `${labelOf(machine) ?? STAGE_INFO[stage].label}: ${list[0]} is out of limits but no lens parameter explains it`, category: 'UNEXPLAINED', stage, machineId: machine || null, confidence: 0, score: 1, evidence: suspects.get(k)!.obs.filter(flagged).slice(0, 6).map(evOf), contrast: [], affected: { machines: [labelOf(machine) ?? machine], shifts: [], dates: [], lots: [str(target.lot.lot_no)] }, symptomAt: list, explanation: 'The symptom is visible in the lab results, but machine settings, accessories and fibre readings are all within the masters — widen the lens or inspect the machine.', _suspect: suspects.get(k)! });
  }

  // ---- cross-lot corroboration + recall scope
  const recall = new Map<string, AnalysisRecallLot>();
  const openCmp = new Map((await db.prepare(`SELECT lot_id, complaint_no FROM complaints WHERE status<>'RESOLVED'`).all<Row>()).map((c) => [str(c.lot_id), str(c.complaint_no)]));
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
  const addRecall = (b: LotBundle, reason: string, risk: AnalysisRecallLot['risk']) => {
    if (b.lot.id === target.lot.id) return;
    const prev = recall.get(str(b.lot.id));
    if (prev) { if (!prev.reason.includes(reason)) prev.reason += ` · ${reason}`; if (rank[risk] > rank[prev.risk]) prev.risk = risk; return; }
    const s = summarize(b, all, book, nowMs, mode);
    recall.set(str(b.lot.id), { lotId: str(b.lot.id), lotNo: str(b.lot.lot_no), countDisplay: str(b.count.display), status: str(b.lot.status), reason, risk, kg: s.packedKg ?? num(b.lot.planned_kg), customerId: s.customerId, customerName: s.customerName, dispatchNo: s.dispatchNo, openComplaint: openCmp.get(str(b.lot.id)) ?? null, stageHint: s.location.label });
  };
  const correlations: AnalysisResult['correlations'] = [];
  const corrSeen = new Set<string>();
  for (const c of causes) {
    const s = c._suspect;
    if (s.key === 'MIX') {
      for (const b of [...all.lots.values()].filter((x) => x.lot.mix_id === target.lot.mix_id && x.lot.id !== target.lot.id)) {
        const sym = aggOf(b).filter((o) => o.kind === 'QUALITY' && o.machineId && flagged(o) && symptomKeys.has(o.key));
        addRecall(b, `shares mix ${str(target.mix?.mix_no) || 'Unavailable'}${sym.length ? ` (${sym[0].label} ${fmt(sym[0].value, sym[0].key)} on ${sym[0].machineLabel})` : ''}`, sym.some((o) => o.color === 'red') ? 'HIGH' : 'MEDIUM');
        if (!c.affected.lots.includes(str(b.lot.lot_no))) c.affected.lots.push(str(b.lot.lot_no));
      }
      continue;
    }
    if (!s.machineId || s.key === 'PACK') continue;
    const machineLabel = labelOf(s.machineId) as string;
    const myRuns = target.runs.filter((r) => r.machine_id === s.machineId && r.stage === s.stage);
    const lastIn = Math.max(...myRuns.map((r) => Date.parse(str(r.in_at))));
    const causalLens = lens.filter((l) => l.stage === s.stage && ['PRODUCTION', 'ACCESSORY'].includes(paramDef(l.key)?.kind ?? ''));
    const symLens = lens.filter((l) => l.stage === s.stage && paramDef(l.key)?.kind === 'QUALITY');
    const others: { b: LotBundle; devs: AnalysisObservation[]; sym: AnalysisObservation[]; at: number }[] = [];
    for (const b of all.lots.values()) {
      if (b.lot.id === target.lot.id || b.lot.count_id !== countId) continue;
      const runs = b.runs.filter((r) => r.machine_id === s.machineId && r.stage === s.stage);
      if (!runs.length) continue;
      const agg = aggregate([...causalLens, ...symLens].flatMap((l) => observe(b, all, book, l, mode)).filter((o) => o.machineId === s.machineId), book.warnFraction);
      others.push({ b, devs: agg.filter((o) => CAUSAL.has(o.kind) && flagged(o)), sym: agg.filter((o) => o.kind === 'QUALITY' && flagged(o)), at: Math.min(...runs.map((r) => Date.parse(str(r.in_at)))) });
    }
    for (const x of others.filter((o) => o.devs.length)) {
      addRecall(x.b, `ran on ${machineLabel} with ${x.devs.map((o) => o.label.toLowerCase()).slice(0, 2).join(' + ')} outside the master${x.sym.length ? `; ${x.sym[0].label} ${fmt(x.sym[0].value, x.sym[0].key)} (${x.sym[0].color})` : ''}`, x.sym.some((o) => o.color === 'red') ? 'HIGH' : 'MEDIUM');
      if (!c.affected.lots.includes(str(x.b.lot.lot_no))) c.affected.lots.push(str(x.b.lot.lot_no));
      for (const o of [...x.devs, ...x.sym]) { for (const dt of o.dates) if (!c.affected.dates.includes(dt)) c.affected.dates.push(dt); for (const sh of o.shifts) if (!c.affected.shifts.includes(sh)) c.affected.shifts.push(sh); }
    }
    c.affected.dates.sort();
    const later = others.filter((o) => o.at > lastIn && !o.devs.length && !o.sym.length).sort((a, b) => a.at - b.at);
    if (later.length && others.some((o) => o.devs.length)) c.contrast.push(`From ${istDate(new Date(later[0].at).toISOString())} the later ${plural(later.length, 'lot')} ${later.slice(0, 3).map((x) => str(x.b.lot.lot_no)).join(', ')} on ${machineLabel} ${later.length === 1 ? 'is' : 'are'} within master — the condition has been corrected since (verify at the next doff test).`);
    const sym = symLens.find((l) => symptomKeys.has(l.key)) ?? symLens[0];
    if (sym) for (const ev of c.evidence.filter((e) => CAUSAL.has(paramDef(e.key)?.kind === 'PRODUCTION' ? 'PRODUCTION' : paramDef(e.key)?.kind === 'ACCESSORY' ? 'ACCESSORY' : 'X'))) {
      const xs: number[] = []; const ys: number[] = [];
      for (const b of all.lots.values()) { if (b.lot.count_id !== countId) continue; for (const r of b.runs.filter((x) => x.stage === s.stage && x.machine_id)) {
        const xv = (paramDef(ev.key)?.kind === 'PRODUCTION' ? parse<Record<string, number>>(r.params, {}) : parse<Record<string, number>>(r.accessories, {}))[ev.key];
        const tv = b.tests.filter((t) => t.machine_id === r.machine_id && t.stage === s.stage && t.sample_type === 'MACHINE').map((t) => parse<Record<string, number>>(t.values_json, {})[sym.key]).filter((v) => typeof v === 'number');
        if (typeof xv === 'number' && tv.length) { xs.push(xv); ys.push(mean(tv)); }
      } }
      const rr = pearson(xs, ys); const ck = `${ev.key}|${sym.key}`;
      if (rr !== null && !corrSeen.has(ck)) { corrSeen.add(ck); correlations.push({ x: `${paramDef(ev.key)?.label} (${STAGE_INFO[s.stage].short})`, y: `${paramDef(sym.key)?.label} (average per machine run)`, r: r1(rr, 2), n: xs.length, note: `Across all ${countId} ${STAGE_INFO[s.stage].label.toLowerCase()} runs: ${Math.abs(rr) >= 0.6 ? 'strong' : Math.abs(rr) >= 0.35 ? 'moderate' : 'weak'} ${rr >= 0 ? 'positive' : 'negative'} correlation.` }); }
    }
  }

  // ---- confidence, ranking, explanations
  for (const c of causes) {
    const causalEv = c.evidence.filter((e) => e.stage === 'BALE' ? false : CAUSAL.has(paramDef(e.key)?.kind === 'PRODUCTION' ? 'PRODUCTION' : paramDef(e.key)?.kind === 'ACCESSORY' ? 'ACCESSORY' : paramDef(e.key)?.kind === 'FIBRE' ? 'FIBRE' : paramDef(e.key)?.stages.includes('PACK') ? 'PACK' : 'X'));
    const reds = causalEv.filter((e) => e.color === 'red').length; const yel = causalEv.filter((e) => e.color === 'yellow').length;
    const corroborated = c.affected.lots.length > 1; const contrast = c.contrast.some((x) => x.startsWith('Same lot')); const symptom = c.symptomAt.length > 0;
    const strongCorr = correlations.some((r) => Math.abs(r.r) >= 0.6 && c.evidence.some((e) => r.x.startsWith(paramDef(e.key)?.label ?? '#')));
    const baleHit = c.evidence.some((e) => e.stage === 'BALE');
    const base = c.category === 'MIX_FIBRE' ? 24 : c.category === 'UNEXPLAINED' ? 18 : c.category === 'PACKING' ? 40 : 30;
    c.confidence = c.id === 'PACKING_COLOR' ? 92 : c.category === 'UNEXPLAINED' ? 35 : Math.min(97, Math.round(base + 11 * Math.min(reds, 3) + 5 * Math.min(yel, 2) + (symptom ? 10 : 0) + (corroborated ? 9 : 0) + (contrast ? 8 : 0) + (strongCorr ? 7 : 0) + (baleHit ? 6 : 0) + (c.category === 'PACKING' && reds >= 1 ? 25 : 0)));
  }
  causes.sort((a, b) => b.confidence - a.confidence || b.score - a.score);
  causes.forEach((c, i) => { c.rank = i + 1; });
  const top = causes.slice(0, 4);
  for (const c of top) {
    if (c.explanation) continue;
    const loc = c.machineId ? labelOf(c.machineId) : c.category === 'MIX_FIBRE' ? `mix ${str(target.mix?.mix_no) || 'Unavailable'}` : 'packing';
    const causalN = c.evidence.filter((e) => e.color !== 'green' && e.stage !== 'BALE').length;
    const others = c.affected.lots.filter((l) => l !== str(target.lot.lot_no));
    c.explanation = `${causalN} ${plural(causalN, 'reading')} at ${loc} ${causalN === 1 ? 'is' : 'are'} outside the master${c.symptomAt.length ? `, and the symptom shows there (${c.symptomAt.slice(0, 2).join('; ')})` : ''}. ${others.length ? `The same condition appears on ${plural(others.length, 'lot')} ${others.join(', ')}. ` : ''}${c.contrast[0] ?? ''}`.trim();
  }

  // ---- recall scope
  const recallLots = [...recall.values()].sort((a, b) => rank[b.risk] - rank[a.risk] || Number(a.lotNo) - Number(b.lotNo));
  const custMap = new Map<string, { customerId: string; name: string; lots: string[]; kg: number }>();
  const targetSummary = summarize(target, all, book, nowMs, mode);
  if (targetSummary.customerId) custMap.set(targetSummary.customerId, { customerId: targetSummary.customerId, name: targetSummary.customerName ?? '', lots: [str(target.lot.lot_no)], kg: targetSummary.packedKg ?? 0 });
  for (const l of recallLots.filter((x) => x.risk !== 'LOW')) if (l.customerId) { const cu = custMap.get(l.customerId) ?? { customerId: l.customerId, name: l.customerName ?? '', lots: [], kg: 0 }; cu.lots.push(l.lotNo); cu.kg += l.kg ?? 0; custMap.set(l.customerId, cu); }
  const atRisk = recallLots.filter((l) => l.risk !== 'LOW').reduce((s, l) => s + (l.kg ?? 0), 0) + (targetSummary.packedKg ?? 0);

  // ---- actions
  const corrective: AnalysisAction[] = []; const preventive: AnalysisAction[] = [];
  top.forEach((c, i) => {
    const m = labelOf(c.machineId);
    const accE = c.evidence.find((e) => paramDef(e.key)?.kind === 'ACCESSORY' && e.color === 'red'); const prodE = c.evidence.find((e) => paramDef(e.key)?.kind === 'PRODUCTION' && e.color === 'red');
    const symLabel = [...symptomKeys].map((k) => paramDef(k)?.label).filter(Boolean)[0];
    if (c.category === 'MIX_FIBRE') {
      corrective.push({ id: `A${i}c`, text: `Quarantine the remaining stock of mix ${str(target.mix?.mix_no) || 'Unavailable'} and re-test the bales that raised the ${c.evidence.find((e) => e.stage !== 'BALE')?.label.toLowerCase() ?? 'fibre property'}; blend with a lower-short-fibre variety before further use.`, owner: 'Bale store + QA', priority: 'HIGH', relatedCauseId: c.id });
      preventive.push({ id: `A${i}p`, text: 'Add a pre-mix HVI check: hold bales whose short-fibre index or uniformity breach the Count & Mix master ranges before they are issued, and review the supplier lot.', owner: 'QA / Purchase', priority: 'MEDIUM', relatedCauseId: c.id });
    } else if (c.category === 'PACKING') {
      corrective.push({ id: `A${i}c`, text: 'Re-inspect the cartons of this lot against the Color Code and Accessories masters; replace mismatching cones and re-issue the packing slip.', owner: 'Packing in-charge', priority: 'HIGH', relatedCauseId: c.id });
      preventive.push({ id: `A${i}p`, text: 'Verify the cone tube colour at packing against the Color Code master and block carton sealing on a mismatch.', owner: 'Dispatch + QA', priority: 'MEDIUM', relatedCauseId: c.id });
    } else if (c.category === 'UNEXPLAINED') {
      corrective.push({ id: `A${i}c`, text: `Inspect ${m ?? 'the machine'} directly: lab results are out of limits but settings and accessories look normal.`, owner: `${STAGE_INFO[c.stage].label} supervisor`, priority: 'MEDIUM', relatedCauseId: c.id });
    } else {
      if (prodE) corrective.push({ id: `A${i}c1`, text: `Verify and reset ${prodE.label.toLowerCase()} on ${m} to the master (${fmt(prodE.std, prodE.key)}, limits ${fmt(prodE.lower, prodE.key)}–${fmt(prodE.upper, prodE.key)})${symLabel ? ` and confirm ${symLabel} over three shifts` : ''}.`, owner: `${STAGE_INFO[c.stage].label} supervisor`, priority: 'HIGH', relatedCauseId: c.id });
      if (accE) corrective.push({ id: `A${i}c2`, text: `Change the ${accE.label.replace(/ – age| age/g, '').toLowerCase()} on ${m} now (age ${fmt(accE.value, accE.key)} days vs master limit ${fmt(accE.upper, accE.key)}).`, owner: 'Maintenance', priority: 'HIGH', relatedCauseId: c.id });
      if (!prodE && !accE) corrective.push({ id: `A${i}c`, text: `Inspect ${m}: ${c.evidence[0]?.text ?? 'out-of-master results'}`, owner: `${STAGE_INFO[c.stage].label} supervisor`, priority: 'MEDIUM', relatedCauseId: c.id });
      preventive.push({ id: `A${i}p`, text: `Add ${[prodE?.label, accE?.label].filter(Boolean).join(' and ').toLowerCase() || 'the flagged parameters'} to the shift-start checklist and raise the accessories alert when the age reaches 80% of the master limit.`, owner: 'Production supervisor', priority: 'MEDIUM', relatedCauseId: c.id });
    }
  });
  if (recallLots.some((l) => l.risk !== 'LOW')) corrective.push({ id: 'AR', text: `Hold unshipped stock and contact the customers of the at-risk lots (${recallLots.filter((l) => l.risk !== 'LOW').map((l) => l.lotNo).join(', ')}) before they complain; offer replacement from a lot that ran on a healthy frame.`, owner: 'Customer service + QA', priority: 'HIGH', relatedCauseId: top[0]?.id ?? 'AR' });

  const flaggedCount = obs.filter(flagged).length;
  const lead = top[0];
  const locOf = (c: AnalysisCause) => (c.machineId ? labelOf(c.machineId) : c.category === 'MIX_FIBRE' ? `mix ${str(target.mix?.mix_no) || 'Unavailable'}` : 'packing');
  const verb = !lead ? '' : lead.confidence >= 75 ? 'traced to' : lead.confidence >= 50 ? 'most likely linked to' : 'weak lead only:';
  const headline = lead ? `${COMPLAINT_NAME[type]} ${verb} ${locOf(lead)} — ${lead.title.split(': ').slice(1).join(': ') || lead.title}${top[1] && top[1].confidence >= 40 ? `; contributory: ${locOf(top[1])}` : ''}${lead.confidence < 50 ? ' (low confidence — no conclusive cause in the data)' : ''}` : `No lens parameter is outside its master for lot ${str(target.lot.lot_no)}`;
  const ruledOut = lens.filter((l) => { const rows = obs.filter((o) => o.stage === l.stage && o.key === l.key); return rows.length > 0 && rows.every((o) => !flagged(o)); }).map((l) => `${paramDef(l.key)?.label} (${STAGE_INFO[l.stage].short}) is within master and in line with the reference lots`);
  const mixRef = [...new Set(refs.map((r) => str(r.b.mix?.mix_no) || 'Unavailable'))];
  const overall: QualityColor = worstColor(obs.map((o) => o.color));
  return {
    engineVersion: 'stat-2.1', generatedAt: nowIso, mode,
    lot: { id: str(target.lot.id), lotNo: str(target.lot.lot_no), lotCode: str(target.lot.lot_code), countId, countDisplay: str(target.count.display), mixNo: str(target.mix?.mix_no) || 'Unavailable' },
    complaint: complaint ? { id: str(complaint.id), complaintNo: str(complaint.complaint_no), type } : null,
    lens, referenceLots: refs.map((r) => ({ lotId: str(r.b.lot.id), lotNo: str(r.b.lot.lot_no), mixNo: str(r.b.mix?.mix_no) || 'Unavailable', kind: (r.b.lot.mix_id === target.lot.mix_id ? 'GOOD' : 'PREVIOUS_MIX') as 'GOOD' | 'PREVIOUS_MIX', leadingScore: r1(r.score, 2) })),
    summary: { headline, overallColor: overall, topSuspect: lead ? lead.title : null, deviatingCount: flaggedCount, dataPoints: obs.reduce((s, o) => s + o.n, 0), referenceCount: refs.length },
    parameters: obs.sort((a, b) => sev(b) - sev(a) || a.stage.localeCompare(b.stage)), ruledOut, rootCauses: top.map(({ _suspect, ...c }) => { void _suspect; return c; }), correlations,
    recallScope: { lots: recallLots, customers: [...custMap.values()].map((cu) => ({ ...cu, kg: r1(cu.kg, 0) })), totalKgAtRisk: r1(atRisk, 0), basis: `${recallLots.filter((l) => l.risk !== 'LOW').length} other ${plural(recallLots.filter((l) => l.risk !== 'LOW').length, 'lot')} share the suspected machine window or mix with the complaint lot. Reference: ${refs.length} good ${plural(refs.length, 'lot')} of the same count from ${mixRef.length} ${plural(mixRef.length, 'mix', 'mixes')}.` },
    actions: { corrective, preventive },
    narrative: { source: 'template', headline, text: top.map((c) => `${c.rank}. ${c.title} (confidence ${c.confidence}%). ${c.explanation}`).join('\n\n'), cautions: ['Statistical analysis is advisory. The QA head makes the final root-cause call and the customer disposition.', 'Reference readings are the last good lots of the same count; confidence reflects how many independent lines of evidence agree.'] },
  };
}
const COMPLAINT_NAME: Record<string, string> = { HAIRINESS: 'Hairiness', COUNT_VARIATION: 'Count variation', EVENNESS: 'Evenness (U%)', THIN_THICK_NEPS: 'Imperfections', STRENGTH: 'Low strength', CONTAMINATION: 'Contamination', SHADE: 'Shade variation', PACKING_COLOR: 'Cone-colour problem', SHORT_WEIGHT: 'Short weight', OTHER: 'Quality deviation' };
