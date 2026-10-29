import { useState, type MutableRefObject, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Check, CheckCircle2, Clock, ExternalLink, FileDown, FlaskConical, Leaf, MapPin, MessageSquareWarning, Package, PackageCheck, QrCode, ShieldAlert, ShieldCheck, Truck, XCircle } from 'lucide-react';
import type { LotPassport } from '@shared/domain';
import { fmtD, fmtDT } from '../../lib/fmt';
import { DataTable, type Col } from '../DataTable';
import { ColorPill, Hash, J, StageIcon, Tip } from '../ui';
import { DispatchPill, ComplaintPill, PCard, VehicleBadge, kgText } from './ui';
import { FRIENDLY_STAGE, VERDICT, blendParts, blendSentence, certSummary, certificateRows, dayRange, keyResults, origins, passportLinks, specRange, specTarget, valueText, verification, type CertRow } from './passportModel';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-7)'];
const Fact = ({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }): JSX.Element => <div className="f"><span>{label}</span><b>{children}</b>{sub ? <small>{sub}</small> : null}</div>;
const VerdictIcon = ({ color, size = 16 }: { color: string; size?: number }) => color === 'green' ? <CheckCircle2 size={size} /> : color === 'yellow' ? <AlertTriangle size={size} /> : color === 'red' ? <XCircle size={size} /> : <Check size={size} />;

// ------------------------------------------------------------------ verification banner
export function VerifyBanner({ p }: { p: LotPassport }): JSX.Element {
  const v = verification(p); const [open, setOpen] = useState(false); const c = p.lot.chain;
  return <div className={`pt-verify ${v.state === 'verified' ? '' : v.state === 'changed' ? 'bad' : 'wait'}`} data-testid="portal-verify" role="status">
    <span className="ico">{v.state === 'verified' ? <ShieldCheck size={22} /> : v.state === 'changed' ? <ShieldAlert size={22} /> : <Clock size={22} />}</span>
    <div className="grow">
      <b>{v.lead} — {v.text}</b>
      <p>{v.detail}.</p>
      <button type="button" className="btn sm ghost tech" onClick={() => setOpen(!open)} style={{ marginLeft: -10 }}>{open ? 'Hide' : 'Show'} the technical proof</button>
      {open ? <dl className="kv" style={{ fontSize: 14, marginTop: 6 }}>
        <dt>Ledger block</dt><dd>#{c.blockNumber ?? '—'}</dd>
        <dt>Transaction</dt><dd><Hash value={c.txHash} n={20} /></dd>
        <dt>Record fingerprint</dt><dd><Hash value={c.recordHash} n={20} /></dd>
        <dt>Record version</dt><dd>{c.version}</dd>
        <dt>Records for this lot</dt><dd>{p.ledger.lotTxCount} ledger entries between blocks #{p.ledger.firstBlock ?? '—'} and #{p.ledger.lastBlock ?? '—'}</dd>
      </dl> : null}
    </div>
  </div>;
}

// ------------------------------------------------------------------ hero
export function LotHero({ p, onCertificate, certBusy, reportTo }: { p: LotPassport; onCertificate: () => void; certBusy: boolean; reportTo: string }): JSX.Element {
  const d = p.dispatch; const pk = p.packing; const delivered = d?.status === 'DELIVERED' || p.lot.status === 'DELIVERED';
  return <div className="pt-lot-hero">
    <div className="row between" style={{ alignItems: 'flex-start', gap: 18 }}>
      <div>
        <div className="pt-eyebrow">Lot Passport</div>
        <div className="pt-lot-no"><h1>Lot {p.lot.lotNo}</h1><span className="pt-chip" style={{ fontSize: 15 }}>{p.lot.countDisplay} yarn</span>{d ? <DispatchPill status={d.status} /> : null}</div>
        <p className="pt-lead">The story of your yarn — from the cotton bales to your door — with the laboratory results to prove it.</p>
      </div>
      <div className="row no-print" style={{ gap: 10 }}>
        <button type="button" className="btn primary lg" onClick={onCertificate} disabled={certBusy} data-testid="portal-certificate"><FileDown size={18} /> Download quality certificate (PDF)</button>
        <Link to={reportTo} className="btn lg" data-testid="portal-report-lot"><MessageSquareWarning size={18} /> Report a problem with this lot</Link>
      </div>
    </div>
    <div className="pt-facts">
      <Fact label="Quantity" sub={pk ? `${pk.cartons} cartons · ${pk.conesPacked.toLocaleString('en-IN')} cones` : undefined}>{kgText(d?.lotKg ?? p.lot.packedKg)}</Fact>
      <Fact label="Dispatched" sub={d ? `Dispatch ${d.dispatchNo}` : undefined}>{d ? fmtD(d.dispatchedAt) : 'Not yet'}</Fact>
      <Fact label="Vehicle number">{d ? <VehicleBadge no={d.vehicleNo} /> : '—'}</Fact>
      <Fact label="Invoice number" sub={d ? `dated ${fmtD(d.invoiceDate)}` : undefined}>{d?.invoiceNo ?? '—'}</Fact>
      <Fact label={delivered ? 'Delivered' : 'Delivery'} sub={delivered ? undefined : 'on its way to you'}>{delivered && d?.deliveredAt ? fmtD(d.deliveredAt) : delivered ? 'Delivered' : 'On the road'}</Fact>
    </div>
    <VerifyBanner p={p} />
  </div>;
}

