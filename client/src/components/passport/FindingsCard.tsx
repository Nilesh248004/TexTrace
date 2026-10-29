import { useMemo, useState } from 'react';
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import type { LotPassport } from '@shared/domain';
import { Card, CardBody, CardHead, J, Seg } from '../ui';
import { SOURCE_LABEL, collectFindings, groupFindings, type FindingGroup } from './findings';
import { TAB_LABEL, rangeText, type PassportTab } from './util';

function Row({ g, onJump }: { g: FindingGroup; onJump: (t: PassportTab) => void }): JSX.Element {
  const w = g.worst;
  const total = g.red + g.yellow;
  const where = g.where.map((x) => (x.n > 1 ? `${x.name} ×${x.n}` : x.name)).join(' · ');
  const headline = g.red ? `${g.red} reading${g.red === 1 ? '' : 's'} out of limits${g.yellow ? `, ${g.yellow} in the warning zone` : ''}` : `${total} reading${total === 1 ? '' : 's'} in the warning zone`;
  return <div className={`pp-find ${w.color}`} data-testid="finding-row">
    <span className={`ico ${w.color}`}>{w.color === 'red' ? <XCircle size={15} /> : <AlertTriangle size={15} />}</span>
    <div className="grow">
      <div><b>{g.label}</b> <span className="muted small">· {g.stageLabel}</span> <span className="pp-tag">{SOURCE_LABEL[g.source]}</span></div>
      <div className="small">{headline} — {where}{w.j ? <> · master {rangeText(w.j)} {w.j.unit}{w.j.versionNo ? ` (v${w.j.versionNo})` : ''}{w.j.deviationPct !== null ? ` · worst ${w.j.deviationPct >= 0 ? '+' : ''}${w.j.deviationPct.toFixed(1)}% from std` : ''}</> : <> · {w.text}</>}</div>
      {w.j?.plain ? <div className="muted tiny" style={{ marginTop: 2 }}>{w.j.plain}</div> : null}
    </div>
    <div className="val">
      {w.j ? <J j={w.j} unit plain /> : <span className={`pill ${w.color}`}>{w.text}</span>}
      {g.tab ? <button type="button" className="btn ghost sm no-print" onClick={() => onJump(g.tab as PassportTab)} title={`Open the ${TAB_LABEL[g.tab]} tab`}>Evidence <ArrowRight size={12} /></button> : <span className="muted tiny">see Origin</span>}
    </div>
  </div>;
}

export function FindingsCard({ p, onJump }: { p: LotPassport; onJump: (t: PassportTab) => void }): JSX.Element {
  const [view, setView] = useState<'red' | 'all'>('red');
  const groups = useMemo(() => groupFindings(collectFindings(p)), [p]);
  const reds = groups.filter((g) => g.worst.color === 'red');
  const shown = view === 'red' ? reds : groups;
  const started = p.quality.length > 0 || p.production.length > 0;
  const tone = reds.length ? 'bad' : groups.length ? 'warn' : 'ok';
  return <Card tone={tone} className="pp-avoid" >
    <CardHead
      title={<span className="pp-sec">{reds.length ? <AlertOctagon size={17} /> : <CheckCircle2 size={17} />} Findings — what is outside the master</span>}
      sub={started ? 'Every reading outside (red) or close to (yellow) its master limits, grouped by parameter. Start here to answer “why does this lot behave like that?”, then open the evidence.' : 'No lab or machine records yet — results appear here as the lot moves through the mill.'}
      right={groups.length ? <span className="no-print"><Seg value={view} onChange={setView} options={[{ key: 'red', label: `Out of limits (${reds.length})` }, { key: 'all', label: `With warnings (${groups.length})` }]} /></span> : null}
    />
    <CardBody className="" >
      {shown.length ? <div style={{ margin: '0 -16px -16px' }}>{shown.map((g) => <Row key={g.key} g={g} onJump={onJump} />)}</div>
        : <div className="muted">{started ? 'Every reading is within its master limits.' : 'Nothing to judge yet.'}</div>}
    </CardBody>
  </Card>;
}
