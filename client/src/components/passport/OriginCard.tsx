import { Link } from 'react-router-dom';
import { ArrowRight, Blend, Factory, Info, MapPin, Package, Sprout, Truck, Users, Warehouse } from 'lucide-react';
import type { BackTrace, LotPassport, PassportBale } from '@shared/domain';
import { PARAMS } from '@shared/params';
import { Card, CardBody, CardHead, ChainBadge, ColorPill, J, Legend, Pill, Skeleton } from '../ui';
import { DataTable, type Col } from '../DataTable';
import { fmtD, fmtDT, fmtDTShort } from '../../lib/fmt';
import { MasterTable } from './MasterTable';
import { cellVal, fmtKg, fmtN } from './util';

const HVI_KEYS = PARAMS.filter((p) => p.kind === 'FIBRE').map((p) => p.key);

function baleColumns(p: LotPassport): Col<PassportBale>[] {
  const hdr = (k: string) => { const j = p.bales[0]?.hvi.find((x) => x.key === k); return j ? { label: j.label.replace(/ \(.*\)$/, ''), unit: j.unit } : { label: k, unit: '' }; };
  return [
    { key: 'bale', header: 'Bale no', value: (b) => b.baleNo, render: (b) => <Link to={`/live?bale=${b.baleNo}`} className="bold mono-s" data-testid="bale-row" title="Track this bale: where it is now and which lots / customers received yarn from it">{b.baleNo}</Link> },
    { key: 'variety', header: 'Variety', value: (b) => b.variety, render: (b) => <span className="nowrap">{b.variety}</span> },
    { key: 'supplier', header: 'Supplier / ginner', value: (b) => `${b.supplier}, ${b.station}`, render: (b) => <>{b.supplier}<span className="pp-sub">{b.station} · gin lot {b.ginLot}</span></> },
    { key: 'store', header: 'Store location', value: (b) => `${b.bay} / ${b.bin}`, render: (b) => <Pill tone="gray" icon={<MapPin size={11} />} title={`Bale store ${b.bay}, bin ${b.bin}`}>{b.bay} · {b.bin}</Pill> },
    { key: 'recv', header: 'Received', value: (b) => fmtDT(b.receivedAt), render: (b) => <span className="nowrap">{fmtDTShort(b.receivedAt)}</span> },
    { key: 'iss', header: 'Issued to blow room', value: (b) => (b.issuedAt ? fmtDT(b.issuedAt) : ''), render: (b) => <span className="nowrap">{b.issuedAt ? fmtDTShort(b.issuedAt) : <Pill tone="blue">in store</Pill>}</span> },
    { key: 'kg', header: 'kg used', num: true, value: (b) => b.kgUsed, render: (b) => fmtN(b.kgUsed, 0) },
    { key: 'pct', header: '% of mix', num: true, value: (b) => b.pct, render: (b) => `${fmtN(b.pct, 1)}%` },
    ...HVI_KEYS.map((k): Col<PassportBale> => { const h = hdr(k); return { key: `hvi-${k}`, header: <>{h.label}<small>{h.unit}</small></>, exportHeader: `${h.label} ${h.unit}`.trim(), num: true, value: (b) => cellVal(b.hvi.find((x) => x.key === k)), render: (b) => <J j={b.hvi.find((x) => x.key === k)} plain />, color: (b) => b.hvi.find((x) => x.key === k)?.color }; }),
    { key: 'chain', header: 'On-chain', noExport: true, sortable: false, render: (b) => <ChainBadge chain={b.chain} /> },
  ];
}

