import { useNavigate } from 'react-router-dom';
import { useGet, useGlobalParams, qstr } from '../lib/api';
import { Card, CardBody, ColorPill, Loading, PageHead, StageIcon } from '../components/ui';
import { DataTable, type Col } from '../components/DataTable';
import { fmtDTShort, kg } from '../lib/fmt';
import type { Stage } from '@shared/params';

type Color = 'green' | 'yellow' | 'red' | 'none';
interface Lot { id: string; lotNo: string; lotCode: string; countId: string; countDisplay: string; mixNo: string; status: string; plannedKg: number; customerName: string | null; dispatchNo: string | null; location: { stage: Stage; label: string; detail: string; machines: { id: string; label: string }[]; since: string | null; state: string }; worst: Color; chain: never }

export default function Lots(): JSX.Element {
  const { count, mode } = useGlobalParams(); const nav = useNavigate();
  const q = useGet<Lot[]>('/api/lots' + qstr({ count, mode }));
  const columns: Col<Lot>[] = [
    { key: 'lot', header: 'Lot', value: (x) => x.lotNo, render: (x) => <><b>{x.lotNo}</b><span className="sub">{x.lotCode}</span></> },
    { key: 'count', header: 'Count', value: (x) => x.countDisplay }, { key: 'mix', header: 'Mix', value: (x) => x.mixNo },
    { key: 'location', header: 'Current location', value: (x) => `${x.location.label} ${x.location.machines.map((m) => m.label).join(' ')}`, render: (x) => <span className="row" style={{ gap: 6 }}><StageIcon stage={x.location.stage} size={14} /> <span>{x.location.label}<span className="sub">{x.location.machines.map((m) => m.label).join(', ') || x.location.detail}{x.location.since ? ` · since ${fmtDTShort(x.location.since)}` : ''}</span></span></span> },
    { key: 'customer', header: 'Customer', value: (x) => x.customerName ?? '' }, { key: 'kg', header: 'Planned kg', value: (x) => x.plannedKg, num: true, render: (x) => kg(x.plannedKg) },
    { key: 'status', header: 'Status', value: (x) => x.status, render: (x) => <ColorPill color={x.worst} label={x.status.replace('_', ' ')} />, color: (x) => x.worst },
  ];
  return <div className="page" data-testid="lots-page"><PageHead eyebrow="MILL LOTS" title="Lot Passport" sub="Search every cotton-to-customer yarn lot. Opening a lot shows the mix, bale origins, stage journey, quality, production, packing and dispatch proof." /><Loading q={q}>{q.data ? <Card><CardBody><DataTable rows={q.data} columns={columns} rowKey={(x) => x.id} exportName="textrace-lots" title="TexTrace lot register" legend onRowClick={(x) => nav(`/lots/${x.id}`)} filters={[{ key: 'count', label: 'Count', value: (x) => x.countDisplay }, { key: 'stage', label: 'Stage', value: (x) => x.location.label }, { key: 'status', label: 'Status', value: (x) => x.status }]} /></CardBody></Card> : null}</Loading></div>;
}
