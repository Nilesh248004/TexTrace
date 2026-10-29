import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Save, Undo2, XCircle } from 'lucide-react';
import { paramDef } from '@shared/params';
import { useMut } from '../../lib/api';
import { Notice, Pill, Seg, StageIcon } from '../ui';
import { errMsg, parseNum, scopeLabel, useCan } from './common';
import { FIELDS, changedItems, firstError, rowKeyOf, sortRows, valuesOf, type Field, type GridState, type RowEdit, type RowErrors } from './gridState';
import type { MasterRow } from './types';
import './masters.css';

type Only = 'all' | 'missing' | 'invalid' | 'changed';
const NUM_FIELDS = new Set<Field>(['std', 'lower', 'upper']);
const COL_LABEL: Record<Field, string> = { std: 'Std', lower: 'Lower', upper: 'Upper', frequency: 'Frequency', instrument: 'Instrument', note: 'Note' };

function Delta({ label, cur, prev }: { label: string; cur: number | null; prev: number | null | undefined }): JSX.Element | null {
  if (prev === undefined) return null;
  if (cur === null && prev === null) return null;
  if (cur !== null && Number.isNaN(cur)) return null;
  if (cur === null) return <span className="pill gray" title={`${label} limit removed (was ${prev})`}>{label} removed</span>;
  if (prev === null) return <span className="pill blue" title={`${label} limit added`}>{label} new</span>;
  const d = cur - prev; if (Math.abs(d) < 1e-9) return null;
  const txt = `${d > 0 ? '+' : '−'}${String(Number(Math.abs(d).toFixed(4)))}`;
  return <span className={`pill ${d > 0 ? 'blue' : 'yellow'}`} title={`${label}: now ${cur}, was ${prev}`}>{d > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}{label} {txt}</span>;
}

interface RowProps { row: MasterRow; ri: number; edit: RowEdit | undefined; errors: RowErrors | undefined; editable: boolean; onChange: (key: string, f: Field, v: string) => void; onRevert: (key: string) => void }
const GridRow = memo(function GridRow({ row, ri, edit, errors, editable, onChange, onRevert }: RowProps) {
  const vals = valuesOf(row, edit); const dirty = Object.keys(edit ?? {}) as Field[];
  const key = rowKeyOf(row); const def = paramDef(row.parameter);
  const std = parseNum(vals.std); const lo = parseNum(vals.lower); const up = parseNum(vals.upper);
  const untouchedMissing = row.missing && dirty.length === 0;
  const msg = firstError(errors);
  const cls = `${untouchedMissing ? 'missing' : ''} ${dirty.length ? 'changed' : ''} ${errors ? 'invalid' : ''}`;
  const cell = (f: Field, ci: number) => {
    const bad = !!errors && !!((f === 'std' && errors.std) || (f === 'lower' && (errors.lower || errors.row)) || (f === 'upper' && (errors.upper || errors.row)));
    const text = !NUM_FIELDS.has(f);
    return <td key={f} className={text ? '' : 'num'} style={text ? undefined : { width: 84 }}>
      <input className={`mg-cell ${text ? 'text' : ''} ${dirty.includes(f) ? 'dirty' : ''} ${bad ? 'bad' : ''}`} value={vals[f]} disabled={!editable} data-r={ri} data-c={ci} inputMode={text ? 'text' : 'decimal'} spellCheck={false} autoComplete="off"
        data-testid={`cell-${row.scope}-${row.parameter}-${f}`} aria-label={`${row.label} ${COL_LABEL[f]}`} aria-invalid={bad || undefined} title={bad && msg ? msg : undefined}
        onChange={(e) => onChange(key, f, e.target.value)} onFocus={(e) => e.currentTarget.select()} />
    </td>;
  };
  return <tr className={`mg-row ${cls}`} data-testid="grid-row" data-key={key}>
    <td><div className="mg-param"><b>{row.label}{row.missing ? <Pill tone="yellow" title="This required item has no value yet — enter a standard and a limit">Missing</Pill> : null}{!row.required ? <span className="muted tiny" style={{ marginLeft: 6 }}>optional</span> : null}</b><span className="key">{row.parameter}</span>
      {msg ? <span className="mg-err" role="alert"><XCircle size={11} style={{ flex: 'none', marginTop: 1 }} />{msg}</span> : null}</div></td>
    <td className="muted small nowrap">{row.unit || '—'}</td>
    {cell('std', 0)}{cell('lower', 1)}{cell('upper', 2)}{cell('frequency', 3)}{cell('instrument', 4)}{cell('note', 5)}
    <td className="mg-prev">{row.prev ? row.prev.std : '—'}</td><td className="mg-prev">{row.prev ? row.prev.lower ?? '—' : '—'}</td><td className="mg-prev">{row.prev ? row.prev.upper ?? '—' : '—'}</td>
    <td><div className="mg-delta">{row.prev ? <><Delta label="Std" cur={std} prev={row.prev.std} /><Delta label="Low" cur={lo} prev={row.prev.lower} /><Delta label="Up" cur={up} prev={row.prev.upper} /></> : <span className="muted tiny">{row.missing ? '' : 'new item'}</span>}{dirty.length ? <button className="btn ghost sm icon" style={{ padding: 2 }} title="Undo changes to this row" aria-label="Undo row changes" onClick={() => onRevert(key)}><Undo2 size={12} /></button> : null}</div></td>
  </tr>;
});

