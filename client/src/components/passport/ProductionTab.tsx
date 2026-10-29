import { useMemo, useState, type ReactNode } from 'react';
import { Download, Gauge } from 'lucide-react';
import type { LotPassport, PassportProductionStage, PassportRun } from '@shared/domain';
import { Card, CardBody, CardHead, ChainBadge, ColorIcon, ColorPill, J, Kpi, Legend, Pill, StageIcon } from '../ui';
import { DataTable, type Col } from '../DataTable';
import { fmtDTShort, fmtDuration } from '../../lib/fmt';
import { MASTER_HEAD, MasterTable, masterRows } from './MasterTable';
import { CountPills, PrintCollapse, downloadCsv, fmtKg, fmtN, tally } from './util';

type Row = { kind: 'run'; id: string; run: PassportRun } | { kind: 'total'; id: string; st: PassportProductionStage };

const runDur = (r: PassportRun): string => (r.outAt ? fmtDuration(Date.parse(r.outAt) - Date.parse(r.inAt)) : '');

function BalancePill({ run }: { run: PassportRun }): JSX.Element {
  const b = run.balance;
  if (!b) return run.running ? <Pill tone="blue">running</Pill> : <span className="muted">—</span>;
  return <span className={`pill ${b.color}`} title={`Mass balance: input − output − waste = ${fmtN(b.diffKg, 2)} kg (${b.diffPct}% of the input). Green up to 0.3%, yellow up to 0.6%, red above.`}>
    <ColorIcon color={b.color} size={12} /> {b.color === 'green' ? 'Balanced' : `${fmtN(Math.abs(b.diffKg), 1)} kg unaccounted`} · {fmtN(b.diffPct, 2)}%
  </span>;
}