// ------------------------------------------------------------------ 1. origin
export function OriginSection({ p }: { p: LotPassport }): JSX.Element {
  const parts = blendParts(p); const groups = origins(p);
  return <PCard id="origin" title="1. Where your cotton came from" icon={<Leaf size={20} />} iconTone="green" lead={<>Cotton from {groups.length} ginner{groups.length === 1 ? '' : 's'}, blended on {fmtD(p.mix.issuedAt ?? p.mix.formedAt)} (mix {p.mix.mixNo}, {kgText(p.mix.totalKg)}).</>} testId="portal-origin">
    <div className="pt-blend-sentence" data-testid="portal-blend">{blendSentence(parts)}</div>
    <div className="pt-blend" role="img" aria-label={blendSentence(parts)}>{parts.map((b, i) => <i key={b.key} style={{ width: `${b.exactPct}%`, background: `hsl(${SERIES[i % SERIES.length]})` }} title={`${b.pct}% ${b.label}`} />)}</div>
    <div className="stack tight">{parts.map((b, i) => <div key={b.key} className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><span className="pt-dot" style={{ background: `hsl(${SERIES[i % SERIES.length]})` }} /><b style={{ minWidth: 46 }}>{b.pct}%</b><span className="grow">{b.fullLabel}</span><span className="muted">{kgText(b.kg)}</span></div>)}</div>
    <div>
      <div className="pt-eyebrow" style={{ color: 'hsl(var(--muted-foreground))', marginBottom: 8 }}>The bales — who ginned them and where</div>
      <div className="pt-origin-grid">{groups.map((g) => <div key={`${g.supplier}${g.station}`} className="pt-origin">
        <b>{g.supplier}</b>
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><MapPin size={15} style={{ color: 'hsl(var(--primary))', flex: 'none' }} />{g.station}</span>
        <span>{g.varieties.join(' + ')} · {g.bales} bale{g.bales === 1 ? '' : 's'} · {kgText(g.kg)}</span>
        <span className="muted small">Gin lot{g.ginLots.length === 1 ? '' : 's'} {g.ginLots.join(', ')}</span>
      </div>)}</div>
    </div>
  </PCard>;
}

