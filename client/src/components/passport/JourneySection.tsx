import { useMemo } from 'react';
import type { JourneyStage, LotPassport } from '@shared/domain';
import { PROCESS_STAGES } from '@shared/params';
import { Card, CardBody, CardHead, ColorPill, Legend, Pill, StageIcon, StageStepper } from '../ui';
import { DataTable, type Col } from '../DataTable';
import { fmtDT, fmtDTShort, fmtDuration } from '../../lib/fmt';
import { fmtKg, fmtN, sum } from './util';

const STATE: Record<JourneyStage['state'], { label: string; tone: 'green' | 'blue' | 'gray' | 'yellow' }> = { DONE: { label: 'Done', tone: 'green' }, CURRENT: { label: 'In progress', tone: 'blue' }, NEXT: { label: 'Next', tone: 'yellow' }, PENDING: { label: 'Pending', tone: 'gray' } };
const machinesOf = (s: JourneyStage): string => [...new Set(s.machines.map((m) => m.label))].join(', ');

export function JourneySection({ p }: { p: LotPassport }): JSX.Element {
  const j = p.journey;
  const flow = useMemo(() => {
    const br = j.find((s) => s.stage === 'BR'); const pack = j.find((s) => s.stage === 'PACK'); const fg = j.find((s) => s.stage === 'FG');
    const run = sum(j.filter((s) => PROCESS_STAGES.includes(s.stage)).map((s) => s.durationMs ?? 0));
    const wait = sum(j.filter((s) => s.inAt && s.stage !== 'BALE' && s.stage !== 'FG' && s.stage !== 'DISP' && s.stage !== 'DELIV').map((s) => s.dwellBeforeMs ?? 0));
    const total = br?.inAt && pack?.outAt ? Date.parse(pack.outAt) - Date.parse(br.inAt) : null;
    return { run, wait, total, fg: fg?.durationMs ?? null, store: j[0]?.durationMs ?? null };
  }, [j]);

  const cols: Col<JourneyStage>[] = useMemo(() => [
    { key: 'stage', header: 'Stage', sortable: false, value: (s) => s.label, render: (s) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ flex: 'none', display: 'inline-flex' }}><StageIcon stage={s.stage} size={15} /></span><b>{s.label}</b></span> },
    { key: 'state', header: 'Status', sortable: false, value: (s) => STATE[s.state].label, render: (s) => <Pill tone={STATE[s.state].tone}>{STATE[s.state].label}</Pill> },
    { key: 'where', header: 'Machines / place', sortable: false, value: (s) => machinesOf(s) || s.location || '', render: (s) => {
      const m = machinesOf(s);
      return m ? <span title={s.machines.map((x) => `${x.label} · shift ${x.shift ?? '—'}${x.operator ? ` · ${x.operator}` : ''}`).join('\n')}><b>{m}</b></span> : s.location ? <span className="muted">{s.location}</span> : <span className="muted">—</span>;
    } },
    { key: 'in', header: 'IN', sortable: false, value: (s) => fmtDT(s.inAt), render: (s) => <span className="nowrap" title={fmtDT(s.inAt)}>{s.inAt ? fmtDTShort(s.inAt) : '—'}</span> },
    { key: 'out', header: 'OUT', sortable: false, value: (s) => (s.outAt ? fmtDT(s.outAt) : s.state === 'CURRENT' ? 'in progress' : ''), render: (s) => <span className="nowrap" title={fmtDT(s.outAt)}>{s.outAt ? fmtDTShort(s.outAt) : s.state === 'CURRENT' ? <Pill tone="blue">in progress</Pill> : '—'}</span> },
    { key: 'dur', header: 'Duration', sortable: false, num: true, value: (s) => (s.durationMs === null ? '' : fmtDuration(s.durationMs)), render: (s) => <span className="nowrap">{s.durationMs === null ? '—' : fmtDuration(s.durationMs)}</span> },
    { key: 'wait', header: 'Waited before', sortable: false, num: true, value: (s) => (s.dwellBeforeMs === null ? '' : fmtDuration(s.dwellBeforeMs)), render: (s) => <span className="nowrap" title="Time between the previous stage finishing and this stage starting">{s.dwellBeforeMs === null ? '—' : fmtDuration(s.dwellBeforeMs)}</span> },
    { key: 'kgin', header: 'kg in', sortable: false, num: true, value: (s) => (s.kgIn ? s.kgIn : ''), render: (s) => (s.kgIn ? fmtN(s.kgIn, 1) : '—') },
    { key: 'kgout', header: 'kg out', sortable: false, num: true, value: (s) => (s.kgOut ? s.kgOut : ''), render: (s) => (s.kgOut ? fmtN(s.kgOut, 1) : '—') },
    { key: 'waste', header: 'Waste %', sortable: false, num: true, value: (s) => s.wastePct ?? '', render: (s) => (s.wastePct === null ? '—' : <span title={`${fmtN(s.wasteKg, 1)} kg of waste`}>{fmtN(s.wastePct, 2)}%</span>) },
    { key: 'res', header: 'Result', sortable: false, value: (s) => (s.worst === 'none' ? '' : s.worst), render: (s) => (s.worst === 'none' ? <span className="muted">—</span> : <ColorPill color={s.worst} label={s.worst === 'red' ? 'Has red' : s.worst === 'yellow' ? 'Has yellow' : 'All good'} />), color: (s) => (s.worst === 'none' ? undefined : s.worst) },
    { key: 'batch', header: 'Batch ref', sortable: false, value: (s) => s.batchRefs.join(' '), render: (s) => <span className="mono-s">{s.batchRefs.join(', ') || '—'}</span> },
  ], []);

  return <div id="pp-journey" className="pp-anchor"><Card>
    <CardHead title={<span className="pp-sec">Journey — every stage, IN / OUT and waiting time</span>} sub="From the bale store to the customer. Hover a stage for machines, operators and batch references." />
    <CardBody>
      <div className="stack" style={{ gap: 14 }}>
        <StageStepper journey={j} />
        <div className="pp-flow">
          <span>Bale store: <b>{fmtDuration(flow.store)}</b></span>
          <span>Blow room IN → packed OUT: <b>{fmtDuration(flow.total)}</b></span>
          <span>On machines: <b>{fmtDuration(flow.run)}</b></span>
          <span>Waiting between stages: <b>{fmtDuration(flow.wait)}</b></span>
          <span>Finished-goods store: <b>{fmtDuration(flow.fg)}</b></span>
          <span className="muted small">Times are IST. {fmtKg(p.summary.cottonKg, 0)} of cotton became {p.summary.yarnKg === null ? 'yarn (in progress)' : fmtKg(p.summary.yarnKg)}.</span>
        </div>
      </div>
    </CardBody>
    <div style={{ borderTop: '1px solid hsl(var(--border))' }}>
      <DataTable rows={j} columns={cols} rowKey={(s) => s.stage} search={false} pageSize={25} exportName={`lot-${p.lot.lotNo}-journey`} title={`Lot ${p.lot.lotNo} — journey`} dense rowTone={(s) => (s.worst === 'red' || s.worst === 'yellow' ? s.worst : undefined)} footNote={<Legend chain />} />
    </div>
  </Card></div>;
}
