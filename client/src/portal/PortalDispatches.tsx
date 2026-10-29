import { Link } from 'react-router-dom';
import { PackageCheck, Truck } from 'lucide-react';
import { useGet } from '../lib/api';
import { fmtD, fmtT } from '../lib/fmt';
import { DataTable, type Col } from '../components/DataTable';
import { Loading } from '../components/ui';
import { DispatchPill, PCard, PHead, Tile, VehicleBadge, kgText, plural } from '../components/portal/ui';
import type { PortalDispatch } from '../components/portal/types';

const statusText = (d: PortalDispatch) => (d.status === 'DELIVERED' ? 'Delivered' : 'On the road');

export default function PortalDispatches(): JSX.Element {
  const q = useGet<PortalDispatch[]>('/api/portal/dispatches');
  const rows = q.data ?? [];
  const road = rows.filter((d) => d.status !== 'DELIVERED');

  const cols: Col<PortalDispatch>[] = [
    { key: 'date', header: 'Date', value: (d) => d.dispatchedAt, exportHeader: 'Dispatch date', render: (d) => <><b>{fmtD(d.dispatchedAt)}</b><span className="sub">{fmtT(d.dispatchedAt)} · {d.dispatchNo}</span></> },
    { key: 'invoice', header: 'Invoice no.', value: (d) => d.invoiceNo, render: (d) => <span className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{d.invoiceNo}</span> },
    { key: 'vehicle', header: 'Vehicle number', value: (d) => d.vehicleNo, render: (d) => <VehicleBadge no={d.vehicleNo} /> },
    { key: 'qty', header: 'Quantity', num: true, value: (d) => d.netKg, exportHeader: 'Net kg', render: (d) => <><b>{kgText(d.netKg)}</b><span className="sub">{kgText(d.grossKg)} with packing</span></> },
    { key: 'pack', header: 'Cartons & cones', value: (d) => `${d.cartons} cartons, ${d.conesCount} cones`, render: (d) => <>{plural(d.cartons, 'carton')}<span className="sub">{plural(d.conesCount, 'cone')}</span></> },
    { key: 'lots', header: 'Lots', value: (d) => d.lots.map((l) => `Lot ${l.lotNo}`).join(' '), render: (d) => <div className="pt-chips">{d.lots.map((l) => <Link key={l.lotId} to={`/portal/lots/${l.lotId}`} className="pt-chip" title={`Open the Lot Passport — ${kgText(l.kg)}`}>Lot {l.lotNo}</Link>)}</div> },
    { key: 'transporter', header: 'Transporter', value: (d) => `${d.transporter} ${d.lrNo}`, exportHeader: 'Transporter / LR', render: (d) => <>{d.transporter}<span className="sub">LR {d.lrNo}</span></> },
    { key: 'dest', header: 'Destination', value: (d) => d.destination, render: (d) => <span style={{ display: 'block', maxWidth: 190, fontSize: 14, lineHeight: 1.35 }}>{d.destination}</span> },
    { key: 'status', header: 'Status', value: statusText, render: (d) => <><DispatchPill status={d.status} /><span className="sub">{d.status === 'DELIVERED' ? `on ${fmtD(d.deliveredAt)}` : 'travelling to you'}</span></> },
  ];

  return <div className="pt-page" data-testid="portal-dispatches">
    <PHead eyebrow="Your shipments" title="Dispatches" lead="Every shipment that left the mill for you — with the invoice, the vehicle that carried it, and the lots inside." />
    <Loading q={q}>
      <div className="pt-tiles">
        <Tile tone="amber" icon={<Truck size={22} />} value={road.length} label="On the road" sub={road.length ? road.map((d) => d.vehicleNo).join(', ') : 'nothing travelling right now'} />
        <Tile tone="green" icon={<PackageCheck size={22} />} value={rows.length - road.length} label="Delivered" sub={`${kgText(rows.filter((d) => d.status === 'DELIVERED').reduce((s, d) => s + d.netKg, 0))} received`} />
      </div>
      <PCard flush>
        <DataTable rows={rows} columns={cols} rowKey={(d) => d.id} exportName="my-dispatches" title="My dispatches" pageSize={25}
          filters={[{ key: 'status', label: 'Status', value: statusText }, { key: 'vehicle', label: 'Vehicle', value: (d) => d.vehicleNo }]}
          footNote={<span className="muted">Select a lot to open its Lot Passport: the cotton it came from, how it was made, and its test certificates.</span>} />
      </PCard>
    </Loading>
  </div>;
}