function runColumns(): Col<Row>[] {
  const run = (r: Row) => (r.kind === 'run' ? r.run : null);
  return [
    { key: 'machine', header: 'Machine', sortable: false, value: (r) => (r.kind === 'run' ? r.run.machineLabel ?? r.run.location ?? '' : 'Stage total'), render: (r) => (r.kind === 'run' ? <><b>{r.run.machineLabel ?? r.run.location ?? r.run.stage}</b>{r.run.machineLabel && r.run.location ? <span className="pp-sub">{r.run.location}</span> : null}</> : <b className="nowrap">Stage total</b>) },
    { key: 'shift', header: 'Shift', sortable: false, value: (r) => run(r)?.shift ?? '', render: (r) => run(r)?.shift ?? '' },
    { key: 'op', header: 'Operator', sortable: false, value: (r) => run(r)?.operatorName ?? '', render: (r) => run(r)?.operatorName ?? '' },
    { key: 'in', header: 'IN', sortable: false, value: (r) => (run(r) ? fmtDTShort(run(r)!.inAt) : ''), render: (r) => (run(r) ? <span className="nowrap">{fmtDTShort(run(r)!.inAt)}</span> : '') },
    { key: 'out', header: 'OUT', sortable: false, value: (r) => (run(r) ? (run(r)!.outAt ? fmtDTShort(run(r)!.outAt) : 'running') : ''), render: (r) => (run(r) ? (run(r)!.outAt ? <span className="nowrap">{fmtDTShort(run(r)!.outAt)}</span> : <Pill tone="blue">running</Pill>) : '') },
    { key: 'dur', header: 'Duration', sortable: false, num: true, value: (r) => (run(r) ? runDur(run(r)!) : ''), render: (r) => (run(r) ? runDur(run(r)!) || '—' : '') },
    { key: 'in-kg', header: 'Input kg', sortable: false, num: true, value: (r) => (r.kind === 'run' ? r.run.inKg : r.st.totals.inKg), render: (r) => <span className={r.kind === 'total' ? 'bold' : ''}>{fmtN(r.kind === 'run' ? r.run.inKg : r.st.totals.inKg, 1)}</span> },
    { key: 'out-kg', header: 'Output kg', sortable: false, num: true, value: (r) => (r.kind === 'run' ? r.run.outKg : r.st.totals.outKg), render: (r) => <span className={r.kind === 'total' ? 'bold' : ''}>{r.kind === 'run' && r.run.running ? '…' : fmtN(r.kind === 'run' ? r.run.outKg : r.st.totals.outKg, 1)}</span> },
    { key: 'w-kg', header: 'Waste kg', sortable: false, num: true, value: (r) => (r.kind === 'run' ? r.run.wasteKg : r.st.totals.wasteKg), render: (r) => <span className={r.kind === 'total' ? 'bold' : ''} title={r.kind === 'run' ? r.run.wasteType ?? undefined : undefined}>{fmtN(r.kind === 'run' ? r.run.wasteKg : r.st.totals.wasteKg, 1)}</span> },
    { key: 'w-pct', header: 'Waste % vs master', sortable: false, num: true, value: (r) => (r.kind === 'run' ? r.run.wastePct : r.st.totals.waste?.value ?? r.st.totals.wastePct) ?? '', render: (r) => (r.kind === 'run' ? (r.run.wastePct === null ? '—' : <span title="Waste kg ÷ input kg of this run (judged at stage level in the total row)">{fmtN(r.run.wastePct, 2)}%</span>) : r.st.totals.waste ? <J j={r.st.totals.waste} unit plain /> : `${fmtN(r.st.totals.wastePct, 2)}%`), color: (r) => (r.kind === 'total' ? r.st.totals.waste?.color : undefined) },
    { key: 'bal', header: 'Mass balance · yield', sortable: false, value: (r) => (r.kind === 'run' ? (r.run.balance ? (r.run.balance.color === 'green' ? 'Balanced' : `${r.run.balance.diffKg} kg unaccounted`) : 'running') : r.st.totals.yield?.value ?? ''), render: (r) => (r.kind === 'run' ? <BalancePill run={r.run} /> : r.st.totals.yield ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><span className="muted small">Yield</span><J j={r.st.totals.yield} unit plain /></span> : ''), color: (r) => (r.kind === 'run' ? r.run.balance?.color : r.st.totals.yield?.color) },
    { key: 'batch', header: 'Batch ref ← input refs', sortable: false, value: (r) => (r.kind === 'run' ? `${r.run.batchRef ?? ''} <- ${r.run.inputRefs.join(' ')}` : ''), render: (r) => (r.kind === 'run' ? <><span className="mono-s bold">{r.run.batchRef ?? '—'}</span>{r.run.inputRefs.length ? <span className="pp-refs" title="Batches this run consumed">{r.run.inputRefs.map((x) => <span key={x}>← {x}</span>)}</span> : null}</> : '') },
    { key: 'res', header: 'Result', sortable: false, value: (r) => (r.kind === 'run' ? r.run.worst : r.st.worst), render: (r) => <ColorPill color={r.kind === 'run' ? r.run.worst : r.st.worst} />, color: (r) => (r.kind === 'run' ? r.run.worst : r.st.worst) },
    { key: 'chain', header: 'On-chain', sortable: false, noExport: true, render: (r) => (r.kind === 'run' ? <ChainBadge chain={r.run.chain} /> : '') },
  ];
}