// ------------------------------------------------------------------ 2. journey
export function JourneySection({ p }: { p: LotPassport }): JSX.Element {
  const onTheRoad = p.dispatch?.status === 'DISPATCHED';
  return <PCard id="journey" title="2. How your yarn was made" icon={<PackageCheck size={20} />} lead="Every step your cotton went through at our mill, with the dates." testId="portal-journey">
    <div className="pt-tl">{p.journey.map((s) => {
      const fr = FRIENDLY_STAGE[s.stage]; const cls = s.state === 'DONE' ? 'done' : s.state === 'CURRENT' ? 'current' : s.state === 'NEXT' ? 'next' : 'pending';
      return <div key={s.stage} className={`pt-tl-item ${cls}`} data-testid={`journey-${s.stage}`}>
        <div className="pt-tl-node"><StageIcon stage={s.stage} size={20} /></div>
        <div><h3>{fr?.name ?? s.label}{fr && fr.tech !== fr.name ? <span className="pill gray" style={{ fontWeight: 550 }}>{fr.tech}</span> : null}{s.state === 'DONE' ? <span className="pill green"><Check size={13} /> Done</span> : s.state === 'CURRENT' ? <span className="pill blue">Happening now</span> : null}</h3><p>{s.plain}</p></div>
        <div className="when">{s.inAt ? <><b>{dayRange(s.inAt, s.outAt)}</b>{s.state === 'CURRENT' ? 'in progress' : null}</> : s.state === 'NEXT' ? <b>{s.stage === 'DELIV' && onTheRoad ? 'On its way to you' : 'Next step'}</b> : <span>Not started</span>}</div>
      </div>;
    })}</div>
  </PCard>;
}

// ------------------------------------------------------------------ 3. test certificates
export function CertificatesSection({ p }: { p: LotPassport }): JSX.Element {
  const rows = certificateRows(p); const keys = keyResults(rows); const sum = certSummary(rows);
  const qm = p.masters.find((m) => m.type === 'QUALITY');
  const samples = [...new Map(rows.map((r) => [r.sampleId, r])).values()];
  const cols: Col<CertRow>[] = [
    { key: 'parameter', header: 'What was measured', value: (r) => r.j.label, exportHeader: 'Parameter', render: (r) => <><b>{r.j.label}</b> <Tip text={r.j.plain} /><span className="sub">{r.sampleLabel}</span></> },
    { key: 'result', header: 'Result', num: true, value: (r) => r.j.value, exportHeader: 'Result', color: (r) => r.j.color === 'none' ? undefined : r.j.color, render: (r) => <J j={r.j} unit plain /> },
    { key: 'unit', header: 'Unit', value: (r) => r.j.unit, exportHeader: 'Unit', noExport: false, render: (r) => <span className="muted">{r.j.unit || '—'}</span> },
    { key: 'spec', header: 'Specification', value: (r) => `${specRange(r.j)}${specTarget(r.j) ? ` (${specTarget(r.j)})` : ''}`, exportHeader: 'Specification', render: (r) => <>{specRange(r.j)}<span className="sub">{specTarget(r.j)}</span></> },
    { key: 'status', header: 'Status', value: (r) => VERDICT[r.j.color].label, exportHeader: 'Status', color: (r) => r.j.color === 'none' ? undefined : r.j.color, render: (r) => <ColorPill color={r.j.color} label={VERDICT[r.j.color].label} /> },
    { key: 'tested', header: 'Tested', value: (r) => r.testedAt, exportHeader: 'Tested at', render: (r) => <span className="muted">{fmtD(r.testedAt)}</span> },
  ];
  return <PCard id="certificates" title="3. Test certificates" icon={<FlaskConical size={20} />} iconTone="chain" lead="Laboratory results measured on a composite sample of the whole lot — the numbers you can hold us to." testId="portal-certificates"
    right={sum.total ? <span className={`pill ${sum.outside ? 'red' : sum.near ? 'yellow' : 'green'} pt-glance`}>{sum.outside ? <XCircle size={14} /> : sum.near ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{sum.outside || sum.near ? `${sum.within} of ${sum.total} readings within specification` : `All ${sum.total} test readings are within specification`}</span> : undefined}>
    <div className="pt-results">{keys.map((k) => <div key={k.key} className={`pt-result ${k.j.color}`} data-testid={`cert-${k.key}`} title={`${k.j.label}: ${valueText(k.j)} — ${k.j.plain}`}>
      <div className="name"><span>{k.title}</span><Tip text={k.j.plain} /></div>
      <div className="val">{k.j.value === null ? '—' : k.j.value.toLocaleString('en-IN', { minimumFractionDigits: k.j.decimals, maximumFractionDigits: k.j.decimals })}{k.j.unit ? <small>{k.j.unit}</small> : null}</div>
      <div className="verdict"><VerdictIcon color={k.j.color} />{VERDICT[k.j.color].label}</div>
      <div className="plain">{k.j.plain}</div>
      <div className="spec">Our specification: {specRange(k.j)}{specTarget(k.j) ? ` · ${specTarget(k.j)}` : ''}{k.j.unit ? ` ${k.j.unit}` : ''}</div>
    </div>)}</div>
    {sum.outside ? <div className="notice warn"><AlertTriangle size={18} /><div>{sum.outside === 1 ? 'One reading is' : `${sum.outside} readings are`} outside our specification — we list every result honestly. If you notice a problem with this lot, please tell us so our quality team can investigate.</div></div> : null}
    <div className="muted small">{samples.map((s) => <div key={s.sampleId}>{s.sampleLabel}: sample <span className="mono">{s.sampleId}</span> · tested {fmtDT(s.testedAt)}{s.instrument ? ` · ${s.instrument}` : ''}</div>)}{qm?.versionNo ? <div>Judged against our quality specification version {qm.versionNo}{qm.effectiveFrom ? ` (in force since ${fmtD(qm.effectiveFrom)})` : ''}.</div> : null}</div>
    <div style={{ margin: '0 -26px -24px', borderTop: '1px solid hsl(var(--border))' }}>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} exportName={`lot-${p.lot.lotNo}-test-results`} title={`Lot ${p.lot.lotNo} — test results (${p.lot.countDisplay})`} pageSize={50} dense
        footNote={<div className="legend"><span className="sw"><span className="judged green"><CheckCircle2 size={12} /></span> Within specification</span><span className="sw"><span className="judged yellow"><AlertTriangle size={12} /></span> Near the limit</span><span className="sw"><span className="judged red"><XCircle size={12} /></span> Outside specification</span><span>Hover a result to see what it means in plain words.</span></div>} />
    </div>
  </PCard>;
}

