// Master values for the four counts (20s, 30s CH, 40s CH, 40s compact). std / lower / upper per (type, scope, parameter),
// derived from the count (Ne) and compact flag so counts differ the way real mills' masters do.
import type { AccessoriesMeta, ColorMeta, CountMixMeta } from '@shared/domain';
import { routeFor, paramDef, type MasterType, type Scope, type Stage } from '@shared/params';

export interface CountSpec { id: string; label: string; display: string; ne: number; comber: boolean; compact: boolean }

export const COUNTS: CountSpec[] = [
  { id: '20S', label: '20s Carded Hosiery', display: '20s', ne: 20, comber: false, compact: false },
  { id: '30CH', label: '30s Carded Hosiery', display: '30s CH', ne: 30, comber: false, compact: false },
  { id: '40CH', label: '40s Carded Hosiery', display: '40s CH', ne: 40, comber: false, compact: false },
  { id: '40CP', label: '40s Compact (combed)', display: '40s compact', ne: 40, comber: true, compact: true },
  { id: '16S', label: '16s Carded Open-end Blend', display: '16s', ne: 16, comber: false, compact: false },
  { id: '24CH', label: '24s Carded Hosiery', display: '24s CH', ne: 24, comber: false, compact: false },
  { id: '34CH', label: '34s Carded Hosiery', display: '34s CH', ne: 34, comber: false, compact: false },
  { id: '30CP', label: '30s Compact (combed)', display: '30s compact', ne: 30, comber: true, compact: true },
  { id: '50CP', label: '50s Compact (combed)', display: '50s compact', ne: 50, comber: true, compact: true },
  { id: '60CP', label: '60s Compact (combed)', display: '60s compact', ne: 60, comber: true, compact: true },
];

export interface SpecItem { master: MasterType; scope: Scope; key: string; std: number; lower: number | null; upper: number | null; unit?: string; frequency: string; instrument: string }

const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const INSTR: Record<string, string> = {
  BR: 'HVI 1000 / AFIS', CARD: 'Uster Tester 6 (sliver) / AFIS', DFB: 'Uster Tester 6 (sliver)', DFF: 'Uster Tester 6 (sliver)',
  COMB: 'Uster Tester 6 (sliver) / AFIS', FF: 'Uster Tester 6 (roving)', RF: 'Uster Tester 6 + Tensorapid', AW: 'Uster Quantum 3 / Tensojet',
};
const FREQ: Record<string, string> = {
  BR: 'Every mix', CARD: 'Every shift per card', DFB: 'Every shift per machine', DFF: 'Every shift per machine', COMB: 'Every shift per machine',
  FF: 'Every shift per frame', RF: 'Every shift per frame (L & R side)', AW: 'Daily per machine',
};

/** Two-sided band [std−tol, std+tol]. */
const band = (std: number, tol: number, d = 2): [number, number, number] => [r(std, d), r(std - tol, d), r(std + tol, d)];
/** Upper-limit-only (lower is better). */
const maxOnly = (std: number, upper: number, d = 2): [number, null, number] => [r(std, d), null, r(upper, d)];
/** Lower-limit-only (higher is better). */
const minOnly = (std: number, lower: number, d = 2): [number, number, null] => [r(std, d), r(lower, d), null];

type Tri = [number, number | null, number | null];

