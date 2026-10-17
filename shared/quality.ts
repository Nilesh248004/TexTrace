// Tolerance / color evaluation. Used by the server (quality gate, AI engine, alerts) and the client (every colored cell).
//
// GREEN  = within [lower, upper] and NOT in a warning zone.
// YELLOW = within limits but in the warning zone: the last `warnFraction` (default 20%) of the band toward either limit.
// RED    = outside the limits.
// NONE   = no value or no applicable standard.
//
// Two-sided band (lower and upper both set): warn width = warnFraction * (upper - lower), applied at each end.
//   e.g. RF U%: std 10.5, lower 10.3, upper 10.8 -> width 0.5, warn 0.1 -> YELLOW in [10.3,10.4) and (10.7,10.8].
// One-sided (only upper, e.g. thin places max 5, std 2): YELLOW when value > upper - warnFraction * (upper - std).
// One-sided (only lower, e.g. CSP min 2150, std 2250): YELLOW when value < lower + warnFraction * (std - lower).
// Values exactly on a limit are within limits (YELLOW). A value exactly on a warning boundary is GREEN.

export type QualityColor = 'green' | 'yellow' | 'red' | 'none';

export interface Limits {
  std: number;
  lower: number | null;
  upper: number | null;
}

export interface Evaluation {
  color: QualityColor;
  /** Human label, always shown alongside the color (never color alone). */
  label: 'Within limits' | 'Warning' | 'Out of limits' | 'No standard' | 'No data';
  /** 'low' | 'high' when the value is in a warning zone or out of limits on that side. */
  side: 'low' | 'high' | null;
  /** value - std (null when not computable). */
  deviation: number | null;
  /** (value - std) / std * 100 */
  deviationPct: number | null;
  /**
   * Signed normalized position: 0 at std, +/-1 at the upper/lower limit (|x| > 1 means out of limits).
   * For a one-sided standard the missing side is normalized by the present side's half-width.
   */
  normalized: number | null;
}

export const DEFAULT_WARN_FRACTION = 0.2;
const EPS = 1e-9;

export const COLOR_LABEL: Record<QualityColor, Evaluation['label']> = {
  green: 'Within limits',
  yellow: 'Warning',
  red: 'Out of limits',
  none: 'No standard',
};

/** Icon name hints (lucide-react) per color, so UI never relies on color alone. */
export const COLOR_ICON: Record<QualityColor, 'CheckCircle2' | 'AlertTriangle' | 'XCircle' | 'MinusCircle'> = {
  green: 'CheckCircle2',
  yellow: 'AlertTriangle',
  red: 'XCircle',
  none: 'MinusCircle',
};

/** Text symbol per color for CSV/PDF exports. */
export const COLOR_SYMBOL: Record<QualityColor, string> = { green: 'OK', yellow: 'WARN', red: 'OUT', none: '-' };

/** RGB used by PDF exports (jsPDF) — light fills that keep black text readable. */
export const COLOR_RGB: Record<QualityColor, [number, number, number]> = {
  green: [209, 250, 229],
  yellow: [254, 243, 199],
  red: [254, 226, 226],
  none: [243, 244, 246],
};