function StageProduction({ st, lotNo, dev }: { st: PassportProductionStage; lotNo: string; dev: boolean }): JSX.Element {
  const rows: Row[] = useMemo(() => [...st.runs.map((r): Row => ({ kind: 'run', id: r.id, run: r })), { kind: 'total', id: `${st.stage}-total`, st }], [st]);
  const cols = useMemo(() => runColumns(), []);
  const counts = tally(st.runs.flatMap((r) => r.params)); const balRed = st.runs.filter((r) => r.balance?.color === 'red').length; const balYellow = st.runs.filter((r) => r.balance?.color === 'yellow').length;
  const exportParams = () => downloadCsv(`lot-${lotNo}-${st.stage}-parameters.csv`, [['Machine', 'Shift', 'Run IN (IST)', ...MASTER_HEAD], ...st.runs.flatMap((r) => masterRows(r.params, [r.machineLabel ?? st.label, r.shift, fmtDTShort(r.inAt)]))]);
  return <div id={`pp-p-${st.stage}`} className="pp-anchor" data-testid={`production-${st.stage}`}><Card flush>
    <CardHead
      title={<span className="pp-sec"><StageIcon stage={st.stage} size={17} /> {st.label}</span>}
      sub={`${st.runs.length} machine run${st.runs.length === 1 ? '' : 's'} · ${fmtKg(st.totals.inKg)} in → ${fmtKg(st.totals.outKg)} out`}
      right={<>{st.totals.waste ? <span className="small row" style={{ gap: 5, flexWrap: 'nowrap' }}>Stage waste <J j={st.totals.waste} unit plain /></span> : null}{st.totals.yield ? <span className="small row" style={{ gap: 5, flexWrap: 'nowrap' }}>Yield <J j={st.totals.yield} unit plain /></span> : null}<ColorPill color={st.worst} /><CountPills red={counts.red + balRed} yellow={counts.yellow + balYellow} /></>}
    />
    <CardBody>
      <div style={{ marginTop: 10 }}>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} search={false} pageSize={50} dense exportName={`lot-${lotNo}-production-${st.stage}`} title={`Lot ${lotNo} — ${st.label} — machine runs`} rowTone={(r) => { const c = r.kind === 'run' ? r.run.worst : st.worst; return c === 'red' || c === 'yellow' ? c : undefined; }} />
      </div>
      <div style={{ padding: '10px 16px 6px' }}>
        <div className="row between" style={{ marginBottom: 2 }}>
          <span className="bold small" style={{ letterSpacing: '.04em', textTransform: 'uppercase' }}>Actual vs master vs deviation — machine settings &amp; results of each run</span>
          <button type="button" className="btn sm no-print" onClick={exportParams} title="CSV of every parameter of every run in this stage"><Download size={13} /> Parameters CSV</button>
        </div>
        {st.runs.map((r) => {
          const items = dev ? r.params.filter((j) => j.color === 'red' || j.color === 'yellow') : r.params;
          const c = tally(r.params);
          return <RunParams key={r.id} run={r} counts={c}>{items.length ? <MasterTable items={items} testId={`params-${r.id}`} /> : <div className="muted small" style={{ padding: '4px 0 8px' }}>{dev ? 'Every parameter of this run is within its master limits.' : 'No machine parameters were recorded for this run.'}</div>}</RunParams>;
        })}
      </div>
    </CardBody>
  </Card></div>;
}

function RunParams({ run, counts, children }: { run: PassportRun; counts: { red: number; yellow: number }; children: ReactNode }): JSX.Element {
  return <PrintCollapse
    title={<span><b>{run.machineLabel ?? run.location ?? run.stage}</b><span className="muted small" style={{ fontWeight: 500 }}> · shift {run.shift ?? '—'} · {run.operatorName ?? '—'} · {fmtDTShort(run.inAt)}{run.outAt ? ` → ${fmtDTShort(run.outAt)}` : ' → running'} · {run.params.length} parameters</span></span>}
    right={<><ColorPill color={run.worst} /><CountPills red={counts.red} yellow={counts.yellow} ok="Settings within master" /></>}>
    {children}
  </PrintCollapse>;
}