function qualityTable(c: CountSpec): Record<string, Tri> {
  const { ne, compact } = c;
  const k = compact ? 1 : 0;
  const uStd = 8.2 + 0.055 * ne - 0.8 * k;
  const thin = (4 + 0.1 * ne) * (1 - 0.5 * k);
  const thick = (45 + 0.8 * ne) * (1 - 0.4 * k);
  const neps = (60 + ne) * (1 - 0.45 * k);
  const ipi = thin + thick + neps;
  const tm = compact ? 3.6 : ne >= 40 ? 3.5 : 3.4;
  const tpi = tm * Math.sqrt(ne);
  const hank = (hk: number) => band(hk, hk * 0.03, 3);
  const sliverHank = ne >= 40 ? 0.115 : ne >= 30 ? 0.12 : 0.125;
  const rovingHank = ne >= 40 ? 1.2 : ne >= 30 ? 1.05 : 0.9;
  return {
    // blow room: fibre of the mix + cleaning
    'BR.MIC': band(4.2, 0.4, 2), 'BR.UHML': band(ne >= 40 ? (compact ? 31 : 29.5) : ne >= 30 ? 28.5 : 27.5, 1, 1), 'BR.UI': minOnly(82, 80, 1), 'BR.STR': minOnly(29, 27.5, 1),
    'BR.SFI': maxOnly(compact ? 7 : 8, compact ? 8 : 9, 1), 'BR.TRASH': maxOnly(2.2, 3, 2), 'BR.MOIST': band(7.5, 1, 1), 'BR.RD': minOnly(74, 70, 1), 'BR.PLUS_B': maxOnly(9, 11, 1),
    'BR.CLEAN_EFF': minOnly(55, 48, 1), 'BR.WASTE_TRASH': minOnly(60, 50, 1), 'BR.NEPS_BEFORE': maxOnly(180, 240, 0), 'BR.NEPS_AFTER': maxOnly(210, 280, 0),
    // card
    'CARD.HANK': hank(sliverHank), 'CARD.U': maxOnly(3.1, 3.7, 2), 'CARD.CV': maxOnly(3.9, 4.6, 2), 'CARD.A': maxOnly(1.2, 1.8, 2),
    'CARD.NEPS_IN': maxOnly(210, 280, 0), 'CARD.NEPS_OUT': maxOnly(compact ? 40 : 70, compact ? 60 : 100, 0), 'CARD.NEP_REMOVAL': minOnly(compact ? 82 : 72, compact ? 76 : 65, 1), 'CARD.TRASH_OUT': maxOnly(0.35, 0.6, 2),
    // drawing
    ...Object.fromEntries(['DFB', 'DFF'].flatMap((s) => {
      const f = s === 'DFF' ? 1 : 1.25;
      return [
        [`${s}.HANK`, hank(sliverHank)], [`${s}.HANK_CV`, maxOnly(0.7 * f, 1.1 * f, 2)], [`${s}.U`, maxOnly(2.6 * f, 3.3 * f, 2)], [`${s}.CV`, maxOnly(3.3 * f, 4.1 * f, 2)],
        [`${s}.CV1M`, maxOnly(1.5 * f, 2.1 * f, 2)], [`${s}.CV3M`, maxOnly(1.2 * f, 1.8 * f, 2)], [`${s}.CV10M`, maxOnly(0.9 * f, 1.4 * f, 2)], [`${s}.A`, maxOnly(1.0 * f, 1.5 * f, 2)],
      ] as [string, Tri][];
    })),
    // comber
    'COMB.NOIL_PCT': band(16, 2, 1), 'COMB.LAP_NEPS': maxOnly(30, 45, 0), 'COMB.SLV_NEPS': maxOnly(18, 28, 0), 'COMB.U': maxOnly(2.4, 3.0, 2),
    // fly frame
    'FF.HANK': hank(rovingHank), 'FF.HANK_CV': maxOnly(0.9, 1.4, 2), 'FF.U': maxOnly(4.4, 5.0, 2), 'FF.CV': maxOnly(5.6, 6.4, 2), 'FF.TPI': band(r(rovingHank ** 0.5 * 1.1, 2), 0.1, 2), 'FF.MOIST_ROV': band(6.8, 0.6, 1),
    // ring frame
    'RF.COUNT': band(ne, ne * 0.015, 2), 'RF.COUNT_CV': maxOnly(1.9 - 0.3 * k, 2.5 - 0.3 * k, 2), 'RF.U': band(uStd, 0.5, 2), 'RF.CV': band(uStd * 1.27, 0.7, 2),
    'RF.THIN': maxOnly(thin, thin * 2.2, 0), 'RF.THICK': maxOnly(thick, thick * 1.5, 0), 'RF.NEPS': maxOnly(neps, neps * 1.45, 0), 'RF.IPI': maxOnly(ipi, ipi * 1.3, 0),
    'RF.H': band((8.2 - 0.052 * ne) * (compact ? 0.78 : 1), 0.4, 2), 'RF.S3': maxOnly((2000 - 22 * ne) * (compact ? 0.5 : 1), (2000 - 22 * ne) * (compact ? 0.6 : 1.2), 0),
    'RF.RKM': minOnly(17 - 0.04 * ne + 1.5 * k, 15.8 - 0.04 * ne + 1.5 * k, 2), 'RF.CSP': minOnly(2500 - 6 * ne + 150 * k, 2350 - 6 * ne + 150 * k, 0), 'RF.ELONG': band(5.4 - 0.02 * ne, 0.6, 2),
    'RF.TPI': band(tpi, tpi * 0.03, 2), 'RF.TPI_CV': maxOnly(2.5, 4, 2),
    // winding
    'AW.CUTS_NEP': maxOnly(18 - 6 * k, 30 - 8 * k, 1), 'AW.CUTS_SHORT': maxOnly(9 - 3 * k, 16 - 4 * k, 1), 'AW.CUTS_LONG': maxOnly(1.6, 3.2, 1), 'AW.CUTS_THIN': maxOnly(4, 8, 1),
    'AW.SPLICE_STR': minOnly(88, 80, 1), 'AW.THIN': maxOnly(thin * 0.6, thin * 1.4, 0), 'AW.THICK': maxOnly(thick * 0.55, thick * 0.9, 0), 'AW.NEPS': maxOnly(neps * 0.55, neps * 0.9, 0),
    'AW.S3': maxOnly((2000 - 22 * ne) * (compact ? 0.52 : 1.05), (2000 - 22 * ne) * (compact ? 0.62 : 1.3), 0), 'AW.H': band(((8.2 - 0.052 * ne) * (compact ? 0.78 : 1)) * 1.04, 0.45, 2), 'AW.U': band(uStd * 0.97, 0.5, 2), 'AW.SHADE_FAULTS': maxOnly(0.4, 1.0, 1), 'AW.CONTAM_CUTS': maxOnly(0.5, 1.2, 1),
    // MIX ranges (used by the Count & Mix master)
    'MIX.MIC': band(4.2, 0.4, 2), 'MIX.UHML': band(ne >= 40 ? (compact ? 31 : 29.5) : ne >= 30 ? 28.5 : 27.5, 1, 1), 'MIX.UI': minOnly(82, 80, 1), 'MIX.STR': minOnly(29, 27.5, 1),
    'MIX.SFI': maxOnly(compact ? 7 : 8, compact ? 8 : 9, 1), 'MIX.TRASH': maxOnly(2.2, 3, 2), 'MIX.MOIST': band(7.5, 1, 1), 'MIX.RD': minOnly(74, 70, 1), 'MIX.PLUS_B': maxOnly(9, 11, 1),
  };
}

