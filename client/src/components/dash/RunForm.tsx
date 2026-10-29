import { useMemo, useState } from 'react';
import { PARAMS, STAGE_INFO, PROCESS_STAGES, type Stage } from '@shared/params';
import type { LotSummary } from '@shared/domain';
import { useGet, useMut } from '../../lib/api';
import { istLocalToIso, isoToIstLocal } from '../../lib/fmt';
import { previewColor, useActiveMaster } from '../../lib/masters';
import { Field, Modal, Notice, ColorIcon } from '../ui';

interface Machine { id: string; stage: Stage; label: string }

/** Log a production stage run (IN/OUT time, quantities, machine parameters) — a ProcessEvent.logStageRun contract call. */
export function RunForm({ onClose, lotNo, stage: stage0 }: { onClose: () => void; lotNo?: string; stage?: Stage }): JSX.Element {
  const lots = useGet<LotSummary[]>('/api/lots');
  const machines = useGet<Machine[]>('/api/machines');
  const meta = useGet<{ now: string }>('/api/meta');
  const [lotId, setLotId] = useState(lotNo ? `LOT-${lotNo}` : '');
  const [stage, setStage] = useState<Stage>(stage0 ?? 'RF');
  const [machineId, setMachineId] = useState('');
  const [inAt, setInAt] = useState(''); const [outAt, setOutAt] = useState('');
  const [inKg, setInKg] = useState(''); const [outKg, setOutKg] = useState(''); const [wasteKg, setWasteKg] = useState('');
  const [notes, setNotes] = useState(''); const [params, setParams] = useState<Record<string, string>>({}); const [err, setErr] = useState('');
  const lot = lots.data?.find((l) => l.id === lotId);
  const master = useActiveMaster(lot?.countId, 'PRODUCTION');
  const candidates = useMemo(() => (lots.data ?? []).filter((l) => ['IN_PRODUCTION', 'PLANNED'].includes(l.status) && l.location.stage !== 'BALE'), [lots.data]);
  const stageParams = PARAMS.filter((p) => p.kind === 'PRODUCTION' && p.stages.includes(stage) && !['WASTE_PCT', 'YIELD_PCT'].includes(p.key));
  const m = useMut<Record<string, unknown>, unknown>('POST', '/api/production-events', (b) => `Log ${STAGE_INFO[stage].label} run for lot ${String(b.lotId).replace('LOT-', '')}`);
  const submit = async () => {
    setErr('');
    try {
      await m.mutateAsync({ lotId, stage, machineId, inAt: istLocalToIso(inAt), outAt: outAt ? istLocalToIso(outAt) : null, inputKg: Number(inKg), outputKg: Number(outKg), wasteKg: Number(wasteKg), notes, params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Rejected'); }
  };
  const now = meta.data ? isoToIstLocal(meta.data.now) : '';
  return <Modal wide title="Log a production run" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!lotId || !machineId || !inAt || !inKg || !outKg || !wasteKg || m.isPending} onClick={() => void submit()} data-testid="run-submit">Commit to ledger</button></>}>
    <div className="stack">
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <div className="grid g3">
        <Field label="Lot"><select className="select" value={lotId} onChange={(e) => setLotId(e.target.value)} data-testid="run-lot"><option value="">Select a lot in production…</option>{candidates.map((l) => <option key={l.id} value={l.id}>{l.lotNo} · {l.countDisplay} · {l.location.label}</option>)}</select></Field>
        <Field label="Stage"><select className="select" value={stage} onChange={(e) => { setStage(e.target.value as Stage); setMachineId(''); setParams({}); }}>{PROCESS_STAGES.filter((s) => s !== 'COMB' || lot?.countId === '40CP').map((s) => <option key={s} value={s}>{STAGE_INFO[s].label}</option>)}</select></Field>
        <Field label="Machine"><select className="select" value={machineId} onChange={(e) => setMachineId(e.target.value)}><option value="">Select machine…</option>{(machines.data ?? []).filter((x) => x.stage === stage).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
        <Field label="IN (mill time, IST)"><input className="input" type="datetime-local" value={inAt} max={now} onChange={(e) => setInAt(e.target.value)} /></Field>
        <Field label="OUT (leave empty if still running)"><input className="input" type="datetime-local" value={outAt} min={inAt} max={now} onChange={(e) => setOutAt(e.target.value)} /></Field>
        <Field label="Notes"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Input kg"><input className="input" inputMode="decimal" value={inKg} onChange={(e) => setInKg(e.target.value)} /></Field>
        <Field label="Output kg"><input className="input" inputMode="decimal" value={outKg} onChange={(e) => setOutKg(e.target.value)} /></Field>
        <Field label="Waste kg" hint="input − output − waste must balance (±0.3%)"><input className="input" inputMode="decimal" value={wasteKg} onChange={(e) => setWasteKg(e.target.value)} /></Field>
      </div>
      <div><div className="bold small" style={{ marginBottom: 6 }}>Machine / process parameters {master.versionNo ? <span className="muted">· colour preview against Production master v{master.versionNo}</span> : null}</div>
        <div className="grid g4">{stageParams.map((p) => { const row = master.find(stage, p.key); const v = params[p.key] === undefined || params[p.key] === '' ? null : Number(params[p.key]); const c = previewColor(row, v);
          return <Field key={p.key} label={<>{p.label} <span className="muted">({p.unit || '–'})</span></>} hint={row ? `master ${row.lower ?? '–'} … ${row.std} … ${row.upper ?? '–'}` : undefined}><div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" inputMode="decimal" value={params[p.key] ?? ''} onChange={(e) => setParams({ ...params, [p.key]: e.target.value })} placeholder={row?.std !== null && row ? String(row.std) : ''} />{v !== null ? <span className={`judged ${c}`}><ColorIcon color={c} size={12} /></span> : null}</div></Field>; })}</div></div>
    </div>
  </Modal>;
}
