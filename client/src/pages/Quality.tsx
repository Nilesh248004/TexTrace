import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FlaskConical, Plus } from 'lucide-react';
import { useGet, useGlobalParams, qstr } from '../lib/api';
import { useSession } from '../lib/store';
import { MACHINE_STAGES, STAGE_INFO, type Stage } from '@shared/params';
import type { Judged } from '@shared/domain';
import type { OnChainRef } from '@shared/types';
import { fmtDTShort } from '../lib/fmt';
import { Card, CardBody, ChainBadge, ColorPill, Drawer, J, Kpi, Legend, Loading, PageHead, Pill, StageIcon } from '../components/ui';
import { DataTable, type Col } from '../components/DataTable';
import { TestForm } from '../components/dash/TestForm';

interface Test { id: string; sampleId: string; lotId: string; lotNo: string; countId: string; countDisplay: string; stage: Stage; stageLabel: string; machineId: string | null; machineLabel: string; type: 'LOT' | 'MACHINE'; pos: string | null; testedAt: string; shift: string; by: string; instrument: string; values: Judged[]; worst: 'green' | 'yellow' | 'red' | 'none'; red: number; yellow: number; chain: OnChainRef }
const HEADLINE: Record<string, string[]> = { BR: ['SFI', 'MIC', 'UHML', 'CLEAN_EFF'], CARD: ['U', 'CV', 'NEPS_OUT', 'HANK'], DFB: ['U', 'CV', 'HANK_CV', 'CV3M'], DFF: ['U', 'CV', 'HANK_CV', 'CV3M'], COMB: ['NOIL_PCT', 'U', 'SLV_NEPS'], FF: ['U', 'CV', 'HANK_CV', 'TPI'], RF: ['U', 'CV', 'IPI', 'H', 'COUNT_CV'], AW: ['U', 'H', 'CUTS_NEP', 'THICK'] };

