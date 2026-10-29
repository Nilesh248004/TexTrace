import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGet, useGlobalParams, qstr } from '../lib/api';
import { Card, CardBody, CardHead, Legend, Loading, PageHead, Seg } from '../components/ui';
import { MiniHeat } from '../components/dash/MiniHeat';
import type { Heatmap } from '@shared/domain';

const params = [{ key: 'U', label: 'U% / evenness' }, { key: 'H', label: 'Hairiness H' }, { key: 'COUNT_CV', label: 'Count CV%' }];
export default function Analytics(): JSX.Element {
  const { count } = useGlobalParams(); const nav = useNavigate(); const [parameter, setParameter] = useState('U'); const [days, setDays] = useState('21');
  const q = useGet<Heatmap>('/api/analytics/heatmap' + qstr({ stage: 'RF', parameter, days, count }));
  return <div className="page" data-testid="analytics-page"><PageHead eyebrow="MACHINE QUALITY" title="Analytics" sub="Ring-frame quality heatmaps expose machine/day patterns. Click a cell to investigate its affected lot evidence." />
    <Card><CardHead title="Machine × day heatmap" sub="Each cell is judged against the master active on that test date." /><CardBody><div className="row between no-print"><Seg value={parameter} onChange={setParameter} options={params} /><select className="select sm" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period"><option value="14">14 days</option><option value="21">21 days</option><option value="30">30 days</option></select></div><Loading q={q}>{q.data ? <><MiniHeat data={q.data} onCell={(x) => x.value !== null && nav(`/analytics?stage=RF&parameter=${parameter}&machine=${x.machineId}&date=${x.date}`)} /><Legend chain /></> : null}</Loading></CardBody></Card>
  </div>;
}