function Realization({ p }: { p: LotPassport }): JSX.Element {
  const { summary } = p; const real = summary.realization;
  const rows = summary.stageYield.filter((s) => s.cumulativePct !== null);
  const target = summary.targetRealizationPct;
  const min = Math.min(...rows.map((r) => r.cumulativePct as number), target ?? 100, summary.yarnKg !== null && summary.cottonKg ? (summary.yarnKg / summary.cottonKg) * 100 : 100);
  const lo = Math.max(0, Math.floor(min / 5) * 5 - 5);
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (100 - lo)) * 100))}%`;
  return <div id="pp-realization" className="pp-anchor"><Card>
    <CardHead title={<span className="pp-sec"><Gauge size={17} /> Overall realization — cotton in, yarn out</span>} sub="Yarn packed ÷ cotton fed to the blow room, compared with the Count & Mix master target." />
    <CardBody>
      <div className="stack" style={{ gap: 16 }}>
        <div className="pp-bigfacts">
          <Kpi label="Cotton fed to the blow room" value={fmtN(summary.cottonKg, 0)} unit="kg" sub="100% of the material" />
          <Kpi label="Yarn packed" value={summary.yarnKg === null ? '…' : fmtN(summary.yarnKg, 1)} unit="kg" sub={summary.yarnKg === null ? 'Packing not done yet' : `Net weight on packing slip ${p.packing?.slipNo ?? ''}`} />
          <Kpi label="Realization — actual" value={real ? <J j={real} unit plain /> : '—'} sub={target !== null ? `Master target ${fmtN(target, 1)}%${real?.lower != null ? ` · minimum ${fmtN(real.lower, 1)}%` : ''}` : undefined} tone={real?.color === 'none' ? undefined : real?.color} />
          <Kpi label="Total waste" value={summary.wastePct === null ? '—' : fmtN(summary.wastePct, 1)} unit="%" sub={summary.targetWastePct !== null ? `Master target ${fmtN(summary.targetWastePct, 1)}%` : undefined} />
        </div>
        {rows.length ? <div>
          <div className="bold small" style={{ letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 8 }}>Cumulative yield after each stage <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(bars start at {lo}% · the line marks the master realization target)</span></div>
          <div className="pp-yield" style={{ paddingTop: 12 }} data-testid="stage-yield">
            <span className="bold">Cotton in</span><div className="trk"><i style={{ width: '100%' }} />{target !== null ? <span className="tgt" style={{ left: pos(target) }} data-label={`target ${fmtN(target, 1)}%`} /> : null}</div><span className="bold right">100%</span>
            {rows.map((r) => <span key={r.stage} style={{ display: 'contents' }}><span><StageIcon stage={r.stage} size={13} /> {r.label}</span><div className="trk"><i style={{ width: pos(r.cumulativePct as number) }} />{target !== null ? <span className="tgt" style={{ left: pos(target) }} /> : null}</div><span className="bold right">{fmtN(r.cumulativePct, 1)}%</span></span>)}
          </div>
        </div> : null}
      </div>
    </CardBody>
  </Card></div>;
}

export function ProductionTab({ p }: { p: LotPassport }): JSX.Element {
  const [dev, setDev] = useState(false);
  const exportAll = () => downloadCsv(`lot-${p.lot.lotNo}-production-all.csv`, [['Stage', 'Machine', 'Shift', 'Operator', 'IN (IST)', 'OUT (IST)', 'Input kg', 'Output kg', 'Waste kg', 'Waste %', 'Batch ref', ...MASTER_HEAD], ...p.production.flatMap((st) => st.runs.flatMap((r) => masterRows(r.params, [st.label, r.machineLabel, r.shift, r.operatorName, fmtDTShort(r.inAt), r.outAt ? fmtDTShort(r.outAt) : 'running', r.inKg, r.outKg, r.wasteKg, r.wastePct, r.batchRef])))]);
  if (!p.production.length) return <Card><CardBody><div className="muted">No machine runs have been logged for this lot yet.</div></CardBody></Card>;
  return <div className="stack" data-testid="production-panel">
    <div className="pp-tools no-print">
      <Gauge size={15} className="muted" />
      <label className="chk"><input type="checkbox" checked={dev} onChange={(e) => setDev(e.target.checked)} data-testid="production-dev-only" /> Only parameters with red / yellow</label>
      <span className="pp-jump">{p.production.map((s) => <a key={s.stage} href={`#pp-p-${s.stage}`} className={s.worst === 'red' || s.worst === 'yellow' ? s.worst : ''}><StageIcon stage={s.stage} size={12} /> {s.stage}</a>)}<a href="#pp-realization">Realization</a></span>
      <button type="button" className="btn sm sp" onClick={exportAll} title="One CSV with every parameter of every run"><Download size={13} /> Export all (CSV)</button>
    </div>
    {p.production.map((st) => <StageProduction key={st.stage} st={st} lotNo={p.lot.lotNo} dev={dev} />)}
    <Realization p={p} />
    <Legend chain />
  </div>;
}
