// Turns a (sanitised) LotPassport into the plain-language pieces of the customer's Lot Passport.
import type { Judged, LotPassport } from '@shared/domain';
import type { Stage } from '@shared/params';
import type { QualityColor } from '@shared/quality';
import { fmtD } from '../../lib/fmt';

/** Customer-friendly stage names (the technical name stays visible as a small caption). */
export const FRIENDLY_STAGE: Record<Stage, { name: string; tech: string }> = {
  BALE: { name: 'Cotton bales stored', tech: 'Bale store' },
  BR: { name: 'Opening and cleaning', tech: 'Blow room' },
  CARD: { name: 'Carding', tech: 'Carding' },
  DFB: { name: 'Drawing — first pass', tech: 'Breaker drawing' },
  DFF: { name: 'Drawing — second pass', tech: 'Finisher drawing' },
  COMB: { name: 'Combing', tech: 'Comber' },
  FF: { name: 'Roving', tech: 'Fly frame' },
  RF: { name: 'Spinning into yarn', tech: 'Ring frame' },
  AW: { name: 'Winding onto cones', tech: 'Autoconer' },
  PACK: { name: 'Packing', tech: 'Packing' },
  FG: { name: 'Waiting for dispatch', tech: 'Finished-goods store' },
  DISP: { name: 'Dispatched', tech: 'Dispatch' },
  DELIV: { name: 'Delivered to you', tech: 'Delivery' },
};

// ------------------------------------------------------------------ origin: blend + ginners
export interface BlendPart { key: string; label: string; pct: number; exactPct: number; kg: number; waste: boolean; fullLabel: string }
/** Recipe as whole-number percentages that add up to 100 (largest-remainder rounding). */
export function blendParts(p: LotPassport): BlendPart[] {
  const r = p.mix.recipe;
  const floors = r.map((x) => Math.floor(x.pct));
  let left = Math.round(r.reduce((s, x) => s + x.pct, 0)) - floors.reduce((a, b) => a + b, 0);
  for (const o of r.map((x, i) => ({ i, rem: x.pct - Math.floor(x.pct) })).sort((a, b) => b.rem - a.rem)) { if (left <= 0) break; floors[o.i] += 1; left -= 1; }
  return r.map((x, i) => ({ key: x.key, label: x.source === 'WASTE' ? 'recycled cotton' : x.label, fullLabel: x.source === 'WASTE' ? 'Recycled cotton (our own blow-room and card waste, re-used)' : x.label, pct: floors[i], exactPct: x.pct, kg: x.kg, waste: x.source === 'WASTE' }));
}
export const blendSentence = (parts: BlendPart[]): string => parts.map((b) => `${b.pct}% ${b.label}`).join(' + ');

export interface Origin { supplier: string; station: string; varieties: string[]; bales: number; kg: number; pct: number; ginLots: string[] }
/** Bales grouped by ginner and place. */
export function origins(p: LotPassport): Origin[] {
  const m = new Map<string, Origin>();
  for (const b of p.bales) {
    const k = `${b.supplier}|${b.station}`;
    const o = m.get(k) ?? { supplier: b.supplier, station: b.station, varieties: [], bales: 0, kg: 0, pct: 0, ginLots: [] };
    o.bales += 1; o.kg += b.kgUsed; o.pct += b.pct;
    if (!o.varieties.includes(b.variety)) o.varieties.push(b.variety);
    if (b.ginLot && !o.ginLots.includes(b.ginLot)) o.ginLots.push(b.ginLot);
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.kg - a.kg);
}

// ------------------------------------------------------------------ test certificates (lot-level samples only)
export interface CertRow { id: string; stage: Stage; stageLabel: string; sampleId: string; testedAt: string; instrument: string; sampleLabel: string; j: Judged }
export function certificateRows(p: LotPassport): CertRow[] {
  const rows: CertRow[] = [];
  for (const q of p.quality) for (const s of q.samples) {
    if (s.type !== 'LOT') continue;
    const sampleLabel = q.stage === 'RF' ? 'Spun yarn — lot sample' : q.stage === 'AW' ? 'Wound cones — final lot sample' : `${FRIENDLY_STAGE[q.stage]?.name ?? q.label} — lot sample`;
    for (const j of s.values) if (j.value !== null) rows.push({ id: `${s.id}:${j.key}`, stage: q.stage, stageLabel: q.label, sampleId: s.sampleId, testedAt: s.testedAt, instrument: s.instrument, sampleLabel, j });
  }
  return rows;
}

