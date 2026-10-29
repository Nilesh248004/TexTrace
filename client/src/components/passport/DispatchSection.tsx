import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardList, ExternalLink, Phone, ShieldAlert, ShieldCheck, Truck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { LotPassport } from '@shared/domain';
import { COMPLAINT_STATUS_COLOR, COMPLAINT_STATUS_LABEL, COMPLAINT_TYPE_LABEL } from '@shared/params';
import { Card, CardBody, CardHead, ChainBadge, ColorIcon, Pill } from '../ui';
import { fmtD, fmtDT, fmtDuration } from '../../lib/fmt';
import { KV, fmtKg } from './util';

export function DispatchSection({ p, canDispatch }: { p: LotPassport; canDispatch: boolean }): JSX.Element {
  const d = p.dispatch; const lot = p.lot;
  if (!d) {
    return <div id="pp-dispatch" className="pp-anchor"><Card>
      <CardHead title={<span className="pp-sec"><Truck size={17} /> Dispatch &amp; delivery</span>} sub="Where the lot went, on which vehicle, and who received it" />
      <CardBody>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="stack tight">
            <div><Pill tone={lot.status === 'ON_HOLD' ? 'red' : 'gray'} icon={<Truck size={12} />}>{lot.status === 'ON_HOLD' ? 'Dispatch blocked — lot is on QA hold' : 'Not dispatched yet'}</Pill></div>
            <div className="muted">{p.packing ? <>This lot is packed ({p.packing.cartons} cartons, {fmtKg(p.packing.netKg)}) and waiting in the finished-goods store at <b>{p.packing.fgLocation}</b>{lot.qaReleased ? ' — QA released, ready for dispatch.' : lot.status === 'ON_HOLD' ? ' — it cannot leave until QA releases it or records an override.' : ' — dispatch needs a QA release first.'}</> : <>Current position: <b>{lot.location.label}</b>. Dispatch details (vehicle, driver, invoice, destination) appear here after packing and the QA release.</>}</div>
          </div>
          {canDispatch && p.packing ? <Link className="btn primary no-print" to="/dispatch/new">Create dispatch</Link> : null}
        </div>
      </CardBody>
    </Card></div>;
  }
  const origin = window.location.origin;
  const passUrl = `${origin}/passport/${d.passportCode}`;
  const cartonCode = `C-${lot.lotNo}-001`; const cartonUrl = `${origin}/passport/${cartonCode}`;
  const delivered = !!(d.deliveredAt ?? lot.deliveredAt);
  return <div id="pp-dispatch" className="pp-anchor" data-testid="dispatch-section"><Card>
    <CardHead
      title={<span className="pp-sec"><Truck size={17} /> Dispatch &amp; delivery</span>}
      sub={<>To <b>{d.customerName}</b> · dispatch <Link to={`/dispatch/${d.id}`} className="bold" style={{ color: 'hsl(var(--primary))' }}>{d.dispatchNo}</Link></>}
      right={<>{d.qaReleased ? <Pill tone="green" icon={<ShieldCheck size={12} />}>QA released</Pill> : <Pill tone="red" icon={<ShieldAlert size={12} />} title="This dispatch left the mill without a QA release">Dispatched without QA release</Pill>}{delivered ? <Pill tone="green" icon={<CheckCircle2 size={12} />}>Delivered {fmtD(d.deliveredAt ?? lot.deliveredAt)}</Pill> : <Pill tone="blue" icon={<Truck size={12} />}>In transit{lot.location.inStageMs !== null ? ` · ${fmtDuration(lot.location.inStageMs)}` : ''}</Pill>}<ChainBadge chain={d.chain} /></>}
    />
    <CardBody>
      <div className="grid g-main" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="pp-facts" style={{ borderTop: 0, paddingTop: 0 }}>
            <KV label="Left the mill" sub="Gate pass time (IST)">{fmtDT(d.dispatchedAt)}</KV>
            <KV label="Invoice" sub={`Dated ${fmtD(d.invoiceDate)}`}>{d.invoiceNo}</KV>
            <KV label="Vehicle number"><span className="pp-plate" data-testid="vehicle-no">{d.vehicleNo}</span></KV>
            <KV label="Driver" sub={d.driverPhone ? <a href={`tel:${d.driverPhone.replace(/\s/g, '')}`} className="row" style={{ gap: 4, display: 'inline-flex', color: 'hsl(var(--primary))' }}><Phone size={11} /> {d.driverPhone}</a> : undefined}>{d.driverName}</KV>
            <KV label="Transporter">{d.transporter}</KV>
            <KV label="LR number" sub="Lorry receipt">{d.lrNo}</KV>
            <KV label="Destination">{d.destination}</KV>
            <KV label="Cartons · cones" sub="whole dispatch">{d.cartons} · {d.conesCount.toLocaleString('en-IN')}</KV>
            <KV label="Net / gross weight" sub="whole dispatch">{fmtKg(d.netKg)} / {fmtKg(d.grossKg)}</KV>
            <KV label={`Lot ${lot.lotNo} quantity`} sub="share of this dispatch">{fmtKg(d.lotKg)}</KV>
            <KV label="Delivery" sub={delivered ? 'Customer confirmed receipt' : 'Waiting for delivery confirmation'}>{delivered ? fmtDT(d.deliveredAt ?? lot.deliveredAt) : 'In transit'}</KV>
            <KV label="Other lots on this vehicle" sub={d.alsoInDispatch.length ? 'same dispatch' : 'this lot travelled alone'}>{d.alsoInDispatch.length ? d.alsoInDispatch.map((o, i) => <span key={o.lotId}>{i ? ', ' : ''}<Link to={`/lots/${o.lotId}`} style={{ color: 'hsl(var(--primary))' }}>Lot {o.lotNo}</Link></span>) : '—'}</KV>
          </div>
          {d.remarks ? <div className="small muted" style={{ borderLeft: '3px solid hsl(var(--border))', paddingLeft: 10 }}>{d.remarks}</div> : null}
        </div>
        <div className="pp-qrs" data-testid="passport-qr">
          <div className="pp-qr"><div className="box"><QRCodeSVG value={passUrl} size={128} /></div><b>Dispatch passport</b><span className="mono-s">{d.passportCode}</span><span className="muted tiny" style={{ maxWidth: 150 }}>Scan to open the public product passport of the whole dispatch</span></div>
          <div className="pp-qr"><div className="box"><QRCodeSVG value={cartonUrl} size={128} /></div><b>Sample carton</b><span className="mono-s">{cartonCode}</span><span className="muted tiny" style={{ maxWidth: 150 }}>Every carton label carries its own QR (C-{lot.lotNo}-001 … )</span></div>
          <a className="btn sm no-print" href={passUrl} target="_blank" rel="noreferrer" style={{ alignSelf: 'center' }}><ExternalLink size={13} /> Open public passport</a>
        </div>
      </div>
    </CardBody>
  </Card></div>;
}

