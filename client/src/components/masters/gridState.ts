import { useCallback, useMemo, useRef, useState } from 'react';
import { STAGES } from '@shared/params';
import { parseNum } from './common';
import type { MasterRow } from './types';

export type Field = 'std' | 'lower' | 'upper' | 'frequency' | 'instrument' | 'note';
export const FIELDS: Field[] = ['std', 'lower', 'upper', 'frequency', 'instrument', 'note'];
const NUMERIC = new Set<Field>(['std', 'lower', 'upper']);
export type RowEdit = Partial<Record<Field, string>>;
export type Edits = Record<string, RowEdit>;
export interface RowErrors { std?: string; lower?: string; upper?: string; row?: string }

export const rowKeyOf = (r: Pick<MasterRow, 'scope' | 'parameter'>) => `${r.scope}|${r.parameter}`;
const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
export const origOf = (r: MasterRow): Record<Field, string> => ({ std: s(r.std), lower: s(r.lower), upper: s(r.upper), frequency: r.frequency ?? '', instrument: r.instrument ?? '', note: r.note ?? '' });
export const valuesOf = (r: MasterRow, e: RowEdit | undefined): Record<Field, string> => ({ ...origOf(r), ...(e ?? {}) });

const sameValue = (f: Field, a: string, b: string): boolean => {
  if (!NUMERIC.has(f)) return a === b;
  const x = parseNum(a); const y = parseNum(b);
  return (x === null && y === null) || (x !== null && y !== null && !Number.isNaN(x) && !Number.isNaN(y) && x === y) || a.trim() === b.trim();
};

const fmt = (n: number) => String(Number(n.toFixed(6)));
/** Live validation of one edited row (same rules as the contract: std required, lower ≤ std ≤ upper, at least one limit). */
export function validateValues(v: Record<Field, string>): RowErrors | null {
  const e: RowErrors = {};
  const std = parseNum(v.std); const lo = parseNum(v.lower); const up = parseNum(v.upper);
  if (std === null) e.std = 'Standard value is required'; else if (Number.isNaN(std)) e.std = 'Standard must be a number';
  if (lo !== null && Number.isNaN(lo)) e.lower = 'Lower limit must be a number';
  if (up !== null && Number.isNaN(up)) e.upper = 'Upper limit must be a number';
  if (!e.std && !e.lower && !e.upper) {
    const sd = std as number;
    if (lo === null && up === null) e.row = 'Enter at least one limit (lower or upper)';
    if (lo !== null && lo > sd) e.lower = `Lower limit must be ≤ the standard (${fmt(sd)})`;
    if (up !== null && sd > up) e.upper = `Upper limit must be ≥ the standard (${fmt(sd)})`;
    if (lo !== null && up !== null && lo > up && !e.lower && !e.upper) e.upper = 'Upper limit must be ≥ the lower limit';
  }
  return Object.keys(e).length ? e : null;
}
export const firstError = (e: RowErrors | null | undefined): string | null => (e ? e.std ?? e.lower ?? e.upper ?? e.row ?? null : null);

/** Sort rows by process stage (mix first), keeping the master-template order within a stage. */
export function sortRows(rows: MasterRow[]): MasterRow[] {
  const idx = (r: MasterRow) => (r.scope === 'MIX' ? -1 : STAGES.indexOf(r.scope));
  return rows.map((r, i) => ({ r, i })).sort((a, b) => idx(a.r) - idx(b.r) || a.i - b.i).map((x) => x.r);
}

export interface GridState {
  edits: Edits;
  errors: Record<string, RowErrors>;
  dirtyKeys: string[];
  invalidKeys: string[];
  setField: (key: string, field: Field, value: string) => void;
  setMany: (entries: [string, Field, string][]) => number;
  revertRow: (key: string) => void;
  reset: () => void;
}

/** Edit buffer of the spreadsheet grid: only changed cells are stored; dirty rows are validated live. */
export function useGridEdits(rows: MasterRow[]): GridState {
  const [edits, setEdits] = useState<Edits>({});
  const rowsRef = useRef(new Map<string, MasterRow>());
  rowsRef.current = new Map(rows.map((r) => [rowKeyOf(r), r]));

  const apply = (prev: Edits, entries: [string, Field, string][]): Edits => {
    const next: Edits = { ...prev };
    for (const [key, field, value] of entries) {
      const row = rowsRef.current.get(key); if (!row) continue;
      const cur: RowEdit = { ...(next[key] ?? {}) };
      if (sameValue(field, value, origOf(row)[field])) delete cur[field]; else cur[field] = value;
      if (Object.keys(cur).length) next[key] = cur; else delete next[key];
    }
    return next;
  };
  const setField = useCallback((key: string, field: Field, value: string) => setEdits((p) => apply(p, [[key, field, value]])), []);
  const setMany = useCallback((entries: [string, Field, string][]) => { setEdits((p) => apply(p, entries)); return entries.length; }, []);
  const revertRow = useCallback((key: string) => setEdits((p) => { const n = { ...p }; delete n[key]; return n; }), []);
  const reset = useCallback(() => setEdits({}), []);

  const errors = useMemo(() => {
    const out: Record<string, RowErrors> = {};
    for (const [key, e] of Object.entries(edits)) { const row = rowsRef.current.get(key); if (!row) continue; const err = validateValues(valuesOf(row, e)); if (err) out[key] = err; }
    return out;
  }, [edits, rows]);
  return { edits, errors, dirtyKeys: Object.keys(edits), invalidKeys: Object.keys(errors), setField, setMany, revertRow, reset };
}

/** Request body rows for the changed lines only. */
export function changedItems(rows: MasterRow[], g: GridState) {
  return rows.filter((r) => g.edits[rowKeyOf(r)]).map((r) => { const v = valuesOf(r, g.edits[rowKeyOf(r)]); return { scope: r.scope, parameter: r.parameter, std: parseNum(v.std) as number, lower: parseNum(v.lower), upper: parseNum(v.upper), unit: r.unit, frequency: v.frequency, instrument: v.instrument, note: v.note }; });
}
