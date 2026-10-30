import { Link } from 'react-router-dom';
import { ClipboardList, FileDown, MapPin, Printer, Radar, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { LotLocation, LotPassport } from '@shared/domain';
import { COLOR_TEXT, ChainBadge, ColorIcon, ColorPill, J, Pill } from '../ui';
import { fmtD, fmtDT, fmtDuration } from '../../lib/fmt';
import { useCan } from '../masters/common';
import { CountPills, KV, LOT_STATUS, fmtKg, fmtN } from './util';

const SERIES = [1, 2, 3, 4, 5, 6, 7];

export function LocationPill({ loc }: { loc: LotLocation }): JSX.Element {
  const tone = loc.state === 'HOLD' ? 'red' : loc.state === 'DELIVERED' ? 'green' : loc.state === 'RUNNING' || loc.state === 'IN_TRANSIT' ? 'blue' : loc.state === 'WAITING' ? 'yellow' : 'gray';
  return <span className={`pill ${tone} pp-loc`} title={`${loc.label} — ${loc.detail}`} data-testid="lot-location"><MapPin size={12} /> {loc.label}<small>{loc.inStageMs !== null ? ` · ${fmtDuration(loc.inStageMs)} in this stage` : ''}</small></span>;
}

export function MixChips({ recipe }: { recipe: LotPassport['mix']['recipe'] }): JSX.Element {
  return <div className="pp-mix" data-testid="mix-ratio">
    <div className="pp-mixbar" role="img" aria-label={recipe.map((c) => `${c.label} ${c.pct}%`).join(', ')}>{recipe.map((c, i) => <i key={c.key} style={{ width: `${c.pct}%`, background: `hsl(var(--series-${SERIES[i % SERIES.length]}))` }} title={`${c.label} ${c.pct}%`} />)}</div>
    <div className="pp-chips">{recipe.map((c, i) => <span key={c.key} className={`pill ${c.color} pp-chip`} title={`${c.label}: ${c.pct}% of the mix (${fmtN(c.kg, 0)} kg).\nMaster band ${c.minPct}–${c.maxPct}% — ${COLOR_TEXT[c.color]}`}>
      <span className="sd" style={{ background: `hsl(var(--series-${SERIES[i % SERIES.length]}))` }} />{c.label} <b>{c.pct}%</b><ColorIcon color={c.color} size={12} />
    </span>)}</div>
  </div>;
}

export function PassportHeader({ p, canTrace, onExport, judgeLabel }: { p: LotPassport; canTrace: boolean; onExport: () => void; judgeLabel: string }): JSX.Element {
  const reg = useCan('Quality.registerComplaint');
  const { lot, summary, ledger, packing, dispatch, mix } = p;
  const st = LOT_STATUS[lot.status] ?? { label: lot.status, tone: 'gray' as const };
  const real = summary.realization;
  const allVerified = ledger.totalRecords > 0 && ledger.verifiedRecords === ledger.totalRecords;
  const qa = lot.qaReleased
    ? <Pill tone="green" icon={<ShieldCheck size={12} />} title={`QA release recorded on the ledger${lot.qaReleaseAt ? ` on ${fmtDT(lot.qaReleaseAt)}` : ''}`}>QA released{lot.qaReleaseAt ? ` ${fmtD(lot.qaReleaseAt)}` : ''}{lot.qaReleaseBy ? ` · ${lot.qaReleaseBy}` : ''}</Pill>
    : lot.status === 'ON_HOLD' ? <Pill tone="red" icon={<ShieldAlert size={12} />} title="The lot composite is out of master limits — dispatch is blocked until QA releases or overrides">On QA hold — not released</Pill>
    : lot.status === 'PLANNED' || lot.status === 'IN_PRODUCTION' ? <Pill tone="gray" icon={<ShieldCheck size={12} />} title="QA releases the lot after packing">QA release pending</Pill>
    : <Pill tone="red" icon={<ShieldAlert size={12} />} title="This lot left the packing stage without a QA release on record">No QA release on record</Pill>;
  return <section className={`pp-hero ${lot.worstColor === 'none' ? '' : lot.worstColor}`} data-testid="passport-header">
    <div className="pp-hero-in">
      <div className="pp-hero-top">
        <div className="stack" style={{ gap: 9, minWidth: 0 }}>
          <div className="eyebrow">Lot passport · {lot.lotCode}</div>
          <div className="pp-lotline"><span className="pp-lotno" data-testid="lot-number">Lot {lot.lotNo}</span><span className="pp-count">{lot.countDisplay}</span><Pill tone="gray" title={`Cotton mix ${mix.mixNo} — blended in ${mix.blowRoomLine ?? 'the blow room'}`}>Mix {mix.mixNo}</Pill><Pill tone={st.tone} >{st.label}</Pill></div>
          <div className="pp-pills">
            <LocationPill loc={lot.location} />
            {qa}
            <ChainBadge chain={lot.chain} label="Lot on-chain" />
            <span className={`pill ${allVerified ? 'chain' : 'red'}`} title={`${ledger.lotTxCount} ledger transactions · blocks #${ledger.firstBlock ?? '—'} to #${ledger.lastBlock ?? '—'}. Every record is re-hashed and compared with the hash anchored on the ledger.`} data-testid="ledger-verified">
              {allVerified ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />} {ledger.verifiedRecords} of {ledger.totalRecords} records verified
            </span>
            <span className="pill gray" title="Which master version every colour on this page is judged against (top-bar switch)">Masters: {judgeLabel}</span>
          </div>
        </div>
        <div className="pp-actions no-print">
          <button type="button" className="btn" onClick={() => window.print()} data-testid="passport-print" title="Print the whole passport (all tabs)"><Printer size={14} /> Print</button>
          <button type="button" className="btn" onClick={onExport} data-testid="passport-pdf" title="Download a PDF summary: header, journey and key results"><FileDown size={14} /> Export PDF</button>
          <Link className="btn" to={`/live?lot=${lot.lotNo}`} title="See where this lot is right now"><Radar size={14} /> Track live</Link>
          {canTrace ? <Link className="btn" to={`/developer?lot=${lot.lotNo}`} data-testid="passport-trace" title="Open this lot's ledger history in the Developer Console"><ScrollText size={14} /> Trace this lot&apos;s ledger history</Link> : null}
          {reg.can ? <Link className="btn primary" to={`/complaints/new?lot=${lot.lotNo}&type=HAIRINESS`} data-testid="passport-complaint"><ClipboardList size={14} /> Report a complaint</Link> : null}
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <div className="pp-kv" style={{ minWidth: 86 }}><span>Mix ratio</span></div>
        <div className="grow"><MixChips recipe={mix.recipe} /></div>
      </div>

      <div className="pp-facts">
        <KV label="Customer" sub={lot.dispatchNo ? <>Dispatch {lot.dispatchNo}</> : 'Not dispatched yet'}>{lot.customerName ?? '—'}</KV>
        <KV label="Started" sub="Blow room IN (IST)">{fmtDT(lot.startedAt) !== '—' ? fmtDT(lot.startedAt) : fmtD(lot.startDate)}</KV>
        <KV label="Packed" sub={packing ? `${packing.cartons} cartons · ${fmtKg(packing.netKg)} net` : 'Not packed yet'}>{packing ? fmtDT(packing.packedAt) : '—'}</KV>
        <KV label="Dispatched" sub={dispatch ? <>Vehicle {dispatch.vehicleNo}</> : 'Waiting for dispatch'}>{lot.dispatchedAt ? fmtDT(lot.dispatchedAt) : '—'}</KV>
        <KV label="Delivered" sub={lot.deliveredAt ? 'Customer confirmed' : lot.dispatchedAt ? 'Not yet delivered — in transit' : 'After dispatch'}>{lot.deliveredAt ? fmtDT(lot.deliveredAt) : '—'}</KV>
        <KV label="Realization vs master" title="Yarn packed ÷ cotton fed to the blow room, against the Count & Mix master target" sub={real ? `Master target ${fmtN(summary.targetRealizationPct, 1)}% · minimum ${fmtN(real.lower, 1)}%` : 'Known once the lot is packed'}>{real ? <J j={real} unit plain /> : '—'}</KV>
        <KV label="Cotton in → yarn out" sub={summary.wastePct !== null ? `Total waste ${fmtN(summary.wastePct, 1)}% (master ${fmtN(summary.targetWastePct, 1)}%)` : 'In production'}>{fmtKg(summary.cottonKg, 0)} → {summary.yarnKg !== null ? fmtKg(summary.yarnKg) : '…'}</KV>
        <KV label="Worst colour" title="Readings outside (red) or in the warning zone (yellow) of the master limits, across quality, production and accessories" sub="Across quality, production and accessories"><span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><ColorPill color={lot.worstColor} /><CountPills red={lot.red} yellow={lot.yellow} ok="No exceptions" /></span></KV>
      </div>
    </div>
  </section>;
}
