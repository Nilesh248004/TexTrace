import { Link, useNavigate } from 'react-router-dom';
import { ClipboardPlus } from 'lucide-react';
import { useGet, useGlobalParams, qstr } from '../lib/api';
import { Card, CardBody, ChainBadge, ColorPill, Loading, PageHead } from '../components/ui';
import { DataTable, type Col } from '../components/DataTable';
import { fmtD } from '../lib/fmt';
import { useCan } from '../components/masters/common';

interface Complaint { id: string; complaintNo: string; type: string; typeLabel: string; status: 'OPEN' | 'UNDER_ANALYSIS' | 'RESOLVED'; customerName: string; lotNo: string; countId: string; description: string; receivedDate: string; repeatCount: number; chain: never }
const tone = (s: Complaint['status']) => s === 'OPEN' ? 'red' : s === 'UNDER_ANALYSIS' ? 'yellow' : 'green';

export default function Complaints(): JSX.Element {
  const { count } = useGlobalParams(); const nav = useNavigate(); const q = useGet<Complaint[]>('/api/complaints' + qstr({ count })); const reg = useCan('Quality.registerComplaint');
  const cols: Col<Complaint>[] = [
    { key: 'no', header: 'Complaint', value: (x) => x.complaintNo, render: (x) => <b>{x.complaintNo}</b> }, { key: 'received', header: 'Received', value: (x) => x.receivedDate, render: (x) => fmtD(x.receivedDate) },
    { key: 'customer', header: 'Customer', value: (x) => x.customerName }, { key: 'lot', header: 'Lot / count', value: (x) => `${x.lotNo} ${x.countId}`, render: (x) => <>Lot {x.lotNo}<span className="sub">{x.countId}</span></> },
    { key: 'type', header: 'Issue', value: (x) => x.typeLabel }, { key: 'description', header: 'Customer report', value: (x) => x.description },
    { key: 'status', header: 'Status', value: (x) => x.status, render: (x) => <ColorPill color={tone(x.status)} label={x.status === 'OPEN' ? 'Open' : x.status === 'UNDER_ANALYSIS' ? 'In progress' : 'Closed'} />, color: (x) => tone(x.status) },
    { key: 'repeat', header: 'History', value: (x) => x.repeatCount, render: (x) => x.repeatCount ? <span className="judged yellow">{x.repeatCount} earlier</span> : 'First report' }, { key: 'chain', header: 'Ledger', noExport: true, render: (x) => <ChainBadge chain={x.chain} /> },
  ];
  return <div className="page" data-testid="complaints-page"><PageHead eyebrow="CUSTOMER SERVICE + QA" title="Complaints" sub="Open each case in a full traceability workspace: dispatch, packing, mix, bales, process evidence, AI suspects and QA closure." right={reg.can ? <Link className="btn primary" to="/complaints/new"><ClipboardPlus size={15} /> New complaint</Link> : undefined} /><Loading q={q}>{q.data ? <Card><CardBody><DataTable rows={q.data} columns={cols} rowKey={(x) => x.id} exportName="complaints" title="TexTrace complaint register" legend onRowClick={(x) => nav(`/complaints/${x.id}`)} filters={[{ key: 'status', label: 'Status', value: (x) => x.status }, { key: 'type', label: 'Issue', value: (x) => x.typeLabel }, { key: 'customer', label: 'Customer', value: (x) => x.customerName }]} rowTone={(x) => tone(x.status)} /></CardBody></Card> : null}</Loading></div>;
}
