import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Printer, Truck } from 'lucide-react';
import { useGet, useMut } from '../lib/api';
import { useSession } from '../lib/store';
import type { GateResult } from '@shared/domain';
import type { OnChainRef } from '@shared/types';
import { fmtD, fmtDT, num } from '../lib/fmt';
import { Card, CardBody, CardHead, ChainBadge, ColorPill, Fact, Hash, KeyValues, Loading, Notice, PageHead, Pill } from '../components/ui';

interface Detail { id: string; dispatch_no: string; customer_id: string; customer_name: string; city: string; address: string; order_no: string | null; po_no: string | null; count_id: string; dispatched_at: string; invoice_no: string; invoice_date: string; vehicle_no: string; driver_name: string; driver_phone: string; transporter: string; lr_no: string; destination: string; cartons: number; cones_count: number; net_kg: number; gross_kg: number; delivered_at: string | null; status: string; qa_released: number; passport_code: string; remarks: string; chain: OnChainRef; gate: GateResult | null; overrideIds: string[]; lots: { lotId: string; lotNo: string; lotCode: string; quantityKg: number; cartons: number }[] }

export default function DispatchDetail(): JSX.Element {
  const { id = '' } = useParams(); const user = useSession((s) => s.user);
  const q = useGet<Detail>(`/api/dispatches/${encodeURIComponent(id)}`);
  const deliver = useMut<{ id: string }, unknown>('POST', (b) => `/api/dispatches/${b.id}/deliver`, 'Confirm delivery at the customer');
  const d = q.data; const url = d ? `${window.location.origin}/passport/${d.passport_code}` : '';
  return <div className="page" data-testid="dispatch-detail">
    <Loading q={q}>{d ? <>
      <PageHead eyebrow="CUSTODY RECORD" title={<span className="row">{d.dispatch_no} {d.status === 'DELIVERED' ? <Pill tone="green" icon={<CheckCircle2 size={12} />}>Delivered</Pill> : <Pill tone="blue" icon={<Truck size={12} />}>On the road</Pill>}</span>} sub={`${d.customer_name}, ${d.city} · ${d.lots.length} lot${d.lots.length > 1 ? 's' : ''} · ${num(d.net_kg, 1)} kg net`} right={<><button className="btn" onClick={() => window.print()}><Printer size={15} /> Print dispatch note</button>{d.status === 'DISPATCHED' && user && ['ADMIN', 'DISPATCH'].includes(user.role) ? <button className="btn primary" disabled={deliver.isPending} onClick={() => deliver.mutate({ id: d.id })} data-testid="confirm-delivery">Confirm delivery</button> : null}<Link className="btn" to="/dispatch">All dispatches</Link></>} />
      {!d.qa_released ? <Notice tone="bad">This consignment left the mill without a QA release — it needs regularisation by the QA head.</Notice> : null}
      {deliver.error ? <Notice tone="bad">{deliver.error.message}</Notice> : null}
      <div className="grid g-main">
        <Card><CardHead title="Consignment" right={<ChainBadge chain={d.chain} />} /><CardBody>
          <div className="grid g4" style={{ marginBottom: 14 }}><Fact label="Left the mill">{fmtDT(d.dispatched_at)}</Fact><Fact label="Invoice">{d.invoice_no}<br /><span className="muted small">{fmtD(d.invoice_date)}</span></Fact><Fact label="Vehicle number"><span className="mono">{d.vehicle_no}</span></Fact><Fact label="Delivered">{d.delivered_at ? fmtDT(d.delivered_at) : 'in transit'}</Fact></div>
          <KeyValues items={[['Customer', `${d.customer_name} — ${d.address}`], ['Destination', d.destination], ['Driver', `${d.driver_name}${d.driver_phone ? ` · ${d.driver_phone}` : ''}`], ['Transporter · LR no.', `${d.transporter} · ${d.lr_no}`], ['Order · PO', `${d.order_no ?? '—'} · ${d.po_no ?? '—'}`], ['Cartons · cones', `${d.cartons} cartons · ${d.cones_count} cones`], ['Net · gross weight', `${num(d.net_kg, 1)} kg · ${num(d.gross_kg, 1)} kg`], ['QA release', d.qa_released ? <ColorPill color="green" label="Released" /> : <ColorPill color="red" label="Not released" />], ['Remarks', d.remarks || '—']]} />
        </CardBody></Card>
        <Card tone="chain"><CardHead title="Product passport" sub="Printed as a QR on every carton" /><CardBody className="stack center"><div style={{ background: '#fff', padding: 10, borderRadius: 10, display: 'inline-block', margin: '0 auto' }}><QRCodeSVG value={url} size={150} /></div><div className="mono small">{d.passport_code}</div><Link className="btn" to={`/passport/${d.passport_code}`} target="_blank">Open public passport</Link></CardBody></Card>
      </div>
      <Card flush><CardHead title="Lots on this vehicle" /><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Lot</th><th>Code</th><th className="num">Quantity</th><th className="num">Cartons</th><th /></tr></thead><tbody>{d.lots.map((l) => <tr key={l.lotId}><td className="bold">{l.lotNo}</td><td className="mono small">{l.lotCode}</td><td className="num">{num(l.quantityKg, 1)} kg</td><td className="num">{l.cartons}</td><td className="right"><Link className="btn sm" to={`/lots/${l.lotId}`}>Lot passport</Link></td></tr>)}</tbody></table></div></Card>
      {d.gate ? <Card><CardHead title="Quality gate at dispatch" sub={`Checked ${fmtDT(d.gate.checkedAt)}`} right={<><ColorPill color={d.gate.passed ? 'green' : 'red'} label={d.gate.passed ? 'Passed' : 'Blocked'} />{d.overrideIds.length ? <Pill tone="chain">Override {d.overrideIds.join(', ')}</Pill> : null}</>} /><CardBody className="stack"><div>{d.gate.message}</div>{d.gate.lots.map((l) => <div key={l.lotId} className="row"><b>Lot {l.lotNo}</b><ColorPill color={l.worst} />{l.redItems.map((i) => <span key={i.parameter + i.stage} className="judged red" title={`${i.stage} ${i.parameter}: master ${i.lower ?? '–'} … ${i.std} … ${i.upper ?? '–'}`}>{i.stage} {i.label ?? i.parameter} {i.value}</span>)}{l.overrideId ? <Pill tone="chain">QA override</Pill> : null}</div>)}<div className="muted small">Ledger tx <Hash value={d.chain.txHash} /></div></CardBody></Card> : null}
    </> : null}</Loading>
  </div>;
}
