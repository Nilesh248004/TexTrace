import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGet } from '../lib/api';
import { useUi } from '../lib/store';
import { Loading, PageHead, Tabs } from '../components/ui';
import { CountTiles, MasterCards } from '../components/masters/MasterCards';
import { PendingStrip, VersionHistory } from '../components/masters/VersionHistory';
import { ColorCodes } from '../components/masters/ColorCodes';
import { LensEditor } from '../components/masters/LensEditor';
import type { MastersOverview } from '../components/masters/types';

type Tab = 'counts' | 'color' | 'lens';

export default function Masters(): JSX.Element {
  const [sp, setSp] = useSearchParams();
  const globalCount = useUi((s) => s.count);
  const q = useGet<MastersOverview>('/api/masters/overview');
  const [tab, setTab] = useState<Tab>((['counts', 'color', 'lens'] as const).find((t) => t === sp.get('tab')) ?? 'counts');
  const [sel, setSel] = useState<string>(sp.get('count') ?? (globalCount !== 'ALL' ? globalCount : ''));
  // the count filter in the top bar drives this page as well
  useEffect(() => { if (globalCount !== 'ALL') setSel(globalCount); }, [globalCount]);
  const choose = (t: Tab) => { setTab(t); const n = new URLSearchParams(sp); n.set('tab', t); setSp(n, { replace: true }); };

  const counts = q.data?.counts ?? [];
  const count = counts.find((c) => c.id === sel) ?? counts[0];
  const pendingTotal = counts.reduce((n, c) => n + c.versions.filter((v) => v.status === 'DRAFT' || v.status === 'QA_APPROVED').length, 0);

  return <div className="page" data-testid="masters-page">
    <PageHead eyebrow="CUSTOMERS & QUALITY" title="Masters" sub="Every result in TexTrace is judged against these versioned masters — how well we create the master decides how good the result is. Each change (new version, edit, approval, activation) is a ledger transaction." />
    <Tabs<Tab> value={tab} onChange={choose} tabs={[{ key: 'counts', label: 'Masters by count', count: pendingTotal || undefined, tone: 'warn' }, { key: 'color', label: 'Color Code Master' }, { key: 'lens', label: 'Complaint lens' }]} />
    <Loading q={q}>
      {tab === 'counts' && count ? <div className="stack loose" role="tabpanel">
        <PendingStrip counts={counts} />
        <CountTiles counts={counts} value={count.id} onChange={setSel} />
        <MasterCards count={count} all={counts} />
        <VersionHistory count={count} />
      </div> : null}
      {tab === 'color' ? <div role="tabpanel"><ColorCodes counts={counts} /></div> : null}
      {tab === 'lens' ? <div role="tabpanel"><LensEditor /></div> : null}
    </Loading>
  </div>;
}
