import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Factory, Plus, Warehouse } from 'lucide-react';
import { useGet, useGlobalParams, useMut, qstr } from '../lib/api';
import { useSession } from '../lib/store';
import { STAGE_INFO, PROCESS_STAGES, type Stage } from '@shared/params';
import type { Judged, LotSummary, OwnerDashboard } from '@shared/domain';
import { fmtDTShort, fmtDuration, num } from '../lib/fmt';
import { Card, CardBody, CardHead, ChainBadge, ColorIcon, ColorPill, Drawer, J, Kpi, Legend, Loading, Notice, PageHead, Pill, StageIcon } from '../components/ui';
import { DataTable, type Col } from '../components/DataTable';
import { RunForm } from '../components/dash/RunForm';

interface Run { id: string; lotId: string; lotNo: string; countId: string; countDisplay: string; stage: Stage; stageLabel: string; machineId: string | null; machineLabel: string | null; shift: string; operator: string; inAt: string; outAt: string | null; running: boolean; inKg: number; outKg: number; wasteKg: number; wastePct: number | null; batchRef: string | null; balance: { diffKg: number; diffPct: number; color: 'green' | 'yellow' | 'red' } | null; worst: 'green' | 'yellow' | 'red' | 'none'; params: Judged[]; accessories: (Judged & { spec?: string })[]; chain: never }
interface Resp { items: Run[]; total: number; capped: boolean }

