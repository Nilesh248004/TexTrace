import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend as RLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, Boxes, ClipboardList, Gauge, PackageCheck, ShieldAlert, Truck, XCircle } from 'lucide-react';
import { evaluate } from '@shared/quality';
import { useGet, useGlobalParams, qstr } from '../lib/api';
import { useUi } from '../lib/store';
import type { Alert, Heatmap, OwnerDashboard } from '@shared/domain';
import { ColorPill, Card, CardBody, CardHead, ColorIcon, Kpi, Legend, Loading, PageHead, Pill, StageIcon, type Color } from '../components/ui';
import { fmtDT, kg, num, pct } from '../lib/fmt';
import { MiniHeat } from '../components/dash/MiniHeat';

// fallback only: each count's bar uses its own cone-tip colour so the chart matches the swatch on its card
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7'];
const ALERT_LABEL: Record<Alert['kind'], string> = { OUT_OF_MASTER: 'Out of master', ACCESSORY_OVERDUE: 'Accessory', MASS_BALANCE: 'Mass balance', COLOR_MISMATCH: 'Cone colour', NO_QA_RELEASE: 'No QA release', QA_HOLD: 'QA hold', REPEAT_COMPLAINT: 'Repeat complaint', MASTER_PENDING: 'Master pending' };

function Vs({ actual, master, color, unit = '%', d = 1 }: { actual: number | null; master: number | null; color: Color; unit?: string; d?: number }): JSX.Element {
  return <span className="row" style={{ gap: 8, flexWrap: 'nowrap', justifyContent: 'flex-end' }}><span className={`judged ${color}`} title={`Actual ${num(actual, d)}${unit} vs master ${num(master, d)}${unit}`}><ColorIcon color={color} size={12} />{num(actual, d)}{unit}</span><span className="muted small nowrap">master {num(master, d)}{unit}</span></span>;
}

