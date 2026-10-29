import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Boxes, CheckCircle2, ClipboardList, ListChecks, MessageSquareWarning, ShieldCheck, Truck } from 'lucide-react';
import { useGet } from '../lib/api';
import { fmtD, fmtT } from '../lib/fmt';
import { Loading } from '../components/ui';
import { LotSearch } from '../components/portal/LotSearch';
import { ComplaintPill, DispatchPill, PCard, Tile, VehicleBadge, kgText, plural, useMeta } from '../components/portal/ui';
import { typeTitle } from '../components/portal/complaintTypes';
import type { PortalComplaint, PortalDispatch, PortalLotRow, PortalSummary } from '../components/portal/types';

export default function PortalHome(): JSX.Element {
  const nav = useNavigate();
  const summary = useGet<PortalSummary>('/api/portal/summary');
  const dispatches = useGet<PortalDispatch[]>('/api/portal/dispatches');
  const complaints = useGet<PortalComplaint[]>('/api/portal/complaints');
  const lots = useGet<PortalLotRow[]>('/api/portal/lots');
  const meta = useMeta();
  const [lotText, setLotText] = useState('');
  const hour = Number((fmtT(meta.data?.now) || '12').slice(0, 2));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const report = (lotNo: string) => nav(`/portal/report?lot=${encodeURIComponent(lotNo.replace(/^lot[\s-]*/i, ''))}`);

  return <div className="pt-page" data-testid="portal-home">
    <Loading q={summary}>{summary.data ? <>
      <div className="pt-hero">
        <div>
          <h1>{greet}, {summary.data.customer.contactName}</h1>
          <p><b>{summary.data.customer.name}</b> · {summary.data.customer.city}. Here is where your yarn is, what the mill has measured, and how to tell us if something is not right.</p>
        </div>
        <div className="pt-trust"><ShieldCheck size={22} style={{ flex: 'none' }} /><span>Every record here is written on the mill's tamper-evident ledger.</span></div>
      </div>

      <div className="pt-tiles" data-testid="portal-tiles">
        <Tile to="/portal/orders" icon={<ClipboardList size={22} />} value={summary.data.orders} label={summary.data.orders === 1 ? 'Order' : 'Orders'} sub={`${kgText(summary.data.orderedKg)} ordered in total`} />
        <Tile to="/portal/dispatches" tone="amber" icon={<Truck size={22} />} value={summary.data.inTransit} label="Shipments on the road" sub={summary.data.inTransit ? 'on their way to you right now' : 'nothing travelling right now'} />
        <Tile to="/portal/dispatches" tone="green" icon={<CheckCircle2 size={22} />} value={summary.data.delivered} label="Shipments delivered" sub={`${kgText(summary.data.deliveredKg)} sent to you in total`} />
        <Tile to="/portal/lots" tone="chain" icon={<Boxes size={22} />} value={summary.data.lots} label="Lots purchased" sub="each with its own Lot Passport" />
        <Tile to="/portal/complaints" tone={summary.data.complaints.open + summary.data.complaints.inProgress ? 'red' : 'green'} icon={<MessageSquareWarning size={22} />} value={summary.data.complaints.open + summary.data.complaints.inProgress} label="Open complaints" sub={`${summary.data.complaints.open} received · ${summary.data.complaints.inProgress} being investigated · ${summary.data.complaints.closed} closed`} />
      </div>

      <div className="pt-two">
        <PCard title="Your recent shipments" icon={<Truck size={20} />} iconTone="amber" right={<Link to="/portal/dispatches" className="pt-link">All dispatches <ArrowRight size={16} /></Link>}>
          <Loading q={dispatches}><div className="pt-list">
            {(dispatches.data ?? []).slice(0, 4).map((d) => <div key={d.id} className="pt-ship-row" data-testid="portal-recent-dispatch">
              <div className="top"><span className="t">{fmtD(d.dispatchedAt)}</span><span className="muted">invoice <span className="mono" style={{ fontSize: 13.5 }}>{d.invoiceNo}</span></span><span className="grow" /><DispatchPill status={d.status} /></div>
              <div className="mid"><VehicleBadge no={d.vehicleNo} /><span>{kgText(d.netKg)} · {plural(d.cartons, 'carton')} · {plural(d.conesCount, 'cone')}</span></div>
              <div className="pt-chips">{d.lots.map((l) => <Link key={l.lotId} to={`/portal/lots/${l.lotId}`} className="pt-chip">Lot {l.lotNo}</Link>)}</div>
            </div>)}
          </div></Loading>
        </PCard>

        <PCard title="Report a problem" icon={<MessageSquareWarning size={20} />} iconTone="amber" lead="Something not right with your yarn? Tell us the lot number and we will look into it straight away.">
          <LotSearch value={lotText} onChange={setLotText} onPick={(h) => report(h.lotNo)} onSubmit={report} testId="portal-lot-search" placeholder="Type your lot number, e.g. 101" />
          {lots.data?.length ? <div><div className="muted small" style={{ marginBottom: 6 }}>Or pick one of your latest lots</div><div className="pt-chips">{lots.data.slice(0, 5).map((l) => <button key={l.id} className="pt-chip" style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => report(l.lotNo)}>Lot {l.lotNo} · {l.countDisplay}</button>)}</div></div> : null}
          <Link to="/portal/report" className="btn primary lg" style={{ alignSelf: 'flex-start' }}><MessageSquareWarning size={18} /> Report a problem</Link>
        </PCard>
      </div>

      {complaints.data?.length ? <PCard title="Your complaints" icon={<ListChecks size={20} />} right={<Link to="/portal/complaints" className="pt-link">See all <ArrowRight size={16} /></Link>}>
        <div className="pt-list">{complaints.data.slice(0, 3).map((c) => <Link key={c.id} to={`/portal/complaints/${c.id}`} className="pt-row">
          <div className="grow"><div className="t">Complaint {c.complaintNo} · {typeTitle(c.type)}</div><div className="m">Lot {c.lotNo} · received {fmtD(c.receivedDate)}</div></div>
          <ComplaintPill status={c.status} /><ArrowRight size={18} className="muted" />
        </Link>)}</div>
      </PCard> : null}
    </> : null}</Loading>
  </div>;
}