function TraceChain({ t }: { t: BackTrace }): JSX.Element {
  const stageMach = [...new Set(t.stages.flatMap((s) => s.machines))];
  const nodes: { icon: JSX.Element; title: string; main: string; sub: string }[] = [
    { icon: <Users size={12} />, title: 'Customer', main: t.customer?.name ?? 'Not dispatched yet', sub: t.dispatch ? `Dispatch ${t.dispatch.dispatchNo} · ${t.dispatch.vehicleNo}` : 'Lot is still in the mill' },
    { icon: <Package size={12} />, title: 'Packing', main: t.packing ? `Slip ${t.packing.slipNo}` : 'Not packed yet', sub: t.packing ? `${t.packing.cartons} cartons ${t.packing.cartonFrom} … ${t.packing.cartonTo}` : 'Packing happens after winding' },
    { icon: <Factory size={12} />, title: 'Stages', main: `${t.stages.length} stages`, sub: `${stageMach.length} machines · ${t.stages.reduce((n, s) => n + s.batchRefs.length, 0)} batch refs` },
    { icon: <Blend size={12} />, title: 'Mix', main: `Mix ${t.mix.mixNo}`, sub: t.mix.recipe.map((r) => `${Math.round(r.pct)}% ${r.label.split(' ')[0]}`).join(' · ') },
    { icon: <Warehouse size={12} />, title: 'Bales', main: `${t.bales.length} bales`, sub: `${fmtN(t.bales.reduce((n, b) => n + b.kgUsed, 0), 0)} kg · ${[...new Set(t.bales.map((b) => b.bay))].join(', ')}` },
    { icon: <Sprout size={12} />, title: 'Suppliers', main: `${t.suppliers.length} supplier${t.suppliers.length === 1 ? '' : 's'}`, sub: t.suppliers.map((s) => s.station).join(' · ') },
  ];
  return <div className="pp-chain" aria-label="Back-trace from customer to cotton supplier">
    {nodes.map((n, i) => <span key={n.title} style={{ display: 'contents' }}>{i ? <span className="arrow"><ArrowRight size={16} /></span> : null}<div className="node"><span className="t">{n.icon}{n.title}</span><span className="m">{n.main}</span><span className="s">{n.sub}</span></div></span>)}
  </div>;
}

