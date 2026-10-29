import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CopyCheck, FileUp, GitBranchPlus } from 'lucide-react';
import { MASTER_LABEL, MASTER_PLAIN } from '@shared/params';
import type { AccessoriesMeta, ColorMeta, CountMixMeta } from '@shared/domain';
import { useGet } from '../lib/api';
import { fmtD, fmtDT } from '../lib/fmt';
import { Card, CardBody, ChainBadge, Fact, Loading, Notice, PageHead } from '../components/ui';
import { CompletenessBar, MASTER_ICON, MasterStatusPill, useCan, useMillMeta } from '../components/masters/common';
import { MasterGrid } from '../components/masters/MasterGrid';
import { useGridEdits } from '../components/masters/gridState';
import { AccessoriesEditor, ColorEditor, CountMixEditor, accessoriesProblems, colorProblems, countMixProblems } from '../components/masters/MetaEditors';
import { WorkflowPanel } from '../components/masters/WorkflowPanel';
import { CopyFromCountModal, ExportButton, ImportModal } from '../components/masters/EditorTools';
import { useCreateVersion } from '../components/masters/MasterCards';
import type { MasterRow, MasterVersionDetail, MastersOverview } from '../components/masters/types';

/** Completeness of THIS version (the API reports the one active now): required rows filled + recipe / packing / colour fields. */
function versionCompleteness(d: MasterVersionDetail): { pct: number; present: number; required: number } {
  const req = d.items.filter((i) => i.required); let present = req.filter((i) => !i.missing).length; let required = req.length;
  const m = d.version.meta;
  if (d.version.masterType === 'COUNT_MIX') { const ok = countMixProblems(m as unknown as CountMixMeta); required += 4; present += 4 - Math.min(4, ok.length); }
  if (d.version.masterType === 'ACCESSORIES') { const bad = accessoriesProblems(m as unknown as AccessoriesMeta).length; required += 10; present += Math.max(0, 10 - bad); }
  if (d.version.masterType === 'COLOR') { const mm = m as unknown as ColorMeta; const bad = colorProblems(mm).length; required += 4; present += bad ? 4 - Math.min(4, [!mm.colorName, !mm.hex, !mm.tip, !mm.code].filter(Boolean).length) : 4; }
  return { present, required, pct: required ? Math.round((present / required) * 1000) / 10 : 100 };
}

