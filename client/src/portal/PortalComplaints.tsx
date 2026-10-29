import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, MessageSquareWarning, Paperclip } from 'lucide-react';
import { useGet } from '../lib/api';
import { fmtD } from '../lib/fmt';
import { DataTable, type Col } from '../components/DataTable';
import { Loading } from '../components/ui';
import { COMPLAINT_STATUS_UI, ComplaintPill, PCard, PHead, Tile } from '../components/portal/ui';
import { typeTitle } from '../components/portal/complaintTypes';
import type { PortalComplaint } from '../components/portal/types';

export default function PortalComplaints(): JSX.Element {
  const nav = useNavigate();
  const q = useGet<PortalComplaint[]>('/api/portal/complaints');
  const rows = q.data ?? [];
  const n = (s: PortalComplaint['status']) => rows.filter((c) => c.status === s).length;

  const cols: Col<PortalComplaint>[] = [
    { key: 'no', header: 'Complaint', value: (c) => c.complaintNo, render: (c) => <b style={{ fontSize: 16 }}>{c.complaintNo}</b> },
    { key: 'lot', header: 'Lot', value: (c) => `Lot ${c.lotNo}`, render: (c) => <Link to={`/portal/lots/${c.lotId}`} className="pt-chip" onClick={(e) => e.stopPropagation()}>Lot {c.lotNo}</Link> },
    { key: 'type', header: 'Kind of problem', value: (c) => typeTitle(c.type), render: (c) => typeTitle(c.type) },
    { key: 'received', header: 'Received', value: (c) => c.receivedDate, render: (c) => fmtD(c.receivedDate) },
    { key: 'status', header: 'Status', value: (c) => COMPLAINT_STATUS_UI[c.status].label, width: 270, color: (c) => COMPLAINT_STATUS_UI[c.status].tone, render: (c) => <ComplaintPill status={c.status} /> },
    { key: 'updated', header: 'Last update', value: (c) => c.updatedAt, render: (c) => <span className="muted">{fmtD(c.updatedAt)}</span> },
    { key: 'file', header: 'Photo / PDF', value: (c) => (c.documentId ? 'Yes' : 'No'), render: (c) => (c.documentId ? <span className="pt-chip"><Paperclip size={13} /> attached</span> : <span className="muted">—</span>) },
    { key: 'open', header: '', sortable: false, noExport: true, render: () => <ArrowRight size={18} className="muted" /> },
  ];

  return <div className="pt-page" data-testid="portal-complaints">
    <PHead eyebrow="We keep you posted" title="My complaints" lead="Every problem you have reported, and where we are with it." right={<Link to="/portal/report" className="btn primary lg"><MessageSquareWarning size={18} /> Report a problem</Link>} />
    <Loading q={q}>
      <div className="pt-tiles">
        <Tile tone="red" icon={COMPLAINT_STATUS_UI.OPEN.icon} value={n('OPEN')} label="Open — received" sub="we have your report" />
        <Tile tone="amber" icon={COMPLAINT_STATUS_UI.UNDER_ANALYSIS.icon} value={n('UNDER_ANALYSIS')} label="In progress" sub="being investigated by our quality team" />
        <Tile tone="green" icon={COMPLAINT_STATUS_UI.RESOLVED.icon} value={n('RESOLVED')} label="Closed" sub="with our findings and reply" />
      </div>
      <PCard flush>
        <DataTable rows={rows} columns={cols} rowKey={(c) => c.id} exportName="my-complaints" title="My complaints" pageSize={25} onRowClick={(c) => nav(`/portal/complaints/${c.id}`)}
          filters={[{ key: 'status', label: 'Status', value: (c) => COMPLAINT_STATUS_UI[c.status].label }, { key: 'type', label: 'Problem', value: (c) => typeTitle(c.type) }]}
          footNote={<span className="muted">Click a complaint to see every step, our investigation and our reply.</span>} />
      </PCard>
    </Loading>
  </div>;
}
