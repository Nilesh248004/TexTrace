import { useMemo, useState } from 'react';
import { MACHINE_STAGES, PARAMS, STAGE_INFO, type Stage } from '@shared/params';
import type { LotSummary } from '@shared/domain';
import { useGet, useMut } from '../../lib/api';
import { istLocalToIso, isoToIstLocal } from '../../lib/fmt';
import { previewColor, useActiveMaster } from '../../lib/masters';
import { ColorIcon, Field, Modal, Notice } from '../ui';

interface Machine { id: string; stage: Stage; label: string }

/** Enter a laboratory test result: the colour of every value is previewed against the active Quality master while typing. */
export function TestForm({ onClose, lotNo }: { onClose: () => void; lotNo?: string }): JSX.Element {
  const lots = useGet<LotSummary[]>('/api/lots'); const machines = useGet<Machine[]>('/api/machines'); const meta = useGet<{ now: string }>('/api/meta');
  const [lotId, setLotId] = useState(lotNo ? `LOT-${lotNo}` : ''); const [stage, setStage] = useState<Stage>('RF'); const [type, setType] = useState<'MACHINE' | 'LOT'>('MACHINE');
  const [machineId, setMachineId] = useState(''); const [pos, setPos] = useState(''); const [at, setAt] = useState(''); const [instrument, setInstrument] = useState(''); const [remarks, setRemarks] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({}); const [err, setErr] = useState('');
  const lot = lots.data?.find((l) => l.id === lotId); const master = useActiveMaster(lot?.countId, 'QUALITY');
  const started = useMemo(() => (lots.data ?? []).filter((l) => l.status !== 'PLANNED'), [lots.data]);
  const params = PARAMS.filter((p) => (p.kind === 'QUALITY' || p.kind === 'FIBRE') && p.stages.includes(stage));
  const m = useMut<Record<string, unknown>, unknown>('POST', '/api/test-results', () => `Record ${STAGE_INFO[stage].label} test for lot ${lotId.replace('LOT-', '')}`);
  const now = meta.data ? isoToIstLocal(meta.data.now) : '';
  const submit = async () => {
    setErr('');
    try {
      await m.mutateAsync({ lotId, stage, sampleType: type, machineId: type === 'MACHINE' ? machineId : null, pos, testedAt: at ? istLocalToIso(at) : undefined, instrument, remarks, values: Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Rejected'); }
  };
  return <Modal wide title="Record a laboratory test result" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!lotId || (type === 'MACHINE' && !machineId) || Object.values(vals).every((v) => v === '') || m.isPending} onClick={() => void submit()} data-testid="test-submit">Commit to ledger</button></>}>
    <div className="stack">
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <div className="grid g4">
        <Field label="Lot"><select className="select" value={lotId} onChange={(e) => setLotId(e.target.value)} data-testid="test-lot"><option value="">Select lot…</option>{started.map((l) => <option key={l.id} value={l.id}>{l.lotNo} · {l.countDisplay}</option>)}</select></Field>
        <Field label="Department"><select className="select" value={stage} onChange={(e) => { setStage(e.target.value as Stage); setMachineId(''); setVals({}); }}>{MACHINE_STAGES.filter((s) => s !== 'COMB' || lot?.countId === '40CP').map((s) => <option key={s} value={s}>{STAGE_INFO[s].label}</option>)}</select></Field>
        <Field label="Sample"><select className="select" value={type} onChange={(e) => setType(e.target.value as 'MACHINE' | 'LOT')}><option value="MACHINE">Machine sample</option><option value="LOT">Lot composite</option></select></Field>
        <Field label="Machine">{type === 'MACHINE' ? <select className="select" value={machineId} onChange={(e) => setMachineId(e.target.value)}><option value="">Select…</option>{(machines.data ?? []).filter((x) => x.stage === stage).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select> : <input className="input" disabled value="Composite of the lot" />}</Field>
        <Field label="Tested at (IST)" hint="empty = now"><input className="input" type="datetime-local" value={at} max={now} onChange={(e) => setAt(e.target.value)} /></Field>
        <Field label="Position (side / doff / drum / can)"><input className="input" value={pos} onChange={(e) => setPos(e.target.value)} placeholder="Side L" /></Field>
        <Field label="Instrument"><input className="input" value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="Uster Tester 6" /></Field>
        <Field label="Remarks"><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
      </div>
      <div className="bold small">Results {master.versionNo ? <span className="muted">· colour preview against Quality master v{master.versionNo}</span> : null}</div>
      <div className="grid g4">{params.map((p) => { const row = master.find(stage, p.key); const v = vals[p.key] === undefined || vals[p.key] === '' ? null : Number(vals[p.key]); const c = previewColor(row, v);
        return <Field key={p.key} label={<>{p.label} <span className="muted">({p.unit || '–'})</span></>} hint={row ? `master ${row.lower ?? '–'} … ${row.std} … ${row.upper ?? '–'}` : lot ? 'no master' : undefined}><div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" inputMode="decimal" value={vals[p.key] ?? ''} onChange={(e) => setVals({ ...vals, [p.key]: e.target.value })} data-testid={`val-${p.key}`} />{v !== null ? <span className={`judged ${c}`} title={c}><ColorIcon color={c} size={12} /></span> : null}</div></Field>; })}</div>
    </div>
  </Modal>;
}