function productionTable(c: CountSpec): Record<string, Tri> {
  const { ne, compact } = c;
  const spindle = compact ? 18000 : ne >= 40 ? 18200 : ne >= 30 ? 16800 : 15500;
  const tm = compact ? 3.6 : ne >= 40 ? 3.5 : 3.4;
  const tpiSet = tm * Math.sqrt(ne);
  const wasteBR = compact ? 4.2 : ne >= 40 ? 4.6 : 4.8;
  const wasteCard = compact ? 4.4 : 5.2;
  const yieldDrop = (w: number) => 100 - w;
  const t: Record<string, Tri> = {};
  const set = (stage: Stage, key: string, v: Tri) => { t[`${stage}.${key}`] = v; };
  const common: Record<string, { w: number; eff: number; util: number; stops: number; kwh: number; prod: number }> = {
    BR: { w: wasteBR, eff: 88, util: 85, stops: 2, kwh: 0.12, prod: 4600 },
    CARD: { w: wasteCard, eff: 90, util: 86, stops: 2, kwh: 0.42, prod: 300 },
    DFB: { w: 0.4, eff: 86, util: 84, stops: 3, kwh: 0.16, prod: 1100 },
    DFF: { w: 0.4, eff: 87, util: 85, stops: 3, kwh: 0.18, prod: 900 },
    COMB: { w: 16, eff: 90, util: 86, stops: 2, kwh: 0.35, prod: 260 },
    FF: { w: 0.7, eff: 85, util: 83, stops: 4, kwh: 0.55, prod: 170 },
    RF: { w: 1.5, eff: 94, util: 90, stops: 3, kwh: 1.7 - 0.01 * ne, prod: 150 + (ne >= 40 ? 0 : 20) },
    AW: { w: 1.0, eff: 87, util: 82, stops: 6, kwh: 0.45, prod: 380 },
  };
  for (const [stage, v] of Object.entries(common) as [Stage, (typeof common)[string]][]) {
    if (stage === 'COMB' && !compact) continue;
    set(stage, 'WASTE_PCT', maxOnly(v.w, v.w * 1.3 + 0.1, 2));
    set(stage, 'YIELD_PCT', minOnly(yieldDrop(v.w), yieldDrop(v.w * 1.3 + 0.1), 1));
    set(stage, 'EFF_PCT', minOnly(v.eff, v.eff - 6, 1));
    set(stage, 'UTIL_PCT', minOnly(v.util, v.util - 8, 1));
    set(stage, 'STOPPAGES', maxOnly(v.stops, v.stops * 2, 0));
    set(stage, 'KWH_KG', maxOnly(v.kwh, v.kwh * 1.2, 2));
    set(stage, 'PROD_KG_SHIFT', minOnly(v.prod, v.prod * 0.85, 0));
  }
  for (const stage of ['BR', 'CARD', 'FF', 'RF', 'AW'] as Stage[]) { set(stage, 'RH_PCT', band(stage === 'BR' ? 55 : stage === 'RF' ? 55 : 52, 5, 0)); set(stage, 'TEMP_C', band(28, 3, 1)); }
  set('BR', 'BEATER_RPM', band(850, 50, 0)); set('BR', 'FEED_RATE', band(600, 60, 0));
  set('CARD', 'CARD_RATE', band(compact ? 36 : 40, 4, 1)); set('CARD', 'DEL_SPEED', band(120, 10, 0)); set('CARD', 'CYL_RPM', band(450, 20, 0)); set('CARD', 'LICKER_RPM', band(900, 40, 0));
  set('CARD', 'FLAT_SPEED', band(220, 20, 0)); set('CARD', 'CYL_FLAT_GAUGE', band(0.25, 0.03, 2)); set('CARD', 'CARD_DRAFT', band(120, 10, 1)); set('CARD', 'FLAT_STRIP_PCT', maxOnly(1.1, 1.6, 2));
  for (const s of ['DFB', 'DFF'] as Stage[]) {
    set(s, 'DEL_SPEED', band(s === 'DFB' ? 350 : 400, 30, 0)); set(s, 'TOTAL_DRAFT', band(s === 'DFB' ? 6.5 : 7.5, 0.4, 2)); set(s, 'BREAK_DRAFT', band(s === 'DFB' ? 1.6 : 1.3, 0.1, 2));
    set(s, 'ROLLER_GAUGE', band(40, 2, 1)); set(s, 'DOUBLINGS', band(6, 0, 0)); set(s, 'HANK_SET', band(ne >= 40 ? 0.115 : ne >= 30 ? 0.12 : 0.125, 0.004, 3));
  }
  set('COMB', 'NIPS_MIN', band(400, 20, 0)); set('COMB', 'FEED_NIP', band(5.9, 0.3, 2)); set('COMB', 'COMB_RATE', band(30, 3, 1));
  set('FF', 'FLYER_RPM', band(ne >= 40 ? 1100 : 1000, 50, 0)); set('FF', 'TPI_SET', band(ne >= 40 ? 1.2 : 1.1, 0.05, 2)); set('FF', 'TOTAL_DRAFT', band(8.2, 0.4, 2)); set('FF', 'BREAK_DRAFT', band(1.2, 0.05, 2));
  set('FF', 'ROLLER_GAUGE', band(44, 2, 1)); set('FF', 'HANK_SET', band(ne >= 40 ? 1.2 : ne >= 30 ? 1.05 : 0.9, 0.03, 3)); set('FF', 'BREAKS_100SH', maxOnly(1.6, 3.0, 1));
  set('RF', 'SPINDLE_RPM', band(spindle, 500, 0)); set('RF', 'TPI_SET', band(tpiSet, tpiSet * 0.02, 2)); set('RF', 'TOTAL_DRAFT', band(r(ne / (ne >= 40 ? 1.2 : ne >= 30 ? 1.05 : 0.9), 1), 1.5, 2));
  set('RF', 'BREAK_DRAFT', band(1.18, 0.06, 2)); set('RF', 'ROLLER_GAUGE', band(ne >= 40 ? 44 : 46, 1.5, 1)); set('RF', 'RING_DIA', band(ne >= 40 ? 36 : ne >= 30 ? 38 : 42, 0.2, 1));
  set('RF', 'BOBBIN_LEAD', band(5.5, 0.5, 1)); set('RF', 'TOP_ARM_KG', band(compact ? 14 : 13.5, 0.7, 1)); set('RF', 'BREAKS_100SH', maxOnly(r(ne >= 40 ? 18 : 14, 0), r(ne >= 40 ? 28 : 22, 0), 1));
  set('AW', 'WIND_SPEED', band(1100, 60, 0)); set('AW', 'TENSION', band(11, 1.5, 1)); set('AW', 'SPLICE_AIR', band(5.5, 0.4, 1));
  return t;
}

