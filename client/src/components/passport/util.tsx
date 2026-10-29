import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react';
import type { Judged, QualityColor } from '@shared/domain';
import { PARAMS, STAGE_INFO, type Stage } from '@shared/params';
import { ColorIcon, StageIcon } from '../ui';
import './passport.css';

export { worstColor } from '@shared/quality';

// ------------------------------------------------------------------ number / range helpers (display only — judging happens on the server)
export const fmtN = (v: number | null | undefined, d = 1): string => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtKg = (v: number | null | undefined, d = 1): string => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${fmtN(v, d)} kg`);

/** "5.91 – 6.81", "≤ 14", "≥ 80" or "—" for a master band. */
export function rangeText(j: Pick<Judged, 'lower' | 'upper' | 'decimals'>): string {
  const f = (v: number) => fmtN(v, j.decimals);
  if (j.lower !== null && j.upper !== null) return `${f(j.lower)} – ${f(j.upper)}`;
  if (j.upper !== null) return `≤ ${f(j.upper)}`;
  if (j.lower !== null) return `≥ ${f(j.lower)}`;
  return '—';
}
/** "+0.51 (+4.9%)" — ASCII signs so the text is safe for CSV / PDF. */
export function devText(j: Judged): string {
  if (j.deviation === null) return '—';
  const s = j.deviation > 0 ? '+' : j.deviation < 0 ? '-' : '';
  const pct = j.deviationPct === null ? '' : ` (${j.deviationPct > 0 ? '+' : j.deviationPct < 0 ? '-' : ''}${Math.abs(j.deviationPct).toFixed(1)}%)`;
  return `${s}${fmtN(Math.abs(j.deviation), j.decimals)}${pct}`;
}
export const verText = (j: Judged): string => (j.versionNo ? `v${j.versionNo}` : '—');
export const cellVal = (j: Judged | undefined | null): number | null => (j && j.value !== null ? j.value : null);

export function tally(items: { color: QualityColor }[]): { red: number; yellow: number } {
  let red = 0; let yellow = 0;
  for (const i of items) { if (i.color === 'red') red++; else if (i.color === 'yellow') yellow++; }
  return { red, yellow };
}

/** Canonical parameter order (the order of `PARAMS`) so unions of columns are stable. */
export const PARAM_ORDER: Map<string, number> = new Map(PARAMS.map((p, i) => [p.key, i]));
export const byParamOrder = (a: string, b: string): number => (PARAM_ORDER.get(a) ?? 999) - (PARAM_ORDER.get(b) ?? 999);

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------ CSV
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const esc = (x: string | number | null | undefined) => { const s = x === null || x === undefined ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

// ------------------------------------------------------------------ print helpers
/** Sets the paper size while a page is mounted (e.g. 'A4 landscape') without touching other pages' printing. */
export function usePrintPageStyle(size: string): void {
  useEffect(() => {
    const el = document.createElement('style');
    el.setAttribute('data-pp-page', '');
    el.textContent = `@page { size: ${size}; margin: 9mm; }`;
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, [size]);
}
/** Printing always uses the light theme (dark backgrounds would waste ink and hide text on white paper). */
export function useLightPrint(): void {
  useEffect(() => {
    const root = document.documentElement; let was = false;
    const before = () => { was = root.classList.contains('dark'); root.classList.remove('dark'); };
    const after = () => { if (was) root.classList.add('dark'); };
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);
}

// ------------------------------------------------------------------ small presentational pieces
export function CountPills({ red, yellow, ok = 'All within limits' }: { red: number; yellow: number; ok?: string }): JSX.Element {
  if (!red && !yellow) return <span className="pill green"><CheckCircle2 size={12} /> {ok}</span>;
  return <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
    {red ? <span className="pill red" title={`${red} reading${red === 1 ? '' : 's'} outside the master limits`}><XCircle size={12} /> {red} red</span> : null}
    {yellow ? <span className="pill yellow" title={`${yellow} reading${yellow === 1 ? '' : 's'} in the warning zone (last 20% of the tolerance band)`}><AlertTriangle size={12} /> {yellow} yellow</span> : null}
  </span>;
}

export const StatusText = ({ j }: { j: Judged }): JSX.Element => <span className={`pp-st ${j.color}`}><ColorIcon color={j.color} size={12} /> {j.text}</span>;

export const StageTag = ({ stage, label }: { stage: Stage; label?: string }): JSX.Element => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><StageIcon stage={stage} size={14} /> {label ?? STAGE_INFO[stage].label}</span>;

/** Collapsible block whose body stays in the DOM (so it prints) — toggled with inline display. */
export function PrintCollapse({ title, right, defaultOpen = true, children }: { title: ReactNode; right?: ReactNode; defaultOpen?: boolean; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return <div className="pp-collapse">
    <button type="button" className="pp-collapse-head" onClick={() => setOpen(!open)} aria-expanded={open}>
      {open ? <ChevronDown size={14} className="chev" /> : <ChevronRight size={14} className="chev" />}
      <span className="grow">{title}</span>{right ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{right}</span> : null}
    </button>
    <div className="pp-collapse-body" style={{ display: open ? 'block' : 'none', paddingBottom: 8 }}>{children}</div>
  </div>;
}

/** Label / value pair used in fact grids (a little richer than ui `Fact`: allows nodes and a sub line). */
export const KV = ({ label, children, sub, title }: { label: string; children: ReactNode; sub?: ReactNode; title?: string }): JSX.Element => <div className="pp-kv" title={title}><span>{label}</span><b>{children}</b>{sub ? <small>{sub}</small> : null}</div>;

export type PassportTab = 'quality' | 'production' | 'accessories';
export const TAB_LABEL: Record<PassportTab, string> = { quality: 'Quality', production: 'Production', accessories: 'Accessories & packing' };

/** Display status for a lot status code. */
export const LOT_STATUS: Record<string, { label: string; tone: QualityColor | 'blue' | 'gray' }> = {
  PLANNED: { label: 'Planned', tone: 'gray' }, IN_PRODUCTION: { label: 'In production', tone: 'blue' }, PACKED: { label: 'Packed', tone: 'blue' },
  ON_HOLD: { label: 'On QA hold', tone: 'red' }, DISPATCHED: { label: 'Dispatched', tone: 'yellow' }, DELIVERED: { label: 'Delivered', tone: 'green' },
};
