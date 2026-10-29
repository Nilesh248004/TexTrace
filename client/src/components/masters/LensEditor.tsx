import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { COMPLAINT_TYPES, COMPLAINT_TYPE_LABEL, DEFAULT_LENS, PROCESS_STAGES, STAGE_INFO, paramDef, paramsFor, type ComplaintType, type LensItem, type Stage } from '@shared/params';
import { useGet, useMut } from '../../lib/api';
import { fmtDT } from '../../lib/fmt';
import { Card, CardBody, CardHead, ChainBadge, Loading, Notice, Pill } from '../ui';
import { errMsg, useCan } from './common';
import type { LensMaster } from './types';
import './masters.css';

const LENS_STAGES: Stage[] = [...PROCESS_STAGES, 'PACK'];
const DIR_LABEL: Record<string, string> = { '': 'Auto (from the parameter)', high: 'High side matters', low: 'Low side matters', both: 'Either side matters' };
const WEIGHT_LABEL = ['0 · information only', '1 · minor', '2 · relevant', '3 · important', '4 · strong', '5 · decisive'];

export function WeightDots({ weight, max = 5 }: { weight: number; max?: number }): JSX.Element {
  return <span className="weight-dots" title={`Lens weight ${weight} of ${max}`} aria-label={`weight ${weight} of ${max}`}>{Array.from({ length: max }, (_, i) => <span key={i} className={i < weight ? '' : 'off'}>●</span>)}</span>;
}
export const dirText = (d: LensItem['dir']): string => (d === 'high' ? 'High side matters' : d === 'low' ? 'Low side matters' : d === 'both' ? 'Either side' : 'Auto');

const clean = (items: LensItem[]): LensItem[] => items.map((i) => ({ stage: i.stage, key: i.key, weight: Number(i.weight), why: i.why ?? '', ...(i.dir ? { dir: i.dir } : {}) }));
const sameItems = (a: LensItem[], b: LensItem[]) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

function problems(items: LensItem[]): string[] {
  const out: string[] = []; const seen = new Set<string>();
  if (!items.length) out.push('At least one parameter is required.');
  items.forEach((it, i) => {
    const row = `Row ${i + 1}`;
    if (!paramsFor(it.stage).some((p) => p.key === it.key)) out.push(`${row}: ${paramDef(it.key)?.label ?? it.key} is not measured at ${STAGE_INFO[it.stage]?.label ?? it.stage}.`);
    if (!(Number(it.weight) >= 0 && Number(it.weight) <= 5)) out.push(`${row}: the weight must be between 0 and 5.`);
    const k = `${it.stage}|${it.key}`; if (seen.has(k)) out.push(`${row}: ${paramDef(it.key)?.label ?? it.key} at ${STAGE_INFO[it.stage]?.label ?? it.stage} is listed twice.`); seen.add(k);
  });
  return out;
}

