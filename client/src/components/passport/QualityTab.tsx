import { useMemo, useState } from 'react';
import { Download, FlaskConical, Layers } from 'lucide-react';
import type { Judged, LotPassport, PassportQualityStage, PassportSample } from '@shared/domain';
import { Card, CardBody, CardHead, ChainBadge, ColorPill, J, Legend, Pill, StageIcon } from '../ui';
import { DataTable, type Col } from '../DataTable';
import { fmtDT, fmtDTShort } from '../../lib/fmt';
import { CountPills, byParamOrder, cellVal, downloadCsv } from './util';

const machineOf = (s: PassportSample): string => s.machineLabel ?? 'Lot composite';

interface ParamCol { key: string; label: string; unit: string }
function paramCols(samples: PassportSample[]): ParamCol[] {
  const seen = new Map<string, ParamCol>();
  for (const s of samples) for (const v of s.values) if (!seen.has(v.key)) seen.set(v.key, { key: v.key, label: v.label, unit: v.unit });
  return [...seen.values()].sort((a, b) => byParamOrder(a.key, b.key));
}
const valueOf = (s: PassportSample, key: string): Judged | undefined => s.values.find((v) => v.key === key);

function buildColumns(q: PassportQualityStage): Col<PassportSample>[] {
  const params = paramCols(q.samples);
  return [
    { key: 'sample', header: 'Sample ID', value: (s) => s.sampleId, render: (s) => <span className={`mono-s bold nowrap ${s.type === 'LOT' ? 'pp-comp-mark' : ''}`}>{s.sampleId}</span> },
    { key: 'at', header: 'Date / time', value: (s) => fmtDT(s.testedAt), render: (s) => <span className="nowrap" title={fmtDT(s.testedAt)}>{fmtDTShort(s.testedAt)}</span> },
    { key: 'shift', header: 'Shift', value: (s) => s.shift ?? '', render: (s) => s.shift ?? '—' },
    { key: 'machine', header: 'Machine', value: (s) => machineOf(s), render: (s) => (s.type === 'LOT' ? <span className="muted">—</span> : <b>{machineOf(s)}</b>) },
    { key: 'pos', header: 'Position', value: (s) => s.pos ?? '', render: (s) => <span className="nowrap">{s.pos ?? '—'}</span> },
    { key: 'type', header: 'Type', value: (s) => (s.type === 'LOT' ? 'Lot composite' : 'Machine sample'), render: (s) => (s.type === 'LOT' ? <Pill tone="blue" icon={<Layers size={11} />} title="Composite sample of the whole lot — this is the result QA releases the lot on">Lot composite</Pill> : <span className="muted">Machine</span>) },
    { key: 'by', header: 'Tested by', value: (s) => s.byName, render: (s) => <span className="nowrap">{s.byName}</span> },
    { key: 'inst', header: 'Instrument', value: (s) => s.instrument, render: (s) => <span className="small nowrap">{s.instrument}</span> },
    ...params.map((c): Col<PassportSample> => ({
      key: `p-${c.key}`, header: <>{c.label}<small>{c.unit || ' '}</small></>, exportHeader: `${c.label}${c.unit ? ` [${c.unit}]` : ''}`, num: true,
      value: (s) => cellVal(valueOf(s, c.key)), render: (s) => <J j={valueOf(s, c.key)} plain />, color: (s) => valueOf(s, c.key)?.color,
    })),
    { key: 'res', header: 'Sample result', value: (s) => s.worst, render: (s) => <ColorPill color={s.worst} label={s.worst === 'red' ? 'Has red' : s.worst === 'yellow' ? 'Has yellow' : s.worst === 'green' ? 'All good' : 'No standard'} />, color: (s) => s.worst },
    { key: 'chain', header: 'On-chain', noExport: true, sortable: false, render: (s) => <ChainBadge chain={s.chain} /> },
  ];
}

