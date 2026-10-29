import { useNavigate } from 'react-router-dom';
import { useGet } from '../lib/api';
import { Card, CardBody, ColorPill, Loading, PageHead } from '../components/ui';
import { DataTable, type Col } from '../components/DataTable';
import { kg } from '../lib/fmt';

interface Customer { id: string; code: string; name: string; city: string; contactName: string; email: string; phone: string; lots: number; dispatches: number; dispatchedKg: number; orders: number; orderedKg: number; complaints: { open: number; inProgress: number; closed: number; repeat: string[] } }
export default function Customers(): JSX.Element {
  const nav = useNavigate(); const q = useGet<Customer[]>('/api/customers');
  const cols: Col<Customer>[] = [
    { key: 'customer', header: 'Customer', value: (x) => `${x.name} ${x.code} ${x.city}`, render: (x) => <><b>{x.name}</b><span className="sub">{x.code} · {x.city} · {x.contactName}</span></> }, { key: 'orders', header: 'Orders', value: (x) => x.orders, num: true }, { key: 'lots', header: 'Lots purchased', value: (x) => x.lots, num: true }, { key: 'dispatches', header: 'Dispatches', value: (x) => x.dispatches, num: true }, { key: 'kg', header: 'Dispatched kg', value: (x) => x.dispatchedKg, num: true, render: (x) => kg(x.dispatchedKg) },
    { key: 'complaints', header: 'Complaint history', value: (x) => x.complaints.open + x.complaints.inProgress + x.complaints.closed, render: (x) => <span className="row"><ColorPill color={x.complaints.open ? 'red' : x.complaints.inProgress ? 'yellow' : 'green'} label={`${x.complaints.open} open · ${x.complaints.inProgress} active · ${x.complaints.closed} closed`} />{x.complaints.repeat.length ? <span className="muted tiny">repeat: {x.complaints.repeat.join(', ')}</span> : null}</span> },
  ];
  return <div className="page" data-testid="customers-page"><PageHead eyebrow="CUSTOMER RELATIONSHIPS" title="Customers" sub="Purchase history, traceable lots and repeat-complaint signals. Customer logins can only view their own records in the portal." /><Loading q={q}>{q.data ? <Card><CardBody><DataTable rows={q.data} columns={cols} rowKey={(x) => x.id} exportName="customers" title="TexTrace customers" onRowClick={(x) => nav(`/dispatch?q=${encodeURIComponent(x.name)}`)} filters={[{ key: 'city', label: 'City', value: (x) => x.city }]} /></CardBody></Card> : null}</Loading></div>;
}
