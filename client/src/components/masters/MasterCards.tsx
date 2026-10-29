import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, CopyPlus, ExternalLink, FilePlus2, GitBranchPlus } from 'lucide-react';
import { MASTER_LABEL, MASTER_PLAIN, MASTER_TYPES, type MasterType } from '@shared/params';
import type { AccessoriesMeta, ColorMeta, CountMixMeta, MasterVersionDTO } from '@shared/domain';
import { useMut } from '../../lib/api';
import { fmtD } from '../../lib/fmt';
import { Card, CardBody, ChainBadge, Field, Modal, Notice, Pill } from '../ui';
import { CompletenessBar, MASTER_ICON, MasterStatusPill, errMsg, missingLabel, pctTone, useCan } from './common';
import type { MasterCountOverview } from './types';
import './masters.css';

export interface CreateVersionBody { countId: string; masterType: MasterType; cloneFrom: string | null; note?: string }
const isPending = (v: MasterVersionDTO) => v.status === 'DRAFT' || v.status === 'QA_APPROVED';

/** Hook shared by the card buttons and the clone dialog: create a draft and open it in the editor. */
export function useCreateVersion(): { create: (b: CreateVersionBody) => Promise<void>; busy: boolean; error: string | null; reset: () => void } {
  const nav = useNavigate();
  const m = useMut<CreateVersionBody, { id: string }>('POST', '/api/masters/versions', (b) => `Create ${MASTER_LABEL[b.masterType]} draft for ${b.countId}`);
  const [error, setError] = useState<string | null>(null);
  return {
    busy: m.isPending, error, reset: () => setError(null),
    create: async (b) => { setError(null); try { const r = await m.mutateAsync(b); nav(`/masters/${r.id}`); } catch (e) { setError(errMsg(e)); } },
  };
}

// ------------------------------------------------------------------ count tiles (switcher + completeness at a glance)
export function CountTiles({ counts, value, onChange }: { counts: MasterCountOverview[]; value: string; onChange: (id: string) => void }): JSX.Element {
  return <div className="mt-tiles" role="group" aria-label="Choose a count" data-testid="master-count-tiles">
    {counts.map((c) => {
      const pending = c.versions.filter(isPending).length; const tone = pctTone(c.completeness.overall);
      return <button key={c.id} className="mt-tile" aria-pressed={value === c.id} onClick={() => onChange(c.id)} data-testid={`master-count-${c.id}`}>
        <span className="row between"><b style={{ fontSize: 15 }}>{c.display}</b>{pending ? <Pill tone="yellow" title="Versions waiting for approval or activation">{pending} pending</Pill> : <Pill tone="green">all active</Pill>}</span>
        <span className="muted small">{c.label}{c.usesComber ? ' · combed' : ''}</span>
        <span className="row between small"><span className="muted">Master completeness</span><span className={`judged ${tone}`} style={{ cursor: 'default' }}>{c.completeness.overall}%</span></span>
        <span className="bar"><i style={{ width: `${c.completeness.overall}%`, background: `hsl(var(${tone === 'green' ? '--ok' : tone === 'yellow' ? '--warn' : '--bad'}))` }} /></span>
      </button>;
    })}
  </div>;
}

