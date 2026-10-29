export { fmtD, fmtDT, fmtDTShort, fmtT, fmtDuration, istDate, shortHash } from '@shared/format';
export const kg = (n: number | null | undefined, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })} kg`);
export const num = (n: number | null | undefined, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${n.toFixed(d)}%`);
export const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/** `<input type="datetime-local">` values are mill time (IST): convert to and from ISO instants. */
export const istLocalToIso = (local: string): string => new Date(`${local}:00+05:30`).toISOString();
export const isoToIstLocal = (iso: string): string => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 16);
