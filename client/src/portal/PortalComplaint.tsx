import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, CircleDot, Hourglass, Inbox, MessageSquareWarning, Package } from 'lucide-react';
import type { ComplaintStatus } from '@shared/params';
import { useGet } from '../lib/api';
import { fmtD, fmtDT } from '../lib/fmt';
import { Loading, Notice } from '../components/ui';
import { AttachmentCard } from '../components/portal/files';
import { COMPLAINT_STATUS_UI, ComplaintPill, PCard } from '../components/portal/ui';
import { typeTitle } from '../components/portal/complaintTypes';
import type { PortalComplaintDetail } from '../components/portal/types';

const STEP_ICON: Record<ComplaintStatus, JSX.Element> = { OPEN: <Inbox size={20} />, UNDER_ANALYSIS: <Hourglass size={20} />, RESOLVED: <Check size={20} /> };
const NEXT_TEXT: Record<ComplaintStatus, string> = { OPEN: 'Our quality team will start the investigation', UNDER_ANALYSIS: 'We will close the complaint with our findings and a reply', RESOLVED: '' };
const ORDER: ComplaintStatus[] = ['OPEN', 'UNDER_ANALYSIS', 'RESOLVED'];

export default function PortalComplaint(): JSX.Element {
  const { id = '' } = useParams();
  const q = useGet<PortalComplaintDetail>(`/api/portal/complaints/${encodeURIComponent(id)}`);
  if (q.error) return <div className="pt-page"><Link to="/portal/complaints" className="pt-link"><ArrowLeft size={16} /> My complaints</Link><PCard><Notice tone="bad">{q.error instanceof Error ? q.error.message : 'We could not find that complaint.'}</Notice></PCard></div>;
  return <div className="pt-page" data-testid="portal-complaint">
    <Link to="/portal/complaints" className="pt-link no-print" style={{ alignSelf: 'flex-start' }}><ArrowLeft size={16} /> My complaints</Link>
    <Loading q={q}>{q.data ? (() => {
      const { complaint: c, steps, summary, document: doc } = q.data; const next = NEXT_TEXT[c.status];
      return <>
        <div className="pt-lot-hero">
          <div className="row between" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div><div className="pt-eyebrow">Complaint</div><div className="pt-lot-no"><h1>{c.complaintNo}</h1><ComplaintPill status={c.status} /></div>
              <p className="pt-lead">{typeTitle(c.type)} · lot {c.lotNo} · received {fmtD(c.receivedDate)}</p></div>
            <Link to={`/portal/lots/${c.lotId}`} className="btn lg no-print"><Package size={18} /> Open Lot {c.lotNo}</Link>
          </div>
        </div>

        <div className="pt-two">
          <div className="pt-page">
            <PCard title="What you told us" icon={<MessageSquareWarning size={20} />} iconTone="amber">
              <div className="pt-quote">{c.description}</div>
              <div className="muted small">Reported by {c.complainant || c.createdByName} on {fmtDT(c.createdAt)}</div>
              {doc ? <AttachmentCard doc={doc} /> : null}
            </PCard>

            {c.status === 'RESOLVED' && summary ? <PCard title="What we found and what we did" icon={<Check size={20} />} iconTone="green" tone="ok" testId="portal-complaint-findings" lead={`Closed on ${fmtD(summary.closedAt)}`}>
              <div className="pt-find"><h3>Our investigation found</h3><p>{summary.rootCause}</p></div>
              <div className="pt-find"><h3>What we did about it</h3><p>{summary.correctiveAction}</p></div>
              <div className="pt-find" style={{ background: 'hsl(var(--primary-soft) / .6)', borderColor: 'hsl(var(--primary) / .3)' }}><h3 style={{ color: 'hsl(var(--primary))' }}>Our reply to you</h3><p>{summary.reply}</p></div>
            </PCard> : <PCard title="Where we are" icon={<CircleDot size={20} />} iconTone="amber" tone={c.status === 'OPEN' ? 'bad' : 'warn'}>
              <div className="row" style={{ gap: 12 }}><ComplaintPill status={c.status} /></div>
              <p style={{ margin: 0, fontSize: 16.5 }}>{c.status === 'OPEN' ? 'We have received your report and it is waiting for our quality team to pick it up. You do not need to do anything.' : 'Our quality team is comparing this lot\'s test results and machine records to find the cause. We will write our findings and reply here as soon as we close it.'}</p>
            </PCard>}
          </div>

          <PCard title="Progress so far" icon={<Check size={20} />} iconTone="chain" testId="portal-complaint-steps">
            <div className="pt-tl">
              {steps.map((s) => <div key={s.at + s.status} className="pt-tl-item done"><div className="pt-tl-node">{STEP_ICON[s.status]}</div><div><h3>{s.text}</h3><p>{COMPLAINT_STATUS_UI[s.status].label}</p></div><div className="when"><b>{fmtD(s.at)}</b>{fmtDT(s.at).split(', ')[1]}</div></div>)}
              {next ? <div className="pt-tl-item next"><div className="pt-tl-node">{STEP_ICON[ORDER[ORDER.indexOf(c.status) + 1]]}</div><div><h3>Next</h3><p>{next}</p></div><div className="when" /></div> : null}
            </div>
          </PCard>
        </div>
      </>;
    })() : null}</Loading>
  </div>;
}