export function ComplaintsSection({ p }: { p: LotPassport }): JSX.Element {
  const cs = p.complaints;
  return <div id="pp-complaints" className="pp-anchor" data-testid="complaints-section"><Card tone={cs.some((c) => c.status !== 'RESOLVED') ? 'warn' : undefined}>
    <CardHead
      title={<span className="pp-sec"><ClipboardList size={17} /> Complaints on this lot</span>}
      sub={cs.length ? `${cs.length} complaint${cs.length === 1 ? '' : 's'} registered` : 'Nothing registered so far'}
      right={<Link className="btn sm no-print" to={`/complaints/new?lot=${p.lot.lotNo}&type=HAIRINESS`}><ClipboardList size={13} /> Report a complaint</Link>}
    />
    <CardBody>
      {cs.length ? <div className="stack">
        {cs.map((c) => {
          const tone = COMPLAINT_STATUS_COLOR[c.status];
          return <div key={c.id} className="pp-find" style={{ borderLeftColor: `hsl(var(--${tone === 'red' ? 'bad' : tone === 'yellow' ? 'warn' : 'ok'}))`, border: '1px solid hsl(var(--border))', borderLeftWidth: 4, borderRadius: 10 }}>
            <div className="grow">
              <div className="row" style={{ gap: 8 }}><Link to={`/complaints/${c.id}`} className="bold" style={{ color: 'hsl(var(--primary))' }}>Complaint {c.complaintNo}</Link><Pill tone="gray">{COMPLAINT_TYPE_LABEL[c.type]}</Pill><span className={`pill ${tone}`}><ColorIcon color={tone} size={12} /> {COMPLAINT_STATUS_LABEL[c.status]}</span><span className="muted small">{c.customerName} · received {fmtD(c.receivedDate)}</span></div>
              <div style={{ marginTop: 4 }}>“{c.description}”</div>
              <div className="small" style={{ marginTop: 4 }}>{c.status === 'RESOLVED' && c.rootCause ? <><b>Root cause:</b> {c.rootCause}</> : <span className="muted">Root-cause analysis is still open — <Link to={`/complaints/${c.id}`} style={{ color: 'hsl(var(--primary))' }}>open the workspace</Link> to run the AI analysis and conclude.</span>}</div>
            </div>
          </div>;
        })}
      </div> : <div className="row between" style={{ alignItems: 'center' }}>
        <div className="muted">No customer complaint is registered for this lot. If the customer reports a problem (for example <b>more hairiness</b>), register it so the findings above feed the AI root-cause analysis.</div>
        <Link className="btn primary no-print" to={`/complaints/new?lot=${p.lot.lotNo}&type=HAIRINESS`}>Register a complaint</Link>
      </div>}
    </CardBody>
  </Card></div>;
}
