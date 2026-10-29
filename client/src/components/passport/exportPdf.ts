import jsPDF from 'jspdf';
import autoTable, { type CellHookData } from 'jspdf-autotable';
import type { BackTrace, LotPassport, QualityColor } from '@shared/domain';
import { fmtD, fmtDT, fmtDTShort, fmtDuration } from '../../lib/fmt';
import { collectFindings, groupFindings, SOURCE_LABEL } from './findings';
import { devText, fmtKg, fmtN, rangeText, tally } from './util';

const RGB: Record<string, [number, number, number]> = { green: [209, 250, 229], yellow: [254, 243, 199], red: [254, 226, 226] };
const MAP: Record<string, string> = { '—': '-', '–': '-', '−': '-', '…': '...', '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '✔': 'OK', '✖': 'X', '·': '|', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '-', '×': 'x', ' ': ' ' };
/** jsPDF's built-in fonts only cover Latin-1: swap the few typographic characters the product uses. */
export const pdfText = (v: unknown): string => String(v ?? '').replace(/[—–−…→←≤≥✔✖·‘’“”•× ]/g, (c) => MAP[c] ?? c).replace(/[^\x20-\x7e -ÿ]/g, '');

type Cell = string | number | null | undefined;

export function exportPassportPdf(p: LotPassport, trace: BackTrace | undefined, millName: string, judgeLabel: string): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(); const H = doc.internal.pageSize.getHeight();
  const M = 34; let y = 0;
  const lot = p.lot;
  const last = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;

  // ---- title band
  doc.setFillColor(41, 54, 92); doc.rect(0, 0, W, 64, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(pdfText(`Lot Passport - Lot ${lot.lotNo}  (${lot.countDisplay})`), M, 30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(pdfText(`${millName}  |  lot code ${lot.lotCode}  |  mix ${p.mix.mixNo}  |  generated ${fmtDT(p.generatedAt)} IST  |  masters judged: ${judgeLabel}`), M, 48);
  doc.setTextColor(0); y = 82;

  const ensure = (h: number) => { if (y + h > H - 46) { doc.addPage(); y = M; } };
  const section = (title: string, note?: string) => {
    ensure(60);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(41, 54, 92); doc.text(pdfText(title), M, y);
    doc.setDrawColor(41, 54, 92); doc.setLineWidth(0.6); doc.line(M, y + 3, W - M, y + 3);
    doc.setTextColor(0); y += 14;
    if (note) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110); doc.text(pdfText(note), M, y); doc.setTextColor(0); y += 10; }
  };
  const table = (head: string[], body: Cell[][], opts: { colors?: (QualityColor | undefined)[][]; widths?: Record<number, number>; font?: number; headFill?: [number, number, number] } = {}) => {
    autoTable(doc, {
      startY: y, margin: { left: M, right: M }, theme: 'grid', head: [head.map(pdfText)], body: body.map((r) => r.map((c) => pdfText(c))),
      styles: { fontSize: opts.font ?? 7.5, cellPadding: 2.5, lineColor: [210, 210, 210], lineWidth: 0.3, textColor: 20 },
      headStyles: { fillColor: opts.headFill ?? [41, 54, 92], textColor: 255, fontSize: opts.font ?? 7.5 },
      columnStyles: Object.fromEntries(Object.entries(opts.widths ?? {}).map(([k, v]) => [k, { cellWidth: v }])),
      didParseCell: (d: CellHookData) => { if (d.section === 'body') { const c = opts.colors?.[d.row.index]?.[d.column.index]; if (c && RGB[c]) d.cell.styles.fillColor = RGB[c]; } },
    });
    y = last() + 12;
  };

  // ---- header facts
  const real = p.summary.realization; const k = p.packing; const d = p.dispatch;
  section('Header');
  table(['Item', 'Value', 'Item', 'Value'], [
    ['Lot', `${lot.lotNo} (${lot.lotCode})`, 'Count', lot.countDisplay],
    ['Status', lot.status.replace(/_/g, ' ').toLowerCase(), 'Where it is now', `${lot.location.label}${lot.location.inStageMs !== null ? ` (${fmtDuration(lot.location.inStageMs)} in this stage)` : ''}`],
    ['Customer', lot.customerName ?? '-', 'Dispatch', lot.dispatchNo ?? '-'],
    ['Started (blow room IN)', fmtDT(lot.startedAt), 'Packed', k ? fmtDT(k.packedAt) : '-'],
    ['Dispatched', lot.dispatchedAt ? fmtDT(lot.dispatchedAt) : '-', 'Delivered', lot.deliveredAt ? fmtDT(lot.deliveredAt) : lot.dispatchedAt ? 'in transit' : '-'],
    ['QA release', lot.qaReleased ? `released ${fmtD(lot.qaReleaseAt)} by ${lot.qaReleaseBy ?? '-'}` : lot.status === 'ON_HOLD' ? 'ON HOLD - not released' : 'not released', 'Ledger', `${p.ledger.verifiedRecords} of ${p.ledger.totalRecords} records verified (blocks #${p.ledger.firstBlock ?? '-'} to #${p.ledger.lastBlock ?? '-'})`],
    ['Realization vs master', real ? `${fmtN(real.value, 1)}% (master target ${fmtN(p.summary.targetRealizationPct, 1)}%, min ${fmtN(real.lower, 1)}%) - ${real.text}` : '-', 'Cotton in -> yarn out', `${fmtKg(p.summary.cottonKg, 0)} -> ${p.summary.yarnKg === null ? 'in production' : fmtKg(p.summary.yarnKg)}`],
    ['Worst colour', `${lot.worstColor.toUpperCase()}  (${lot.red} red, ${lot.yellow} yellow readings)`, 'Mix ratio', p.mix.recipe.map((r) => `${r.pct}% ${r.label}`).join(', ')],
  ], { colors: [[], [], [], [], [], [lot.qaReleased ? undefined : 'red', undefined, undefined, undefined], [undefined, real?.color, undefined, undefined], [undefined, lot.worstColor === 'none' ? undefined : lot.worstColor]].map((r) => r as (QualityColor | undefined)[]), widths: { 0: 90, 2: 90 } });

  // ---- mix
  section('Mix ratio vs master band', `Mix ${p.mix.mixNo} - ${fmtKg(p.mix.totalKg, 0)} - ${p.bales.length} bales. Bales are blended in the blow room, so traceability after mixing is at mix level.`);
  table(['Component', 'Source', 'Share %', 'kg', 'Master band', 'Status'], p.mix.recipe.map((r) => [r.label, r.source === 'BALE' ? 'cotton bales' : 'recycled waste', fmtN(r.pct, 1), fmtN(r.kg, 0), `${r.minPct} - ${r.maxPct}%`, r.color === 'green' ? 'Within band' : r.color === 'yellow' ? 'Near the band edge' : 'Out of band']), { colors: p.mix.recipe.map((r) => [undefined, undefined, r.color, undefined, undefined, r.color]) });
  table(['Fibre property of the blend', 'Unit', 'Actual', 'Std', 'Limits', 'Deviation', 'Master', 'Status'], p.mix.fibre.map((j) => [j.label, j.unit, fmtN(j.value, j.decimals), fmtN(j.std, j.decimals), rangeText(j), devText(j), j.versionNo ? `v${j.versionNo}` : '-', j.text]), { colors: p.mix.fibre.map((j) => [undefined, undefined, j.color, undefined, undefined, undefined, undefined, j.color]) });

  // ---- journey
  section('Journey - every stage with IN / OUT and waiting time', 'Times in IST.');
  table(['Stage', 'Machines / place', 'IN', 'OUT', 'Duration', 'Waited before', 'kg in', 'kg out', 'Waste %'], p.journey.map((s) => [s.label, [...new Set(s.machines.map((m) => m.label))].join(', ') || s.location || '-', s.inAt ? fmtDTShort(s.inAt) : '-', s.outAt ? fmtDTShort(s.outAt) : s.state === 'CURRENT' ? 'in progress' : '-', s.durationMs !== null ? fmtDuration(s.durationMs) : '-', s.dwellBeforeMs !== null ? fmtDuration(s.dwellBeforeMs) : '-', s.kgIn ? fmtN(s.kgIn, 1) : '-', s.kgOut ? fmtN(s.kgOut, 1) : '-', s.wastePct === null ? '-' : fmtN(s.wastePct, 2)]),
    { colors: p.journey.map((s) => [s.worst === 'none' ? undefined : s.worst]), widths: { 1: 90 } });

  // ---- bales
  section('Origin - bales with store locations');
  table(['Bale', 'Variety', 'Supplier / ginner (station)', 'Bay / bin', 'Received', 'Issued', 'kg used', '% mix'], p.bales.map((b) => [b.baleNo, b.variety, `${b.supplier} (${b.station})`, `${b.bay} / ${b.bin}`, fmtDTShort(b.receivedAt), b.issuedAt ? fmtDTShort(b.issuedAt) : 'in store', fmtN(b.kgUsed, 0), fmtN(b.pct, 1)]));
  if (trace) table(['Supplier / ginner', 'Station', 'Bales', 'kg'], trace.suppliers.map((s) => [s.supplier, s.station, s.bales, fmtN(s.kg, 0)]), { headFill: [90, 100, 140] });

  // ---- key results
  const groups = groupFindings(collectFindings(p)).filter((g) => g.worst.color === 'red');
  const counts = tally([...p.quality.flatMap((q) => q.samples.flatMap((s) => s.values)), ...p.production.flatMap((s) => s.runs.flatMap((r) => r.params)), ...p.accessories.flatMap((a) => a.items)]);
  section('Key results - what is outside the master', `${counts.red} red and ${counts.yellow} yellow readings across quality, production and accessories. Red findings, grouped by parameter:`);
  if (groups.length) table(['Stage', 'Parameter', 'Source', 'Where', 'Readings', 'Worst value', 'Master limits (version)', 'Deviation'], groups.map((g) => { const w = g.worst; return [g.stageLabel, g.label, SOURCE_LABEL[g.source], g.where.map((x) => (x.n > 1 ? `${x.name} x${x.n}` : x.name)).join(', '), `${g.red} red${g.yellow ? `, ${g.yellow} yellow` : ''}`, w.j ? `${fmtN(w.j.value, w.j.decimals)} ${w.j.unit}` : w.text, w.j ? `${rangeText(w.j)} ${w.j.unit} (${w.j.versionNo ? `v${w.j.versionNo}` : '-'})` : '-', w.j ? devText(w.j) : '-']; }), { colors: groups.map(() => [undefined, undefined, undefined, undefined, undefined, 'red', undefined, undefined]), widths: { 3: 80 } });
  else { doc.setFontSize(9); doc.text('No red findings - every reading is within its master limits.', M, y + 4); y += 18; }

  // ---- lot composites
  const comps = p.quality.flatMap((q) => q.samples.filter((s) => s.type === 'LOT').map((s) => ({ q, s })));
  if (comps.length) {
    section('Lot composite results (the samples QA releases the lot on)');
    for (const { q, s } of comps) table([`${q.label} - ${s.sampleId} (${fmtDT(s.testedAt)})`, 'Unit', 'Value', 'Std', 'Limits', 'Master', 'Status'], s.values.map((j) => [j.label, j.unit, fmtN(j.value, j.decimals), fmtN(j.std, j.decimals), rangeText(j), j.versionNo ? `v${j.versionNo}` : '-', j.text]), { colors: s.values.map((j) => [undefined, undefined, j.color, undefined, undefined, undefined, j.color]), widths: { 0: 150 } });
  }

  // ---- production summary + accessories
  if (p.production.length) {
    section('Production summary by stage', 'Waste and yield are judged against the Production master for the stage total.');
    table(['Stage', 'Runs', 'kg in', 'kg out', 'Waste kg', 'Waste %', 'Waste vs master', 'Yield vs master'], p.production.map((s) => [s.label, s.runs.length, fmtN(s.totals.inKg, 1), fmtN(s.totals.outKg, 1), fmtN(s.totals.wasteKg, 1), fmtN(s.totals.wastePct, 2), s.totals.waste ? `${fmtN(s.totals.waste.value, 2)} (${rangeText(s.totals.waste)}) ${s.totals.waste.text}` : '-', s.totals.yield ? `${fmtN(s.totals.yield.value, 1)} (${rangeText(s.totals.yield)}) ${s.totals.yield.text}` : '-']), { colors: p.production.map((s) => [undefined, undefined, undefined, undefined, undefined, undefined, s.totals.waste?.color, s.totals.yield?.color]) });
  }
  const accRows = p.accessories.flatMap((a) => a.items.map((j) => ({ a, j })));
  if (accRows.length) {
    section('Accessories - age against the life master');
    table(['Machine', 'Accessory', 'Spec', 'Value', 'Master limit', 'Version', 'Status'], accRows.map(({ a, j }) => [a.machineLabel, j.label, j.spec ?? '-', `${fmtN(j.value, j.decimals)} ${j.unit}`, rangeText(j), j.versionNo ? `v${j.versionNo}` : '-', j.text]), { colors: accRows.map(({ j }) => [undefined, undefined, undefined, j.color, undefined, undefined, j.color]) });
  }

  // ---- packing + dispatch
  if (k) {
    section('Packing record');
    table(['Item', 'Value', 'Item', 'Value'], [
      ['Slip', k.slipNo, 'Packed', `${fmtDT(k.packedAt)} by ${k.packerName}`],
      ['Package', `${k.packageType === 'CHEESE' ? 'Cheese' : 'Cone'} - ${k.coneType ?? '-'}`, 'Cartons', `${k.cartons} (${k.cartonFrom} ... ${k.cartonTo})`],
      ['Cones', k.conesPacked, 'Net / tare / gross', `${fmtKg(k.netKg)} / ${fmtKg(k.tareKg, 2)} / ${fmtKg(k.grossKg)}`],
      ['Cone colour', `actual ${k.colorActual} vs master ${k.colorMaster} - ${k.colorOk ? 'verified' : 'MISMATCH'}`, 'FG location', `${k.fgLocation} (${k.pallets} pallet${k.pallets === 1 ? '' : 's'})`],
    ], { colors: [[], [], [], [undefined, k.colorOk ? 'green' : 'red']], widths: { 0: 80, 2: 90 } });
    table(['Per-carton check', 'Unit', 'Actual', 'Std', 'Limits', 'Master', 'Status'], k.checks.map((j) => [j.label, j.unit, fmtN(j.value, j.decimals), fmtN(j.std, j.decimals), rangeText(j), j.versionNo ? `v${j.versionNo}` : '-', j.text]), { colors: k.checks.map((j) => [undefined, undefined, j.color, undefined, undefined, undefined, j.color]) });
  }
  if (d) {
    section('Dispatch & delivery');
    table(['Item', 'Value', 'Item', 'Value'], [
      ['Dispatch', d.dispatchNo, 'Customer', d.customerName],
      ['Left the mill', fmtDT(d.dispatchedAt), 'Invoice', `${d.invoiceNo} (${fmtD(d.invoiceDate)})`],
      ['Vehicle number', d.vehicleNo, 'Driver', `${d.driverName} ${d.driverPhone}`],
      ['Transporter', d.transporter, 'LR no.', d.lrNo],
      ['Destination', d.destination, 'Cartons / cones', `${d.cartons} / ${d.conesCount}`],
      ['Net / gross', `${fmtKg(d.netKg)} / ${fmtKg(d.grossKg)}`, 'This lot', fmtKg(d.lotKg)],
      ['QA released', d.qaReleased ? 'yes' : 'NO', 'Delivery', d.deliveredAt ? `delivered ${fmtDT(d.deliveredAt)}` : 'in transit'],
      ['Other lots on the vehicle', d.alsoInDispatch.map((o) => `Lot ${o.lotNo}`).join(', ') || '-', 'Public passport', `${window.location.origin}/passport/${d.passportCode}`],
    ], { colors: [[], [], [], [], [], [], [undefined, d.qaReleased ? 'green' : 'red']], widths: { 0: 90, 2: 80 } });
  }
  section('Complaints');
  if (p.complaints.length) table(['No.', 'Type', 'Status', 'Received', 'Description', 'Root cause'], p.complaints.map((c) => [c.complaintNo, c.type.replace(/_/g, ' ').toLowerCase(), c.status.replace(/_/g, ' ').toLowerCase(), fmtD(c.receivedDate), c.description, c.rootCause ?? 'analysis open']), { widths: { 4: 150, 5: 150 } });
  else { doc.setFontSize(9); doc.text('No complaint registered for this lot.', M, y + 4); y += 18; }

  // ---- footers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
    doc.text(pdfText(`TexTrace | Lot ${lot.lotNo} | green = within master, yellow = warning, red = out of tolerance | ${p.ledger.verifiedRecords}/${p.ledger.totalRecords} records verified on the ledger`), M, H - 20);
    doc.text(`Page ${i} / ${pages}`, W - M, H - 20, { align: 'right' });
  }
  doc.save(`lot-${lot.lotNo}-passport.pdf`);
}
