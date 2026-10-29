import type { Judged, LotPassport, QualityColor } from '@shared/domain';
import { STAGES, STAGE_INFO, type Stage } from '@shared/params';
import { fmtN, tally, type PassportTab } from './util';

export type FindingSource = 'MIX' | 'QUALITY' | 'PRODUCTION' | 'ACCESSORY' | 'PACKING';
export const SOURCE_LABEL: Record<FindingSource, string> = { MIX: 'Cotton mix', QUALITY: 'Lab test', PRODUCTION: 'Machine setting / run', ACCESSORY: 'Accessory age', PACKING: 'Packing' };
const SOURCE_TAB: Record<FindingSource, PassportTab | null> = { MIX: null, QUALITY: 'quality', PRODUCTION: 'production', ACCESSORY: 'accessories', PACKING: 'accessories' };

export interface Finding {
  source: FindingSource;
  stage: Stage | 'MIX';
  stageLabel: string;
  where: string;
  j: Judged | null;
  color: QualityColor;
  label: string;
  text: string;
}
export interface FindingGroup {
  key: string;
  source: FindingSource;
  tab: PassportTab | null;
  stage: Stage | 'MIX';
  stageLabel: string;
  label: string;
  red: number;
  yellow: number;
  where: { name: string; n: number }[];
  worst: Finding;
}

/** Every red / yellow reading of a lot passport (mix fibre, lab tests, machine runs, accessories, packing). */
export function collectFindings(p: LotPassport): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => { if (f.color === 'red' || f.color === 'yellow') out.push(f); };
  const fromJ = (source: FindingSource, stage: Stage | 'MIX', stageLabel: string, where: string, j: Judged): Finding => ({ source, stage, stageLabel, where, j, color: j.color, label: j.label, text: j.text });
  for (const j of p.mix.fibre) add(fromJ('MIX', 'MIX', 'Cotton mix (blow room)', `Mix ${p.mix.mixNo}`, j));
  for (const q of p.quality) for (const s of q.samples) for (const j of s.values) add(fromJ('QUALITY', q.stage, q.label, s.machineLabel ?? 'Lot composite', j));
  for (const st of p.production) for (const r of st.runs) {
    for (const j of r.params) add(fromJ('PRODUCTION', st.stage, st.label, r.machineLabel ?? st.label, j));
    if (r.balance && (r.balance.color === 'red' || r.balance.color === 'yellow')) add({ source: 'PRODUCTION', stage: st.stage, stageLabel: st.label, where: r.machineLabel ?? st.label, j: null, color: r.balance.color, label: 'Mass balance', text: `${fmtN(Math.abs(r.balance.diffKg), 1)} kg (${r.balance.diffPct}%) of the input is unaccounted for` });
  }
  for (const a of p.accessories) for (const j of a.items) add(fromJ('ACCESSORY', a.stage, STAGE_INFO[a.stage].label, a.machineLabel, j));
  if (p.packing) {
    for (const j of p.packing.checks) add(fromJ('PACKING', 'PACK', 'Packing', `Slip ${p.packing.slipNo}`, j));
    if (!p.packing.colorOk) add({ source: 'PACKING', stage: 'PACK', stageLabel: 'Packing', where: `Slip ${p.packing.slipNo}`, j: null, color: 'red', label: 'Cone colour', text: `Packed with ${p.packing.colorActual}, master requires ${p.packing.colorMaster}` });
  }
  return out;
}

const sev = (c: QualityColor) => (c === 'red' ? 2 : c === 'yellow' ? 1 : 0);
const stageRank = (s: Stage | 'MIX') => (s === 'MIX' ? -1 : STAGES.indexOf(s));

export function groupFindings(fs: Finding[]): FindingGroup[] {
  const map = new Map<string, FindingGroup>();
  for (const f of fs) {
    const key = `${f.source}|${f.stage}|${f.j?.key ?? f.label}`;
    let g = map.get(key);
    if (!g) { g = { key, source: f.source, tab: SOURCE_TAB[f.source], stage: f.stage, stageLabel: f.stageLabel, label: f.label, red: 0, yellow: 0, where: [], worst: f }; map.set(key, g); }
    if (f.color === 'red') g.red++; else g.yellow++;
    const w = g.where.find((x) => x.name === f.where); if (w) w.n++; else g.where.push({ name: f.where, n: 1 });
    const dev = (x: Finding) => Math.abs(x.j?.deviationPct ?? 0);
    if (sev(f.color) > sev(g.worst.color) || (sev(f.color) === sev(g.worst.color) && dev(f) > dev(g.worst))) g.worst = f;
  }
  return [...map.values()].sort((a, b) => sev(b.worst.color) - sev(a.worst.color) || stageRank(a.stage) - stageRank(b.stage) || b.red + b.yellow - (a.red + a.yellow) || a.label.localeCompare(b.label));
}

/** Red / yellow counts shown on each tab. They add up to the lot totals (`lot.red` / `lot.yellow`) the server reports. */
export function tabCounts(p: LotPassport): Record<PassportTab, { red: number; yellow: number }> {
  const quality = tally(p.quality.flatMap((q) => q.samples.flatMap((s) => s.values)));
  const production = tally(p.production.flatMap((s) => s.runs.flatMap((r) => r.params)));
  for (const s of p.production) for (const r of s.runs) if (r.balance?.color === 'red') production.red++; else if (r.balance?.color === 'yellow') production.yellow++;
  const accessories = tally(p.accessories.flatMap((a) => a.items));
  return { quality, production, accessories };
}