/** Spreadsheet-style editor for master items: Tab / Enter / arrows move between cells, Excel blocks paste in, live validation, only changed rows are saved. */
export function MasterGrid({ versionId, rows: rawRows, grid, editable, prevVersionNo, toolbar, serverRev, onSaved, title = 'Master items' }: {
  versionId: string; rows: MasterRow[]; grid: GridState; editable: boolean; prevVersionNo: number | null; toolbar?: ReactNode; serverRev: unknown; onSaved?: (n: number) => void; title?: string;
}): JSX.Element {
  const rows = useMemo(() => sortRows(rawRows), [rawRows]);
  const [stage, setStage] = useState('ALL'); const [q, setQ] = useState(''); const [only, setOnly] = useState<Only>('all');
  const [note, setNote] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const perm = useCan('Master.upsertItems');
  const canEdit = editable && perm.can;
  const wrap = useRef<HTMLDivElement>(null);
  const save = useMut<{ items: ReturnType<typeof changedItems> }, { created: number; updated: number }>('PUT', `/api/masters/versions/${versionId}/items`, `Edit master items of ${versionId}`);
  const pendingClear = useRef(false);
  useEffect(() => { if (pendingClear.current) { pendingClear.current = false; grid.reset(); } }, [serverRev]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!grid.dirtyKeys.length) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [grid.dirtyKeys.length]);

  const stages = useMemo(() => [...new Set(rows.map((r) => r.scope))], [rows]);
  const missingN = rows.filter((r) => r.missing && !grid.edits[rowKeyOf(r)]).length;
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const k = rowKeyOf(r);
      if (stage !== 'ALL' && r.scope !== stage) return false;
      if (needle && !`${r.label} ${r.parameter} ${r.scope} ${scopeLabel(r.scope)} ${r.instrument} ${r.note}`.toLowerCase().includes(needle)) return false;
      if (only === 'missing') return r.missing && !grid.edits[k];
      if (only === 'invalid') return !!grid.errors[k];
      if (only === 'changed') return !!grid.edits[k];
      return true;
    });
  }, [rows, stage, q, only, grid.edits, grid.errors]);
  const visRef = useRef<MasterRow[]>([]); visRef.current = visible;

  const focusCell = useCallback((r: number, c: number) => {
    const el = wrap.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${Math.max(0, Math.min(FIELDS.length - 1, c))}"]`);
    if (el) { el.focus(); el.select(); }
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLInputElement; if (!(el instanceof HTMLInputElement) || el.dataset.r === undefined) return;
    const r = Number(el.dataset.r); const c = Number(el.dataset.c);
    const caretStart = el.selectionStart === 0 && el.selectionEnd === 0; const caretEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    if (e.key === 'Enter') { e.preventDefault(); focusCell(r + (e.shiftKey ? -1 : 1), c); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusCell(r + 1, c); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c); }
    else if (e.key === 'ArrowRight' && caretEnd && c < FIELDS.length - 1) { e.preventDefault(); focusCell(r, c + 1); }
    else if (e.key === 'ArrowLeft' && caretStart && c > 0) { e.preventDefault(); focusCell(r, c - 1); }
    else if (e.key === 'Escape') { const row = visRef.current[r]; if (row) { grid.revertRow(rowKeyOf(row)); } }
  };
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLInputElement; if (!(el instanceof HTMLInputElement) || el.dataset.r === undefined || !canEdit) return;
    const text = e.clipboardData.getData('text');
    if (!/[\t\n\r]/.test(text.replace(/[\r\n]+$/, ''))) return; // a single value pastes normally
    e.preventDefault();
    const matrix = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
    const r0 = Number(el.dataset.r); const c0 = Number(el.dataset.c);
    const entries: [string, Field, string][] = [];
    matrix.forEach((line, i) => { const row = visRef.current[r0 + i]; if (!row) return; line.forEach((cellText, j) => { const f = FIELDS[c0 + j]; if (f) entries.push([rowKeyOf(row), f, NUM_FIELDS.has(f) ? cellText.trim() : cellText.trim()]); }); });
    const n = grid.setMany(entries);
    setNote(`Pasted ${matrix.length} row${matrix.length === 1 ? '' : 's'} × ${Math.max(...matrix.map((l) => l.length))} column${Math.max(...matrix.map((l) => l.length)) === 1 ? '' : 's'} (${n} cells) — review the highlighted cells, then save.`);
  };

  const doSave = async () => {
    setError(null); setNote(null);
    const items = changedItems(rows, grid);
    try { const r = await save.mutateAsync({ items }); pendingClear.current = true; setTimeout(() => { if (pendingClear.current) { pendingClear.current = false; grid.reset(); } }, 2500); setNote(`Saved ${items.length} changed row${items.length === 1 ? '' : 's'} (${r.updated} updated, ${r.created} added) on the ledger.`); onSaved?.(items.length); } catch (e) { setError(errMsg(e)); }
  };

  const nDirty = grid.dirtyKeys.length; const nBad = grid.invalidKeys.length;
  let last = '';
  return <div data-testid="master-grid">
    <div className="tbl-toolbar no-print">
      <strong style={{ fontSize: 13 }}>{title}</strong>
      <select className="select sm" style={{ width: 'auto' }} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter by stage"><option value="ALL">All stages ({rows.length})</option>{stages.map((s) => <option key={s} value={s}>{scopeLabel(s)} ({rows.filter((r) => r.scope === s).length})</option>)}</select>
      <input className="input sm" style={{ width: 190 }} placeholder="Search parameter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search parameters" />
      <Seg<Only> value={only} onChange={setOnly} options={[{ key: 'all', label: 'All' }, { key: 'missing', label: `Missing (${missingN})` }, { key: 'invalid', label: `Invalid (${nBad})` }, { key: 'changed', label: `Changed (${nDirty})` }]} />
      <span className="grow" />{toolbar}
    </div>
    <div className="mg-wrap" ref={wrap} onKeyDown={onKeyDown} onPaste={onPaste}>
      <table className="mg-table">
        <thead><tr><th>Parameter</th><th>Unit</th><th className="num">Std</th><th className="num">Lower</th><th className="num">Upper</th><th>Frequency</th><th>Instrument</th><th>Note</th>
          <th className="prev num" title={`Previous version${prevVersionNo ? ` (v${prevVersionNo})` : ''}`}>Prev std</th><th className="prev num">Prev lower</th><th className="prev num">Prev upper</th><th>{prevVersionNo ? `Change vs v${prevVersionNo}` : 'Change'}</th></tr></thead>
        <tbody>
          {visible.map((r, ri) => {
            const head = r.scope !== last; last = r.scope; const k = rowKeyOf(r); const e = grid.edits[k];
            return <Fragment key={k}>
              {head ? <tr className="mg-stage"><td colSpan={12}><span className="row" style={{ gap: 8 }}>{r.scope === 'MIX' ? null : <StageIcon stage={r.scope} size={14} />}{scopeLabel(r.scope)}<span className="muted small">{rows.filter((x) => x.scope === r.scope).length} items{rows.some((x) => x.scope === r.scope && x.missing && !grid.edits[rowKeyOf(x)]) ? ` · ${rows.filter((x) => x.scope === r.scope && x.missing && !grid.edits[rowKeyOf(x)]).length} missing` : ''}</span></span></td></tr> : null}
              <GridRow row={r} ri={ri} edit={e} errors={grid.errors[k]} editable={canEdit} onChange={grid.setField} onRevert={grid.revertRow} />
            </Fragment>;
          })}
          {!visible.length ? <tr><td colSpan={12} className="center muted" style={{ padding: 28 }}>No rows match these filters.</td></tr> : null}
        </tbody>
      </table>
    </div>
    <div className="mg-savebar no-print">
      {canEdit ? <span className="muted small">Tab / Enter / arrow keys move between cells · paste a block copied from Excel · Esc undoes the row</span> : <span className="muted small">{editable ? perm.why : 'This version is locked — only a DRAFT can be edited.'}</span>}
      <span className="grow" />
      {nBad ? <span className="judged red" style={{ cursor: 'default' }}><AlertTriangle size={12} /> {nBad} row{nBad === 1 ? ' needs' : 's need'} fixing</span> : null}
      {nDirty ? <button className="btn sm ghost" onClick={grid.reset}>Discard {nDirty}</button> : null}
      <button className="btn primary" disabled={!canEdit || nDirty === 0 || nBad > 0 || save.isPending} onClick={() => void doSave()} title={nBad ? 'Fix the highlighted cells first' : undefined} data-testid="master-save"><Save size={14} /> {save.isPending ? 'Saving…' : `Save ${nDirty} change${nDirty === 1 ? '' : 's'}`}</button>
    </div>
    {error ? <div style={{ padding: '0 14px 12px' }}><Notice tone="bad">{error}</Notice></div> : null}
    {note ? <div style={{ padding: '0 14px 12px' }}><Notice tone="ok">{note}</Notice></div> : null}
  </div>;
}
void Plus;