export default function Dashboard(): JSX.Element {
  const { count } = useGlobalParams(); const nav = useNavigate(); const judge = useUi((s) => s.judge); void judge;
  const q = useGet<OwnerDashboard>('/api/dashboard/owner');
  const heatQ = (parameter: string) => '/api/analytics/heatmap' + qstr({ stage: 'RF', parameter, days: 14, count });
  const hU = useGet<Heatmap>(heatQ('U')); const hH = useGet<Heatmap>(heatQ('H')); const hC = useGet<Heatmap>(heatQ('COUNT_CV'));
  return <div className="page" data-testid="owner-dashboard">
    <PageHead eyebrow={q.data ? `${new Date(`${q.data.businessDate}T06:00:00+05:30`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).toUpperCase()}` : 'MILL OWNER VIEW'} title="Mill dashboard" sub={q.data ? `As of ${fmtDT(q.data.asOf)} IST · every figure is judged against the active masters and anchored on the ledger.` : ''} right={<><Link className="btn" to="/live"><Boxes size={15} /> Where is every lot?</Link><Link className="btn primary" to="/complaints/new"><ClipboardList size={15} /> Register complaint</Link></>} />
    <Loading q={q}>{q.data ? (() => { const d = q.data; const k = d.kpis; const sel = (id: string) => count === 'ALL' || count === id; const counts = d.counts.filter((c) => sel(c.countId));
      const prodDays = k.production7d.map((x) => ({ date: new Date(`${x.date}T06:00:00+05:30`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }), ...Object.fromEntries(d.counts.map((c) => [c.display, x.byCount[c.countId] ?? 0])) }));
      const wipMax = Math.max(1, ...k.wipByStage.map((w) => w.kg));
      return <>
      <div className="grid g6">
        <Kpi label="Yarn spun today" value={num(k.productionTodayKg, 0)} unit="kg" icon={<Gauge size={16} />} sub={k.productionTodayByCount.filter((c) => c.kg > 0).map((c) => `${c.display} ${num(c.kg, 0)}`).join(' · ') || 'No ring-frame output yet'} />
        <Kpi label="Yarn realization" value={pct(k.realization.actual)} icon={<PackageCheck size={16} />} tone={k.realization.color} sub={`master ${pct(k.realization.master)} · lots packed in the last 21 days`} />
        <Kpi label="Quality alerts (7 d)" value={k.qualityAlerts.red} unit="red" icon={<ShieldAlert size={16} />} tone={k.qualityAlerts.red ? 'red' : 'green'} sub={`${k.qualityAlerts.yellow} in the warning zone`} to="/quality?color=red" />
        <Kpi label="Complaints" value={k.complaints.open} unit="open" icon={<ClipboardList size={16} />} tone={k.complaints.open ? 'red' : 'green'} sub={`${k.complaints.inProgress} in progress · ${k.complaints.closed} closed`} to="/complaints" />
        <Kpi label="Finished stock" value={num(k.finishedStock.filter((s) => sel(s.countId)).reduce((a, s) => a + s.kg, 0), 0)} unit="kg" icon={<Boxes size={16} />} sub={k.finishedStock.filter((s) => sel(s.countId) && s.kg > 0).map((s) => `${s.display} ${num(s.kg, 0)}`).join(' · ') || '—'} to="/lots?status=PACKED" />
        <Kpi label="Dispatches" value={k.dispatches.today} unit="today" icon={<Truck size={16} />} sub={`${k.dispatches.month} this month · ${num(k.dispatches.monthKg, 0)} kg`} to="/dispatch" />
      </div>

      <div className="grid g4">{counts.map((c) => <Card key={c.countId} className="link" tone={c.worstColor === 'red' ? 'bad' : c.worstColor === 'yellow' ? 'warn' : undefined}>
        <CardBody className="stack" >
          <div className="row between"><div className="row" style={{ gap: 8 }}><span className="swatch" style={{ background: c.colorTip?.hex ?? '#ccc', width: 18, height: 18 }} title={`${c.colorTip?.colorName} tip cone`} /><div><b style={{ fontSize: 15 }}>{c.display}</b><div className="muted tiny">{c.label}</div></div></div><ColorPill color={c.worstColor} label={c.worstColor === 'green' ? 'Lots OK' : c.worstColor === 'yellow' ? 'Watch' : 'Attention'} /></div>
          <div className="row" style={{ gap: 5 }}>{c.recipe.map((r) => <Pill key={r.label} tone="gray" title={r.label}>{r.label.replace('Recycled blow-room & card waste', 'Recycled').replace(' (own)', '')} {r.pct}%</Pill>)}</div>
          <div className="row between small"><span className="muted">Realization</span><Vs actual={c.realization} master={c.realizationMaster} color={c.realization === null ? 'none' : evaluate(c.realization, { std: c.realizationMaster, lower: c.realizationMaster - 1.5, upper: null }).color} /></div>
          <div className="row between small"><span className="muted">Spun last 7 days</span><b>{kg(c.production7dKg)}</b></div>
          <div><div className="muted tiny" style={{ marginBottom: 4 }}>{c.lotsActive} lots in the mill right now</div>
            <div className="row" style={{ gap: 4 }}>{c.stages.map((s) => <button key={s.stage} className="btn sm" style={{ padding: '2px 6px', opacity: s.lots.length ? 1 : .45 }} onClick={() => s.lots.length && nav(`/lots/LOT-${s.lots[0]}`)} title={`${s.label}: ${s.lots.length ? `lots ${s.lots.join(', ')}` : 'none'}`}><StageIcon stage={s.stage} size={12} /><b>{s.lots.length || ''}</b></button>)}</div>
          </div>
          <Link className="small" to={`/lots?count=${c.countId}`}>Open {c.display} lots <ArrowRight size={12} style={{ verticalAlign: -2 }} /></Link>
        </CardBody></Card>)}</div>

      <div className="grid g-main">
        <Card><CardHead title="Yarn production by count" sub="Ring-frame output, last 7 days (kg per day)" /><CardBody>
          <div style={{ height: 250 }}><ResponsiveContainer><BarChart data={prodDays} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}><CartesianGrid stroke="hsl(var(--chart-grid))" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--chart-axis))" /><YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--chart-axis))" /><Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `${num(v, 0)} kg`} /><RLegend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            {counts.map((c, i) => <Bar key={c.countId} dataKey={c.display} stackId="a" fill={c.colorTip?.hex ?? `hsl(var(${SERIES[i % SERIES.length]}))`} radius={i === counts.length - 1 ? [4, 4, 0, 0] : 0} />)}</BarChart></ResponsiveContainer></div></CardBody></Card>
        <Card><CardHead title="Work in process by stage" sub="Kg currently inside each department" /><CardBody className="stack tight">
          {k.wipByStage.map((w) => <div key={w.stage} className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><span style={{ width: 156, flexShrink: 0, flexWrap: 'nowrap' }} className="row small"><StageIcon stage={w.stage} size={13} /> {w.label.replace(' (simplex)', '').replace(' (winding)', '')}</span><div className="bar grow"><i style={{ width: `${(w.kg / wipMax) * 100}%` }} /></div><span className="small nowrap" style={{ width: 92, textAlign: 'right' }}><b>{num(w.kg, 0)}</b> kg · {w.lots} lot{w.lots === 1 ? '' : 's'}</span></div>)}</CardBody></Card>
      </div>

      <div className="grid g2">
        <Card><CardHead title="Waste % by stage" sub="Last 14 days vs master (green within, yellow warning, red above)" /><div className="tbl-wrap"><table className="tbl dense"><thead><tr><th>Stage</th><th className="num">Actual vs master</th></tr></thead><tbody>{k.wasteByStage.map((w) => <tr key={w.stage}><td><span className="row"><StageIcon stage={w.stage} size={14} /> {w.label}</span></td><td className="num"><Vs actual={w.actual} master={w.master} color={w.color} d={2} /></td></tr>)}</tbody></table></div></Card>
        <Card><CardHead title="Machine efficiency by stage" sub="Last 7 days vs master" /><div className="tbl-wrap"><table className="tbl dense"><thead><tr><th>Stage</th><th className="num">Actual vs master</th></tr></thead><tbody>{k.efficiency.map((w) => <tr key={w.stage}><td><span className="row"><StageIcon stage={w.stage} size={14} /> {w.label}</span></td><td className="num"><Vs actual={w.actual} master={w.master} color={w.color} /></td></tr>)}</tbody></table></div></Card>
      </div>

      <div className="grid g-main">
        <Card tone={d.alerts.some((a) => a.severity === 'red') ? 'bad' : undefined}><CardHead title={<span className="row"><AlertTriangle size={16} /> Alerts</span>} sub="Out-of-master results, overdue accessories, mass-balance breaches, colour-code mismatches, dispatch without QA release" right={<Pill tone={d.alerts.some((a) => a.severity === 'red') ? 'red' : 'yellow'}>{d.alerts.filter((a) => a.severity === 'red').length} red · {d.alerts.filter((a) => a.severity === 'yellow').length} yellow</Pill>} />
          <div style={{ maxHeight: 420, overflow: 'auto' }}>{d.alerts.map((a) => <Link key={a.id} to={a.link} className="alert-row"><span className={`ico ${a.severity}`}>{a.severity === 'red' ? <XCircle size={15} /> : <AlertTriangle size={15} />}</span><div className="grow"><div className="row between"><b>{a.title}</b><Pill tone="gray">{ALERT_LABEL[a.kind]}</Pill></div><div className="muted small">{a.detail}</div></div></Link>)}</div></Card>
        <Card><CardHead title="Master completeness" sub="Share of required master items filled on the active versions" /><CardBody className="stack">
          {k.masterCompleteness.map((m) => { const c = d.counts.find((x) => x.countId === m.countId); return <Link key={m.countId} to="/masters" className="stack tight"><div className="row between small"><b>{c?.display}</b><span className={`judged ${m.overall >= 99 ? 'green' : m.overall >= 95 ? 'yellow' : 'red'}`}>{m.overall}%</span></div><div className="bar"><i style={{ width: `${m.overall}%`, background: m.overall >= 99 ? 'hsl(var(--ok))' : m.overall >= 95 ? 'hsl(var(--warn))' : 'hsl(var(--bad))' }} /></div>
            {Object.entries(m.byType).filter(([, v]) => v.pct < 100).map(([t, v]) => <div key={t} className="muted tiny">{t.replace('_', ' & ').toLowerCase()}: {v.pct}% — missing {v.missing.length} item{v.missing.length === 1 ? '' : 's'}</div>)}</Link>; })}
        </CardBody></Card>
      </div>

      <Card><CardHead title="Ring-frame heatmaps — machine × day" sub="Click a cell to open the AI analysis for that machine and day (last 14 days)" right={<Link className="btn sm" to="/analytics">All heatmaps <ArrowRight size={13} /></Link>} />
        <CardBody className="stack loose">
          <div className="grid g3">{[{ h: hU, t: 'U% (evenness)' }, { h: hH, t: 'Hairiness H' }, { h: hC, t: 'Count CV%' }].map(({ h, t }) => <div key={t}><div className="bold small" style={{ marginBottom: 6 }}>{t}</div>{h.data ? <MiniHeat data={h.data} onCell={(c) => c.value !== null && nav(`/analytics?stage=RF&parameter=${h.data!.parameter}&machine=${c.machineId}&date=${c.date}`)} /> : <div className="skeleton" style={{ height: 200 }} />}</div>)}</div>
          <Legend />
        </CardBody></Card>
    </>; })() : null}</Loading>
  </div>;
}