export function OriginCard({ p, trace }: { p: LotPassport; trace: { data?: BackTrace; isLoading: boolean; error: unknown } }): JSX.Element {
  const { mix } = p;
  const t = trace.data;
  return <div id="pp-origin" className="pp-anchor"><Card>
    <CardHead title={<span className="pp-sec"><Sprout size={17} /> Origin — the cotton behind this lot</span>} sub={<>Mix {mix.mixNo} · {fmtKg(mix.totalKg, 0)} blended in {mix.blowRoomLine ?? 'the blow room'}{mix.formedAt ? <> · formed {fmtDT(mix.formedAt)}</> : null}{mix.issuedAt ? <> · issued to the blow room {fmtDT(mix.issuedAt)}</> : null}</>}
      right={mix.otherLots.length ? <span className="muted small">Same mix also made: {mix.otherLots.map((l, i) => <span key={l.lotId}>{i ? ', ' : ''}<Link to={`/lots/${l.lotId}`} className="bold" style={{ color: 'hsl(var(--primary))' }}>Lot {l.lotNo}</Link></span>)}</span> : null} />
    <CardBody>
      <div className="stack" style={{ gap: 18 }}>
        <div className="stack" style={{ gap: 18 }}>
          <div className="stack tight">
            <h3 className="bold" style={{ fontSize: 13 }}>Mix ratio vs master band</h3>
            <div className="tbl-wrap"><table className="tbl dense" data-testid="mix-recipe">
              <thead><tr><th>Component</th><th>Share of the mix (marker) in the master band (bar)</th><th className="num">Actual</th><th className="num">kg</th><th>Master band</th><th>Status</th></tr></thead>
              <tbody>{mix.recipe.map((c) => <tr key={c.key}>
                <td><b>{c.label}</b><span className="pp-sub">{c.source === 'BALE' ? 'Cotton bales' : 'Recycled mill waste'}</span></td>
                <td style={{ minWidth: 170 }}><div className={`pp-band ${c.color}`} title={`${c.pct}% — master band ${c.minPct}–${c.maxPct}%`}><span className="rng" style={{ left: `${c.minPct}%`, width: `${c.maxPct - c.minPct}%` }} /><span className="mk" style={{ left: `${Math.min(100, c.pct)}%` }} /></div></td>
                <td className="num bold">{fmtN(c.pct, 1)}%</td><td className="num">{fmtN(c.kg, 0)}</td><td>{c.minPct} – {c.maxPct}%</td><td><ColorPill color={c.color} /></td>
              </tr>)}</tbody>
            </table></div>
            <div className="pp-rule" style={{ marginTop: 6 }}><Info size={15} /><div><b>Traceability rule.</b> Bales are blended in the blow room, so after mixing traceability is at <b>mix level</b>: every lot of mix {mix.mixNo} carries cotton from all {p.bales.length} bales below, in the ratio above.</div></div>
          </div>
          <div className="stack tight">
            <h3 className="bold" style={{ fontSize: 13 }}>Fibre properties of the blend (HVI / AFIS) vs the Count &amp; Mix master</h3>
            <MasterTable items={mix.fibre} showPlain testId="mix-fibre" />
          </div>
        </div>

        <div>
          <h3 className="bold" style={{ fontSize: 13, marginBottom: 6 }}>Bales in this mix — with their store locations</h3>
          <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 10, overflow: 'hidden' }}>
            <DataTable rows={p.bales} columns={baleColumns(p)} rowKey={(b) => b.id} pageSize={25} exportName={`lot-${p.lot.lotNo}-bales`} title={`Lot ${p.lot.lotNo} — bales of mix ${mix.mixNo}`} dense legend />
          </div>
        </div>

        <div>
          <h3 className="bold" style={{ fontSize: 13, marginBottom: 6 }}>Back-trace summary — customer to supplier</h3>
          {t ? <div className="stack">
            <TraceChain t={t} />
            <div className="grid g2" style={{ alignItems: 'start' }}>
              <div className="tbl-wrap"><table className="tbl dense" data-testid="trace-suppliers">
                <thead><tr><th>Supplier / ginner</th><th>Station</th><th className="num">Bales</th><th className="num">kg</th></tr></thead>
                <tbody>{t.suppliers.map((s) => <tr key={`${s.supplier}${s.station}`}><td><b>{s.supplier}</b></td><td>{s.station}</td><td className="num">{s.bales}</td><td className="num">{fmtN(s.kg, 0)}</td></tr>)}</tbody>
              </table></div>
              <div className="tbl-wrap"><table className="tbl dense" data-testid="trace-batches">
                <thead><tr><th>Stage</th><th>Machines</th><th>Batch references</th></tr></thead>
                <tbody>{t.stages.map((s) => <tr key={s.stage}><td><b>{s.label}</b><span className="pp-sub">{s.inAt ? fmtDTShort(s.inAt) : ''}{s.outAt ? ` → ${fmtDTShort(s.outAt)}` : ''}</span></td><td>{s.machines.join(', ') || '—'}</td><td><span className="mono-s">{s.batchRefs.join(', ') || '—'}</span></td></tr>)}</tbody>
              </table></div>
            </div>
            <div className="small muted">Customer {t.customer ? <b>{t.customer.name}</b> : '—'}{t.dispatch ? <> received it on dispatch {t.dispatch.dispatchNo} (invoice {t.dispatch.invoiceNo}, vehicle {t.dispatch.vehicleNo}, left {fmtD(t.dispatch.dispatchedAt)})</> : null}. <Link to={`/live?lot=${p.lot.lotNo}`} style={{ color: 'hsl(var(--primary))' }} className="bold no-print">Open the full back-trace →</Link></div>
          </div> : trace.error ? <div className="muted small">The back-trace could not be loaded.</div> : <Skeleton h={120} />}
        </div>
        <Legend chain />
      </div>
    </CardBody>
  </Card></div>;
}
void Truck;
