import { Link } from 'react-router-dom';
import { ExternalLink, GitBranchPlus } from 'lucide-react';
import { useGet } from '../../lib/api';
import { fmtD } from '../../lib/fmt';
import { Card, CardBody, CardHead, ChainBadge, Loading, Notice, Swatch } from '../ui';
import { DataTable, type Col } from '../DataTable';
import { MasterStatusPill, useCan } from './common';
import { useCreateVersion } from './MasterCards';
import type { ColorCode, MasterCountOverview } from './types';
import './masters.css';

function ColorCard({ code, count }: { code: ColorCode; count: MasterCountOverview | undefined }): JSX.Element {
  const active = count?.versions.find((v) => v.masterType === 'COLOR' && v.status === 'ACTIVE');
  const pending = count?.versions.find((v) => v.masterType === 'COLOR' && (v.status === 'DRAFT' || v.status === 'QA_APPROVED'));
  const { create, busy, error } = useCreateVersion();
  const perm = useCan('Master.createVersion');
  return <Card><CardBody className="stack" >
    <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
      <span className="mt-cone" style={{ color: code.hex, width: 72, height: 72, boxShadow: 'inset 0 0 0 9px hsl(var(--card)), inset 0 0 0 18px currentColor' }} aria-label={`${code.colorName} tip cone`} />
      <div className="grow"><div className="row between"><b style={{ fontSize: 16 }}>{code.display}</b>{active ? <MasterStatusPill status="ACTIVE" /> : null}</div>
        <div className="bold">{code.colorName} <span className="mono muted small">{code.code}</span></div>
        <div className="muted small">{code.tip}</div></div>
    </div>
    <div className="row between small"><span className="muted">{active ? <>v{active.versionNo} · effective {fmtD(active.effectiveFrom)}</> : 'no active version'}</span>{active ? <ChainBadge chain={active.chain} /> : null}</div>
    {error ? <Notice tone="bad">{error}</Notice> : null}
    <div className="mt-actions">
      {active ? <Link className="btn sm primary" to={`/masters/${active.id}`}><ExternalLink size={13} /> Open</Link> : null}
      {pending ? <Link className="btn sm" to={`/masters/${pending.id}`}><ExternalLink size={13} /> Open pending v{pending.versionNo}</Link>
        : <button className="btn sm" disabled={busy || !perm.can || !active} title={perm.why ?? 'Create a draft to change the cone colour of this count'} onClick={() => active && void create({ countId: code.countId, masterType: 'COLOR', cloneFrom: active.id })}><GitBranchPlus size={13} /> Change colour (new version)</button>}
    </div>
  </CardBody></Card>;
}

/** Color Code Master: the cone tip colour that identifies each count, checked at packing against the cones actually packed. */
export function ColorCodes({ counts }: { counts: MasterCountOverview[] }): JSX.Element {
  const q = useGet<ColorCode[]>('/api/color-codes');
  const columns: Col<ColorCode>[] = [
    { key: 'count', header: 'Count', value: (c) => c.display, exportHeader: 'Count' },
    { key: 'colour', header: 'Colour', value: (c) => c.colorName, render: (c) => <Swatch hex={c.hex} name={c.colorName} />, exportHeader: 'Colour' },
    { key: 'hex', header: 'Hex', value: (c) => c.hex, render: (c) => <span className="mono small">{c.hex}</span>, exportHeader: 'Hex' },
    { key: 'tip', header: 'Tip description', value: (c) => c.tip, exportHeader: 'Tip' },
    { key: 'code', header: 'Code', value: (c) => c.code, render: (c) => <span className="mono">{c.code}</span>, exportHeader: 'Code' },
    { key: 'ver', header: 'Version', value: (c) => counts.find((x) => x.id === c.countId)?.versions.find((v) => v.masterType === 'COLOR' && v.status === 'ACTIVE')?.versionNo ?? '', render: (c) => { const v = counts.find((x) => x.id === c.countId)?.versions.find((x) => x.masterType === 'COLOR' && x.status === 'ACTIVE'); return v ? <span>v{v.versionNo}<span className="sub">from {fmtD(v.effectiveFrom)}</span></span> : '—'; }, exportHeader: 'Version' },
  ];
  return <div className="stack loose" data-testid="color-code-master">
    <Notice tone="info">The Color Code Master gives every count its own cone tip colour. At packing the colour of the cones actually packed is checked against it — a mismatch turns the packing record red and is flagged on the lot passport (this is what a "wrong colour cones" complaint is judged against).</Notice>
    <Loading q={q}>{q.data ? <>
      <div className="mt-cards">{q.data.map((c) => <ColorCard key={c.countId} code={c} count={counts.find((x) => x.id === c.countId)} />)}</div>
      <Card flush><CardHead title="Color Code Master — all counts" sub="Latest active version of each count" /><div style={{ height: 8 }} />
        <DataTable rows={q.data} columns={columns} rowKey={(c) => c.countId} exportName="color-code-master" title="Color Code Master" legend={false} pageSize={10} /></Card>
    </> : null}</Loading>
  </div>;
}
