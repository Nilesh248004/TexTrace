import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Factory, FlaskConical, Info, ScrollText, SearchX, ShieldCheck, Wrench } from 'lucide-react';
import type { BackTrace, LotPassport as Passport } from '@shared/domain';
import { MASTER_LABEL, type MasterType } from '@shared/params';
import { ApiError, qstr, useGet, useGlobalParams } from '../lib/api';
import { useSession } from '../lib/store';
import { Card, CardBody, Loading, Notice, Tabs } from '../components/ui';
import { fmtDT } from '../lib/fmt';
import { PassportHeader } from '../components/passport/PassportHeader';
import { FindingsCard } from '../components/passport/FindingsCard';
import { JourneySection } from '../components/passport/JourneySection';
import { OriginCard } from '../components/passport/OriginCard';
import { QualityTab } from '../components/passport/QualityTab';
import { ProductionTab } from '../components/passport/ProductionTab';
import { AccessoriesTab } from '../components/passport/AccessoriesTab';
import { ComplaintsSection, DispatchSection } from '../components/passport/DispatchSection';
import { exportPassportPdf } from '../components/passport/exportPdf';
import { tabCounts } from '../components/passport/findings';
import { TAB_LABEL, useLightPrint, usePrintPageStyle, type PassportTab } from '../components/passport/util';

const TABS: PassportTab[] = ['quality', 'production', 'accessories'];
const TAB_ICON = { quality: FlaskConical, production: Factory, accessories: Wrench } as const;

/** Master versions used vs the latest ones — explains why a result may be colour-coded differently under "Latest master". */
function MasterNotices({ p, asOf, mode }: { p: Passport; asOf: Passport | undefined; mode: 'asOf' | 'latest' }): JSX.Element | null {
  if (mode === 'latest') {
    if (!asOf) return null;
    const diffs = p.masters.map((m) => ({ m, was: asOf.masters.find((x) => x.type === m.type) })).filter(({ m, was }) => was && was.versionNo !== null && m.versionNo !== null && was.versionNo !== m.versionNo);
    return diffs.length
      ? <Notice tone="warn" icon={<Info size={16} />}><b data-testid="master-notice">Judged on the latest master{diffs.length === 1 ? '' : 's'}</b> — {diffs.map(({ m, was }) => `${MASTER_LABEL[m.type as MasterType]} v${m.versionNo} instead of v${was?.versionNo}`).join('; ')}: the version{diffs.length === 1 ? '' : 's'} active on the production date ({p.lot.startDate}) {diffs.length === 1 ? 'was' : 'were'} {diffs.map(({ was }) => `v${was?.versionNo}`).join(', ')}. Colours may differ from what the lab saw at the time. Switch “Masters” in the top bar back to “As produced” for the original judgement.</Notice>
      : <Notice tone="info" icon={<Info size={16} />}><span data-testid="master-notice">Latest master selected — no newer master version exists for this lot&apos;s count, so every result is judged exactly as produced.</span></Notice>;
  }
  const newer = p.masters.filter((m) => m.versionNo !== null && m.latestVersionNo !== null && m.latestVersionNo > m.versionNo);
  return newer.length
    ? <Notice tone="info" icon={<Info size={16} />}><span data-testid="master-notice">Judged on the master version active on the production date ({newer.map((m) => `${MASTER_LABEL[m.type]} v${m.versionNo}`).join(', ')}). A newer version exists ({newer.map((m) => `v${m.latestVersionNo}`).join(', ')}) — switch “Masters” in the top bar to “Latest master” to re-judge this lot on it.</span></Notice>
    : null;
}