// ------------------------------------------------------------------ 4. packing
export function PackingSection({ p }: { p: LotPassport }): JSX.Element | null {
  const k = p.packing; if (!k) return null;
  return <PCard id="packing" title="4. How it was packed" icon={<Package size={20} />} lead="Cones are weighed, labelled and boxed. The colour of the cone tip tells you the yarn count at a glance." testId="portal-packing">
    <div className="pt-cone">
      <span className="pt-cone-sw" style={{ background: k.colorHex ?? 'hsl(var(--muted))' }} aria-label={`${k.colorActual} cone tip`} />
      <div className="grow"><b>{k.colorActual} tip = {p.lot.countDisplay}</b><div className="muted">{k.tip ?? `${k.colorActual} tip cone`} · the colour the mill uses for this count</div></div>
      {k.colorOk ? <span className="pill green"><CheckCircle2 size={14} /> Colour checked against the mill's colour code</span> : <span className="pill red"><XCircle size={14} /> Cone colour did not match the colour code ({k.colorMaster} expected)</span>}
    </div>
    <div className="pt-facts">
      <Fact label="Cartons" sub={`${k.cartonFrom} → ${k.cartonTo}`}>{k.cartons}</Fact>
      <Fact label="Cones" sub={`about ${k.avgConeKg.toFixed(2)} kg each`}>{k.conesPacked.toLocaleString('en-IN')}</Fact>
      <Fact label="Net weight of yarn" sub={`${kgText(k.grossKg)} with packing`}>{kgText(k.netKg)}</Fact>
      <Fact label="Packed on" sub={`Packing slip ${k.slipNo}`}>{fmtD(k.packedAt)}</Fact>
    </div>
    <div className="muted" style={{ fontSize: 14.5 }}>{[k.coneType, k.cartonType, k.polybag, k.strapping].filter(Boolean).join(' · ')}</div>
  </PCard>;
}

// ------------------------------------------------------------------ 5. dispatch + delivery
export function DeliverySection({ p }: { p: LotPassport }): JSX.Element {
  const d = p.dispatch; const pk = p.packing;
  if (!d) return <PCard title="5. Dispatch and delivery" icon={<Truck size={20} />}><div className="muted">This lot has not been dispatched to you yet.</div></PCard>;
  const delivered = d.status === 'DELIVERED';
  return <PCard id="delivery" title="5. Dispatch and delivery" icon={<Truck size={20} />} iconTone="amber" lead={delivered ? `Delivered to you on ${fmtD(d.deliveredAt)}.` : 'On its way to you.'} testId="portal-delivery" right={<DispatchPill status={d.status} />}>
    <div className="pt-ship">
      <div className="pt-ship-step done"><div className="bar" /><b><Check size={16} /> Packed</b><small>{pk ? fmtD(pk.packedAt) : '—'}</small></div>
      <div className="pt-ship-step done"><div className="bar" /><b><Truck size={16} /> Left the mill</b><small>{fmtDT(d.dispatchedAt)}</small></div>
      <div className={`pt-ship-step ${delivered ? 'done' : 'now'}`}><div className="bar" /><b>{delivered ? <PackageCheck size={16} /> : <Clock size={16} />} {delivered ? 'Delivered' : 'On the road'}</b><small>{delivered ? fmtDT(d.deliveredAt) : 'travelling to ' + (d.destination.split('—')[0].trim() || 'you')}</small></div>
    </div>
    <div className="pt-facts">
      <Fact label="Vehicle number"><VehicleBadge no={d.vehicleNo} /></Fact>
      <Fact label="Invoice" sub={`dated ${fmtD(d.invoiceDate)}`}>{d.invoiceNo}</Fact>
      <Fact label="Transporter" sub={`LR no. ${d.lrNo}`}>{d.transporter}</Fact>
      <Fact label="Driver">{d.driverName || '—'}</Fact>
      <Fact label={delivered ? 'Delivered to' : 'Delivering to'}>{d.destination}</Fact>
      <Fact label="This lot on the invoice" sub={`whole shipment: ${kgText(d.netKg)} · ${d.cartons} cartons · ${d.conesCount.toLocaleString('en-IN')} cones`}>{kgText(d.lotKg)}</Fact>
    </div>
  </PCard>;
}

// ------------------------------------------------------------------ 6. QR codes
export function QrSection({ p, canvasRef }: { p: LotPassport; canvasRef: MutableRefObject<HTMLCanvasElement | null> }): JSX.Element {
  const links = passportLinks(p, typeof window === 'undefined' ? '' : window.location.origin);
  const items = [
    { title: 'Scan a carton label', text: `Anyone can scan the QR on carton ${links.carton.code} to confirm this lot — no login needed.`, ...links.carton },
    ...(links.dispatch ? [{ title: 'Scan the shipment passport', text: 'The passport for the whole shipment (all lots on invoice ' + (p.dispatch?.invoiceNo ?? '') + ').', ...links.dispatch }] : []),
  ];
  return <PCard id="qr" title="6. Scan to verify" icon={<QrCode size={20} />} iconTone="chain" lead="These QR codes open the public passport of this yarn. It shows the same records and the proof from the mill's ledger." testId="portal-qr">
    <div className="pt-qr-grid">{items.map((i) => <div key={i.code} className="pt-qr">
      <span className="code"><QRCodeSVG value={i.url} size={140} level="M" marginSize={1} bgColor="#ffffff" fgColor="#111111" aria-label={`QR code for ${i.code}`} /></span>
      <div className="grow" style={{ minWidth: 160 }}><b>{i.title}</b><small>{i.text}</small><div className="url">{i.url}</div><a className="pt-link" href={`/passport/${i.code}`} target="_blank" rel="noreferrer" style={{ marginTop: 6 }}>Open the public page <ExternalLink size={15} /></a></div>
    </div>)}</div>
    <QRCodeCanvas ref={canvasRef} value={links.carton.url} size={320} level="M" marginSize={1} bgColor="#ffffff" fgColor="#111111" style={{ display: 'none' }} aria-hidden />
  </PCard>;
}

// ------------------------------------------------------------------ complaints already raised for this lot
export function LotComplaints({ p }: { p: LotPassport }): JSX.Element | null {
  if (!p.complaints.length) return null;
  return <PCard title="What you have told us about this lot" icon={<MessageSquareWarning size={20} />} iconTone="amber">
    <div className="pt-list">{p.complaints.map((c) => <Link key={c.id} to={`/portal/complaints/${c.id}`} className="pt-row"><div className="grow"><div className="t">Complaint {c.complaintNo}</div><div className="m">Raised {fmtD(c.receivedDate)}</div></div><ComplaintPill status={c.status} /><span className="pt-link">Track it</span></Link>)}</div>
  </PCard>;
}
