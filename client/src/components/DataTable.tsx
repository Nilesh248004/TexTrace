import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, FileText, Search } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { QualityColor } from '@shared/quality';
import { Legend } from './ui';

export interface Col<T> {
  key: string;
  header: ReactNode;
  /** plain value used for sorting, searching and CSV/PDF export */
  value?: (r: T) => string | number | null | undefined;
  /** value used only for sorting (e.g. a severity rank) when it differs from the displayed / exported value */
  sort?: (r: T) => string | number | null | undefined;
  render?: (r: T) => ReactNode;
  num?: boolean;
  sortable?: boolean;
  /** cell colour used in PDF export */
  color?: (r: T) => QualityColor | undefined;
  /** header text for CSV/PDF (defaults to the key) */
  exportHeader?: string;
  noExport?: boolean;
  width?: number | string;
}
export interface TableFilter<T> { key: string; label: string; value: (r: T) => string | null | undefined; options?: { value: string; label: string }[] }

const RGB: Record<string, [number, number, number]> = { green: [209, 250, 229], yellow: [254, 243, 199], red: [254, 226, 226] };
const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function DataTable<T>({ rows, columns, rowKey, filters = [], search = true, pageSize = 25, exportName = 'export', title, onRowClick, legend = false, toolbar, empty = 'No records match the filters.', dense, initialSort, rowTone, footNote, selectedKey }: {
  rows: T[]; columns: Col<T>[]; rowKey: (r: T) => string; filters?: TableFilter<T>[]; search?: boolean; pageSize?: number; exportName?: string; title?: string; onRowClick?: (r: T) => void; legend?: boolean; toolbar?: ReactNode;
  empty?: string; dense?: boolean; initialSort?: { key: string; dir: 'asc' | 'desc' }; rowTone?: (r: T) => QualityColor | undefined; footNote?: ReactNode; selectedKey?: string | null;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [fv, setFv] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);

  const options = useMemo(() => Object.fromEntries(filters.map((f) => [f.key, f.options ?? [...new Set(rows.map((r) => f.value(r)).filter((x): x is string => !!x))].sort().map((v) => ({ value: v, label: v }))])), [filters, rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => filters.every((f) => !fv[f.key] || f.value(r) === fv[f.key]) && (!needle || columns.some((c) => cell(c.value?.(r)).toLowerCase().includes(needle))));
  }, [rows, q, fv, filters, columns]);
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    const f = col?.sort ?? col?.value;
    if (!col || !f) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => { const x = f(a); const y = f(b); if (x === y) return 0; if (x === null || x === undefined || x === '') return 1; if (y === null || y === undefined || y === '') return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir; });
  }, [filtered, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const cur = Math.min(page, pages - 1);
  const slice = sorted.slice(cur * size, cur * size + size);
  const exportCols = columns.filter((c) => !c.noExport && c.value);

  const csv = () => {
    const head = exportCols.map((c) => c.exportHeader ?? (typeof c.header === 'string' ? c.header : c.key));
    const body = sorted.map((r) => exportCols.map((c) => cell(c.value?.(r))));
    const text = [head, ...body].map((row) => row.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `${exportName}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const pdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(13); doc.text(title ?? exportName, 40, 36); doc.setFontSize(8); doc.setTextColor(110); doc.text(`TexTrace · ${sorted.length} rows · exported ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })} IST · green = within master, yellow = warning, red = out of tolerance`, 40, 50);
    autoTable(doc, {
      startY: 60, styles: { fontSize: 7, cellPadding: 3 }, headStyles: { fillColor: [41, 54, 92] },
      head: [exportCols.map((c) => c.exportHeader ?? (typeof c.header === 'string' ? c.header : c.key))], body: sorted.map((r) => exportCols.map((c) => cell(c.value?.(r)))),
      didParseCell: (d) => { if (d.section === 'body') { const col = exportCols[d.column.index]; const color = col.color?.(sorted[d.row.index]); if (color && RGB[color]) d.cell.styles.fillColor = RGB[color]; } },
    });
    doc.save(`${exportName}.pdf`);
  };

  const clickSort = (c: Col<T>) => { if (!c.value || c.sortable === false) return; setSort((s) => (s?.key === c.key ? (s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' })); setPage(0); };
  return <div>
    <div className="tbl-toolbar no-print">
      {search ? <div className="search"><Search size={14} /><input className="input sm" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search table" /></div> : null}
      {filters.map((f) => <select key={f.key} className="select sm" style={{ width: 'auto', minWidth: 120 }} value={fv[f.key] ?? ''} onChange={(e) => { setFv({ ...fv, [f.key]: e.target.value }); setPage(0); }} aria-label={f.label}><option value="">{f.label}: all</option>{options[f.key].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>)}
      {toolbar}
      <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
        <span className="muted small">{sorted.length === rows.length ? `${rows.length} rows` : `${sorted.length} of ${rows.length}`}</span>
        <button className="btn sm" onClick={csv} title="Download CSV"><Download size={13} /> CSV</button>
        <button className="btn sm" onClick={pdf} title="Download PDF"><FileText size={13} /> PDF</button>
      </div>
    </div>
    <div className="tbl-wrap">
      <table className={`tbl ${dense ? 'dense' : ''}`}>
        <thead><tr>{columns.map((c) => <th key={c.key} className={`${c.num ? 'num' : ''} ${c.value && c.sortable !== false ? 'sortable' : ''}`} style={c.width ? { width: c.width } : undefined} onClick={() => clickSort(c)} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>{c.header}{sort?.key === c.key ? (sort.dir === 'asc' ? <ArrowUp size={11} style={{ marginLeft: 4 }} /> : <ArrowDown size={11} style={{ marginLeft: 4 }} />) : null}</th>)}</tr></thead>
        <tbody>
          {slice.map((r) => { const tone = rowTone?.(r); const key = rowKey(r); return <tr key={key} className={`${onRowClick ? 'click' : ''} ${selectedKey === key ? 'sel' : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined} style={tone === 'red' ? { boxShadow: 'inset 3px 0 0 hsl(var(--bad))' } : tone === 'yellow' ? { boxShadow: 'inset 3px 0 0 hsl(var(--warn))' } : undefined}>{columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : cell(c.value?.(r))}</td>)}</tr>; })}
          {slice.length === 0 ? <tr><td colSpan={columns.length} className="center muted" style={{ padding: 28 }}>{empty}</td></tr> : null}
        </tbody>
      </table>
    </div>
    <div className="tbl-foot no-print">
      <div className="row">{legend ? <Legend chain /> : footNote ?? <span />}</div>
      <div className="row">
        <select className="select sm" style={{ width: 'auto' }} value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} aria-label="Rows per page">{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
        <button className="btn sm icon" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
        <span>{cur + 1} / {pages}</span>
        <button className="btn sm icon" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
      </div>
    </div>
  </div>;
}
