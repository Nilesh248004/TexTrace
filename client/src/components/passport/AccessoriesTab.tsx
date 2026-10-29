import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, ClipboardList, Package, Printer, Wrench, XCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Judged, LotPassport, PassportAccessoryRow, PassportPacking } from '@shared/domain';
import { STAGES, STAGE_INFO, type Stage } from '@shared/params';
import { Card, CardBody, CardHead, ChainBadge, ColorPill, J, Legend, Modal, StageIcon } from '../ui';
import { DataTable, type Col } from '../DataTable';
import { fmtD, fmtDT, fmtDTShort } from '../../lib/fmt';
import { MasterTable } from './MasterTable';
import { CountPills, KV, byParamOrder, cellVal, fmtKg, fmtN, rangeText, tally, worstColor } from './util';

/** Plain-language reading of an accessory age / size, e.g. "30 days vs master limit 14 — overdue by 16 days". */
export function accessoryPlain(j: Judged): string {
  const v = j.value;
  if (v === null) return '—';
  if (j.unit === 'days') {
    const lim = j.upper;
    if (j.color === 'red' && lim !== null && v > lim) return `${fmtN(v, 0)} days vs master limit ${fmtN(lim, 0)} — overdue by ${fmtN(v - lim, 0)} days`;
    if (j.color === 'yellow' && lim !== null) return `${fmtN(v, 0)} days vs master limit ${fmtN(lim, 0)} — due for change soon`;
    return lim !== null ? `${fmtN(v, 0)} days — within the master limit of ${fmtN(lim, 0)} days` : `${fmtN(v, 0)} days — no master limit set`;
  }
  return `${fmtN(v, j.decimals)} ${j.unit} vs master ${rangeText(j)} ${j.unit} — ${j.text.toLowerCase()}`.replace(/\s+/g, ' ');
}

function StageAccessories({ stage, rows, lotNo }: { stage: Stage; rows: PassportAccessoryRow[]; lotNo: string }): JSX.Element {
  const keys = useMemo(() => { const m = new Map<string, Judged>(); for (const r of rows) for (const j of r.items) if (!m.has(j.key)) m.set(j.key, j); return [...m.values()].sort((a, b) => byParamOrder(a.key, b.key)); }, [rows]);
  const cols = useMemo((): Col<PassportAccessoryRow>[] => [
    { key: 'machine', header: 'Machine', sortable: false, value: (r) => r.machineLabel, render: (r) => <b>{r.machineLabel}</b> },
    { key: 'at', header: 'Run started', sortable: false, value: (r) => fmtDT(r.at), render: (r) => <span className="nowrap">{fmtDTShort(r.at)}</span> },
    ...keys.map((k): Col<PassportAccessoryRow> => ({
      key: `a-${k.key}`, header: <>{k.label}<small>{k.unit}</small></>, exportHeader: `${k.label} [${k.unit}]`, sortable: false, num: true,
      value: (r) => cellVal(r.items.find((x) => x.key === k.key)),
      render: (r) => { const j = r.items.find((x) => x.key === k.key); return j ? <><J j={j} plain /><span className="pp-sub" style={{ textAlign: 'right' }}>{j.spec}</span></> : <span className="muted">—</span>; },
      color: (r) => r.items.find((x) => x.key === k.key)?.color,
    })),
    { key: 'res', header: 'Result', sortable: false, value: (r) => r.worst, render: (r) => <ColorPill color={r.worst} />, color: (r) => r.worst },
  ], [keys]);
  const issues = rows.flatMap((r) => r.items.filter((j) => j.color === 'red' || j.color === 'yellow').map((j) => ({ r, j })));
  const c = tally(rows.flatMap((r) => r.items));
  return <div id={`pp-a-${stage}`} className="pp-anchor" data-testid={`accessories-${stage}`}><Card flush>
    <CardHead title={<span className="pp-sec"><StageIcon stage={stage} size={17} /> {STAGE_INFO[stage].label}</span>} sub="Age of each accessory on the day this lot ran, judged against the life limits of the Accessories master" right={<><ColorPill color={worstColor(rows.map((r) => r.worst))} /><CountPills red={c.red} yellow={c.yellow} /></>} />
    <CardBody>
      <div style={{ marginTop: 10 }}>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.runId} search={false} dense pageSize={50} exportName={`lot-${lotNo}-accessories-${stage}`} title={`Lot ${lotNo} — ${STAGE_INFO[stage].label} — accessories`} rowTone={(r) => (r.worst === 'red' || r.worst === 'yellow' ? r.worst : undefined)} />
      </div>
      {issues.length ? <div style={{ borderTop: '1px solid hsl(var(--border))' }} data-testid="accessory-issues">
        {issues.map(({ r, j }) => <div key={`${r.runId}-${j.key}`} className={`pp-find ${j.color}`}>
          <span className={`ico ${j.color}`}>{j.color === 'red' ? <XCircle size={15} /> : <AlertTriangle size={15} />}</span>
          <div className="grow"><b>{r.machineLabel} — {j.label}</b>{j.spec ? <span className="muted small"> ({j.spec})</span> : null}<div className="small">{accessoryPlain(j)}</div>{j.plain ? <div className="muted tiny">{j.plain}</div> : null}</div>
          <div className="val"><J j={j} unit /></div>
        </div>)}
      </div> : null}
    </CardBody>
  </Card></div>;
}

