import { useState, type ReactNode } from 'react';
import { BadgeCheck, CheckCircle2, FilePenLine, History, Rocket, ThumbsUp, XCircle } from 'lucide-react';
import { MASTER_LABEL } from '@shared/params';
import type { MasterVersionDTO } from '@shared/domain';
import { useMut } from '../../lib/api';
import { fmtD, fmtDT } from '../../lib/fmt';
import { Card, CardBody, CardHead, Field, Notice } from '../ui';
import { MasterStatusPill, errMsg, useCan } from './common';
import './masters.css';

type Act = 'approve' | 'approve-activate' | 'activate' | 'reject';
interface Body { action: Act; note?: string; effectiveFrom?: string; reason?: string }

function Step({ state, icon, title, children }: { state: 'done' | 'now' | 'off' | 'bad'; icon: ReactNode; title: string; children?: ReactNode }): JSX.Element {
  return <div className={`mw-step ${state}`}><span className="node">{icon}</span><div><b className="small">{title}</b><div className="muted tiny">{children}</div></div></div>;
}

/** Status timeline (created → approved → active) and the role-aware workflow buttons. */
export function WorkflowPanel({ version: v, dirtyCount, businessDate, onActivated }: { version: MasterVersionDTO; dirtyCount: number; businessDate: string; onActivated: (msg: string) => void }): JSX.Element {
  const approve = useCan('Master.approve'); const activate = useCan('Master.activate'); const reject = useCan('Master.reject');
  const [note, setNote] = useState(''); const [date, setDate] = useState<string | null>(null); const dateVal = date ?? businessDate; const [reason, setReason] = useState(''); const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = useMut<Body, unknown>('POST', (b) => `/api/masters/versions/${v.id}/${b.action}`, (b) => ({ approve: `QA approval of ${v.id}`, 'approve-activate': `Approve & activate ${v.id}`, activate: `Activate ${v.id}`, reject: `Reject ${v.id}` })[b.action]);
  const label = `${MASTER_LABEL[v.masterType]} v${v.versionNo} (${v.countId})`;
  const run = async (b: Body) => {
    setError(null);
    try {
      await m.mutateAsync(b);
      if (b.action === 'approve-activate' || b.action === 'activate') onActivated(`${label} is now ACTIVE from ${fmtD(b.effectiveFrom)}. Results are judged against the master version that was active on their production date — lots produced before that date keep the old limits. To see every result re-judged on this new version, switch “Masters” in the top bar to “Latest master”.`);
      if (b.action === 'reject') setRejecting(false);
    } catch (e) { setError(errMsg(e)); }
  };
  const draft = v.status === 'DRAFT'; const approved = v.status === 'QA_APPROVED';
  const blockedByEdits = dirtyCount > 0;
  const rejected = v.status === 'REJECTED'; const live = v.status === 'ACTIVE' || v.status === 'SUPERSEDED';
  return <div data-testid="workflow-panel"><Card><CardHead title="Approval workflow" sub="A master version is prepared as a draft, approved by QA, then activated from an effective date. Every step is a ledger transaction." right={<MasterStatusPill status={v.status} />} />
    <CardBody className="stack">
      <div className="mw-steps">
        <Step state="done" icon={<FilePenLine size={13} />} title="Created">{v.createdByName}<br />{fmtDT(v.createdAt)}</Step>
        {rejected ? <Step state="bad" icon={<XCircle size={13} />} title="Rejected">{v.note.split('Rejected:')[1]?.trim() ?? 'Rejected by QA'}</Step>
          : <Step state={v.approvedAt ? 'done' : draft ? 'now' : 'off'} icon={<BadgeCheck size={13} />} title="QA approved">{v.approvedAt ? <>{v.approvedByName}<br />{fmtDT(v.approvedAt)}</> : 'waiting for QA'}</Step>}
        <Step state={v.status === 'ACTIVE' ? 'done' : v.status === 'SUPERSEDED' ? 'done' : approved ? 'now' : 'off'} icon={<Rocket size={13} />} title="Active">{v.effectiveFrom ? <>from {fmtD(v.effectiveFrom)}{v.activatedAt ? <><br />activated {fmtDT(v.activatedAt)}</> : null}</> : 'not active yet'}</Step>
        {v.status === 'SUPERSEDED' ? <Step state="done" icon={<History size={13} />} title="Superseded">on {fmtD(v.effectiveTo)}<br />by a newer version</Step> : null}
      </div>

      {draft || approved ? <div className="stack" data-testid="workflow-actions">
        {blockedByEdits ? <Notice tone="warn">You have {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'} in the grid — save or discard them before approving.</Notice> : null}
        {draft ? <>
          <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
            <div className="grow" style={{ minWidth: 220 }}><Field label="QA note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. verified against trial on RF-4" aria-label="QA note" /></Field></div>
            <Field label="Effective from" hint="First production date judged on this version"><input className="input" type="date" value={dateVal} onChange={(e) => setDate(e.target.value)} aria-label="Effective from" data-testid="effective-from" style={{ width: 170 }} /></Field>
          </div>
          <div className="row">
            <button className="btn" disabled={!approve.can || blockedByEdits || m.isPending} title={approve.why ?? 'Approve now; activate later'} onClick={() => void run({ action: 'approve', note })} data-testid="master-approve-only"><ThumbsUp size={14} /> Approve (QA)</button>
            <button className="btn primary" disabled={!approve.can || !activate.can || blockedByEdits || m.isPending || !dateVal} title={approve.why ?? activate.why ?? 'Approve and activate in one step'} onClick={() => void run({ action: 'approve-activate', note, effectiveFrom: dateVal })} data-testid="master-approve"><CheckCircle2 size={14} /> Approve &amp; activate</button>
            <span className="grow" />
            {!rejecting ? <button className="btn sm ghost" style={{ color: 'hsl(var(--bad-foreground))' }} disabled={!reject.can} title={reject.why} onClick={() => setRejecting(true)} data-testid="master-reject"><XCircle size={13} /> Reject this version…</button> : null}
          </div>
        </> : null}
        {approved ? <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
          <Field label="Effective from" hint="First production date judged on this version"><input className="input" type="date" value={dateVal} onChange={(e) => setDate(e.target.value)} aria-label="Effective from" data-testid="effective-from" style={{ width: 170 }} /></Field>
          <button className="btn primary" disabled={!activate.can || m.isPending || !dateVal} title={activate.why} onClick={() => void run({ action: 'activate', effectiveFrom: dateVal })} data-testid="master-activate"><Rocket size={14} /> Activate from {fmtD(dateVal)}</button>
          <span className="grow" />
          {!rejecting ? <button className="btn sm ghost" style={{ color: 'hsl(var(--bad-foreground))' }} disabled={!reject.can} title={reject.why} onClick={() => setRejecting(true)} data-testid="master-reject"><XCircle size={13} /> Reject this version…</button> : null}
        </div> : null}
        {rejecting ? <div className="stack tight"><Field label="Reason for rejecting (at least 5 characters)"><textarea className="textarea" style={{ minHeight: 60 }} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Rejection reason" data-testid="reject-reason" /></Field>
            <div className="row"><button className="btn danger sm" disabled={m.isPending} onClick={() => void run({ action: 'reject', reason })} data-testid="master-reject-confirm">Reject version</button><button className="btn sm ghost" onClick={() => { setRejecting(false); setError(null); }}>Cancel</button></div></div> : null}
      </div> : null}
      {live ? <div className="muted small">{v.status === 'ACTIVE' ? 'This version is in force and locked. To change a value, clone it into a new draft and send that through approval.' : 'This version was replaced and stays on record: results produced while it was in force are still judged against it.'}</div> : null}
      {rejected ? <div className="muted small">This version was rejected and is kept for the audit trail only. Clone another version to start again.</div> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </CardBody></Card></div>;
}