export function evaluate(
  value: number | null | undefined,
  limits: Limits | null | undefined,
  warnFraction: number = DEFAULT_WARN_FRACTION,
): Evaluation {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return { color: 'none', label: 'No data', side: null, deviation: null, deviationPct: null, normalized: null };
  }
  if (!limits || (limits.lower === null && limits.upper === null)) {
    return { color: 'none', label: 'No standard', side: null, deviation: null, deviationPct: null, normalized: null };
  }
  const { std, lower, upper } = limits;
  const deviation = value - std;
  const deviationPct = std !== 0 ? (deviation / std) * 100 : null;
  const normalized = normalize(value, limits);
  const base = { deviation, deviationPct, normalized };

  if (lower !== null && value < lower - EPS) return { color: 'red', label: 'Out of limits', side: 'low', ...base };
  if (upper !== null && value > upper + EPS) return { color: 'red', label: 'Out of limits', side: 'high', ...base };

  const f = clampFraction(warnFraction);
  if (lower !== null && upper !== null) {
    const width = upper - lower;
    if (width <= EPS) {
      // Degenerate band (fixed value, e.g. doublings = 8): equal -> green.
      return { color: 'green', label: 'Within limits', side: null, ...base };
    }
    const warn = f * width;
    if (value < lower + warn - EPS) return { color: 'yellow', label: 'Warning', side: 'low', ...base };
    if (value > upper - warn + EPS) return { color: 'yellow', label: 'Warning', side: 'high', ...base };
    return { color: 'green', label: 'Within limits', side: null, ...base };
  }
  if (upper !== null) {
    const half = Math.max(upper - std, 0);
    if (half > EPS && value > upper - f * half + EPS) return { color: 'yellow', label: 'Warning', side: 'high', ...base };
    return { color: 'green', label: 'Within limits', side: null, ...base };
  }
  // only lower
  const half = Math.max(std - (lower as number), 0);
  if (half > EPS && value < (lower as number) + f * half - EPS) return { color: 'yellow', label: 'Warning', side: 'low', ...base };
  return { color: 'green', label: 'Within limits', side: null, ...base };
}

function clampFraction(f: number): number {
  if (!Number.isFinite(f)) return DEFAULT_WARN_FRACTION;
  return Math.min(Math.max(f, 0), 0.5);
}

/** Signed normalized distance from std: +/-1 at the limit on that side. */
export function normalize(value: number, limits: Limits): number | null {
  const { std, lower, upper } = limits;
  const upHalf = upper !== null ? upper - std : null;
  const lowHalf = lower !== null ? std - lower : null;
  if (value >= std) {
    const h = upHalf !== null && upHalf > EPS ? upHalf : lowHalf !== null && lowHalf > EPS ? lowHalf : null;
    if (h === null) return value === std ? 0 : null;
    return (value - std) / h;
  }
  const h = lowHalf !== null && lowHalf > EPS ? lowHalf : upHalf !== null && upHalf > EPS ? upHalf : null;
  if (h === null) return null;
  return (value - std) / h;
}

const SEVERITY: Record<QualityColor, number> = { none: 0, green: 1, yellow: 2, red: 3 };

/** Worst color of a set (red > yellow > green > none). */
export function worstColor(colors: QualityColor[]): QualityColor {
  let worst: QualityColor = 'none';
  for (const c of colors) if (SEVERITY[c] > SEVERITY[worst]) worst = c;
  return worst;
}

export function colorSeverity(c: QualityColor): number {
  return SEVERITY[c];
}

/** Minimal shape of a standard needed for lookups (matches shared/types Standard). */
export interface StandardLike extends Limits {
  countId: string;
  department: string;
  parameter: string;
  active?: boolean;
}

/** Build a lookup `${department}:${parameter}` -> limits for one count. Inactive standards are ignored. */
export function buildStandardIndex<T extends StandardLike>(standards: T[], countId?: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const s of standards) {
    if (s.active === false) continue;
    if (countId && s.countId !== countId) continue;
    m.set(`${s.department}:${s.parameter}`, s);
  }
  return m;
}

export function lookupStandard<T extends StandardLike>(index: Map<string, T>, department: string, parameter: string): T | undefined {
  return index.get(`${department}:${parameter}`);
}

/** Evaluate every value in a record (e.g. TestResult.values) for a department. */
export function evaluateValues<T extends StandardLike>(
  values: Record<string, number | null | undefined>,
  department: string,
  index: Map<string, T>,
  warnFraction: number = DEFAULT_WARN_FRACTION,
): Record<string, Evaluation> {
  const out: Record<string, Evaluation> = {};
  for (const [k, v] of Object.entries(values)) out[k] = evaluate(v, lookupStandard(index, department, k) ?? null, warnFraction);
  return out;
}
