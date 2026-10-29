import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bug, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useGet, useMut, qstr } from '../lib/api';
import { Card, CardBody, CardHead, Hash, JsonBlock, Loading, Notice, PageHead, Tabs } from '../components/ui';
import { DataTable, type Col } from '../components/DataTable';
import { fmtDT } from '../lib/fmt';

interface Audit { id: string; at: string; username: string; role: string; action: string; label: string; accepted: boolean; reason: string | null; contracts: string[]; txHashes: string[]; blockNumber: number | null; refs: string }
interface AuditResp { items: Audit[]; total: number; users: string[] }
interface QualityResp { items: { id: string }[] }
interface Report { valid: boolean; checkedBlocks: number; checkedTxs: number; checkedRecords: number; issues: { kind: string; entityId?: string; field?: string; message?: string }[] }

export default function Developer(): JSX.Element {
  const [sp] = useSearchParams(); const [tab, setTab] = useState<'actions' | 'integrity'>('actions'); const [report, setReport] = useState<Report | null>(null); const [preset, setPreset] = useState(false); const lot = sp.get('lot') ?? '';
  const audit = useGet<AuditResp>('/api/dev/audit' + qstr({ lot, pageSize: 100 })); const tests = useGet<QualityResp>(preset ? '/api/quality?lot=101&stage=RF&machine=RF-6' : null);
  const validate = useMut<Record<string, never>, Report>('POST', '/api/dev/validate', 'Validate permissioned ledger chain');
  const tamper = useMut<{ kind: string; entityType: string; entityId: string; column: string; jsonKey: string; value: number }, { id: string }>('POST', '/api/dev/tamper', 'Run tamper simulation');
  const cols: Col<Audit>[] = [{ key: 'at', header: 'Time', value: (x) => x.at, render: (x) => fmtDT(x.at) }, { key: 'actor', header: 'Actor', value: (x) => `${x.username} ${x.role}` }, { key: 'action', header: 'Action', value: (x) => x.action, render: (x) => <><b>{x.label}</b><span className="sub">{x.contracts.join(' · ')}</span></> }, { key: 'refs', header: 'References', value: (x) => x.refs }, { key: 'block', header: 'Ledger proof', value: (x) => x.blockNumber ?? '', render: (x) => x.txHashes.length ? <span>Block #{x.blockNumber} · <Hash value={x.txHashes[0]} /></span> : 'No ledger tx' }, { key: 'accepted', header: 'Result', value: (x) => x.accepted ? 'accepted' : 'rejected', render: (x) => <span className={`judged ${x.accepted ? 'green' : 'red'}`}>{x.accepted ? 'Accepted' : x.reason ?? 'Rejected'}</span> }];
  const doValidate = async () => { try { setReport(await validate.mutateAsync({})); } catch { /* mutation surface shows trace / error */ } };
  const doTamper = async () => { const test = tests.data?.items[0]; if (!test) return; await tamper.mutateAsync({ kind: 'record', entityType: 'test_result', entityId: test.id, column: 'values_json', jsonKey: 'H', value: 6 }); };
  return <div className="page" data-testid="developer-console"><PageHead eyebrow="LEDGER + CONTRACT OBSERVABILITY" title="Developer Console" sub="Every staff and customer action includes its request/response trace, contract calls, transaction hash, block, validators and database diff." />
    <Tabs value={tab} onChange={setTab} tabs={[{ key: 'actions', label: 'Actions' }, { key: 'integrity', label: 'Integrity & tamper' }]} />
    {tab === 'actions' ? <Loading q={audit}>{audit.data ? <Card><CardHead title={`Action log${lot ? ` · lot ${lot}` : ''}`} sub={`${audit.data.total} recorded actions. Filtered actions preserve rejections as INVALID ledger transactions.`} /><CardBody><div data-testid="dev-actions"><DataTable rows={audit.data.items} columns={cols} rowKey={(x) => x.id} exportName="ledger-actions" title="TexTrace developer action log" filters={[{ key: 'user', label: 'User', value: (x) => x.username }, { key: 'action', label: 'Action', value: (x) => x.action }]} /></div></CardBody></Card> : null}</Loading> : <div className="stack"><Card><CardHead title="Validate chain + anchored records" sub="Re-hashes every transaction, Merkle root, validator signature and anchored database record." /><CardBody><button className="btn primary" data-testid="validate-chain" onClick={doValidate} disabled={validate.isPending}><ShieldCheck size={15} /> {validate.isPending ? 'Validating…' : 'Validate chain'}</button>{report ? <Notice tone={report.valid ? 'ok' : 'bad'}><b>{report.valid ? 'VALID' : 'INVALID'}</b> · {report.checkedBlocks} blocks · {report.checkedTxs} transactions · {report.checkedRecords} anchored records{report.issues.map((x, i) => <div key={i} className="mono small">{x.kind}{x.entityId ? ` · ${x.entityId}` : ''}{x.field ? ` · ${x.field}` : ''}</div>)}</Notice> : null}</CardBody></Card>
      <Card tone="bad"><CardHead title="Tamper simulation" sub="Intentionally modifies a value outside the contracts so the integrity scan can prove detection. This is a demo-only tool." /><CardBody className="stack"><button className={`btn ${preset ? 'danger' : ''}`} data-testid="tamper-preset-1" onClick={() => setPreset(true)}><Bug size={15} /> Preset 1: change Lot 101 RF-6 hairiness</button>{preset ? <Notice tone="warn">Selected: test-result H value on Lot 101 / RF-6. This will break its record hash until reset or restore.</Notice> : null}<button className="btn danger" data-testid="tamper-run" disabled={!preset || !tests.data?.items[0] || tamper.isPending} onClick={doTamper}><ShieldAlert size={15} /> {tamper.isPending ? 'Tampering…' : 'Run simulation'}</button></CardBody></Card>
      {report?.issues.length ? <Card><CardHead title="Integrity report" /><CardBody><JsonBlock value={report} max={360} /></CardBody></Card> : null}
    </div>}
  </div>;
}