function accessoriesTable(c: CountSpec): Record<string, Tri> {
  const { ne, compact } = c;
  const net = c.id === '20S' ? 2.5 : c.id === '30CH' ? 2.0 : 2.08;
  const cones = c.id === '20S' ? 20 : c.id === '30CH' ? 25 : 24;
  const tare = c.id === '20S' ? 1.1 : 1.0;
  const gross = r(net * cones + tare, 2);
  return {
    'RF.TRAVELLER_AGE_DAYS': maxOnly(10, ne >= 40 ? 14 : 18, 0), 'RF.COT_BUFF_AGE_DAYS': maxOnly(20, 30, 0), 'RF.COT_AGE_DAYS': maxOnly(90, 120, 0), 'RF.APRON_AGE_DAYS': maxOnly(60, 90, 0), 'RF.SPACER_MM': band(compact ? 2.0 : 2.5, 0.1, 2),
    'FF.COT_BUFF_AGE_DAYS': maxOnly(25, 35, 0), 'FF.COT_AGE_DAYS': maxOnly(100, 140, 0), 'FF.APRON_AGE_DAYS': maxOnly(70, 100, 0),
    'DFB.COT_BUFF_AGE_DAYS': maxOnly(30, 45, 0), 'DFB.COT_AGE_DAYS': maxOnly(120, 160, 0), 'DFF.COT_BUFF_AGE_DAYS': maxOnly(30, 45, 0), 'DFF.COT_AGE_DAYS': maxOnly(120, 160, 0),
    'CARD.WIRE_AGE_DAYS': maxOnly(300, 420, 0), 'CARD.FLAT_GRIND_AGE_DAYS': maxOnly(60, 90, 0),
    'PACK.NET_WT_CONE': band(net, 0.05, 2), 'PACK.CONES_PER_CARTON': band(cones, 0, 0), 'PACK.CARTON_TARE': band(tare, 0.1, 2), 'PACK.CARTON_NET': band(r(net * cones, 2), 0.4, 2), 'PACK.CARTON_GROSS': band(gross, 0.5, 2),
  };
}