// ------------------------------------------------------------------ what the active version contains
function ActiveSummary({ type, v }: { type: MasterType; v: MasterVersionDTO }): JSX.Element {
  const m = v.meta;
  if (type === 'COUNT_MIX') {
    const mm = m as unknown as CountMixMeta;
    return <div className="stack tight">
      <div className="row" style={{ gap: 5 }}>{(mm.recipe ?? []).map((r) => <Pill key={r.key} tone="gray" title={`${r.label}: target ${r.pct}% (allowed ${r.minPct}–${r.maxPct}%)`}>{r.label.replace('Recycled blow-room & card waste', 'Recycled waste')} {r.pct}%</Pill>)}</div>
      <div className="muted small">Targets: waste {mm.targetWastePct}% · realization {mm.targetRealizationPct}% · {mm.route?.length ?? 0} process steps · {v.itemCount} fibre ranges</div>
    </div>;
  }
  if (type === 'ACCESSORIES') {
    const mm = m as unknown as AccessoriesMeta;
    return <div className="stack tight"><div className="small"><b>{mm.packageType === 'CHEESE' ? 'Cheese' : 'Cone'}</b> · {mm.coneType}</div><div className="muted small">{mm.cartonType} · label {mm.labelTemplate} · traveller {mm.travellerType} · {v.itemCount} accessory limits</div></div>;
  }
  if (type === 'COLOR') {
    const mm = m as unknown as ColorMeta;
    return <div className="row" style={{ gap: 12 }}><span className="mt-cone" style={{ color: mm.hex }} aria-label={`${mm.colorName} tip cone`} /><div><div className="bold">{mm.colorName} <span className="muted small mono">{mm.code}</span></div><div className="muted small">{mm.tip}</div><div className="muted tiny">Checked at packing against the cone actually packed</div></div></div>;
  }
  return <div className="muted small">{v.itemCount} {type === 'QUALITY' ? 'lab-test limits across the departments' : 'machine settings and targets across the stages'}</div>;
}