export default function Production(): JSX.Element {
  const { count, mode } = useGlobalParams(); const user = useSession((s) => s.user);
  const [sp, setSp] = useSearchParams();
  const [stage, setStage] = useState(sp.get('stage') ?? ''); const [machine, setMachine] = useState(sp.get('machine') ?? ''); const [lot, setLot] = useState(sp.get('lot') ?? ''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [color, setColor] = useState('');
  const [open, setOpen] = useState<Run | null>(null); const [form, setForm] = useState(false);
  const q = useGet<Resp>('/api/production' + qstr({ count, mode, stage, machine, lot, from, to, color }));
  const machines = useGet<{ id: string; stage: Stage; label: string }[]>('/api/machines');
  const dash = useGet<OwnerDashboard>('/api/dashboard/owner');
  const lots = useGet<LotSummary[]>('/api/lots?status=PLANNED');
  const issue = useMut<{ mixId: string; lotNo: string }, unknown>('POST', (b) => `/api/mixes/${b.mixId}/issue`, (b) => `Issue bales of lot ${b.lotNo} to the blow room`);
  const canWrite = !!user && ['ADMIN', 'PRODUCTION'].includes(user.role);
  const rows = q.data?.items ?? [];
  const tot = useMemo(() => { const done = rows.filter((r) => !r.running && r.stage !== 'PACK'); const i = done.reduce((s, r) => s + r.inKg, 0); const w = done.reduce((s, r) => s + r.wasteKg, 0); return { runs: rows.length, running: rows.filter((r) => r.running).length, inKg: i, outKg: done.reduce((s, r) => s + r.outKg, 0), wasteKg: w, wastePct: i ? (w / i) * 100 : null, red: rows.filter((r) => r.worst === 'red').length }; }, [rows]);
  const byShift = useMemo(() => ['A', 'B', 'C'].map((sh) => { const rs = rows.filter((r) => r.shift === sh && !r.running && r.stage !== 'PACK'); const i = rs.reduce((a, r) => a + r.inKg, 0); const w = rs.reduce((a, r) => a + r.wasteKg, 0); const eff = rs.map((r) => r.params.find((p) => p.key === 'EFF_PCT')?.value).filter((v): v is number => typeof v === 'number'); return { sh, runs: rs.length, out: rs.reduce((a, r) => a + r.outKg, 0), waste: i ? (w / i) * 100 : null, eff: eff.length ? eff.reduce((a, b) => a + b, 0) / eff.length : null, red: rs.filter((r) => r.worst === 'red').length }; }), [rows]);
  const waiting = (lots.data ?? []).filter((l) => l.location.state === 'PLANNED' && (count === 'ALL' || l.countId === count));
  const pj = (r: Run, key: string) => r.params.find((p) => p.key === key);

  const cols: Col<Run>[] = [
    { key: 'in', header: 'IN', value: (r) => r.inAt, render: (r) => <span className="nowrap">{fmtDTShort(r.inAt)}</span> },
    { key: 'out', header: 'OUT', value: (r) => r.outAt ?? '', render: (r) => r.outAt ? <span className="nowrap">{fmtDTShort(r.outAt)}</span> : <Pill tone="blue"><span className="dot live" /> running</Pill> },
    { key: 'dur', header: 'Duration', value: (r) => (r.outAt ? Date.parse(r.outAt) - Date.parse(r.inAt) : null), render: (r) => <span className="muted nowrap">{r.outAt ? fmtDuration(Date.parse(r.outAt) - Date.parse(r.inAt)) : '—'}</span> },
    { key: 'lot', header: 'Lot', value: (r) => r.lotNo, render: (r) => <Link to={`/lots/${r.lotId}`} onClick={(e) => e.stopPropagation()} className="bold">{r.lotNo}<span className="sub">{r.countDisplay}</span></Link> },
    { key: 'stage', header: 'Stage', value: (r) => r.stageLabel, render: (r) => <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><StageIcon stage={r.stage} size={14} />{r.stageLabel}</span> },
    { key: 'machine', header: 'Machine', value: (r) => r.machineLabel ?? 'Packing hall' }, { key: 'shift', header: 'Shift', value: (r) => r.shift }, { key: 'op', header: 'Operator', value: (r) => r.operator },
    { key: 'inKg', header: 'Input kg', num: true, value: (r) => r.inKg, render: (r) => num(r.inKg, 1) }, { key: 'outKg', header: 'Output kg', num: true, value: (r) => r.outKg, render: (r) => num(r.outKg, 1) },
    { key: 'waste', header: 'Waste kg', num: true, value: (r) => r.wasteKg, render: (r) => num(r.wasteKg, 1) },
    { key: 'wp', header: 'Waste %', num: true, value: (r) => pj(r, 'WASTE_PCT')?.value ?? r.wastePct, render: (r) => (pj(r, 'WASTE_PCT') ? <J j={pj(r, 'WASTE_PCT')} /> : <span className="muted">{r.wastePct !== null ? `${r.wastePct}%` : '—'}</span>), color: (r) => pj(r, 'WASTE_PCT')?.color },
    { key: 'yield', header: 'Yield %', num: true, value: (r) => pj(r, 'YIELD_PCT')?.value ?? null, render: (r) => <J j={pj(r, 'YIELD_PCT')} />, color: (r) => pj(r, 'YIELD_PCT')?.color },
    { key: 'eff', header: 'Efficiency %', num: true, value: (r) => pj(r, 'EFF_PCT')?.value ?? null, render: (r) => <J j={pj(r, 'EFF_PCT')} />, color: (r) => pj(r, 'EFF_PCT')?.color },
    { key: 'bal', header: 'Mass balance', value: (r) => r.balance?.color ?? '', render: (r) => r.balance ? <ColorPill color={r.balance.color} label={r.balance.diffPct === 0 ? 'Balanced' : `${r.balance.diffPct}% off`} /> : <span className="muted">—</span>, color: (r) => r.balance?.color },
    { key: 'worst', header: 'Status', value: (r) => r.worst, render: (r) => <ColorPill color={r.worst} />, color: (r) => (r.worst === 'none' ? undefined : r.worst) },
    { key: 'chain', header: 'Ledger', noExport: true, render: (r) => <ChainBadge chain={r.chain} /> },
  ];
  return <div className="page" data-testid="production-page">
    <PageHead eyebrow="OPERATIONS" title="Production" sub="Every stage run of every lot — IN/OUT time, quantities, waste, machine settings and efficiency — judged against the Production master and anchored on the ledger." right={canWrite ? <button className="btn primary" onClick={() => setForm(true)} data-testid="log-run"><Plus size={15} /> Log production run</button> : undefined} />
    <div className="grid g5">
      <Kpi label="Runs in view" value={tot.runs} icon={<Factory size={16} />} sub={`${tot.running} running right now`} />
      <Kpi label="Input" value={num(tot.inKg, 0)} unit="kg" sub="completed stage runs" />
      <Kpi label="Output" value={num(tot.outKg, 0)} unit="kg" sub="good product to next stage" />
      <Kpi label="Waste" value={num(tot.wasteKg, 0)} unit="kg" sub={tot.wastePct !== null ? `${tot.wastePct.toFixed(2)}% of input` : '—'} />
      <Kpi label="Runs with red results" value={tot.red} tone={tot.red ? 'red' : 'green'} sub="settings, mass balance, accessories" />
    </div>
    <div className="grid g-main">
      <Card><CardHead title="Stage-wise waste vs master" sub="Last 14 days, all counts" />
        <div className="tbl-wrap"><table className="tbl dense"><thead><tr><th>Stage</th><th className="num">Waste actual vs master</th></tr></thead><tbody>{(dash.data?.kpis.wasteByStage ?? []).map((w) => <tr key={w.stage}><td><span className="row"><StageIcon stage={w.stage} size={14} /> {w.label}</span></td><td className="num"><span className={`judged ${w.color}`}><ColorIcon color={w.color} size={12} />{num(w.actual, 2)}%</span> <span className="muted small">master {num(w.master, 2)}%</span></td></tr>)}</tbody></table></div></Card>
      <Card><CardHead title="Overall yarn realization" sub="Yarn packed ÷ cotton into the blow room, last 21 days" /><div className="tbl-wrap"><table className="tbl dense"><thead><tr><th>Count</th><th className="num">Actual vs master</th><th className="num">Lots</th></tr></thead><tbody>{(dash.data?.kpis.realization.byCount ?? []).map((c) => <tr key={c.countId}><td>{c.display}</td><td className="num"><span className={`judged ${c.color}`}><ColorIcon color={c.color} size={12} />{num(c.actual, 1)}%</span> <span className="muted small">master {num(c.master, 1)}%</span></td><td className="num">{c.lots}</td></tr>)}</tbody></table></div></Card>
    </div>
    <Card><CardHead title="Production by shift" sub="Completed stage runs in the current view — shift A 06–14, B 14–22, C 22–06 (IST)" /><div className="tbl-wrap"><table className="tbl dense"><thead><tr><th>Shift</th><th className="num">Runs</th><th className="num">Output kg</th><th className="num">Waste %</th><th className="num">Avg efficiency</th><th className="num">Runs with red</th></tr></thead><tbody>{byShift.map((x) => <tr key={x.sh}><td className="bold">Shift {x.sh}</td><td className="num">{x.runs}</td><td className="num">{num(x.out, 0)}</td><td className="num">{x.waste !== null ? `${x.waste.toFixed(2)}%` : '—'}</td><td className="num">{x.eff !== null ? `${x.eff.toFixed(1)}%` : '—'}</td><td className="num">{x.red ? <span className="judged red">{x.red}</span> : <span className="muted">0</span>}</td></tr>)}</tbody></table></div></Card>
    {canWrite && waiting.length ? <Card><CardHead title={<span className="row"><Warehouse size={16} /> Waiting in the bale store</span>} sub="Lots whose bales are reserved but not yet issued to the blow room" />
      <div className="tbl-wrap"><table className="tbl dense"><tbody>{waiting.map((l) => <tr key={l.id}><td className="bold"><Link to={`/lots/${l.id}`}>Lot {l.lotNo}</Link></td><td>{l.countDisplay}</td><td>mix {l.mixNo}</td><td className="muted">{l.plannedKg.toLocaleString('en-IN')} kg planned</td><td className="right"><button className="btn sm primary" disabled={issue.isPending} onClick={() => issue.mutate({ mixId: l.mixId, lotNo: l.lotNo })} data-testid={`issue-${l.lotNo}`}>Issue bales to blow room</button></td></tr>)}</tbody></table></div>{issue.error ? <CardBody><Notice tone="bad">{issue.error.message}</Notice></CardBody> : null}</Card> : null}
    <Card flush>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} exportName="production-runs" title="Production runs" onRowClick={setOpen} legend pageSize={25} initialSort={{ key: 'in', dir: 'desc' }} rowTone={(r) => (r.worst === 'red' ? 'red' : r.worst === 'yellow' ? 'yellow' : undefined)}
        toolbar={<>
          <select className="select sm" style={{ width: 'auto' }} value={stage} onChange={(e) => { setStage(e.target.value); setMachine(''); }} aria-label="Stage"><option value="">Stage: all</option>{[...PROCESS_STAGES, 'PACK' as Stage].map((s) => <option key={s} value={s}>{STAGE_INFO[s].label}</option>)}</select>
          <select className="select sm" style={{ width: 'auto' }} value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine"><option value="">Machine: all</option>{(machines.data ?? []).filter((m) => !stage || m.stage === stage).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          <input className="input sm" style={{ width: 90 }} placeholder="Lot no." value={lot} onChange={(e) => setLot(e.target.value)} aria-label="Lot" />
          <input className="input sm" style={{ width: 'auto' }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /><input className="input sm" style={{ width: 'auto' }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <select className="select sm" style={{ width: 'auto' }} value={color} onChange={(e) => setColor(e.target.value)} aria-label="Status"><option value="">Status: all</option><option value="red">Red</option><option value="yellow">Yellow</option><option value="green">Green</option></select>
          {sp.size ? <button className="btn sm ghost" onClick={() => setSp({})}>Clear link filters</button> : null}
        </>} footNote={q.data?.capped ? <span>Showing the newest 500 of {q.data.total} runs — narrow the filters.</span> : undefined} />
      {q.isLoading ? <CardBody><Loading q={q}><span /></Loading></CardBody> : null}
    </Card>
    <Legend chain />
    {open ? <Drawer title={<span className="row"><StageIcon stage={open.stage} /> {open.stageLabel} · {open.machineLabel ?? 'Packing hall'} · lot {open.lotNo}</span>} onClose={() => setOpen(null)}>
      <div className="stack">
        <div className="grid g3"><div className="fact"><span>IN</span><b>{fmtDTShort(open.inAt)}</b></div><div className="fact"><span>OUT</span><b>{open.outAt ? fmtDTShort(open.outAt) : 'running'}</b></div><div className="fact"><span>Shift · operator</span><b>{open.shift} · {open.operator}</b></div><div className="fact"><span>Input → output</span><b>{num(open.inKg, 1)} → {num(open.outKg, 1)} kg</b></div><div className="fact"><span>Waste</span><b>{num(open.wasteKg, 1)} kg ({open.wastePct ?? '—'}%)</b></div><div className="fact"><span>Batch</span><b className="mono small">{open.batchRef}</b></div></div>
        {open.balance ? <Notice tone={open.balance.color === 'green' ? 'ok' : open.balance.color === 'yellow' ? 'warn' : 'bad'}>Mass balance: input − output − waste = {open.balance.diffKg} kg ({open.balance.diffPct}% of input).</Notice> : null}
        <div className="bold">Machine parameters — actual vs master</div>
        <div className="tbl-wrap"><table className="tbl dense"><thead><tr><th>Parameter</th><th className="num">Actual</th><th className="num">Master</th><th className="num">Range</th><th className="num">Deviation</th></tr></thead><tbody>{open.params.map((j) => <tr key={j.key}><td title={j.plain}>{j.label} <span className="muted tiny">{j.unit}</span></td><td className="num"><J j={j} /></td><td className="num">{j.std ?? '—'}</td><td className="num muted">{j.lower ?? '–'} … {j.upper ?? '–'}</td><td className="num">{j.deviation !== null ? `${j.deviation >= 0 ? '+' : ''}${j.deviation.toFixed(j.decimals)}` : '—'}<span className="muted tiny"> v{j.versionNo}</span></td></tr>)}</tbody></table></div>
        {open.accessories.length ? <><div className="bold">Accessories on this machine at run start</div><div className="row">{open.accessories.map((j) => <span key={j.key} className="row" style={{ gap: 6 }}><J j={j} unit /><span className="muted small">{j.label}{j.spec ? ` (${j.spec})` : ''}</span></span>)}</div></> : null}
        <div className="row"><ChainBadge chain={open.chain} /><Link className="btn sm" to={`/lots/${open.lotId}`}>Open lot passport</Link></div>
      </div>
    </Drawer> : null}
    {form ? <RunForm onClose={() => setForm(false)} /> : null}
  </div>;
}