export function buildItems(c: CountSpec): SpecItem[] {
  const out: SpecItem[] = [];
  const push = (master: MasterType, table: Record<string, Tri>, frequency?: (s: string) => string, instrument?: (s: string) => string) => {
    for (const [path, [std, lower, upper]] of Object.entries(table)) {
      const [scope, key] = path.split('.') as [Scope, string];
      const unit = paramDef(key)?.unit ?? '';
      out.push({ master, scope, key, std, lower, upper, unit, frequency: frequency?.(scope) ?? '', instrument: instrument?.(scope) ?? '' });
    }
  };
  const q = qualityTable(c);
  const quality: Record<string, Tri> = {}; const mix: Record<string, Tri> = {};
  for (const [p, v] of Object.entries(q)) (p.startsWith('MIX.') ? mix : quality)[p] = v;
  push('QUALITY', quality, (s) => FREQ[s] ?? 'Every shift', (s) => INSTR[s] ?? '');
  push('COUNT_MIX', mix, () => 'Every mix', () => 'HVI 1000');
  push('PRODUCTION', productionTable(c), (s) => (s === 'RF' ? 'Every shift per frame' : 'Every shift'));
  push('ACCESSORIES', accessoriesTable(c), () => 'Weekly check');
  return out.filter((i) => (i.scope !== 'COMB' || c.comber));
}

