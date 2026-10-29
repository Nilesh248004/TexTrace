// "Download quality certificate (PDF)" — customer, lot, count, mix, dates, lot-level test results with within-spec marks and the ledger proof.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { LotPassport } from '@shared/domain';
import { fmtD, fmtDT } from '../../lib/fmt';
import { VERDICT, blendParts, blendSentence, certSummary, certificateRows, origins, passportLinks, specRange, specTarget, valueText, verification } from './passportModel';

export interface CertificateInput { passport: LotPassport; customerName: string; millName: string; origin: string; qrDataUrl?: string | null }

/** Standard PDF fonts only cover Latin-1: swap the few symbols the data contains. */
const clean = (s: unknown): string => String(s ?? '').replace(/[−–—]/g, '-').replace(/→/g, '->').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/…/g, '...').replace(/[^\x20-\x7E -ÿ]/g, '');
const FILL: Record<string, [number, number, number]> = { green: [209, 250, 229], yellow: [254, 243, 199], red: [254, 226, 226] };

export function buildCertificate(i: CertificateInput): jsPDF {
  const p = i.passport; const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(); const H = doc.internal.pageSize.getHeight(); const M = 40; const inner = W - M * 2;
  const rows = certificateRows(p); const sum = certSummary(rows); const v = verification(p); const links = passportLinks(p, i.origin);
  const d = p.dispatch; const k = p.packing; const delivered = d?.status === 'DELIVERED';
  const finalY = (fallback: number) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;

  // ---- header band
  doc.setFillColor(41, 54, 92); doc.rect(0, 0, W, 92, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text('Quality certificate', M, 42);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.text(clean(`${i.millName}  |  TexTrace mill-to-customer traceability`), M, 62);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(clean(`Lot ${p.lot.lotNo}  |  ${p.lot.countDisplay}`), W - M, 42, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text(`Issued ${fmtDT(p.generatedAt)} IST`, W - M, 62, { align: 'right' });
  doc.setTextColor(30);

  // ---- lot details
  const info: string[][] = [
    ['Customer', i.customerName, 'Lot number', `${p.lot.lotNo}  (code ${p.lot.lotCode})`],
    ['Yarn count', p.lot.countDisplay, 'Cotton mix', `${p.mix.mixNo}  -  ${blendSentence(blendParts(p))}`],
    ['Spinning period', `${fmtD(p.lot.startDate)}${p.lot.endDate ? ` to ${fmtD(p.lot.endDate)}` : ''}`, 'Quality released', p.lot.qaReleaseAt ? fmtD(p.lot.qaReleaseAt) : 'Not recorded'],
    ['Packed', k ? `${fmtD(k.packedAt)}  -  ${k.cartons} cartons, ${k.conesPacked.toLocaleString('en-IN')} cones, ${k.netKg.toLocaleString('en-IN')} kg net` : '-', 'Cone colour', k ? `${k.colorActual} tip${k.colorOk ? ' (matches colour code)' : ''}` : '-'],
    ['Dispatched', d ? `${fmtD(d.dispatchedAt)}  -  invoice ${d.invoiceNo}` : 'Not yet dispatched', 'Vehicle / transporter', d ? `${d.vehicleNo}  -  ${d.transporter}, LR ${d.lrNo}` : '-'],
    ['Delivery', d ? (delivered ? `Delivered ${fmtD(d.deliveredAt)}` : 'On the road to the customer') : '-', 'Quantity of this lot', d ? `${d.lotKg.toLocaleString('en-IN')} kg` : '-'],
  ].map((r) => r.map(clean));
  autoTable(doc, { startY: 112, body: info, theme: 'plain', styles: { fontSize: 9, cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 6 }, textColor: [30, 30, 30], overflow: 'linebreak' }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 82, textColor: [90, 90, 90] }, 1: { cellWidth: 175 }, 2: { fontStyle: 'bold', cellWidth: 92, textColor: [90, 90, 90] }, 3: { cellWidth: 'auto' } }, margin: { left: M, right: M } });

  // ---- origin
  let y = finalY(200) + 14;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Cotton origin', M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const og = origins(p).map((g) => clean(`${g.supplier}, ${g.station}: ${g.varieties.join(' + ')}, ${g.bales} bale${g.bales === 1 ? '' : 's'}, ${g.kg.toLocaleString('en-IN')} kg (gin lot ${g.ginLots.join(', ')})`));
  y += 14; for (const line of og) { for (const l of doc.splitTextToSize(line, inner) as string[]) { doc.text(l, M, y); y += 12; } }

  // ---- results
  y += 8; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Laboratory results (composite sample of the whole lot)', M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  doc.text(clean(`${sum.total} readings: ${sum.within} within specification, ${sum.near} near the limit, ${sum.outside} outside specification.`), M, y + 13);
  doc.setTextColor(30);
  autoTable(doc, {
    startY: y + 22, margin: { left: M, right: M },
    head: [['Test sample', 'Parameter', 'Result', 'Specification', 'Status']],
    body: rows.map((r) => [clean(r.sampleLabel), clean(r.j.label), clean(valueText(r.j)), clean(`${specRange(r.j)}${r.j.unit ? ` ${r.j.unit}` : ''}${specTarget(r.j) ? `  (${specTarget(r.j)})` : ''}`), VERDICT[r.j.color].label.toUpperCase()]),
    styles: { fontSize: 8, cellPadding: 3.2 }, headStyles: { fillColor: [41, 54, 92], textColor: 255 }, alternateRowStyles: { fillColor: [248, 248, 247] },
    columnStyles: { 2: { halign: 'right', fontStyle: 'bold' }, 4: { fontStyle: 'bold', cellWidth: 92 } },
    didParseCell: (h) => { if (h.section === 'body') { const c = rows[h.row.index]?.j.color; if (c && FILL[c] && (h.column.index === 2 || h.column.index === 4)) h.cell.styles.fillColor = FILL[c]; } },
  });

  // ---- ledger proof
  y = finalY(400) + 18;
  const boxH = 118; if (y + boxH > H - 56) { doc.addPage(); y = 50; }
  doc.setDrawColor(98, 80, 214); doc.setFillColor(244, 242, 253); doc.roundedRect(M, y, inner, boxH, 6, 6, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(60, 48, 150); doc.text('Proof on the mill\'s ledger', M + 12, y + 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8); doc.setTextColor(40);
  const textW = inner - 24 - (i.qrDataUrl ? 92 : 0); let ty = y + 33;
  for (const l of doc.splitTextToSize(clean(`${v.lead} - ${v.text}  ${v.detail}.`), textW) as string[]) { doc.text(l, M + 12, ty); ty += 11.5; }
  doc.setFont('courier', 'normal'); doc.setFontSize(7.4);
  for (const l of doc.splitTextToSize(`Block #${p.lot.chain.blockNumber ?? '-'}  transaction ${p.lot.chain.txHash ?? '-'}`, textW) as string[]) { doc.text(l, M + 12, ty); ty += 9.5; }
  for (const l of doc.splitTextToSize(`Record fingerprint ${p.lot.chain.recordHash ?? '-'}`, textW) as string[]) { doc.text(l, M + 12, ty); ty += 9.5; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(60, 48, 150);
  for (const l of doc.splitTextToSize(`Verify online (no login): ${links.carton.url}`, textW) as string[]) { doc.text(l, M + 12, ty + 3); ty += 10; }
  if (i.qrDataUrl) { try { doc.addImage(i.qrDataUrl, 'PNG', M + inner - 92, y + 14, 80, 80); doc.setFontSize(7); doc.setTextColor(90); doc.text('Scan to verify', M + inner - 52, y + 104, { align: 'center' }); } catch { /* QR is optional */ } }

  // ---- footer on every page
  const qm = p.masters.find((m) => m.type === 'QUALITY'); const n = doc.getNumberOfPages();
  for (let pg = 1; pg <= n; pg++) {
    doc.setPage(pg); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(clean(`Results are judged against the mill's quality specification${qm?.versionNo ? ` version ${qm.versionNo}` : ''}. Generated from the mill's ledger records for lot ${p.lot.lotNo}.`), M, H - 30);
    doc.text(`TexTrace  |  page ${pg} of ${n}`, W - M, H - 30, { align: 'right' });
  }
  return doc;
}

export function downloadCertificate(i: CertificateInput): void {
  buildCertificate(i).save(`quality-certificate-lot-${i.passport.lot.lotNo}.pdf`);
}
