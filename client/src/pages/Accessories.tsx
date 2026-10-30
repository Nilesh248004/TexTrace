import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, PackageCheck, Plus, Printer, Wrench } from 'lucide-react';
import { useGet, useGlobalParams, useMut, qstr } from '../lib/api';
import { useSession } from '../lib/store';
import { ACCESSORY_INFO, STAGE_INFO, type AccessoryKind, type Stage } from '@shared/params';
import type { AccessoriesMeta, Judged, LotSummary, MasterVersionDTO } from '@shared/domain';
import type { OnChainRef } from '@shared/types';
import { fmtD, fmtDT, fmtDTShort, isoToIstLocal, istLocalToIso, num } from '../lib/fmt';
import { Card, CardBody, CardHead, ChainBadge, ColorIcon, ColorPill, Drawer, Field, J, Kpi, Legend, Modal, Notice, PageHead, Pill, Seg, StageIcon, Swatch } from '../components/ui';
import { DataTable, type Col } from '../components/DataTable';

interface Acc { machineId: string; machineLabel: string; stage: Stage; countId: string | null; kind: AccessoryKind; kindLabel: string; spec: string; changedAt: string; ageDays: number | null; value: number | null; std: number | null; upper: number | null; color: 'green' | 'yellow' | 'red' | 'none'; text: string; overdueDays: number | null }
interface Change { id: string; machineId: string; machineLabel: string; kind: AccessoryKind; spec: string; changedAt: string; changedBy: string; note: string; chain: OnChainRef }
interface Pack { id: string; lotId: string; lotNo: string; countId: string; countDisplay: string; packedAt: string; packer: string; packageType: string; cones: number; partialCones: number; cartons: number; netKg: number; tareKg: number; grossKg: number; avgConeKg: number; slipNo: string; cartonFrom: string; cartonTo: string; colorActual: string; colorMaster: string; colorOk: boolean; colorHex: string | null; fgLocation: string; labelTemplate: string; checks: Judged[]; worst: 'green' | 'yellow' | 'red' | 'none'; chain: OnChainRef }
interface ColorRow { countId: string; display: string; colorName: string; hex: string; tip: string; code: string }
type Tab = 'accessories' | 'packing' | 'colors';