function PassportBody({ p, asOf, trace, mode, millName }: { p: Passport; asOf: Passport | undefined; trace: { data?: BackTrace; isLoading: boolean; error: unknown }; mode: 'asOf' | 'latest'; millName: string }): JSX.Element {
  const user = useSession((s) => s.user);
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('tab');
  const tab: PassportTab = TABS.includes(raw as PassportTab) ? (raw as PassportTab) : 'quality';
  const setTab = (t: PassportTab) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('tab', t); return n; }, { replace: true });
  const counts = useMemo(() => tabCounts(p), [p]);
  const judgeLabel = mode === 'latest' ? 'latest master' : 'as produced';
  const canTrace = !!user && ['ADMIN', 'DEVELOPER', 'AUDITOR'].includes(user.role);
  const canDispatch = !!user && ['ADMIN', 'DISPATCH'].includes(user.role);
  const jump = (t: PassportTab) => { setTab(t); window.setTimeout(() => document.getElementById('pp-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };
  const mk = (t: PassportTab) => { const c = counts[t]; return { key: t, label: <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{(() => { const I = TAB_ICON[t]; return <I size={14} />; })()} {TAB_LABEL[t]}</span>, count: c.red || c.yellow ? `${c.red} red · ${c.yellow} yellow` : 'all good', tone: c.red ? 'bad' as const : c.yellow ? 'warn' as const : undefined }; };

  return <>
    <div className="print-only pp-print-head">
      <h1>{millName} — Lot Passport</h1>
      <div className="meta"><span>Lot {p.lot.lotNo} · {p.lot.countDisplay} · mix {p.mix.mixNo} · {p.lot.customerName ?? 'not dispatched yet'}</span><span>Printed {fmtDT(p.generatedAt)} IST · masters judged: {judgeLabel}</span></div>
    </div>
    <PassportHeader p={p} canTrace={canTrace} onExport={() => exportPassportPdf(p, trace.data, millName, judgeLabel)} judgeLabel={judgeLabel} />
    <MasterNotices p={p} asOf={asOf} mode={mode} />
    <FindingsCard p={p} onJump={jump} />
    <JourneySection p={p} />
    <OriginCard p={p} trace={trace} />

    <div id="pp-tabs" className="pp-anchor stack" style={{ gap: 12 }}>
      <Tabs tabs={[mk('quality'), mk('production'), mk('accessories')]} value={tab} onChange={setTab} />
      {TABS.map((t) => <div key={t} className="tab-panel" role="tabpanel" data-testid={`panel-${t}`} style={{ display: tab === t ? 'block' : 'none' }}>
        <div className="print-only pp-print-title">{TAB_LABEL[t].toUpperCase()}</div>
        {t === 'quality' ? <QualityTab p={p} /> : t === 'production' ? <ProductionTab p={p} /> : <AccessoriesTab p={p} millName={millName} />}
      </div>)}
    </div>

    <DispatchSection p={p} canDispatch={canDispatch} />
    <ComplaintsSection p={p} />

    <Card tone="chain" className="pp-avoid"><CardBody>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <ShieldCheck size={22} style={{ color: 'hsl(var(--chain-foreground))', flex: 'none', marginTop: 2 }} />
          <div><div className="bold">Verified against the ledger — {p.ledger.verifiedRecords} of {p.ledger.totalRecords} records</div>
            <div className="small muted">Every record on this page (lot, mix, bales, lab samples, machine runs, packing, dispatch) is re-hashed on the server and compared with the hash anchored on the permissioned ledger — {p.ledger.lotTxCount} transactions in blocks #{p.ledger.firstBlock ?? '—'} to #{p.ledger.lastBlock ?? '—'}. A mismatch would show a red “Tampered” badge. Generated {fmtDT(p.generatedAt)} IST.</div></div>
        </div>
        {canTrace ? <Link className="btn sm no-print" to={`/developer?lot=${p.lot.lotNo}`}><ScrollText size={13} /> Trace this lot&apos;s ledger history</Link> : null}
      </div>
    </CardBody></Card>
  </>;
}

export default function LotPassport(): JSX.Element {
  const { id = '' } = useParams();
  const { mode } = useGlobalParams();
  usePrintPageStyle('A4 landscape'); useLightPrint();
  const enc = encodeURIComponent(id);
  const q = useGet<Passport>(`/api/lots/${enc}/passport${qstr({ mode })}`);
  const asOfQ = useGet<Passport>(mode === 'latest' ? `/api/lots/${enc}/passport?mode=asOf` : null);
  const trace = useGet<BackTrace>(`/api/lots/${enc}/trace`);
  const meta = useGet<{ millName: string }>('/api/meta');
  useEffect(() => { const prev = document.title; if (q.data) document.title = `Lot ${q.data.lot.lotNo} passport — TexTrace`; return () => { document.title = prev; }; }, [q.data]);

  const notFound = q.error instanceof ApiError && q.error.status === 404;
  return <div className="page pp-root" data-testid="lot-passport">
    <div className="pp-crumbs no-print"><Link to="/lots">Lot Passport</Link><span>/</span><b>{q.data ? `Lot ${q.data.lot.lotNo}` : id}</b></div>
    {notFound
      ? <Card tone="warn"><CardBody><div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'nowrap' }}><SearchX size={24} className="muted" /><div><h2 style={{ fontSize: 17 }}>Lot “{id}” was not found</h2><p className="muted" style={{ margin: '4px 0 10px' }}>Check the lot number (for example 101 or LOT-101, or a carton code like C-101-007) or pick a lot from the list.</p><Link className="btn primary" to="/lots">Search lots</Link></div></div></CardBody></Card>
      : <Loading q={q}>{q.data ? <PassportBody p={q.data} asOf={asOfQ.data} trace={trace} mode={mode} millName={meta.data?.millName ?? 'Spinning mill'} /> : null}</Loading>}
  </div>;
}