function StageQuality({ q, machine, only, lotNo }: { q: PassportQualityStage; machine: string; only: boolean; lotNo: string }): JSX.Element {
  const cols = useMemo(() => buildColumns(q), [q]);
  const rows = useMemo(() => q.samples.filter((s) => (machine === 'ALL' || machineOf(s) === machine) && (!only || s.worst === 'red' || s.worst === 'yellow')), [q, machine, only]);
  return <div id={`pp-q-${q.stage}`} className="pp-anchor" data-testid={`quality-${q.stage}`}><Card flush>
    <CardHead
      title={<span className="pp-sec"><StageIcon stage={q.stage} size={17} /> {q.label}</span>}
      sub={`${q.samples.length} sample${q.samples.length === 1 ? '' : 's'} · ${q.samples.filter((s) => s.type === 'LOT').length ? 'includes the lot composite' : 'machine samples'}`}
      right={<><ColorPill color={q.worst} /><CountPills red={q.reds} yellow={q.yellows} /></>}
    />
    <CardBody>
      <div style={{ marginTop: 10 }} className="pp-wide">
        <DataTable rows={rows} columns={cols} rowKey={(s) => s.id} pageSize={50} dense exportName={`lot-${lotNo}-quality-${q.stage}`} title={`Lot ${lotNo} — ${q.label} — lab samples`} rowTone={(s) => (s.worst === 'red' || s.worst === 'yellow' ? s.worst : undefined)} empty="No samples match the filter in this department." />
      </div>
    </CardBody>
  </Card></div>;
}

export function QualityTab({ p }: { p: LotPassport }): JSX.Element {
  const [machine, setMachine] = useState('ALL');
  const [only, setOnly] = useState(false);
  const machines = useMemo(() => [...new Set(p.quality.flatMap((q) => q.samples.map(machineOf)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [p.quality]);
  const total = p.quality.reduce((n, q) => n + q.samples.length, 0);

  const exportAll = () => {
    const head = ['Department', 'Sample ID', 'Date/time (IST)', 'Shift', 'Machine', 'Position', 'Type', 'Tested by', 'Instrument', 'Parameter', 'Unit', 'Value', 'Master std', 'Lower', 'Upper', 'Master version', 'Status'];
    const rows: (string | number | null)[][] = [head];
    for (const q of p.quality) for (const s of q.samples) if (machine === 'ALL' || machineOf(s) === machine) for (const v of s.values) rows.push([q.label, s.sampleId, fmtDT(s.testedAt), s.shift, machineOf(s), s.pos, s.type === 'LOT' ? 'Lot composite' : 'Machine', s.byName, s.instrument, v.label, v.unit, v.value, v.std, v.lower, v.upper, v.versionNo ? `v${v.versionNo}` : '', v.text]);
    downloadCsv(`lot-${p.lot.lotNo}-quality-all.csv`, rows);
  };

  if (!p.quality.length) return <Card><CardBody><div className="muted">No lab samples have been recorded for this lot yet — tests appear here as the lot moves through each department.</div></CardBody></Card>;
  return <div className="stack" data-testid="quality-panel">
    <div className="pp-tools no-print">
      <FlaskConical size={15} className="muted" />
      <label className="row small" style={{ gap: 6, flexWrap: 'nowrap' }}>Machine
        <select className="select sm" style={{ width: 'auto' }} value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine filter" data-testid="quality-machine-filter">
          <option value="ALL">All machines &amp; composites ({total} samples)</option>
          {machines.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="chk"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only samples with red / yellow</label>
      <span className="pp-jump">{p.quality.map((q) => <a key={q.stage} href={`#pp-q-${q.stage}`} className={q.worst === 'red' || q.worst === 'yellow' ? q.worst : ''}><StageIcon stage={q.stage} size={12} /> {q.stage}</a>)}</span>
      <button type="button" className="btn sm sp" onClick={exportAll} title="One CSV with every reading of the lot (long format)"><Download size={13} /> Export all (CSV)</button>
    </div>
    {p.quality.filter((q) => machine === 'ALL' || q.samples.some((s) => machineOf(s) === machine)).map((q) => <StageQuality key={q.stage} q={q} machine={machine} only={only} lotNo={p.lot.lotNo} />)}
    <Legend chain />
  </div>;
}
