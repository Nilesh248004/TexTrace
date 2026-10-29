import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Plus, Truck, XCircle } from 'lucide-react';
import { useGet, useGlobalParams, qstr } from '../lib/api';
import { useSession } from '../lib/store';
import type { OnChainRef } from '@shared/types';
import { fmtDTShort, num } from '../lib/fmt';
import { Card, ChainBadge, ColorPill, Kpi, Legend, Loading, PageHead, Pill } from '../components/ui';
import { DataTable, type Col } from '../components/DataTable';

export interface DispatchRow { id: string; dispatchNo: string; customerId: string; customerName: string; orderNo: string | null; countId: string; lotNos: string[]; dispatchedAt: string; invoiceNo: string; vehicleNo: string; driverName: string; transporter: string; lrNo: string; destination: string; cartons: number; conesCount: number; netKg: number; grossKg: number; deliveredAt: string | null; status: string; qaReleased: boolean; passportCode: string; remarks: string; chain: OnChainRef }

export default function Dispatch(): JSX.Element {
  const { count } = useGlobalParams(); const nav = useNavigate(); const user = useSession((s) => s.user);
  const q = useGet<DispatchRow[]>('/api/dispatches' + qstr({ count }));
  const rows = q.data ?? []; const today = rows.filter((r) => r.dispatchedAt.slice(0, 10) === rows[0]?.dispatchedAt.slice(0, 10));
  void today;
  const cols: Col<DispatchRow>[] = [
    { key: 'no', header: 'Dispatch', value: (r) => r.dispatchNo, render: (r) => <span className="bold">{r.dispatchNo}<span className="sub">{r.orderNo ?? ''}</span></span> },
    { key: 'at', header: 'Left the mill', value: (r) => r.dispatchedAt, render: (r) => <span className="nowrap">{fmtDTShort(r.dispatchedAt)}</span> },
    { key: 'cust', header: 'Customer', value: (r) => r.customerName, render: (r) => <span>{r.customerName}<span className="sub">{r.destination.split(' — ')[0]}</span></span> },
    { key: 'lots', header: 'Lots', value: (r) => r.lotNos.join(' '), render: (r) => <span>{r.lotNos.map((n, i) => <span key={n}>{i ? ', ' : ''}<Link to={`/lots/LOT-${n}`} onClick={(e) => e.stopPropagation()} className="bold">{n}</Link></span>)}<span className="sub">{r.countId}</span></span> },
    { key: 'inv', header: 'Invoice', value: (r) => r.invoiceNo, render: (r) => <span className="mono small">{r.invoiceNo}</span> },
    { key: 'veh', header: 'Vehicle', value: (r) => r.vehicleNo, render: (r) => <span className="mono small nowrap">{r.vehicleNo}<span className="sub" style={{ fontFamily: 'inherit' }}>{r.driverName}</span></span> },
    { key: 'tr', header: 'Transporter · LR', value: (r) => `${r.transporter} ${r.lrNo}`, render: (r) => <span>{r.transporter}<span className="sub mono">{r.lrNo}</span></span> },
    { key: 'ctn', header: 'Cartons', num: true, value: (r) => r.cartons }, { key: 'net', header: 'Net kg', num: true, value: (r) => r.netKg, render: (r) => num(r.netKg, 1) },
    { key: 'qa', header: 'QA release', value: (r) => (r.qaReleased ? 'released' : 'NOT released'), render: (r) => r.qaReleased ? <ColorPill color="green" label="Released" /> : <ColorPill color="red" label="No QA release" />, color: (r) => (r.qaReleased ? 'green' : 'red') },
    { key: 'st', header: 'Status', value: (r) => r.status, render: (r) => r.status === 'DELIVERED' ? <Pill tone="green" icon={<CheckCircle2 size={12} />}>Delivered {fmtDTShort(r.deliveredAt)}</Pill> : <Pill tone="blue" icon={<Truck size={12} />}>On the road</Pill> },
    { key: 'chain', header: 'Ledger', noExport: true, render: (r) => <ChainBadge chain={r.chain} /> },
  ];
  const month = rows.filter((r) => r.dispatchedAt.slice(0, 7) === '2026-10');
  return <div className="page" data-testid="dispatch-page">
    <PageHead eyebrow="CUSTODY" title="Dispatch" sub="Every consignment with invoice, vehicle, driver, transporter and LR — released by QA, gated on the lot's quality and anchored with a QR product passport." right={user && ['ADMIN', 'DISPATCH'].includes(user.role) ? <button className="btn primary" onClick={() => nav('/dispatch/new')} data-testid="new-dispatch"><Plus size={15} /> New dispatch</button> : undefined} />
    <div className="grid g4">
      <Kpi label="Dispatches this month" value={month.length} icon={<Truck size={16} />} sub={`${num(month.reduce((s, r) => s + r.netKg, 0), 0)} kg net`} />
      <Kpi label="On the road" value={rows.filter((r) => r.status === 'DISPATCHED').length} sub="not yet confirmed delivered" />
      <Kpi label="Delivered" value={rows.filter((r) => r.status === 'DELIVERED').length} tone="green" sub="confirmed at the customer" />
      <Kpi label="Left without QA release" value={rows.filter((r) => !r.qaReleased).length} icon={<XCircle size={16} />} tone={rows.some((r) => !r.qaReleased) ? 'red' : 'green'} sub="needs regularisation" />
    </div>
    <Loading q={q}><Card flush><DataTable rows={rows} columns={cols} rowKey={(r) => r.id} exportName="dispatches" title="Dispatches" legend onRowClick={(r) => nav(`/dispatch/${r.id}`)} initialSort={{ key: 'at', dir: 'desc' }} rowTone={(r) => (r.qaReleased ? undefined : 'red')} filters={[{ key: 'cust', label: 'Customer', value: (r) => r.customerName }, { key: 'st', label: 'Status', value: (r) => r.status, options: [{ value: 'DISPATCHED', label: 'On the road' }, { value: 'DELIVERED', label: 'Delivered' }] }, { key: 'qa', label: 'QA', value: (r) => (r.qaReleased ? 'released' : 'not released') }]} /></Card></Loading>
    <Legend chain />
  </div>;
}