export default function Quality(): JSX.Element {
  const { count, mode } = useGlobalParams(); const user = useSession((s) => s.user); const [sp] = useSearchParams();
  const [stage, setStage] = useState(sp.get('stage') ?? ''); const [machine, setMachine] = useState(sp.get('machine') ?? ''); const [lot, setLot] = useState(sp.get('lot') ?? ''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [color, setColor] = useState(sp.get('color') ?? ''); const [type, setType] = useState('');
  const [open, setOpen] = useState<Test | null>(null); const [form, setForm] = useState(false);
  const q = useGet<{ items: Test[]; total: number; capped: boolean }>('/api/quality' + qstr({ count, mode, stage, machine, lot, from, to, color, type }));
  const machines = useGet<{ id: string; stage: Stage; label: string }[]>('/api/machines');
  const rows = q.data?.items ?? [];
  const canWrite = !!user && ['ADMIN', 'QA'].includes(user.role);
  const tot = useMemo(() => ({ n: rows.length, red: rows.filter((r) => r.worst === 'red').length, yellow: rows.filter((r) => r.worst === 'yellow').length, readings: rows.reduce((s, r) => s + r.values.length, 0), bad: rows.reduce((s, r) => s + r.red, 0), warn: rows.reduce((s, r) => s + r.yellow, 0) }), [rows]);
  const head = (r: Test) => { const keys = HEADLINE[r.stage] ?? []; const picked = keys.map((k) => r.values.find((v) => v.key === k)).filter((v): v is Judged => !!v); return picked.length ? picked : r.values.slice(0, 4); };
  const cols: Col<Test>[] = [
    { key: 'at', header: 'Tested at', value: (r) => r.testedAt, render: (r) => <span className="nowrap">{fmtDTShort(r.testedAt)}<span className="sub">shift {r.shift}</span></span> },
    { key: 'sample', header: 'Sample', value: (r) => r.sampleId, render: (r) => <span className="mono small nowrap">{r.sampleId}</span> },
    { key: 'lot', header: 'Lot', value: (r) => r.lotNo, render: (r) => <Link to={`/lots/${r.lotId}`} onClick={(e) => e.stopPropagation()} className="bold">{r.lotNo}<span className="sub">{r.countDisplay}</span></Link> },
    { key: 'stage', header: 'Department', value: (r) => r.stageLabel, render: (r) => <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><StageIcon stage={r.stage} size={14} />{r.stageLabel}</span> },
    { key: 'machine', header: 'Machine', value: (r) => `${r.machineLabel}${r.pos ? ` ${r.pos}` : ''}`, render: (r) => <span>{r.type === 'LOT' ? <Pill tone="blue">Lot composite</Pill> : r.machineLabel}{r.pos && r.type === 'MACHINE' ? <span className="sub">{r.pos}</span> : null}</span> },
    { key: 'by', header: 'Tested by', value: (r) => r.by, render: (r) => <span>{r.by}<span className="sub">{r.instrument}</span></span> },
    { key: 'vals', header: 'Key results', value: (r) => head(r).map((v) => `${v.label} ${v.value}`).join('; '), render: (r) => <span className="row" style={{ gap: 5, minWidth: 300 }}>{head(r).map((v) => <span key={v.key} className="row" style={{ gap: 3, flexWrap: 'nowrap' }}><span className="muted tiny">{v.key === 'COUNT_CV' ? 'CntCV' : v.key}</span><J j={v} /></span>)}</span>, color: (r) => (r.worst === 'none' ? undefined : r.worst) },
    { key: 'bad', header: 'Out / warn', num: true, value: (r) => r.red * 100 + r.yellow, render: (r) => <span className="nowrap">{r.red ? <span className="judged red">{r.red}</span> : null} {r.yellow ? <span className="judged yellow">{r.yellow}</span> : null}{!r.red && !r.yellow ? <span className="muted">—</span> : null}</span> },
    { key: 'worst', header: 'Status', value: (r) => r.worst, render: (r) => <ColorPill color={r.worst} />, color: (r) => (r.worst === 'none' ? undefined : r.worst) },
    { key: 'chain', header: 'Ledger', noExport: true, render: (r) => <ChainBadge chain={r.chain} /> },
  ];
  return <div className="page" data-testid="quality-page">
    <PageHead eyebrow="OPERATIONS" title="Quality" sub="Lab results from every department and machine, judged against the Quality master that was active on the day of production." right={canWrite ? <button className="btn primary" onClick={() => setForm(true)} data-testid="enter-test"><Plus size={15} /> Record test result</button> : undefined} />
    <div className="grid g4">
      <Kpi label="Samples in view" value={tot.n} icon={<FlaskConical size={16} />} sub={`${tot.readings.toLocaleString('en-IN')} readings`} />
      <Kpi label="Samples with a red reading" value={tot.red} tone={tot.red ? 'red' : 'green'} sub={`${tot.bad} red readings`} />
      <Kpi label="Samples in the warning zone" value={tot.yellow} tone={tot.yellow ? 'yellow' : 'green'} sub="last 20% of the tolerance band" />
      <Kpi label="Readings within master" value={tot.readings ? `${(((tot.readings - tot.bad - tot.warn) / tot.readings) * 100).toFixed(1)}%` : '—'} tone="green" sub={`${tot.warn} warning · ${tot.bad} out of limits`} />
    </div>
    <Card flush>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} exportName="quality-tests" title="Quality test results" onRowClick={setOpen} legend initialSort={{ key: 'at', dir: 'desc' }} rowTone={(r) => (r.worst === 'red' ? 'red' : r.worst === 'yellow' ? 'yellow' : undefined)}
        toolbar={<>
          <select className="select sm" style={{ width: 'auto' }} value={stage} onChange={(e) => { setStage(e.target.value); setMachine(''); }} aria-label="Department"><option value="">Department: all</option>{MACHINE_STAGES.map((s) => <option key={s} value={s}>{STAGE_INFO[s].label}</option>)}</select>
          <select className="select sm" style={{ width: 'auto' }} value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine"><option value="">Machine: all</option>{(machines.data ?? []).filter((m) => !stage || m.stage === stage).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          <input className="input sm" style={{ width: 90 }} placeholder="Lot no." value={lot} onChange={(e) => setLot(e.target.value)} aria-label="Lot" />
          <select className="select sm" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Sample type"><option value="">Sample: all</option><option value="MACHINE">Machine samples</option><option value="LOT">Lot composites</option></select>
          <input className="input sm" style={{ width: 'auto' }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /><input className="input sm" style={{ width: 'auto' }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <select className="select sm" style={{ width: 'auto' }} value={color} onChange={(e) => setColor(e.target.value)} aria-label="Status"><option value="">Status: all</option><option value="red">Red</option><option value="yellow">Yellow</option><option value="green">Green</option></select>
        </>} footNote={q.data?.capped ? <span>Showing the newest 500 of {q.data.total} samples — narrow the filters.</span> : undefined} />
      {q.isLoading ? <CardBody><Loading q={q}><span /></Loading></CardBody> : null}
    </Card>
    <Legend chain />
    {open ? <Drawer title={<span className="row"><StageIcon stage={open.stage} /> {open.stageLabel} · {open.machineLabel} · lot {open.lotNo}</span>} onClose={() => setOpen(null)}>
      <div className="stack">
        <div className="grid g3"><div className="fact"><span>Sample</span><b className="mono small">{open.sampleId}</b></div><div className="fact"><span>Tested</span><b>{fmtDTShort(open.testedAt)} · shift {open.shift}</b></div><div className="fact"><span>By · instrument</span><b>{open.by}</b><small>{open.instrument}</small></div></div>
        <div className="tbl-wrap"><table className="tbl dense"><thead><tr><th>Parameter</th><th className="num">Result</th><th className="num">Master std</th><th className="num">Lower … upper</th><th className="num">Deviation</th><th>Verdict</th></tr></thead><tbody>{open.values.map((j) => <tr key={j.key}><td title={j.plain}>{j.label} <span className="muted tiny">{j.unit}</span></td><td className="num"><J j={j} /></td><td className="num">{j.std ?? '—'}</td><td className="num muted">{j.lower ?? '–'} … {j.upper ?? '–'}</td><td className="num">{j.deviation !== null ? `${j.deviation >= 0 ? '+' : ''}${j.deviation.toFixed(j.decimals)}` : '—'}{j.deviationPct !== null ? <span className="muted tiny"> ({j.deviationPct >= 0 ? '+' : ''}{j.deviationPct.toFixed(1)}%)</span> : null}</td><td><ColorPill color={j.color} /><span className="muted tiny"> master v{j.versionNo}</span></td></tr>)}</tbody></table></div>
        <div className="row"><ChainBadge chain={open.chain} /><Link className="btn sm" to={`/lots/${open.lotId}`}>Open lot passport</Link></div>
      </div>
    </Drawer> : null}
    {form ? <TestForm onClose={() => setForm(false)} /> : null}
  </div>;
}
