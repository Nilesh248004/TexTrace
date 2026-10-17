// Formatting / parsing helpers shared by client and server. Pure functions, no Node or DOM APIs.

/** ISO date (YYYY-MM-DD or full ISO) -> DD/MM/YYYY (Indian format used across the mill). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** ISO timestamp -> DD/MM/YYYY HH:mm (local time). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** DD/MM/YYYY -> YYYY-MM-DD (returns null when invalid). */
export function parseDisplayDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const iso = `${m[3]}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(dd)) return null;
  return iso;
}

/** Add days to a YYYY-MM-DD date (UTC-safe). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function shortHash(hash: string | null | undefined, n = 10): string {
  if (!hash) return '—';
  const h = hash.startsWith('0x') ? hash.slice(2) : hash;
  return `0x${h.slice(0, n)}…`;
}

export function formatKg(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || Number.isNaN(kg)) return '—';
  return `${kg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`;
}

// ---------------------------------------------------------------------------------------------
// Complaint numbers: NN/YYYY (e.g. 22/2026). Sequence restarts each year.
export function formatComplaintNo(seq: number, year: number): string {
  return `${String(seq).padStart(2, '0')}/${year}`;
}

export function parseComplaintNo(no: string): { seq: number; year: number } | null {
  const m = /^(\d{1,4})\/(\d{4})$/.exec(no.trim());
  return m ? { seq: Number(m[1]), year: Number(m[2]) } : null;
}

// ---------------------------------------------------------------------------------------------
// Lot numbers. Both formats are configurable via settings (`lotNoFormat`, `lotCodeFormat`).
// Tokens: {seq} {seq3} (zero-padded to 3) {yyyy} {yy} {count} (e.g. 30CH) {mark} (mill mark, e.g. X) {batch} (e.g. 001)
export const DEFAULT_LOT_NO_FORMAT = '{seq}/{yyyy}'; // 182/2026
export const DEFAULT_LOT_CODE_FORMAT = '{count} {seq} {mark}/{yy} {batch}'; // 30CH 182 X/26 001

export interface LotFormatVars {
  seq: number;
  year: number;
  count: string; // count id, e.g. '30CH'
  mark?: string;
  batch?: number;
}

export function formatLotTemplate(template: string, v: LotFormatVars): string {
  const yyyy = String(v.year);
  return template
    .replace(/\{seq3\}/g, String(v.seq).padStart(3, '0'))
    .replace(/\{seq\}/g, String(v.seq))
    .replace(/\{yyyy\}/g, yyyy)
    .replace(/\{yy\}/g, yyyy.slice(-2))
    .replace(/\{count\}/g, v.count)
    .replace(/\{mark\}/g, v.mark ?? 'X')
    .replace(/\{batch\}/g, String(v.batch ?? 1).padStart(3, '0'));
}

/** Normalize a lot search string for comparisons (case/whitespace-insensitive). */
export function normalizeLotQuery(q: string): string {
  return q.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Extract the lot sequence (and year if present) from user input in any supported format:
 * "182/2026", "182", "30CH 182 X/26 001", "30 CH 182".
 */
export function parseLotQuery(q: string): { seq: number | null; year: number | null } {
  const s = normalizeLotQuery(q);
  let m = /^(\d{1,5})\s*\/\s*(\d{4})$/.exec(s);
  if (m) return { seq: Number(m[1]), year: Number(m[2]) };
  m = /^(\d{1,5})$/.exec(s);
  if (m) return { seq: Number(m[1]), year: null };
  // code format: <count> <seq> <mark>/<yy> <batch>
  m = /^\d+\s?[A-Z]{1,3}\s+(\d{1,5})(?:\s+[A-Z]+\s*\/\s*(\d{2}))?/.exec(s);
  if (m) return { seq: Number(m[1]), year: m[2] ? 2000 + Number(m[2]) : null };
  return { seq: null, year: null };
}

/** "30CH" -> "30 CH" */
export function displayCount(countId: string): string {
  const m = /^(\d+)([A-Z]+)$/.exec(countId);
  return m ? `${m[1]} ${m[2]}` : countId;
}