// ------------------------------------------------------------------ packing slip (printable)
export function PackingSlip({ p, millName }: { p: LotPassport; millName: string }): JSX.Element {
  const k = p.packing as PassportPacking;
  const per = k.cartons ? k.conesPacked / k.cartons : 0;
  const d = p.dispatch;
  return <div className="pp-slip" data-testid="packing-slip">
    <div className="hd">
      <div><h3>PACKING SLIP</h3><div>{millName}</div><div style={{ color: '#555', fontSize: 12 }}>Finished yarn — {p.lot.countDisplay}</div></div>
      <div style={{ textAlign: 'right' }}><div style={{ fontSize: 18, fontWeight: 700 }}>{k.slipNo}</div><div>Packed {fmtDT(k.packedAt)}</div><div>by {k.packerName}</div></div>
    </div>
    <table>
      <tbody>
        <tr><th>Lot</th><td>Lot {p.lot.lotNo} ({p.lot.lotCode})</td><th>Count</th><td>{p.lot.countDisplay}</td></tr>
        <tr><th>Mix</th><td>{p.mix.mixNo} — {p.mix.recipe.map((r) => `${r.pct}% ${r.label}`).join(', ')}</td><th>Customer</th><td>{d?.customerName ?? p.lot.customerName ?? 'Not assigned yet'}</td></tr>
        <tr><th>Package</th><td>{k.packageType === 'CHEESE' ? 'Cheese' : 'Cone'}{k.coneType ? ` — ${k.coneType}` : ''}</td><th>Label</th><td>{k.labelTemplate}</td></tr>
        <tr><th>Cone colour</th><td>{k.colorActual} (master {k.colorMaster}) — {k.colorOk ? 'verified' : 'MISMATCH'}</td><th>FG location</th><td>{k.fgLocation} · {k.pallets} pallet{k.pallets === 1 ? '' : 's'}</td></tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>Cartons</th><th>Range</th><th>Cones / carton</th><th>Net / carton</th><th>Tare / carton</th><th>Gross / carton</th></tr></thead>
      <tbody><tr><td>{k.cartons}</td><td>{k.cartonFrom} … {k.cartonTo}</td><td>{fmtN(per, 0)}</td><td>{fmtN(k.cartons ? k.netKg / k.cartons : 0, 2)} kg</td><td>{fmtN(k.cartons ? k.tareKg / k.cartons : 0, 2)} kg</td><td>{fmtN(k.cartons ? k.grossKg / k.cartons : 0, 2)} kg</td></tr></tbody>
      <tfoot><tr><th colSpan={2}>Totals</th><th>{k.conesPacked} cones</th><th>{fmtKg(k.netKg)}</th><th>{fmtKg(k.tareKg, 2)}</th><th>{fmtKg(k.grossKg)}</th></tr></tfoot>
    </table>
    <div style={{ display: 'flex', gap: 22, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div style={{ fontSize: 12.5 }}>Average cone weight <b>{fmtN(k.avgConeKg, 3)} kg</b><br />Carton type: {k.cartonType ?? '—'}<br />Polybag: {k.polybag ?? '—'}<br />Strapping: {k.strapping ?? '—'}</div>
      <div className="pp-qr"><div className="box"><QRCodeSVG value={`${window.location.origin}/passport/${k.cartonFrom}`} size={96} /></div><span>{k.cartonFrom}</span></div>
    </div>
    <div className="sig"><div>Packed by — {k.packerName}</div><div>Checked by (QA)</div><div>Received by (store)</div></div>
  </div>;
}

function PackingRecord({ p, millName }: { p: LotPassport; millName: string }): JSX.Element {
  const k = p.packing as PassportPacking;
  const [slip, setSlip] = useState(false);
  const c = tally(k.checks); const colorBad = !k.colorOk;
  const worst = worstColor([...k.checks.map((j) => j.color), colorBad ? 'red' : 'green']);
  const printSlip = () => {
    document.body.classList.add('pp-printing-slip');
    const done = () => { document.body.classList.remove('pp-printing-slip'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };
  return <div id="pp-packing" className="pp-anchor" data-testid="packing-record"><Card>
    <CardHead
      title={<span className="pp-sec"><Package size={17} /> Packing record</span>}
      sub={<>Slip {k.slipNo} · packed {fmtDT(k.packedAt)} by {k.packerName}</>}
      right={<><ColorPill color={worst} /><CountPills red={c.red + (colorBad ? 1 : 0)} yellow={c.yellow} /><ChainBadge chain={k.chain} /><button type="button" className="btn sm no-print" onClick={() => setSlip(true)} data-testid="packing-slip-open" title="Open a printable packing slip"><ClipboardList size={13} /> Packing slip</button></>}
    />
    <CardBody>
      <div className="stack" style={{ gap: 16 }}>
        <div className="pp-facts" style={{ borderTop: 0, paddingTop: 0 }}>
          <KV label="Package type">{k.packageType === 'CHEESE' ? 'Cheese' : 'Cone'}</KV>
          <KV label="Cone type">{k.coneType ?? '—'}</KV>
          <KV label="Cones packed" sub={`${fmtN(k.cartons ? k.conesPacked / k.cartons : 0, 0)} per carton`}>{k.conesPacked.toLocaleString('en-IN')}</KV>
          <KV label="Cartons" sub={`${k.cartonFrom} … ${k.cartonTo}`}>{k.cartons}</KV>
          <KV label="Net weight">{fmtKg(k.netKg)}</KV>
          <KV label="Tare">{fmtKg(k.tareKg, 2)}</KV>
          <KV label="Gross weight">{fmtKg(k.grossKg)}</KV>
          <KV label="Average cone weight">{fmtN(k.avgConeKg, 3)} kg</KV>
          <KV label="Packing slip no.">{k.slipNo}</KV>
          <KV label="Label template">{k.labelTemplate}</KV>
          <KV label="Pallets">{k.pallets}</KV>
          <KV label="FG location">{k.fgLocation}</KV>
          <KV label="Carton / polybag">{k.cartonType ?? '—'}<br /><span className="muted small" style={{ fontWeight: 500 }}>{k.polybag ?? ''} · {k.strapping ?? ''}</span></KV>
          <KV label="Packed by" sub={fmtD(k.packedAt)}>{k.packerName}</KV>
        </div>

        <div className={`pp-cone ${colorBad ? 'bad' : ''}`} data-testid="cone-colour">
          <span className="big" style={{ background: k.colorHex ?? 'hsl(var(--muted))' }} title={k.colorHex ? `Master colour ${k.colorHex}` : undefined} />
          <div className="grow">
            <div className="bold">Cone colour — actual vs master</div>
            <div>Actual: <b>{k.colorActual}</b> &nbsp;·&nbsp; Master colour code for {p.lot.countDisplay}: <b>{k.colorMaster}</b>{k.tip ? <span className="muted"> ({k.tip})</span> : null}</div>
          </div>
          {k.colorOk ? <span className="pill green" title="The cone colour packed matches the Color Code master — checked by the Packing contract"><CheckCircle2 size={12} /> Verified — matches the master</span> : <span className="pill red"><XCircle size={12} /> Mismatch — packed with {k.colorActual}, master requires {k.colorMaster}</span>}
        </div>

        <div>
          <div className="bold small" style={{ letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 4 }}>Per-carton checks vs the Accessories master</div>
          <MasterTable items={k.checks} testId="packing-checks" />
        </div>
      </div>
    </CardBody>
    {slip ? <Modal title={`Packing slip ${k.slipNo}`} wide onClose={() => setSlip(false)} footer={<><button type="button" className="btn" onClick={() => setSlip(false)}>Close</button><button type="button" className="btn primary" onClick={printSlip} data-testid="packing-slip-print"><Printer size={14} /> Print slip</button></>}>
      <PackingSlip p={p} millName={millName} />
    </Modal> : null}
    {slip ? createPortal(<div className="pp-slip-print"><PackingSlip p={p} millName={millName} /></div>, document.body) : null}
  </Card></div>;
}

export function AccessoriesTab({ p, millName }: { p: LotPassport; millName: string }): JSX.Element {
  const groups = useMemo(() => {
    const m = new Map<Stage, PassportAccessoryRow[]>();
    for (const r of p.accessories) { if (!m.has(r.stage)) m.set(r.stage, []); m.get(r.stage)!.push(r); }
    return STAGES.filter((s) => m.has(s)).map((s) => ({ stage: s, rows: m.get(s) as PassportAccessoryRow[] }));
  }, [p.accessories]);
  if (!groups.length && !p.packing) return <Card><CardBody><div className="muted">No accessory records or packing yet — traveller / cot / apron ages are captured when each machine run starts.</div></CardBody></Card>;
  return <div className="stack" data-testid="accessories-panel">
    <div className="pp-tools no-print">
      <Wrench size={15} className="muted" />
      <span className="small muted">Accessories are judged by <b>age in days</b> on the day the lot ran, against the life limits in the Accessories master. Worn travellers, cots and aprons raise hairiness and count variation.</span>
      <span className="pp-jump sp">{groups.map((g) => <a key={g.stage} href={`#pp-a-${g.stage}`} className={g.rows.some((r) => r.worst === 'red') ? 'red' : g.rows.some((r) => r.worst === 'yellow') ? 'yellow' : ''}><StageIcon stage={g.stage} size={12} /> {g.stage}</a>)}{p.packing ? <a href="#pp-packing">Packing</a> : null}</span>
    </div>
    {groups.map((g) => <StageAccessories key={g.stage} stage={g.stage} rows={g.rows} lotNo={p.lot.lotNo} />)}
    {p.packing ? <PackingRecord p={p} millName={millName} /> : <Card><CardBody><div className="muted">Packing has not been recorded yet — the packing record (cartons, weights, cone colour check, slip) appears here after winding.</div></CardBody></Card>}
    <Legend chain />
  </div>;
}