/** "Complaint-Type → Relevant-Parameters mapping (editable master)": which readings the AI analysis and the workspace look at, per issue type. */
export function LensEditor(): JSX.Element {
  const q = useGet<LensMaster[]>('/api/masters/lens');
  const users = useGet<{ id: string; name: string }[]>('/api/users');
  const [sp] = useSearchParams();
  const [type, setType] = useState<ComplaintType>(COMPLAINT_TYPES.includes(sp.get('type') as ComplaintType) ? (sp.get('type') as ComplaintType) : 'HAIRINESS');
  const [drafts, setDrafts] = useState<Partial<Record<ComplaintType, LensItem[]>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const save = useMut<{ type: ComplaintType; items: LensItem[] }, unknown>('PUT', (b) => `/api/masters/lens/${b.type}`, (b) => `Edit complaint lens for ${COMPLAINT_TYPE_LABEL[b.type]}`);
  const perm = useCan('Quality.upsertLens');

  const server = useMemo(() => new Map((q.data ?? []).map((l) => [l.complaintType, l])), [q.data]);
  const current = server.get(type);
  const items = drafts[type] ?? current?.items ?? DEFAULT_LENS[type];
  const dirty = drafts[type] !== undefined && !sameItems(drafts[type] as LensItem[], current?.items ?? DEFAULT_LENS[type]);
  const issues = problems(items);
  const userName = (id: string | null) => users.data?.find((u) => u.id === id)?.name ?? id ?? '—';
  const edit = (next: LensItem[]) => { setSaved(null); setError(null); setDrafts((d) => ({ ...d, [type]: next })); };
  const patch = (i: number, p: Partial<LensItem>) => edit(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));

  const onSave = async () => {
    setError(null); setSaved(null);
    try { await save.mutateAsync({ type, items: clean(items) }); setDrafts((d) => { const n = { ...d }; delete n[type]; return n; }); setSaved(`Saved the ${COMPLAINT_TYPE_LABEL[type]} mapping — new analyses use it straight away.`); } catch (e) { setError(errMsg(e)); }
  };

  return <Loading q={q}><div className="ml-layout" data-testid="lens-editor">
    <Card><CardHead title="Issue types" sub="Pick the complaint type to edit" /><CardBody><div className="ml-list">
      {COMPLAINT_TYPES.map((t) => { const l = server.get(t); const n = (drafts[t] ?? l?.items ?? DEFAULT_LENS[t]).length; return <button key={t} className="ml-type" aria-current={t === type} onClick={() => { setType(t); setError(null); setSaved(null); }} data-testid={`lens-type-${t}`}><span>{COMPLAINT_TYPE_LABEL[t]}{drafts[t] ? <span className="pill yellow" style={{ marginLeft: 6 }}>edited</span> : null}</span><span className="muted small">{n} params</span></button>; })}
    </div></CardBody></Card>

    <Card><CardHead title={`${COMPLAINT_TYPE_LABEL[type]} → relevant parameters`} sub="When this kind of complaint is investigated, these readings are pinned first in the workspace and weighted by the AI analysis. Weight 5 = decisive, 0 = shown for information only. Direction says which side of the master can cause the complaint."
      right={current?.updatedAt ? <span className="row small muted" style={{ gap: 8 }}>edited by {userName(current.updatedBy)}, {fmtDT(current.updatedAt)} <ChainBadge chain={current.chain} /></span> : <Pill tone="gray">default mapping</Pill>} />
      <CardBody className="stack">
        <div className="tbl-wrap"><table className="ml-grid"><thead><tr><th style={{ width: 130 }}>Stage</th><th style={{ width: 230 }}>Parameter</th><th style={{ width: 130 }}>Weight (0–5)</th><th style={{ width: 170 }}>Direction</th><th>Why it matters</th><th style={{ width: 40 }} /></tr></thead><tbody>
          {items.map((it, i) => {
            const opts = paramsFor(it.stage); const known = opts.some((p) => p.key === it.key);
            return <tr key={`${i}-${it.stage}-${it.key}`} data-testid="lens-row">
              <td><select className="select sm" value={it.stage} disabled={!perm.can} aria-label="Stage" onChange={(e) => { const stage = e.target.value as Stage; const ok = paramsFor(stage).some((p) => p.key === it.key); patch(i, { stage, key: ok ? it.key : paramsFor(stage)[0]?.key ?? it.key }); }}>{LENS_STAGES.concat(LENS_STAGES.includes(it.stage) ? [] : [it.stage]).map((s) => <option key={s} value={s}>{STAGE_INFO[s].label}</option>)}</select></td>
              <td><select className="select sm" value={it.key} disabled={!perm.can} aria-label="Parameter" onChange={(e) => patch(i, { key: e.target.value })}>{!known ? <option value={it.key}>{it.key} (not measured here)</option> : null}{opts.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></td>
              <td><div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><select className="select sm" value={it.weight} disabled={!perm.can} aria-label="Weight" onChange={(e) => patch(i, { weight: Number(e.target.value) })}>{WEIGHT_LABEL.map((l, w) => <option key={w} value={w}>{l}</option>)}</select></div></td>
              <td><select className="select sm" value={it.dir ?? ''} disabled={!perm.can} aria-label="Direction" onChange={(e) => patch(i, { dir: (e.target.value || undefined) as LensItem['dir'] })}>{Object.entries(DIR_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td><input className="input sm" value={it.why} disabled={!perm.can} aria-label="Why it matters" onChange={(e) => patch(i, { why: e.target.value })} placeholder="Why this reading can explain the complaint" /></td>
              <td><button className="btn ghost sm icon" disabled={!perm.can || items.length <= 1} title="Remove this parameter" aria-label="Remove row" onClick={() => edit(items.filter((_, idx) => idx !== i))}><Trash2 size={14} /></button></td>
            </tr>;
          })}
        </tbody></table></div>
        <div className="row">
          <button className="btn sm" disabled={!perm.can} onClick={() => { const stage: Stage = 'RF'; const used = new Set(items.filter((x) => x.stage === stage).map((x) => x.key)); const key = paramsFor(stage).find((p) => !used.has(p.key))?.key ?? paramsFor(stage)[0].key; edit([...items, { stage, key, weight: 2, why: '' }]); }} data-testid="lens-add"><Plus size={13} /> Add parameter</button>
          <button className="btn sm" disabled={!perm.can} onClick={() => edit(DEFAULT_LENS[type].map((i) => ({ ...i })))} title="Replace the table by the factory default for this issue type (not saved until you press Save)"><RotateCcw size={13} /> Reset to default mapping</button>
          <span className="grow" />
          {dirty ? <button className="btn sm ghost" onClick={() => { setDrafts((d) => { const n = { ...d }; delete n[type]; return n; }); setError(null); }}>Discard changes</button> : null}
          <button className="btn primary" disabled={!dirty || issues.length > 0 || save.isPending || !perm.can} title={perm.why} onClick={() => void onSave()} data-testid="lens-save"><Save size={14} /> {save.isPending ? 'Saving…' : 'Save mapping'}</button>
        </div>
        {issues.length ? <Notice tone="warn"><ul style={{ margin: 0, paddingLeft: 16 }}>{issues.map((m) => <li key={m}>{m}</li>)}</ul></Notice> : null}
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {saved ? <Notice tone="ok">{saved}</Notice> : null}
        {!perm.can ? <Notice tone="info">{perm.why}</Notice> : null}
      </CardBody></Card>
  </div></Loading>;
}
