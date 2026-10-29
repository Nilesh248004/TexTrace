import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck, ExternalLink } from 'lucide-react';
import { MASTER_LABEL, MASTER_TYPES } from '@shared/params';
import type { MasterVersionDTO } from '@shared/domain';
import { fmtD, fmtDT } from '../../lib/fmt';
import { Card, CardBody, CardHead, ChainBadge, Notice } from '../ui';
import { DataTable, type Col } from '../DataTable';
import { MASTER_SHORT, MasterStatusPill, STATUS_META } from './common';
import type { MasterCountOverview } from './types';

type V = MasterVersionDTO;

// ------------------------------------------------------------------ "Pending approval" strip (all counts)
export function PendingStrip({ counts }: { counts: MasterCountOverview[] }): JSX.Element {
  const pending = counts.flatMap((c) => c.versions.filter((v) => v.status === 'DRAFT' || v.status === 'QA_APPROVED').map((v) => ({ v, c })));
  if (!pending.length) return <Notice tone="ok">Nothing is waiting for approval — every master is active.</Notice>;
  return <Card tone="warn"><CardHead title={<span className="row"><ClipboardCheck size={16} /> Pending approval <span className="pill yellow">{pending.length}</span></span>} sub="Drafts and QA-approved versions that are not in force yet. Results keep being judged on the active version until a pending one is activated." />
    <CardBody><div className="stack tight" data-testid="pending-approval">{pending.map(({ v, c }) => <div key={v.id} className="alert-row" style={{ padding: '8px 4px', alignItems: 'center' }}>
      <MasterStatusPill status={v.status} />
      <div className="grow"><b>{c.display} · {MASTER_LABEL[v.masterType]} v{v.versionNo}</b><div className="muted small">{v.status === 'DRAFT' ? `Draft by ${v.createdByName}, ${fmtDT(v.createdAt)} — needs QA approval` : `Approved by ${v.approvedByName ?? '—'}, ${fmtDT(v.approvedAt)} — waiting to be activated`} · {v.note}</div></div>
      <Link className="btn sm" to={`/masters/${v.id}`}><ExternalLink size={13} /> Open</Link>
    </div>)}</div></CardBody></Card>;
}

// ------------------------------------------------------------------ version history of one count (all five masters)
export function VersionHistory({ count }: { count: MasterCountOverview }): JSX.Element {
  const nav = useNavigate();
  const rows = [...count.versions].sort((a, b) => MASTER_TYPES.indexOf(a.masterType) - MASTER_TYPES.indexOf(b.masterType) || b.versionNo - a.versionNo);
  const columns: Col<V>[] = [
    { key: 'type', header: 'Master', value: (v) => MASTER_SHORT[v.masterType], exportHeader: 'Master' },
    { key: 'ver', header: 'Version', value: (v) => v.versionNo, render: (v) => <span><b>v{v.versionNo}</b><span className="sub mono nowrap">{v.id}</span></span>, exportHeader: 'Version' },
    { key: 'status', header: 'Status', value: (v) => STATUS_META[v.status].label, render: (v) => <MasterStatusPill status={v.status} />, exportHeader: 'Status' },
    { key: 'from', header: 'Effective from', value: (v) => v.effectiveFrom ?? '', render: (v) => fmtD(v.effectiveFrom), exportHeader: 'Effective from' },
    { key: 'to', header: 'Effective to', value: (v) => v.effectiveTo ?? '', render: (v) => (v.effectiveTo ? fmtD(v.effectiveTo) : v.status === 'ACTIVE' ? <span className="muted">in force</span> : '—'), exportHeader: 'Effective to' },
    { key: 'created', header: 'Created', value: (v) => `${v.createdByName} ${v.createdAt}`, render: (v) => <span>{v.createdByName}<span className="sub">{fmtDT(v.createdAt)}</span></span>, exportHeader: 'Created by / at' },
    { key: 'approved', header: 'Approved', value: (v) => (v.approvedByName ? `${v.approvedByName} ${v.approvedAt}` : ''), render: (v) => (v.approvedByName ? <span>{v.approvedByName}<span className="sub">{fmtDT(v.approvedAt)}</span></span> : <span className="muted">—</span>), exportHeader: 'Approved by / at' },
    { key: 'items', header: 'Items', value: (v) => v.itemCount, num: true, exportHeader: 'Items' },
    { key: 'note', header: 'Note', value: (v) => v.note, render: (v) => <span style={{ whiteSpace: 'normal', display: 'inline-block', maxWidth: 360 }}>{v.note}</span>, exportHeader: 'Note' },
    { key: 'chain', header: 'Ledger', value: (v) => (v.chain.txHash ? `block ${v.chain.blockNumber}` : 'off-chain'), render: (v) => <ChainBadge chain={v.chain} />, exportHeader: 'Ledger block' },
  ];
  return <div data-testid="master-history"><Card flush><CardHead title={`Version history — ${count.display}`} sub="Every master version of this count, newest first. Results are judged on the version that was active on their production date." />
    <div style={{ height: 8 }} />
    <DataTable rows={rows} columns={columns} rowKey={(v) => v.id} exportName={`master-versions-${count.id}`} title={`Master version history — ${count.display}`} onRowClick={(v) => nav(`/masters/${v.id}`)} legend pageSize={25}
      filters={[{ key: 'type', label: 'Master', value: (v) => MASTER_SHORT[v.masterType] }, { key: 'status', label: 'Status', value: (v) => STATUS_META[v.status].label }]} />
  </Card></div>;
}