export default function MasterEditor(): JSX.Element {
  const { versionId = '' } = useParams();
  const q = useGet<MasterVersionDetail>(`/api/masters/versions/${versionId}`);
  const overview = useGet<MastersOverview>('/api/masters/overview');
  const meta = useMillMeta();
  const rows: MasterRow[] = q.data?.items ?? [];
  const grid = useGridEdits(rows);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'info'; msg: string } | null>(null);
  const [activated, setActivated] = useState<string | null>(null);
  const [tool, setTool] = useState<'copy' | 'import' | null>(null);
  const { create, busy: cloning, error: cloneError } = useCreateVersion();
  const perm = useCan('Master.createVersion');

  return <div className="page" data-testid="master-editor">
    <Loading q={q}>{q.data ? (() => {
      const d = q.data; const v = d.version; const type = v.masterType;
      const countOv = overview.data?.counts.find((c) => c.id === v.countId);
      const hasGrid = type !== 'COLOR'; const comp = versionCompleteness(d);
      const pendingElsewhere = countOv?.versions.find((x) => x.masterType === type && (x.status === 'DRAFT' || x.status === 'QA_APPROVED') && x.id !== v.id);
      const cloneable = !d.editable && v.status !== 'QA_APPROVED';
      return <>
        <PageHead eyebrow={`MASTERS · ${countOv?.display ?? v.countId}`} title={<span className="row" style={{ gap: 10 }}>{MASTER_LABEL[type]} <span className="muted">v{v.versionNo}</span> <MasterStatusPill status={v.status} /></span>} sub={MASTER_PLAIN[type]}
          right={<><Link className="btn" to="/masters"><ArrowLeft size={14} /> All masters</Link></>} />

        <Card><CardBody className="stack">
          <div className="grid g5" style={{ alignItems: 'start' }}>
            <Fact label="Count"><span className="row" style={{ gap: 6 }}>{MASTER_ICON[type]}{countOv?.display ?? v.countId}</span></Fact>
            <Fact label="Effective" sub={v.effectiveTo ? `to ${fmtD(v.effectiveTo)}` : v.status === 'ACTIVE' ? 'in force' : 'not active yet'}>{v.effectiveFrom ? `from ${fmtD(v.effectiveFrom)}` : '—'}</Fact>
            <Fact label="Created" sub={fmtDT(v.createdAt)}>{v.createdByName}</Fact>
            <Fact label="QA approval" sub={v.approvedAt ? fmtDT(v.approvedAt) : 'not approved yet'}>{v.approvedByName ?? '—'}</Fact>
            <Fact label="Ledger record"><ChainBadge chain={v.chain} /></Fact>
          </div>
          <div className="grid g2" style={{ alignItems: 'center' }}>
            <CompletenessBar pct={comp.pct} label={`this version: ${comp.present} of ${comp.required} required items filled`} height={9} />
            <div className="muted small">{v.note}</div>
          </div>
          {d.completeness.byType[type].missing.length && v.status === 'ACTIVE' ? <div className="muted tiny">Active version for {countOv?.display}: {d.completeness.byType[type].pct}% complete.</div> : null}
        </CardBody></Card>

        {activated ? <Notice tone="ok"><div data-testid="activation-notice"><b>Activated.</b> {activated}</div></Notice> : null}
        <WorkflowPanel version={v} dirtyCount={grid.dirtyKeys.length} businessDate={meta.data?.businessDate ?? ''} onActivated={setActivated} />

        {type === 'COUNT_MIX' ? <CountMixEditor version={v} usesComber={!!countOv?.usesComber} editable={d.editable} /> : null}
        {type === 'ACCESSORIES' ? <AccessoriesEditor version={v} editable={d.editable} /> : null}
        {type === 'COLOR' ? <ColorEditor version={v} editable={d.editable} /> : null}

        {hasGrid ? <Card flush>
          {flash ? <div style={{ padding: '12px 14px 0' }}><Notice tone={flash.tone}>{flash.msg}</Notice></div> : null}
          {cloneError ? <div style={{ padding: '12px 14px 0' }}><Notice tone="bad">{cloneError}</Notice></div> : null}
          <MasterGrid versionId={v.id} rows={rows} grid={grid} editable={d.editable} prevVersionNo={d.previousVersionNo} serverRev={q.data} onSaved={() => setFlash(null)}
            title={type === 'COUNT_MIX' ? 'Fibre ranges allowed in the blended mix' : type === 'ACCESSORIES' ? 'Accessory life limits and packing weights' : type === 'QUALITY' ? 'Lab-test limits by department' : 'Machine settings and targets by stage'}
            toolbar={<>
              {d.editable ? <button className="btn sm" onClick={() => setTool('copy')} data-testid="tool-copy"><CopyCheck size={13} /> Copy from another count</button> : null}
              {d.editable ? <button className="btn sm" onClick={() => setTool('import')} data-testid="tool-import"><FileUp size={13} /> Import CSV</button> : null}
              <ExportButton versionId={v.id} />
              {cloneable ? <button className="btn sm" disabled={cloning || !perm.can || !!pendingElsewhere} title={pendingElsewhere ? `A ${pendingElsewhere.status === 'DRAFT' ? 'draft' : 'QA-approved version'} (v${pendingElsewhere.versionNo}) already exists — finish or reject it first.` : perm.why ?? 'Create a new draft from this version'} onClick={() => void create({ countId: v.countId, masterType: type, cloneFrom: v.id })} data-testid="tool-clone"><GitBranchPlus size={13} /> Clone &amp; adjust</button> : null}
            </>} />
        </Card> : null}

        {!hasGrid ? <div className="row"><ExportButton versionId={v.id} />{cloneable ? <button className="btn sm" disabled={cloning || !perm.can || !!pendingElsewhere} title={pendingElsewhere ? 'A draft or approved version already exists — finish or reject it first.' : perm.why} onClick={() => void create({ countId: v.countId, masterType: type, cloneFrom: v.id })} data-testid="tool-clone"><GitBranchPlus size={13} /> Clone &amp; adjust</button> : null}</div> : null}
        {cloneError && !hasGrid ? <Notice tone="bad">{cloneError}</Notice> : null}

        {tool === 'copy' ? <CopyFromCountModal type={type} currentCountId={v.countId} counts={overview.data?.counts ?? []} rows={rows} onClose={() => setTool(null)} onApply={(entries, msg) => { grid.setMany(entries); setFlash({ tone: 'info', msg }); setTool(null); }} /> : null}
        {tool === 'import' ? <ImportModal versionId={v.id} onClose={() => setTool(null)} onDone={(msg) => { setFlash({ tone: 'ok', msg }); setTool(null); }} /> : null}
      </>;
    })() : null}</Loading>
  </div>;
}
