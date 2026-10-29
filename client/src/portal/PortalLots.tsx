import { ArrowRight, Boxes, CheckCircle2, MessageSquareWarning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGet } from '../lib/api';
import { fmtD } from '../lib/fmt';
import { DataTable, type Col } from '../components/DataTable';
import { Loading, Pill } from '../components/ui';
import { DispatchPill, PCard, PHead, QualityGlance, Tile, kgText } from '../components/portal/ui';
import type { PortalLotRow } from '../components/portal/types';

const glanceText = (l: PortalLotRow) => {
  const { total, warning, outOfSpec } = l.tests; const n = warning + outOfSpec;
  return !total ? 'No test readings yet' : n ? `${n} of ${total} test readings need attention` : `All ${total} test readings are within specification`;
};

export default function PortalLots(): JSX.Element {
  const nav = useNavigate();
  const q = useGet<PortalLotRow[]>('/api/portal/lots');
  const rows = q.data ?? [];
  const clean = rows.filter((l) => !l.tests.warning && !l.tests.outOfSpec).length;

  const cols: Col<PortalLotRow>[] = [
    { key: 'lot', header: 'Lot', value: (l) => l.lotNo, exportHeader: 'Lot no', render: (l) => <><b style={{ fontSize: 16 }}>Lot {l.lotNo}</b><span className="sub">{l.cartonFrom} → {l.cartonTo}</span></> },
    { key: 'count', header: 'Yarn count', value: (l) => l.countDisplay, render: (l) => <span className="pt-chip">{l.countDisplay}</span> },
    { key: 'qty', header: 'Quantity', num: true, value: (l) => l.kg, exportHeader: 'Kg', render: (l) => <b>{kgText(l.kg)}</b> },
    { key: 'date', header: 'Dispatched', value: (l) => l.dispatchedAt, exportHeader: 'Dispatch date', render: (l) => <>{fmtD(l.dispatchedAt)}<span className="sub">{l.dispatchNo}</span></> },
    { key: 'status', header: 'Delivery', value: (l) => (l.status === 'DELIVERED' ? 'Delivered' : 'On the road'), render: (l) => <DispatchPill status={l.status} /> },
    { key: 'quality', header: 'Quality at a glance', value: glanceText, width: 300, color: (l) => (l.tests.outOfSpec ? 'red' : l.tests.warning ? 'yellow' : l.tests.total ? 'green' : undefined), render: (l) => <QualityGlance tests={l.tests} /> },
    { key: 'complaints', header: 'Complaints', num: true, value: (l) => l.complaints, render: (l) => (l.complaints ? <Pill tone="yellow" icon={<MessageSquareWarning size={13} />}>{l.complaints} raised</Pill> : <span className="muted">None</span>) },
    { key: 'open', header: '', sortable: false, noExport: true, render: () => <ArrowRight size={18} className="muted" /> },
  ];

  return <div className="pt-page" data-testid="portal-lots">
    <PHead eyebrow="Your yarn" title="My lots" lead="Every lot you have bought. Open one to see the cotton it came from, how it was made and its laboratory certificates." />
    <Loading q={q}>
      <div className="pt-tiles">
        <Tile tone="chain" icon={<Boxes size={22} />} value={rows.length} label="Lots purchased" sub={`${kgText(rows.reduce((s, l) => s + l.kg, 0))} in total`} />
        <Tile tone="green" icon={<CheckCircle2 size={22} />} value={clean} label="Lots fully within specification" sub={rows.length - clean ? `${rows.length - clean} with readings that need attention` : 'every test reading met our specification'} />
      </div>
      <PCard flush>
        <DataTable rows={rows} columns={cols} rowKey={(l) => l.id} exportName="my-lots" title="My lots" pageSize={25} onRowClick={(l) => nav(`/portal/lots/${l.id}`)}
          filters={[{ key: 'count', label: 'Count', value: (l) => l.countDisplay }, { key: 'delivery', label: 'Delivery', value: (l) => (l.status === 'DELIVERED' ? 'Delivered' : 'On the road') }]}
          footNote={<span className="muted">Click a lot to open its Lot Passport.</span>} />
      </PCard>
    </Loading>
  </div>;
}
