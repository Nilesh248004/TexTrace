import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, MessageSquareWarning } from 'lucide-react';
import type { LotPassport } from '@shared/domain';
import { useGet } from '../lib/api';
import { useSession } from '../lib/store';
import { Loading, Notice } from '../components/ui';
import { PCard, useMeta } from '../components/portal/ui';
import { CertificatesSection, DeliverySection, JourneySection, LotComplaints, LotHero, OriginSection, PackingSection, QrSection } from '../components/portal/PassportSections';
import { downloadCertificate } from '../components/portal/certificatePdf';
import type { PortalSummary } from '../components/portal/types';

const JUMPS = [['origin', 'Origin'], ['journey', 'How it was made'], ['certificates', 'Test certificates'], ['packing', 'Packing'], ['delivery', 'Delivery'], ['qr', 'Scan to verify']];

/** The Lot Passport, customer version: a story rather than a spreadsheet. */
export default function PortalLot(): JSX.Element {
  const { id = '' } = useParams();
  const q = useGet<LotPassport | null>(`/api/portal/lots/${encodeURIComponent(id)}`);
  const summary = useGet<PortalSummary>('/api/portal/summary');
  const meta = useMeta(); const user = useSession((s) => s.user);
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  const certificate = () => {
    const p = q.data; if (!p) return;
    setBusy(true); setErr('');
    try { downloadCertificate({ passport: p, customerName: summary.data?.customer.name ?? p.dispatch?.customerName ?? user?.name ?? '', millName: meta.data?.millName ?? 'Spinning mill', origin: window.location.origin, qrDataUrl: qrRef.current?.toDataURL('image/png') ?? null }); }
    catch (e) { setErr(e instanceof Error ? e.message : 'The certificate could not be created'); }
    finally { setBusy(false); }
  };

  if (q.error || q.data === null) return <div className="pt-page" data-testid="portal-lot-passport"><Link to="/portal/lots" className="pt-link"><ArrowLeft size={16} /> My lots</Link>
    <PCard><Notice tone="bad">{q.error instanceof Error ? q.error.message : 'We could not find that lot.'} We could only find lots that were delivered to you — please check the lot number on your carton label or invoice.</Notice><Link to="/portal/lots" className="btn" style={{ alignSelf: 'flex-start' }}>See all my lots</Link></PCard></div>;

  return <div className="pt-page" data-testid="portal-lot-passport">
    <Link to="/portal/lots" className="pt-link no-print" style={{ alignSelf: 'flex-start' }}><ArrowLeft size={16} /> My lots</Link>
    <Loading q={q}>{q.data ? <>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <LotHero p={q.data} onCertificate={certificate} certBusy={busy} reportTo={`/portal/report?lot=${encodeURIComponent(q.data.lot.lotNo)}`} />
      <nav className="pt-chips no-print" aria-label="Sections of this page"><span className="muted" style={{ alignSelf: 'center', marginRight: 4 }}>Jump to</span>{JUMPS.map(([a, l]) => <a key={a} href={`#${a}`} className="pt-chip">{l}</a>)}</nav>
      <LotComplaints p={q.data} />
      <OriginSection p={q.data} />
      <JourneySection p={q.data} />
      <CertificatesSection p={q.data} />
      <PackingSection p={q.data} />
      <DeliverySection p={q.data} />
      <QrSection p={q.data} canvasRef={qrRef} />
      <PCard title="Need a copy, or something not right?" tone={undefined} lead="Keep the certificate for your records, or let our quality team know if you notice a problem with this lot.">
        <div className="row no-print" style={{ gap: 12 }}>
          <button type="button" className="btn lg" onClick={certificate} disabled={busy}><FileDown size={18} /> Save the certificate as a PDF</button>
          <Link to={`/portal/report?lot=${encodeURIComponent(q.data.lot.lotNo)}`} className="btn lg"><MessageSquareWarning size={18} /> Tell us about a problem</Link>
        </div>
      </PCard>
    </> : null}</Loading>
  </div>;
}
