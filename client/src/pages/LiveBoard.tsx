import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Boxes, MapPin } from 'lucide-react';
import { useGet, useGlobalParams } from '../lib/api';
import { Card, CardBody, CardHead, ColorPill, Loading, PageHead, Pill, StageIcon } from '../components/ui';
import { fmtDuration, fmtDTShort, kg } from '../lib/fmt';
import { STAGE_INFO, STAGES, type Stage } from '@shared/params';

type Color = 'green' | 'yellow' | 'red' | 'none';
interface LiveLot { id: string; lotNo: string; countId: string; countDisplay: string; location: { stage: Stage; label: string; machineLabel?: string | null; inAt?: string | null; expectedNext?: Stage | null }; plannedKg: number; worst: Color }
interface Board { asOf: string; lots: LiveLot[]; baleStore: { inStore: number; reserved: number; issued: number; totalKg: number; byBay: { bay: string; bales: number }[] }; running: { machineId: string; machineLabel: string; stage: Stage; lotNo: string; since: string }[] }

export default function LiveBoard(): JSX.Element {
  const { count } = useGlobalParams();
  const q = useGet<Board>('/api/live');
  const lots = useMemo(() => (q.data?.lots ?? []).filter((x) => count === 'ALL' || x.countId === count), [q.data, count]);
  const byStage = (stage: Stage) => lots.filter((x) => x.location.stage === stage);
  return <div className="page" data-testid="live-board">
    <PageHead eyebrow="REAL-TIME TRACEABILITY" title="Live Lot Location" sub="Every yarn lot and bale has a current physical location, machine, time in stage and next expected step." right={<Link className="btn" to="/lots"><Boxes size={15} /> All lot passports</Link>} />
    <Loading q={q}>{q.data ? <>
      <div className="notice info"><MapPin size={16} /><div>Board refreshed at <b>{fmtDTShort(q.data.asOf)}</b>. Select any lot to open its complete, on-chain passport.</div></div>
      <div className="board">{STAGES.map((stage) => { const rows = byStage(stage); const info = STAGE_INFO[stage]; return <section className="lane" key={stage}><div className="lane-head"><span className="row"><StageIcon stage={stage} size={15} /> {info.label}</span><Pill tone="gray">{rows.length}</Pill></div><div className="stack tight">{rows.map((lot) => <Link className="lot-card" key={lot.id} to={`/lots/${lot.id}`}><div className="row between"><b>Lot {lot.lotNo}</b><ColorPill color={lot.worst} /></div><div className="muted small">{lot.countDisplay} · {kg(lot.plannedKg)}</div><div className="small">{lot.location.machineLabel || lot.location.label}</div>{lot.location.inAt ? <div className="muted tiny">Here since {fmtDTShort(lot.location.inAt)} · {fmtDuration(Date.now() - Date.parse(lot.location.inAt))}</div> : null}<div className="muted tiny">Next: {lot.location.expectedNext ? STAGE_INFO[lot.location.expectedNext].label : 'Customer delivery'}</div></Link>)}{!rows.length ? <div className="muted tiny" style={{ padding: 8 }}>No lot at this stage</div> : null}</div></section>; })}</div>
      <Card><CardHead title="Bale store" sub="Raw cotton traceability before blending. After blow room, bales are linked through their mix." /><CardBody><div className="grid g4"><div className="fact"><span>Available bales</span><b>{q.data.baleStore.inStore}</b><small>{kg(q.data.baleStore.totalKg)} in store</small></div><div className="fact"><span>Reserved bales</span><b>{q.data.baleStore.reserved}</b><small>Allocated to planned mixes</small></div><div className="fact"><span>Issued bales</span><b>{q.data.baleStore.issued}</b><small>Already traceable through mix</small></div>{q.data.baleStore.byBay.slice(0, 5).map((b) => <div className="fact" key={b.bay}><span>Bay {b.bay}</span><b>{b.bales} bales</b><small>Currently available</small></div>)}</div></CardBody></Card>
    </> : null}</Loading>
  </div>;
}