export function countMixMeta(c: CountSpec): CountMixMeta {
  const recipes: Record<string, CountMixMeta['recipe']> = {
    '20S': [
      { key: 'SHANKAR6', label: 'Shankar-6', source: 'BALE', variety: 'Shankar-6', pct: 55, minPct: 50, maxPct: 60 },
      { key: 'MCU5', label: 'MCU-5', source: 'BALE', variety: 'MCU-5', pct: 25, minPct: 20, maxPct: 30 },
      { key: 'RECYCLED', label: 'Recycled blow-room & card waste', source: 'WASTE', pct: 20, minPct: 15, maxPct: 25 },
    ],
    '30CH': [
      { key: 'SHANKAR6', label: 'Shankar-6', source: 'BALE', variety: 'Shankar-6', pct: 60, minPct: 55, maxPct: 65 },
      { key: 'MCU5', label: 'MCU-5', source: 'BALE', variety: 'MCU-5', pct: 30, minPct: 25, maxPct: 35 },
      { key: 'RECYCLED', label: 'Recycled blow-room & card waste', source: 'WASTE', pct: 10, minPct: 5, maxPct: 15 },
    ],
    '40CH': [
      { key: 'SHANKAR6', label: 'Shankar-6', source: 'BALE', variety: 'Shankar-6', pct: 60, minPct: 55, maxPct: 65 },
      { key: 'DCH32', label: 'DCH-32', source: 'BALE', variety: 'DCH-32', pct: 30, minPct: 25, maxPct: 35 },
      { key: 'RECYCLED', label: 'Recycled blow-room & card waste', source: 'WASTE', pct: 10, minPct: 5, maxPct: 15 },
    ],
    '40CP': [
      { key: 'DCH32', label: 'DCH-32', source: 'BALE', variety: 'DCH-32', pct: 65, minPct: 60, maxPct: 70 },
      { key: 'SUVIN', label: 'Suvin', source: 'BALE', variety: 'Suvin', pct: 25, minPct: 20, maxPct: 30 },
      { key: 'NOIL', label: 'Comber noil (own)', source: 'WASTE', pct: 10, minPct: 5, maxPct: 15 },
    ],
  };
  const realization = c.compact ? 72.5 : 86.5;
  return {
    route: routeFor(c.comber), usesComber: c.comber, recipe: recipes[c.id] ?? recipes[c.comber ? '40CP' : c.ne >= 30 ? '30CH' : '20S'],
    targetWastePct: r(100 - realization, 1), targetRealizationPct: realization,
    notes: c.comber ? 'Combed + compact-spun; comber noil is re-blended at 10%.' : 'Carded hosiery yarn; recycled waste re-blended within the recipe band.',
  };
}

export function accessoriesMeta(c: CountSpec): AccessoriesMeta {
  return {
    packageType: 'CONE', coneType: c.compact ? 'Plastic cone 4°20′ (compact, antistatic)' : 'Plastic cone 4°20′', cartonType: '5-ply export carton, 50 kg class',
    polybag: 'LDPE 60 micron, 3 cones separators', strapping: 'PP strap, 2 straps', labelTemplate: `LBL-${c.id}-V1`, qrLabel: true, palletWrap: 'Stretch wrap, 3 layers, 20 cartons/pallet',
    travellerType: c.ne >= 40 ? 'Bracker C1 EL 4/0' : c.ne >= 30 ? 'Bracker C1 EL 2/0' : 'Bracker C1 EL 6', travellerNo: c.ne >= 40 ? '4/0' : c.ne >= 30 ? '2/0' : '6', clearerClass: c.compact ? 'Classimat A4/B3/C2/D1' : 'Classimat A4/B4/C3/D2',
  };
}

export const COLOR_OF: Record<string, ColorMeta> = {
  '20S': { colorName: 'Orange', hex: '#f97316', tip: 'Orange tip cone', code: 'OR-20' },
  '30CH': { colorName: 'Blue', hex: '#2563eb', tip: 'Blue tip cone', code: 'BL-30' },
  '40CH': { colorName: 'Green', hex: '#16a34a', tip: 'Green tip cone', code: 'GR-40' },
  '40CP': { colorName: 'Violet', hex: '#7c3aed', tip: 'Violet tip cone (compact)', code: 'VI-40C' },
  '16S': { colorName: 'Red', hex: '#dc2626', tip: 'Red tip cone', code: 'RD-16' },
  '24CH': { colorName: 'Yellow', hex: '#eab308', tip: 'Yellow tip cone', code: 'YL-24' },
  '34CH': { colorName: 'Teal', hex: '#0d9488', tip: 'Teal tip cone', code: 'TL-34' },
  '30CP': { colorName: 'Pink', hex: '#db2777', tip: 'Pink tip cone (compact)', code: 'PK-30C' },
  '50CP': { colorName: 'Brown', hex: '#92400e', tip: 'Brown tip cone (compact)', code: 'BR-50C' },
  '60CP': { colorName: 'Grey', hex: '#6b7280', tip: 'Grey tip cone (compact)', code: 'GY-60C' },
};
