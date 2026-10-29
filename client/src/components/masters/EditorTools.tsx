import { useRef, useState } from 'react';
import { CopyCheck, Download, FileUp } from 'lucide-react';
import { MASTER_LABEL, type MasterType } from '@shared/params';
import { download, request, useMut } from '../../lib/api';
import { fmtD } from '../../lib/fmt';
import { Field, Modal, Notice, Spinner } from '../ui';
import { errMsg } from './common';
import { rowKeyOf, type Field as GridField } from './gridState';
import type { ImportPreview, MasterCountOverview, MasterRow, MasterVersionDetail } from './types';

// ------------------------------------------------------------------ Copy std / lower / upper from another count into the grid (unsaved edits)
export function CopyFromCountModal({ type, currentCountId, counts, rows, onApply, onClose }: { type: MasterType; currentCountId: string; counts: MasterCountOverview[]; rows: MasterRow[]; onApply: (entries: [string, GridField, string][], summary: string) => void; onClose: () => void }): JSX.Element {
  const sources = counts.filter((c) => c.id !== currentCountId).map((c) => ({ c, v: c.versions.find((v) => v.masterType === type && v.status === 'ACTIVE') })).filter((x) => !!x.v);
  const [src, setSrc] = useState(sources[0]?.c.id ?? '');
  const [loaded, setLoaded] = useState<{ detail: MasterVersionDetail; label: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const s = sources.find((x) => x.c.id === src); if (!s?.v) return;
    setBusy(true); setError(null); setLoaded(null);
    try { const r = await request<MasterVersionDetail>('GET', `/api/masters/versions/${s.v.id}`); setLoaded({ detail: r.data, label: `${s.c.display} · ${MASTER_LABEL[type]} v${s.v.versionNo} (active since ${fmtD(s.v.effectiveFrom)})` }); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const have = new Map((loaded?.detail.items ?? []).filter((i) => !i.missing && i.std !== null).map((i) => [rowKeyOf(i), i]));
  const matched = rows.filter((r) => have.has(rowKeyOf(r)));
  const differing = matched.filter((r) => { const s = have.get(rowKeyOf(r)) as MasterRow; return s.std !== r.std || s.lower !== r.lower || s.upper !== r.upper; });
  const apply = () => {
    const entries: [string, GridField, string][] = [];
    for (const r of matched) { const s = have.get(rowKeyOf(r)) as MasterRow; const k = rowKeyOf(r); entries.push([k, 'std', String(s.std)], [k, 'lower', s.lower === null ? '' : String(s.lower)], [k, 'upper', s.upper === null ? '' : String(s.upper)]); }
    onApply(entries, `Filled std / lower / upper of ${matched.length} rows from ${loaded?.label} — ${differing.length} differ from the current values. Nothing is saved until you press Save.`);
  };
  return <Modal title="Copy values from another count" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!loaded || !matched.length} onClick={apply} data-testid="copy-confirm"><CopyCheck size={14} /> Fill {matched.length} rows in the grid</button></>}>
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>Loads the latest <b>active</b> {MASTER_LABEL[type]} of another count and copies <b>std, lower and upper</b> into the rows that exist in both. The values land in the grid as unsaved edits so you can adjust them before saving.</p>
      <div className="row" style={{ alignItems: 'flex-end' }}><div className="grow"><Field label="Copy from"><select className="select" value={src} onChange={(e) => { setSrc(e.target.value); setLoaded(null); }} aria-label="Source count" data-testid="copy-source">{sources.map(({ c, v }) => <option key={c.id} value={c.id}>{c.display} — v{v?.versionNo} active since {fmtD(v?.effectiveFrom)}</option>)}</select></Field></div><button className="btn" onClick={() => void load()} disabled={!src || busy} data-testid="copy-load">Load values</button></div>
      {busy ? <Spinner /> : null}
      {loaded ? <Notice tone={matched.length ? 'info' : 'warn'}><div><b>{loaded.label}</b><br />{matched.length} matching rows · {differing.length} with different values · {rows.length - matched.length} rows not in the source stay as they are. Existing values of the matching rows will be replaced in the grid (unsaved).</div></Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  </Modal>;
}

// ------------------------------------------------------------------ CSV import (dry run first)
export function ImportModal({ versionId, onClose, onDone }: { versionId: string; onClose: () => void; onDone: (msg: string) => void }): JSX.Element {
  const [csv, setCsv] = useState(''); const [name, setName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const imp = useMut<{ csv: string }, { created: number; updated: number }>('POST', `/api/masters/versions/${versionId}/import`, `Import master items into ${versionId}`);
  const pick = async (f: File | undefined) => {
    if (!f) return; setError(null); setPreview(null); setName(f.name); setBusy(true);
    try { const text = await f.text(); setCsv(text); const r = await request<ImportPreview>('POST', `/api/masters/versions/${versionId}/import?dryRun=1`, { csv: text }); setPreview(r.data); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const run = async () => { setError(null); try { const r = await imp.mutateAsync({ csv }); onDone(`Imported ${preview?.rows ?? 0} rows from ${name}: ${r.updated} updated, ${r.created} added.`); } catch (e) { setError(errMsg(e)); } };
  return <Modal title="Import master items from CSV" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!preview?.ok || imp.isPending} onClick={() => void run()} data-testid="import-confirm"><FileUp size={14} /> Import {preview?.rows ?? 0} rows</button></>}>
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>Columns: <code>scope,parameter,std,lower,upper[,unit,frequency,instrument,note]</code> — the same layout as “Export CSV”. The file is checked first (dry run); nothing is written until you confirm.</p>
      <input ref={file} type="file" accept=".csv,text/csv" className="input" aria-label="CSV file" data-testid="import-file" onChange={(e) => void pick(e.target.files?.[0])} />
      {busy ? <Spinner label="Checking the file…" /> : null}
      {preview ? <Notice tone={preview.ok ? 'ok' : 'bad'}><div><b>{preview.rows} data row{preview.rows === 1 ? '' : 's'}</b> in {name} — {preview.ok ? 'no problems found, ready to import.' : `${preview.errors.length} problem${preview.errors.length === 1 ? '' : 's'} to fix in the file:`}
        {preview.errors.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 16, maxHeight: 180, overflow: 'auto' }}>{preview.errors.slice(0, 30).map((m) => <li key={m}>{m}</li>)}{preview.errors.length > 30 ? <li>… and {preview.errors.length - 30} more</li> : null}</ul> : null}</div></Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  </Modal>;
}

export function ExportButton({ versionId }: { versionId: string }): JSX.Element {
  const [busy, setBusy] = useState(false);
  return <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); try { await download(`/api/masters/versions/${versionId}/export`, `${versionId}.csv`); } finally { setBusy(false); } }} data-testid="master-export"><Download size={13} /> Export CSV</button>;
}
