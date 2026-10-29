import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Truck } from 'lucide-react';
import { useGet, useMut } from '../lib/api';
import { useSession } from '../lib/store';
import type { GateResult } from '@shared/domain';
import { num } from '../lib/fmt';
import { Card, CardBody, CardHead, ColorPill, Field, Modal, Notice, PageHead, Pill } from '../components/ui';
import type { DispatchRow } from './Dispatch';

interface Ready { lotId: string; lotNo: string; countId: string; countDisplay: string; netKg: number; availableKg: number; cartons: number; status: string; qaReleased: boolean; colorOk: boolean }
interface Customer { id: string; name: string; city: string; address: string }

export default function DispatchNew(): JSX.Element {
  const nav = useNavigate(); const [sp] = useSearchParams(); const user = useSession((s) => s.user);
  const ready = useGet<Ready[]>('/api/dispatches/ready'); const customers = useGet<Customer[]>('/api/customers'); const all = useGet<DispatchRow[]>('/api/dispatches');
  const [customerId, setCustomerId] = useState(sp.get('customer') ?? ''); const [sel, setSel] = useState<Record<string, string>>(sp.get('lot') ? { [sp.get('lot') as string]: '' } : {});
  const [vehicle, setVehicle] = useState(''); const [driver, setDriver] = useState(''); const [phone, setPhone] = useState(''); const [transporter, setTransporter] = useState(''); const [lr, setLr] = useState(''); const [invoice, setInvoice] = useState(''); const [dest, setDest] = useState(''); const [remarks, setRemarks] = useState('');
  const [gate, setGate] = useState<GateResult | null>(null); const [err, setErr] = useState(''); const [override, setOverride] = useState<string | null>(null); const [reason, setReason] = useState('');
  const customer = customers.data?.find((c) => c.id === customerId);
  const first = (ready.data ?? []).find((l) => sel[l.lotId] !== undefined);
  const lots = useMemo(() => (ready.data ?? []).filter((l) => !first || l.countId === first.countId), [ready.data, first]);
  const chosen = (ready.data ?? []).filter((l) => sel[l.lotId] !== undefined);
  const nextInvoice = useMemo(() => { const n = Math.max(0, ...(all.data ?? []).map((d) => Number(/(\d+)$/.exec(d.invoiceNo)?.[1] ?? 0))) + 1; return `INV/26-27/${String(n).padStart(4, '0')}`; }, [all.data]);
  const transporters = [...new Set((all.data ?? []).map((d) => d.transporter))];
  const check = useMut<{ lotIds: string[] }, GateResult>('POST', '/api/dispatches/gate-check');
  const release = useMut<{ lotId: string }, unknown>('POST', (b) => `/api/lots/${b.lotId}/release`, (b) => `QA release of ${b.lotId}`);
  const ovr = useMut<{ lotId: string; reason: string }, unknown>('POST', (b) => `/api/lots/${b.lotId}/override`, (b) => `QA override for ${b.lotId}`);
  const create = useMut<Record<string, unknown>, { id: string }>('POST', '/api/dispatches', 'Create customer dispatch');
  const runGate = async () => { setErr(''); try { setGate(await check.mutateAsync({ lotIds: chosen.map((l) => l.lotId) })); } catch (e) { setErr(e instanceof Error ? e.message : 'Check failed'); } };
  const canQa = !!user && ['ADMIN', 'QA'].includes(user.role);
  const submit = async () => {
    setErr('');
    try {
      const d = await create.mutateAsync({ customerId, lots: chosen.map((l) => ({ lotId: l.lotId, quantityKg: Number(sel[l.lotId] || l.availableKg) })), vehicleNo: vehicle, driverName: driver, driverPhone: phone, transporter, lrNo: lr, invoiceNo: invoice || nextInvoice, destination: dest || (customer ? `${customer.city} — ${customer.address}` : ''), remarks });
      nav(`/dispatch/${d.id}`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Dispatch rejected'); }
  };
  return <div className="page" data-testid="dispatch-form">
    <PageHead eyebrow="CUSTODY" title="New dispatch" sub="Pick the customer and lots, check the quality gate, then enter the transport details. A lot must be QA-released (or carry a QA override) before it can leave." right={<Link className="btn" to="/dispatch">Back to dispatches</Link>} />
    {err ? <Notice tone="bad">{err}</Notice> : null}
    <div className="grid g-main">
      <div className="stack">
        <Card><CardHead title="1 · Customer and lots" sub="All lots on one vehicle must be of the same count." /><CardBody className="stack">
          <Field label="Customer"><select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)} data-testid="dsp-customer"><option value="">Select customer…</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} — {c.city}</option>)}</select></Field>
          <div className="tbl-wrap"><table className="tbl dense"><thead><tr><th /><th>Lot</th><th>Count</th><th className="num">Packed kg</th><th className="num">Available kg</th><th className="num">Cartons</th><th>QA</th><th className="num">Dispatch kg</th></tr></thead><tbody>
            {lots.map((l) => <tr key={l.lotId}><td><input type="checkbox" checked={sel[l.lotId] !== undefined} onChange={(e) => { const n = { ...sel }; if (e.target.checked) n[l.lotId] = ''; else delete n[l.lotId]; setSel(n); setGate(null); }} aria-label={`Select lot ${l.lotNo}`} data-testid={`dsp-lot-${l.lotNo}`} /></td><td className="bold"><Link to={`/lots/${l.lotId}`}>{l.lotNo}</Link></td><td>{l.countDisplay}</td><td className="num">{num(l.netKg, 1)}</td><td className="num">{num(l.availableKg, 1)}</td><td className="num">{l.cartons}</td><td>{l.status === 'ON_HOLD' ? <ColorPill color="red" label="On hold" /> : l.qaReleased ? <ColorPill color="green" label="Released" /> : <Pill tone="yellow">Awaiting release</Pill>}{!l.colorOk ? <> <ColorPill color="red" label="Cone colour" /></> : null}</td><td className="num"><input className="input sm" style={{ width: 90, textAlign: 'right' }} inputMode="decimal" disabled={sel[l.lotId] === undefined} placeholder={String(l.availableKg)} value={sel[l.lotId] ?? ''} onChange={(e) => setSel({ ...sel, [l.lotId]: e.target.value })} /></td></tr>)}
            {!lots.length ? <tr><td colSpan={8} className="center muted" style={{ padding: 20 }}>No packed lots are waiting in the finished-goods store.</td></tr> : null}</tbody></table></div>
        </CardBody></Card>
        <Card><CardHead title="2 · Quality gate and QA release" right={<button className="btn" disabled={!chosen.length || check.isPending} onClick={() => void runGate()} data-testid="gate-check"><ShieldCheck size={14} /> Check quality gate</button>} /><CardBody className="stack">
          {!gate ? <div className="muted">Select lots and run the gate check. Lot-level red results block dispatch unless QA records an override; machine-level reds are shown as warnings.</div> : <>
            <Notice tone={gate.passed ? 'ok' : 'bad'}>{gate.message}</Notice>
            {gate.lots.map((l) => <div key={l.lotId} className="card" style={{ padding: 12 }}><div className="row between"><b>Lot {l.lotNo}</b><span className="row"><ColorPill color={l.worst} label={l.blocked ? 'Blocked' : l.worst === 'red' ? 'Red — overridden' : l.worst === 'yellow' ? 'Warnings' : 'Clear'} />{l.released ? <Pill tone="green">QA released</Pill> : <Pill tone="yellow">Not released</Pill>}{l.overrideId ? <Pill tone="chain">Override {l.overrideId}</Pill> : null}</span></div>
              {l.redItems.length ? <div className="tbl-wrap"><table className="tbl dense"><tbody>{l.redItems.map((i) => <tr key={i.testResultId + i.parameter}><td>{i.stage} · {i.label}</td><td className="num"><span className="judged red">{i.value}</span></td><td className="muted small">master {i.lower ?? '–'} … {i.std} … {i.upper ?? '–'}</td></tr>)}</tbody></table></div> : null}
              {l.machineLevelRed.length ? <div className="muted small" style={{ marginTop: 6 }}>{l.machineLevelRed.length} machine-level red reading(s) noted as warnings.</div> : null}
              <div className="row" style={{ marginTop: 8 }}>
                {canQa && !l.released && !l.blocked ? <button className="btn sm ok" disabled={release.isPending} onClick={async () => { try { await release.mutateAsync({ lotId: l.lotId }); await runGate(); } catch (e) { setErr(e instanceof Error ? e.message : 'Release failed'); } }} data-testid={`release-${l.lotNo}`}>QA release lot {l.lotNo}</button> : null}
                {canQa && l.blocked ? <button className="btn sm danger" onClick={() => setOverride(l.lotId)}>Record QA override…</button> : null}
              </div></div>)}</>}
        </CardBody></Card>
      </div>
      <div className="stack">
        <Card><CardHead title={<span className="row"><Truck size={16} /> 3 · Consignment details</span>} /><CardBody className="stack">
          <Field label="Vehicle number" hint="Format TN-39-AB-4521"><input className="input mono" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="TN-39-AB-4521" data-testid="dsp-vehicle" /></Field>
          <div className="grid g2"><Field label="Driver"><input className="input" value={driver} onChange={(e) => setDriver(e.target.value)} /></Field><Field label="Driver phone"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field></div>
          <div className="grid g2"><Field label="Transporter"><input className="input" list="transporters" value={transporter} onChange={(e) => setTransporter(e.target.value)} /><datalist id="transporters">{transporters.map((t) => <option key={t} value={t} />)}</datalist></Field><Field label="LR number"><input className="input" value={lr} onChange={(e) => setLr(e.target.value)} placeholder="SRM/26/10544" /></Field></div>
          <Field label="Invoice number"><input className="input mono" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder={nextInvoice} /></Field>
          <Field label="Destination"><input className="input" value={dest} onChange={(e) => setDest(e.target.value)} placeholder={customer ? `${customer.city} — ${customer.address}` : ''} /></Field>
          <Field label="Remarks"><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
          <button className="btn primary" disabled={!customerId || !chosen.length || !vehicle || !driver || !transporter || !lr || create.isPending} onClick={() => void submit()} data-testid="dsp-create">Create dispatch and issue QR passport</button>
          <div className="muted small">{chosen.length} lot(s) · {num(chosen.reduce((s, l) => s + Number(sel[l.lotId] || l.availableKg), 0), 1)} kg</div>
        </CardBody></Card>
      </div>
    </div>
    {override ? <Modal title="Record a QA override" onClose={() => setOverride(null)} footer={<><button className="btn" onClick={() => setOverride(null)}>Cancel</button><button className="btn danger" disabled={reason.trim().length < 15 || ovr.isPending} onClick={async () => { try { await ovr.mutateAsync({ lotId: override, reason }); setOverride(null); setReason(''); await runGate(); } catch (e) { setErr(e instanceof Error ? e.message : 'Rejected'); setOverride(null); } }}>Record override</button></>}>
      <div className="stack"><Notice tone="warn">An override lets a lot with red lot-level results leave the mill. It is a signed ledger record with your name and reason.</Notice><Field label="Reason (at least 15 characters)"><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div></Modal> : null}
  </div>;
}
