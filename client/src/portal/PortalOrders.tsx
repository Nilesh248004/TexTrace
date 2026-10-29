import { ClipboardList, Hourglass, PackageCheck, Truck } from 'lucide-react';
import { useGet } from '../lib/api';
import { fmtD } from '../lib/fmt';
import { DataTable, type Col } from '../components/DataTable';
import { Loading } from '../components/ui';
import { OrderPill, PCard, PHead, Progress, Tile, daysUntil, dueHint, kgText, useCountName, useMeta } from '../components/portal/ui';
import type { PortalOrder } from '../components/portal/types';

const STATUS_TEXT: Record<string, string> = { OPEN: 'Waiting to ship', PARTIAL: 'Partly shipped', COMPLETE: 'Fully shipped' };

export default function PortalOrders(): JSX.Element {
  const q = useGet<PortalOrder[]>('/api/portal/orders');
  const meta = useMeta(); const countName = useCountName();
  const now = meta.data?.now;
  const orders = q.data ?? [];
  const ordered = orders.reduce((s, o) => s + o.qtyKg, 0); const sent = orders.reduce((s, o) => s + o.sentKg, 0);
  const next = [...orders].filter((o) => o.status !== 'COMPLETE').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  const cols: Col<PortalOrder>[] = [
    { key: 'order', header: 'Order number', value: (o) => o.orderNo, render: (o) => <b>{o.orderNo}</b> },
    { key: 'po', header: 'Your PO', value: (o) => o.poNo, render: (o) => <span className="mono small">{o.poNo}</span> },
    { key: 'count', header: 'Yarn count', value: (o) => countName(o.countId), render: (o) => <span className="pt-chip">{countName(o.countId)}</span> },
    { key: 'ordered', header: 'Ordered', num: true, value: (o) => o.qtyKg, render: (o) => kgText(o.qtyKg) },
    { key: 'sent', header: 'Sent so far', num: true, value: (o) => o.sentKg, render: (o) => <b>{kgText(o.sentKg)}</b> },
    { key: 'progress', header: 'Progress', exportHeader: 'Sent %', value: (o) => (o.qtyKg ? Math.round((o.sentKg / o.qtyKg) * 100) : 0), width: 190, render: (o) => <Progress value={o.sentKg} max={o.qtyKg} /> },
    { key: 'due', header: 'Due date', value: (o) => o.dueDate, render: (o) => { const dh = o.status === 'COMPLETE' ? '' : dueHint(daysUntil(o.dueDate, now)); return <>{fmtD(o.dueDate)}{dh ? <span className="sub">{dh}</span> : null}</>; } },
    { key: 'status', header: 'Status', value: (o) => STATUS_TEXT[o.status] ?? o.status, render: (o) => <OrderPill status={o.status} /> },
  ];

  return <div className="pt-page" data-testid="portal-orders">
    <PHead eyebrow="Your orders" title="Orders" lead="What you have ordered, how much we have sent so far, and when the rest is due." />
    <Loading q={q}>
      <div className="pt-tiles">
        <Tile icon={<ClipboardList size={22} />} value={orders.length} label={orders.length === 1 ? 'Order' : 'Orders'} sub={`${kgText(ordered)} ordered`} />
        <Tile tone="green" icon={<Truck size={22} />} value={kgText(sent)} label="Sent so far" sub={`${ordered ? Math.round((sent / ordered) * 100) : 0}% of everything you ordered`} />
        <Tile tone="amber" icon={<Hourglass size={22} />} value={kgText(Math.max(0, ordered - sent))} label="Still to come" sub={next ? `next order due ${fmtD(next.dueDate)}` : 'all orders shipped'} />
        <Tile tone="chain" icon={<PackageCheck size={22} />} value={orders.filter((o) => o.status === 'COMPLETE').length} label="Fully shipped" sub="orders completed" />
      </div>
      <PCard flush>
        <DataTable rows={orders} columns={cols} rowKey={(o) => o.id} exportName="my-orders" title="My orders" pageSize={25}
          filters={[{ key: 'status', label: 'Status', value: (o) => STATUS_TEXT[o.status] ?? o.status }, { key: 'count', label: 'Count', value: (o) => countName(o.countId) }]}
          footNote={<span className="muted">“Sent so far” counts everything we have dispatched against the order, including shipments still on the road.</span>} />
      </PCard>
    </Loading>
  </div>;
}