const KEY_RESULTS: { key: string; title: string; prefer: Stage[] }[] = [
  { key: 'COUNT', title: 'Yarn count', prefer: ['RF'] },
  { key: 'U', title: 'Evenness (U%)', prefer: ['RF', 'AW'] },
  { key: 'CV', title: 'Mass variation (CV%)', prefer: ['RF'] },
  { key: 'IPI', title: 'Imperfections (IPI)', prefer: ['RF'] },
  { key: 'H', title: 'Hairiness (H)', prefer: ['RF', 'AW'] },
  { key: 'S3', title: 'Hairiness (S3)', prefer: ['RF', 'AW'] },
  { key: 'RKM', title: 'Strength (RKM)', prefer: ['RF'] },
  { key: 'CSP', title: 'Strength (CSP)', prefer: ['RF'] },
];
export interface KeyResult { key: string; title: string; j: Judged; sampleLabel: string; testedAt: string }
/** The headline lot-level results a buyer cares about: count, U%, CV%, imperfections, hairiness, strength. */
export function keyResults(rows: CertRow[]): KeyResult[] {
  const out: KeyResult[] = [];
  for (const k of KEY_RESULTS) {
    const hit = k.prefer.map((s) => rows.find((r) => r.stage === s && r.j.key === k.key)).find(Boolean) ?? rows.find((r) => r.j.key === k.key);
    if (hit) out.push({ key: k.key, title: k.title, j: hit.j, sampleLabel: hit.sampleLabel, testedAt: hit.testedAt });
  }
  return out;
}

export const VERDICT: Record<QualityColor, { label: string; short: string }> = {
  green: { label: 'Within specification', short: 'Within spec' },
  yellow: { label: 'Near the limit', short: 'Near the limit' },
  red: { label: 'Outside specification', short: 'Outside spec' },
  none: { label: 'No specification set', short: 'No spec' },
};

const f = (v: number | null, d: number) => (v === null || v === undefined ? '' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
/** "5.72 – 6.52" / "up to 1,344" / "at least 15.40", plus the target. */
export function specRange(j: Judged): string {
  if (j.lower !== null && j.upper !== null) return `${f(j.lower, j.decimals)} – ${f(j.upper, j.decimals)}`;
  if (j.upper !== null) return `up to ${f(j.upper, j.decimals)}`;
  if (j.lower !== null) return `at least ${f(j.lower, j.decimals)}`;
  return '—';
}
export const specTarget = (j: Judged): string => (j.std === null ? '' : `target ${f(j.std, j.decimals)}`);
export const valueText = (j: Judged): string => (j.value === null ? '—' : `${f(j.value, j.decimals)}${j.unit ? ` ${j.unit}` : ''}`);

export function certSummary(rows: CertRow[]): { total: number; within: number; near: number; outside: number } {
  return { total: rows.length, within: rows.filter((r) => r.j.color === 'green').length, near: rows.filter((r) => r.j.color === 'yellow').length, outside: rows.filter((r) => r.j.color === 'red').length };
}

// ------------------------------------------------------------------ ledger verification in friendly words
export interface Verification { state: 'verified' | 'changed' | 'pending'; lead: string; text: string; detail: string }
export function verification(p: LotPassport): Verification {
  const { chain } = p.lot; const l = p.ledger;
  const range = l.firstBlock !== null ? ` · ledger blocks #${l.firstBlock}–#${l.lastBlock}` : '';
  const detail = `${l.verifiedRecords} of ${l.totalRecords} records for this lot re-checked just now${range}`;
  if (!chain.txHash) return { state: 'pending', lead: 'Waiting for the ledger', text: 'this record has not been written on the mill\'s ledger yet.', detail };
  if (chain.verified && l.totalRecords > 0 && l.verifiedRecords === l.totalRecords) return { state: 'verified', lead: 'Verified', text: 'this record has not been changed since it was written on the mill\'s ledger.', detail };
  return { state: 'changed', lead: 'Please check with the mill', text: `${l.totalRecords - l.verifiedRecords || 1} record(s) for this lot no longer match what was written on the mill's ledger.`, detail };
}

// ------------------------------------------------------------------ public passport links (QR)
export function passportLinks(p: LotPassport, origin: string): { carton: { code: string; url: string }; dispatch: { code: string; url: string } | null } {
  const cartonCode = p.packing?.cartonFrom || `C-${p.lot.lotNo}-001`;
  return { carton: { code: cartonCode, url: `${origin}/passport/${cartonCode}` }, dispatch: p.dispatch?.passportCode ? { code: p.dispatch.passportCode, url: `${origin}/passport/${p.dispatch.passportCode}` } : null };
}

/** "12 Oct → 13 Oct 2026" / "12 Oct 2026" */
export function dayRange(inAt: string | null, outAt: string | null): string {
  if (!inAt) return '';
  const a = fmtD(inAt); const b = outAt ? fmtD(outAt) : null;
  if (!b || a === b) return a;
  return a.slice(-4) === b.slice(-4) ? `${a.slice(0, -5)} → ${b}` : `${a} → ${b}`;
}