// ------------------------------------------------------------------ one master card
export function MasterCard({ count, type, all }: { count: MasterCountOverview; type: MasterType; all: MasterCountOverview[] }): JSX.Element {
  const nav = useNavigate();
  const active = count.versions.find((v) => v.masterType === type && v.status === 'ACTIVE');
  const pending = count.versions.filter((v) => v.masterType === type && isPending(v));
  const comp = count.completeness.byType[type];
  const { create, busy, error, reset } = useCreateVersion();
  const perm = useCan('Master.createVersion');
  const [openMissing, setOpenMissing] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const blocked = pending.length > 0;
  const tone = pctTone(comp.pct);
  return <Card className="mt-card" tone={tone === 'red' ? 'bad' : tone === 'yellow' ? 'warn' : undefined}>
    <CardBody className="stack grow">
      <div className="mt-card-head">
        <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><span className="mt-ico">{MASTER_ICON[type]}</span><div><b style={{ fontSize: 14.5 }}>{MASTER_LABEL[type]}</b><div className="muted tiny">{count.display}</div></div></div>
        {active ? <div className="row" style={{ gap: 6 }}><MasterStatusPill status="ACTIVE" /><b>v{active.versionNo}</b></div> : <Pill tone="red">no active version</Pill>}
      </div>
      <div className="muted small">{MASTER_PLAIN[type]}</div>
      {active ? <>
        <div className="row small" style={{ gap: 14 }}><span><span className="muted">Effective from</span> <b>{fmtD(active.effectiveFrom)}</b></span>{type === 'COLOR' ? null : <span><span className="muted">Items</span> <b>{active.itemCount}</b></span>}<ChainBadge chain={active.chain} /></div>
        <ActiveSummary type={type} v={active} />
      </> : null}
      <div>
        <CompletenessBar pct={comp.pct} label={`${comp.present} of ${comp.required} required items filled`} />
        {comp.missing.length ? <>
          <button className="btn ghost sm" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => setOpenMissing(!openMissing)} aria-expanded={openMissing} data-testid={`missing-toggle-${type}`}>{openMissing ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{comp.missing.length} missing item{comp.missing.length === 1 ? '' : 's'}</button>
          {openMissing ? <ul className="mt-missing" aria-label="Missing master items">{comp.missing.map((m, i) => <li key={`${m.scope}${m.key}${i}`}>{missingLabel(m)}</li>)}</ul> : null}
        </> : <div className="muted tiny" style={{ marginTop: 2 }}>Nothing missing — every required item has a standard and limits.</div>}
      </div>
      {pending.length ? <div className="stack tight">{pending.map((p) => <div key={p.id} className="mt-pending" data-testid={`pending-${p.id}`}><MasterStatusPill status={p.status} /><b>v{p.versionNo}</b><span className="muted grow" title={p.note}>{p.status === 'DRAFT' ? `by ${p.createdByName}` : `approved by ${p.approvedByName ?? '—'}`}</span><Link className="btn sm" to={`/masters/${p.id}`}><ExternalLink size={12} /> Open</Link></div>)}</div> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="mt-actions">
        {active ? <Link className="btn sm primary" to={`/masters/${active.id}`} data-testid={`master-open-${type}`}><ExternalLink size={13} /> Open</Link> : null}
        <button className="btn sm" disabled={busy || blocked || !perm.can} title={blocked ? 'A draft or approved version already exists — finish or reject it first.' : perm.why ?? 'Copy the active version into a new draft and adjust it'} onClick={() => void create({ countId: count.id, masterType: type, cloneFrom: active?.id ?? null })} data-testid={`master-new-${type}`}><GitBranchPlus size={13} /> New version (clone)</button>
        <button className="btn sm" disabled={blocked || !perm.can} title={blocked ? 'A draft or approved version already exists — finish or reject it first.' : perm.why ?? 'Start a draft from another count\'s active version'} onClick={() => { reset(); setCloneOpen(true); }} data-testid={`master-clone-${type}`}><CopyPlus size={13} /> Clone from another count</button>
      </div>
    </CardBody>
    {cloneOpen ? <CloneFromCountModal target={count} type={type} all={all} onClose={() => setCloneOpen(false)} onDone={(id) => { setCloneOpen(false); nav(`/masters/${id}`); }} /> : null}
  </Card>;
}

// ------------------------------------------------------------------ "Clone from another count"
export function CloneFromCountModal({ target, type, all, onClose, onDone }: { target: MasterCountOverview; type: MasterType; all: MasterCountOverview[]; onClose: () => void; onDone: (id: string) => void }): JSX.Element {
  const sources = all.filter((c) => c.id !== target.id).map((c) => ({ c, v: c.versions.find((v) => v.masterType === type && v.status === 'ACTIVE') })).filter((x): x is { c: MasterCountOverview; v: MasterVersionDTO } => !!x.v);
  const [src, setSrc] = useState(sources[0]?.c.id ?? '');
  const sel = sources.find((s) => s.c.id === src);
  const m = useMut<CreateVersionBody, { id: string }>('POST', '/api/masters/versions', `Clone ${MASTER_LABEL[type]} from ${sel?.c.display ?? 'another count'} into ${target.display}`);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!sel) return; setError(null);
    try { const r = await m.mutateAsync({ countId: target.id, masterType: type, cloneFrom: sel.v.id, note: `Cloned from ${sel.v.id} (${sel.c.display})` }); onDone(r.id); } catch (e) { setError(errMsg(e)); }
  };
  return <Modal title={`Clone ${MASTER_LABEL[type]} from another count`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!sel || m.isPending} onClick={() => void go()} data-testid="clone-confirm"><FilePlus2 size={14} /> Create draft for {target.display}</button></>}>
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>A new <b>draft</b> is created for <b>{target.display}</b> with all values (and recipe / specification) copied from the source count's active version. Nothing changes for results until the draft is approved and activated.</p>
      <Field label="Copy from"><select className="select" value={src} onChange={(e) => setSrc(e.target.value)} data-testid="clone-source">{sources.map(({ c, v }) => <option key={c.id} value={c.id}>{c.display} — {MASTER_LABEL[type]} v{v.versionNo} (active since {fmtD(v.effectiveFrom)})</option>)}</select></Field>
      {sel ? <div className="card"><CardBody className="stack tight"><div className="row between"><b>{sel.c.display} · {MASTER_LABEL[type]} v{sel.v.versionNo}</b><MasterStatusPill status={sel.v.status} /></div><div className="muted small">{sel.v.itemCount} items · effective {fmtD(sel.v.effectiveFrom)} · created by {sel.v.createdByName}</div></CardBody></div> : <Notice tone="warn">No other count has an active {MASTER_LABEL[type]} to copy from.</Notice>}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  </Modal>;
}

// ------------------------------------------------------------------ the five cards of the chosen count
export function MasterCards({ count, all }: { count: MasterCountOverview; all: MasterCountOverview[] }): JSX.Element {
  return <div className="mt-cards" data-testid="master-cards">{MASTER_TYPES.map((t) => <div key={`${count.id}-${t}`} data-testid={`master-card-${t}`} style={{ display: 'flex', flexDirection: 'column' }}><MasterCard count={count} type={t} all={all} /></div>)}</div>;
}