function ChangeForm({ onClose, accs }: { onClose: () => void; accs: Acc[] }): JSX.Element {
  const machines = useGet<{ id: string; stage: Stage; label: string }[]>('/api/machines'); const meta = useGet<{ now: string }>('/api/meta');
  const [machineId, setMachineId] = useState(''); const [kind, setKind] = useState<AccessoryKind | ''>(''); const [spec, setSpec] = useState(''); const [at, setAt] = useState(''); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const m = (machines.data ?? []).find((x) => x.id === machineId);
  const kinds = (Object.keys(ACCESSORY_INFO) as AccessoryKind[]).filter((k) => m && ACCESSORY_INFO[k].stages.includes(m.stage));
  const last = accs.find((a) => a.machineId === machineId && a.kind === kind);
  const mut = useMut<Record<string, unknown>, unknown>('POST', '/api/accessory-changes', (b) => `${ACCESSORY_INFO[b.kind as AccessoryKind].label} changed on ${m?.label}`);
  return <Modal title="Record an accessory change" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!machineId || !kind || mut.isPending} data-testid="change-submit" onClick={async () => { setErr(''); try { await mut.mutateAsync({ machineId, kind, spec, value: kind === 'SPACER' ? Number(spec.replace(/[^\d.]/g, '')) || null : null, changedAt: at ? istLocalToIso(at) : undefined, note }); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Rejected'); } }}>Commit to ledger</button></>}>
    <div className="stack">{err ? <Notice tone="bad">{err}</Notice> : null}
      <div className="grid g2"><Field label="Machine"><select className="select" value={machineId} onChange={(e) => { setMachineId(e.target.value); setKind(''); }}><option value="">Select…</option>{(machines.data ?? []).filter((x) => ['CARD', 'DFB', 'DFF', 'FF', 'RF'].includes(x.stage)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
        <Field label="Accessory"><select className="select" value={kind} onChange={(e) => setKind(e.target.value as AccessoryKind)} disabled={!machineId}><option value="">Select…</option>{kinds.map((k) => <option key={k} value={k}>{ACCESSORY_INFO[k].label}</option>)}</select></Field>
        <Field label="Type / specification" hint={last ? `current: ${last.spec || '—'}` : undefined}><input className="input" value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="e.g. Bracker C1 EL 4/0" /></Field>
        <Field label="Changed at (IST)" hint="empty = now"><input className="input" type="datetime-local" value={at} max={meta.data ? isoToIstLocal(meta.data.now) : undefined} onChange={(e) => setAt(e.target.value)} /></Field></div>
      <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {last ? <Notice tone={last.color === 'red' ? 'bad' : last.color === 'yellow' ? 'warn' : 'info'}>The current {last.kindLabel.toLowerCase()} on {last.machineLabel} is {last.ageDays} days old (master limit {last.upper ?? '—'}) — {last.text.toLowerCase()}.</Notice> : null}</div>
  </Modal>;
}

function PackForm({ onClose }: { onClose: () => void }): JSX.Element {
  const lots = useGet<LotSummary[]>('/api/lots'); const colors = useGet<ColorRow[]>('/api/color-codes'); const ov = useGet<{ counts: { id: string; versions: MasterVersionDTO[] }[] }>('/api/masters/overview');
  const [lotId, setLotId] = useState(''); const [cones, setCones] = useState(''); const [cartons, setCartons] = useState(''); const [color, setColor] = useState(''); const [bay, setBay] = useState(''); const [err, setErr] = useState('');
  const ready = (lots.data ?? []).filter((l) => l.location.stage === 'AW' && l.location.state === 'WAITING' && !l.packedKg);
  const lot = ready.find((l) => l.id === lotId);
  const master = colors.data?.find((c) => c.countId === lot?.countId);
  const spec = ov.data?.counts.find((c) => c.id === lot?.countId)?.versions.find((v) => v.masterType === 'ACCESSORIES' && v.status === 'ACTIVE');
  const mut = useMut<Record<string, unknown>, unknown>('POST', '/api/packing', () => `Pack lot ${lot?.lotNo}`);
  const colorOk = !color || !master || color.toLowerCase() === master.colorName.toLowerCase();
  return <Modal title="Record packing of a lot" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!lotId || !cones || !cartons || !color || mut.isPending} data-testid="pack-submit" onClick={async () => { setErr(''); try { await mut.mutateAsync({ lotId, cones: Number(cones), cartons: Number(cartons), colorActual: color, fgLocation: bay || undefined }); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Rejected'); } }}>Commit to ledger</button></>}>
    <div className="stack">{err ? <Notice tone="bad">{err}</Notice> : null}
      <Field label="Lot (winding complete)"><select className="select" value={lotId} onChange={(e) => setLotId(e.target.value)}><option value="">{ready.length ? 'Select…' : 'No lot is waiting for packing'}</option>{ready.map((l) => <option key={l.id} value={l.id}>{l.lotNo} · {l.countDisplay}</option>)}</select></Field>
      <div className="grid g3"><Field label="Cones packed"><input className="input" inputMode="numeric" value={cones} onChange={(e) => setCones(e.target.value)} /></Field><Field label="Cartons (incl. part carton)"><input className="input" inputMode="numeric" value={cartons} onChange={(e) => setCartons(e.target.value)} /></Field><Field label="FG store bay"><input className="input" value={bay} onChange={(e) => setBay(e.target.value)} placeholder="FG-B3" /></Field></div>
      <Field label="Cone tip colour on the packed cones" hint={master ? `Color Code master for ${master.display}: ${master.colorName} (${master.tip})` : undefined}><select className="select" value={color} onChange={(e) => setColor(e.target.value)} data-testid="pack-color"><option value="">Select…</option>{(colors.data ?? []).map((c) => <option key={c.countId} value={c.colorName}>{c.colorName} — {c.tip}</option>)}</select></Field>
      {color && master ? <Notice tone={colorOk ? 'ok' : 'bad'}>{colorOk ? <>Colour verified: {color} matches the master for {master.display}.</> : <>Colour mismatch: the master for {master.display} is <b>{master.colorName}</b>. It will be recorded as a mismatch and raise an alert.</>}</Notice> : null}
      {spec ? <div className="muted small">Packing specification: {(spec.meta as unknown as AccessoriesMeta).cartonType} · {(spec.meta as unknown as AccessoriesMeta).polybag} · {(spec.meta as unknown as AccessoriesMeta).strapping} · label {(spec.meta as unknown as AccessoriesMeta).labelTemplate}</div> : null}</div>
  </Modal>;
}

function slip(p: Pack, millName: string): void {
  const w = window.open('', '_blank', 'width=720,height=860');
  if (!w) return;
  w.document.write(`<html><head><title>Packing slip ${p.slipNo}</title><style>body{font-family:Inter,Arial,sans-serif;padding:28px;color:#111}h1{font-size:20px;margin:0}table{border-collapse:collapse;width:100%;margin-top:14px}td,th{border:1px solid #bbb;padding:7px 10px;text-align:left;font-size:13px}th{background:#f1f1f1;width:38%}.sw{display:inline-block;width:14px;height:14px;border-radius:50%;background:${p.colorHex ?? '#ccc'};border:1px solid #888;vertical-align:-2px}</style></head><body>
    <h1>Packing slip ${p.slipNo}</h1><div>${millName} · packed ${fmtDT(p.packedAt)} IST by ${p.packer}</div>
    <table><tr><th>Lot / count</th><td>${p.lotNo} · ${p.countDisplay}</td></tr><tr><th>Package</th><td>${p.packageType.toLowerCase()} · ${p.cones} cones in ${p.cartons} cartons${p.partialCones ? ` (last carton ${p.partialCones} cones)` : ''}</td></tr>
    <tr><th>Cartons</th><td>${p.cartonFrom} to ${p.cartonTo}</td></tr><tr><th>Net / tare / gross</th><td>${num(p.netKg, 1)} / ${num(p.tareKg, 1)} / ${num(p.grossKg, 1)} kg</td></tr><tr><th>Average cone weight</th><td>${p.avgConeKg} kg</td></tr>
    <tr><th>Cone colour</th><td><span class="sw"></span> ${p.colorActual} (master ${p.colorMaster}) — ${p.colorOk ? 'VERIFIED' : 'MISMATCH'}</td></tr><tr><th>Label template</th><td>${p.labelTemplate}</td></tr><tr><th>FG store</th><td>${p.fgLocation}</td></tr></table>
    <p style="font-size:11px;color:#666">QR on every carton: /passport/${p.cartonFrom}… · ledger block #${p.chain.blockNumber} tx ${p.chain.txHash?.slice(0, 16)}…</p><script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export default function Accessories(): JSX.Element {
  const { count, mode } = useGlobalParams(); const user = useSession((s) => s.user); const [sp] = useSearchParams();
  const mill = useGet<{ millName: string }>('/api/meta'); const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) ?? 'accessories'); const [change, setChange] = useState(false); const [packForm, setPackForm] = useState(false); const [slipOf, setSlipOf] = useState<Pack | null>(null);
  const accs = useGet<Acc[]>('/api/accessories'); const changes = useGet<Change[]>('/api/accessory-changes'); const packs = useGet<Pack[]>('/api/packing' + qstr({ count, mode })); const colors = useGet<ColorRow[]>('/api/color-codes');
  const ov = useGet<{ counts: { id: string; display: string; versions: MasterVersionDTO[] }[] }>('/api/masters/overview');
  const canChange = !!user && ['ADMIN', 'PRODUCTION'].includes(user.role); const canPack = !!user && ['ADMIN', 'PRODUCTION', 'DISPATCH'].includes(user.role);
  const rows = (accs.data ?? []).filter((a) => count === 'ALL' || !a.countId || a.countId === count);
  const over = rows.filter((a) => a.color === 'red').length; const soon = rows.filter((a) => a.color === 'yellow').length;
  const prows = packs.data ?? [];
  const accCols: Col<Acc>[] = useMemo(() => [
    { key: 'machine', header: 'Machine', value: (r) => r.machineLabel, render: (r) => <Link className="bold" to={`/production?machine=${r.machineId}`}>{r.machineLabel}</Link> },
    { key: 'stage', header: 'Department', value: (r) => STAGE_INFO[r.stage].label, render: (r) => <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><StageIcon stage={r.stage} size={14} />{STAGE_INFO[r.stage].label}</span> },
    { key: 'kind', header: 'Accessory', value: (r) => r.kindLabel }, { key: 'spec', header: 'Type / spec', value: (r) => r.spec },
    { key: 'last', header: 'Last changed', value: (r) => r.changedAt, render: (r) => <span className="nowrap">{fmtD(r.changedAt)}</span> },
    { key: 'age', header: 'Age (days)', num: true, value: (r) => r.ageDays ?? r.value, render: (r) => <span className={`judged ${r.color}`} title={`${r.kindLabel}: ${r.kind === 'SPACER' ? r.value : r.ageDays}${r.kind === 'SPACER' ? ' mm' : ' days'} — master limit ${r.upper ?? 'n/a'}`}><ColorIcon color={r.color} size={12} />{r.kind === 'SPACER' ? `${r.value} mm` : r.ageDays}</span>, color: (r) => (r.color === 'none' ? undefined : r.color) },
    { key: 'limit', header: 'Master life', num: true, value: (r) => r.upper, render: (r) => (r.kind === 'SPACER' ? <span className="muted">±0.1 mm of {r.std}</span> : <span className="muted">≤ {r.upper ?? '—'} (target {r.std ?? '—'})</span>) },
    { key: 'status', header: 'Status', sort: (r) => ({ red: 0, yellow: 1, green: 2, none: 3 }[r.color]), value: (r) => r.text, render: (r) => <span>{<ColorPill color={r.color} label={r.color === 'red' && r.overdueDays ? `Overdue ${r.overdueDays} d` : r.color === 'yellow' ? 'Due soon' : r.color === 'green' ? 'Within life' : 'No master'} />}</span>, color: (r) => (r.color === 'none' ? undefined : r.color) },
  ], []);
  const packCols: Col<Pack>[] = [
    { key: 'at', header: 'Packed', value: (r) => r.packedAt, render: (r) => <span className="nowrap">{fmtDTShort(r.packedAt)}<span className="sub">{r.packer}</span></span> },
    { key: 'lot', header: 'Lot', value: (r) => r.lotNo, render: (r) => <Link className="bold" to={`/lots/${r.lotId}`} onClick={(e) => e.stopPropagation()}>{r.lotNo}<span className="sub">{r.countDisplay}</span></Link> },
    { key: 'cones', header: 'Cones', num: true, value: (r) => r.cones }, { key: 'cartons', header: 'Cartons', num: true, value: (r) => r.cartons, render: (r) => <span>{r.cartons}{r.partialCones ? <span className="sub">last: {r.partialCones} cones</span> : null}</span> },
    { key: 'net', header: 'Net kg', num: true, value: (r) => r.netKg, render: (r) => num(r.netKg, 1) }, { key: 'gross', header: 'Gross kg', num: true, value: (r) => r.grossKg, render: (r) => num(r.grossKg, 1) },
    ...(['NET_WT_CONE', 'CARTON_NET', 'CARTON_GROSS'] as const).map((k): Col<Pack> => ({ key: k, header: k === 'NET_WT_CONE' ? 'Cone kg' : k === 'CARTON_NET' ? 'Net / carton' : 'Gross / carton', num: true, value: (r) => r.checks.find((c) => c.key === k)?.value ?? null, render: (r) => <J j={r.checks.find((c) => c.key === k)} />, color: (r) => r.checks.find((c) => c.key === k)?.color })),
    { key: 'color', header: 'Cone colour', value: (r) => `${r.colorActual} (master ${r.colorMaster})`, render: (r) => <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Swatch hex={r.colorOk ? r.colorHex : undefined} name={r.colorActual} />{r.colorOk ? <ColorPill color="green" label="Verified" /> : <ColorPill color="red" label={`Master: ${r.colorMaster}`} />}</span>, color: (r) => (r.colorOk ? 'green' : 'red') },
    { key: 'slip', header: 'Slip', value: (r) => r.slipNo, render: (r) => <span className="mono small">{r.slipNo}</span> },
    { key: 'chain', header: 'Ledger', noExport: true, render: (r) => <ChainBadge chain={r.chain} /> },
  ];
  const specOf = (cid: string) => ov.data?.counts.find((c) => c.id === cid)?.versions.find((v) => v.masterType === 'ACCESSORIES' && v.status === 'ACTIVE');
  return <div className="page" data-testid="accessories-page">
    <PageHead eyebrow="OPERATIONS" title="Accessories & packing" sub="Travellers, cots, aprons and spacers explain a lot of hairiness and count variation — their age is checked against the Accessories master. Packing is verified against the cone colour code." right={<>{canChange ? <button className="btn" onClick={() => setChange(true)} data-testid="record-change"><Wrench size={15} /> Record accessory change</button> : null}{canPack ? <button className="btn primary" onClick={() => setPackForm(true)} data-testid="record-packing"><Plus size={15} /> Record packing</button> : null}</>} />
    <div className="grid g4">
      <Kpi label="Accessories overdue" value={over} tone={over ? 'red' : 'green'} icon={<AlertTriangle size={16} />} sub="past the master life" />
      <Kpi label="Due soon" value={soon} tone={soon ? 'yellow' : 'green'} sub="in the last 20% of life" />
      <Kpi label="Cartons packed (lots in view)" value={prows.reduce((s, p) => s + p.cartons, 0)} icon={<PackageCheck size={16} />} sub={`${num(prows.reduce((s, p) => s + p.netKg, 0), 0)} kg net`} />
      <Kpi label="Colour-code mismatches" value={prows.filter((p) => !p.colorOk).length} tone={prows.some((p) => !p.colorOk) ? 'red' : 'green'} sub="cone colour ≠ Color Code master" />
    </div>
    <div className="tabs"><button className={`tab ${tab === 'accessories' ? 'on' : ''}`} onClick={() => setTab('accessories')} data-testid="tab-accessories">Shop-floor accessories <span className={`count ${over ? 'bad' : ''}`}>{rows.length}</span></button><button className={`tab ${tab === 'packing' ? 'on' : ''}`} onClick={() => setTab('packing')} data-testid="tab-packing">Packing records <span className="count">{prows.length}</span></button><button className={`tab ${tab === 'colors' ? 'on' : ''}`} onClick={() => setTab('colors')} data-testid="tab-colors">Colour codes & packing spec</button></div>
    {tab === 'accessories' ? <><Card flush><DataTable rows={rows} columns={accCols} rowKey={(r) => `${r.machineId}|${r.kind}`} exportName="accessories" title="Accessory status by machine" legend filters={[{ key: 'stage', label: 'Department', value: (r) => STAGE_INFO[r.stage].label }, { key: 'status', label: 'Status', value: (r) => r.color === 'none' ? 'no master' : r.color, options: [{ value: 'red', label: 'Overdue' }, { value: 'yellow', label: 'Due soon' }, { value: 'green', label: 'Within life' }] }]} initialSort={{ key: 'status', dir: 'asc' }} rowTone={(r) => (r.color === 'red' ? 'red' : r.color === 'yellow' ? 'yellow' : undefined)} pageSize={25} /></Card>
      <Card flush><CardHead title="Recent accessory changes" sub="Every change is a ledger transaction" /><DataTable rows={changes.data ?? []} columns={[{ key: 'at', header: 'Changed', value: (r) => r.changedAt, render: (r) => <span className="nowrap">{fmtDTShort(r.changedAt)}</span> }, { key: 'm', header: 'Machine', value: (r) => r.machineLabel }, { key: 'k', header: 'Accessory', value: (r) => ACCESSORY_INFO[r.kind].label }, { key: 's', header: 'Spec', value: (r) => r.spec }, { key: 'by', header: 'By', value: (r) => r.changedBy }, { key: 'n', header: 'Note', value: (r) => r.note }, { key: 'c', header: 'Ledger', noExport: true, render: (r) => <ChainBadge chain={r.chain} /> }]} rowKey={(r) => r.id} exportName="accessory-changes" title="Accessory changes" pageSize={10} dense /></Card></> : null}
    {tab === 'packing' ? <Card flush><DataTable rows={prows} columns={packCols} rowKey={(r) => r.id} exportName="packing-records" title="Packing records" legend onRowClick={setSlipOf} pageSize={25} initialSort={{ key: 'at', dir: 'desc' }} rowTone={(r) => (!r.colorOk ? 'red' : r.worst === 'red' ? 'red' : r.worst === 'yellow' ? 'yellow' : undefined)} filters={[{ key: 'count', label: 'Count', value: (r) => r.countDisplay }, { key: 'color', label: 'Colour check', value: (r) => (r.colorOk ? 'verified' : 'mismatch') }]} /></Card> : null}
    {tab === 'colors' ? <div className="grid g2">{(colors.data ?? []).map((c) => { const v = specOf(c.countId); const m = v?.meta as unknown as AccessoriesMeta | undefined; return <Card key={c.countId}><CardBody className="stack"><div className="row between"><div className="row"><span className="swatch" style={{ background: c.hex, width: 28, height: 28 }} /><div><b style={{ fontSize: 16 }}>{c.display}</b><div className="muted small">{c.colorName} · {c.tip} · code {c.code}</div></div></div><Pill tone="chain">Master v{v?.versionNo ?? '—'}</Pill></div>
      {m ? <dl className="kv"><dt>Package</dt><dd>{m.packageType.toLowerCase()} — {m.coneType}</dd><dt>Carton</dt><dd>{m.cartonType}</dd><dt>Polybag / strapping</dt><dd>{m.polybag} · {m.strapping}</dd><dt>Label</dt><dd>{m.labelTemplate}{m.qrLabel ? ' + QR' : ''}</dd><dt>Pallet</dt><dd>{m.palletWrap}</dd><dt>Traveller</dt><dd>{m.travellerType}</dd><dt>Clearer</dt><dd>{m.clearerClass}</dd></dl> : null}
      <Link className="small" to="/masters">Edit in Masters →</Link></CardBody></Card>; })}</div> : null}
    <Legend chain />
    {slipOf ? <Drawer title={`Packing slip ${slipOf.slipNo}`} onClose={() => setSlipOf(null)}><div className="stack">
      <div className="grid g2"><Fact2 l="Lot / count" v={`${slipOf.lotNo} · ${slipOf.countDisplay}`} /><Fact2 l="Packed" v={`${fmtDT(slipOf.packedAt)} by ${slipOf.packer}`} /><Fact2 l="Package" v={`${slipOf.packageType.toLowerCase()} · ${slipOf.cones} cones in ${slipOf.cartons} cartons${slipOf.partialCones ? ` (last carton ${slipOf.partialCones} cones)` : ''}`} /><Fact2 l="Cartons" v={`${slipOf.cartonFrom} → ${slipOf.cartonTo}`} /><Fact2 l="Net / tare / gross" v={`${num(slipOf.netKg, 1)} / ${num(slipOf.tareKg, 1)} / ${num(slipOf.grossKg, 1)} kg`} /><Fact2 l="FG store" v={slipOf.fgLocation} /></div>
      <div className="row"><Swatch hex={slipOf.colorHex} name={`${slipOf.colorActual}`} />{slipOf.colorOk ? <ColorPill color="green" label="Colour verified against master" /> : <ColorPill color="red" label={`Mismatch — master is ${slipOf.colorMaster}`} />}</div>
      <div className="tbl-wrap"><table className="tbl dense"><thead><tr><th>Check</th><th className="num">Actual</th><th className="num">Master</th><th className="num">Range</th></tr></thead><tbody>{slipOf.checks.map((j) => <tr key={j.key}><td>{j.label} <span className="muted tiny">{j.unit}</span></td><td className="num"><J j={j} /></td><td className="num">{j.std}</td><td className="num muted">{j.lower ?? '–'} … {j.upper ?? '–'}</td></tr>)}</tbody></table></div>
      <div className="row"><ChainBadge chain={slipOf.chain} /><button className="btn" onClick={() => slip(slipOf, mill.data?.millName ?? '')}><Printer size={14} /> Print packing slip</button><Link className="btn" to={`/lots/${slipOf.lotId}`}>Lot passport</Link></div></div></Drawer> : null}
    {change ? <ChangeForm onClose={() => setChange(false)} accs={accs.data ?? []} /> : null}
    {packForm ? <PackForm onClose={() => setPackForm(false)} /> : null}
  </div>;
}
const Fact2 = ({ l, v }: { l: string; v: string }) => <div className="fact"><span>{l}</span><b>{v}</b></div>;
void Seg;
