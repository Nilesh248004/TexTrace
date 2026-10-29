import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Boxes, Check, CheckCircle2, ChevronDown, ChevronRight, Cog, Disc3, Layers, Loader2, MapPin, Merge, Minus, Package, PackageCheck, Scissors, ShieldAlert, ShieldCheck, Truck, Warehouse, Waypoints, Wind, X, XCircle,
} from 'lucide-react';
import type { Judged, JourneyStage, QualityColor } from '@shared/domain';
import type { OnChainRef } from '@shared/types';
import type { Stage } from '@shared/params';
import { fmtDTShort, fmtDuration } from '../lib/fmt';

export type Color = QualityColor;
export const COLOR_TEXT: Record<Color, string> = { green: 'Within limits', yellow: 'Warning', red: 'Out of limits', none: 'No standard' };
export const ColorIcon = ({ color, size = 13 }: { color: Color; size?: number }) => color === 'green' ? <CheckCircle2 size={size} /> : color === 'yellow' ? <AlertTriangle size={size} /> : color === 'red' ? <XCircle size={size} /> : <Minus size={size} />;

const fmtVal = (v: number | null, d: number) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));

/** A result judged against its master: colour + icon + value; hover shows master, deviation and version. */
export function J({ j, unit, plain, tip = true }: { j: Judged | null | undefined; unit?: boolean; plain?: boolean; tip?: boolean }): JSX.Element {
  if (!j || j.value === null) return <span className="judged none"><Minus size={12} /> —</span>;
  const lim = `${j.lower !== null ? fmtVal(j.lower, j.decimals) : '–'} … ${fmtVal(j.std, j.decimals)} … ${j.upper !== null ? fmtVal(j.upper, j.decimals) : '–'}`;
  const title = tip ? `${j.label}: ${fmtVal(j.value, j.decimals)} ${j.unit} — ${j.text.toUpperCase()}\nMaster${j.versionNo ? ` v${j.versionNo}` : ''} (lower … std … upper): ${lim}${j.deviation !== null ? `\nDeviation ${j.deviation >= 0 ? '+' : ''}${fmtVal(j.deviation, j.decimals)}${j.deviationPct !== null ? ` (${j.deviationPct >= 0 ? '+' : ''}${j.deviationPct.toFixed(1)}%)` : ''}${j.side ? `, ${j.side} side` : ''}` : ''}${plain && j.plain ? `\n${j.plain}` : ''}` : undefined;
  return <span className={`judged ${j.color}`} title={title} aria-label={`${j.label} ${fmtVal(j.value, j.decimals)} ${j.text}`}><ColorIcon color={j.color} size={12} />{fmtVal(j.value, j.decimals)}{unit && j.unit ? <small className="muted">{j.unit}</small> : null}</span>;
}

export function ColorPill({ color, label }: { color: Color; label?: string }): JSX.Element {
  return <span className={`pill ${color}`}><ColorIcon color={color} size={12} />{label ?? COLOR_TEXT[color]}</span>;
}
export function Pill({ tone = 'gray', children, title, icon }: { tone?: Color | 'gray' | 'blue' | 'chain'; children: ReactNode; title?: string; icon?: ReactNode }): JSX.Element {
  return <span className={`pill ${tone}`} title={title}>{icon}{children}</span>;
}

export function Legend({ chain = false, className = '' }: { chain?: boolean; className?: string }): JSX.Element {
  return <div className={`legend ${className}`} aria-label="Colour legend">
    <span className="sw"><span className="judged green"><CheckCircle2 size={12} /></span> Within master tolerance</span>
    <span className="sw"><span className="judged yellow"><AlertTriangle size={12} /></span> Warning — last 20% of the tolerance band</span>
    <span className="sw"><span className="judged red"><XCircle size={12} /></span> Out of tolerance</span>
    {chain ? <span className="sw"><span className="chain-badge"><ShieldCheck size={11} /> On-chain</span> record re-hashed and matches the ledger</span> : null}
  </div>;
}

export function ChainBadge({ chain, label }: { chain: OnChainRef | null | undefined; label?: string }): JSX.Element {
  if (!chain || !chain.txHash) return <span className="chain-badge bad" title="Not anchored on the ledger"><ShieldAlert size={11} /> Off-chain</span>;
  if (!chain.verified) return <span className="chain-badge bad" title={`Block #${chain.blockNumber} — the record no longer matches its anchored hash (tampered)`}><ShieldAlert size={11} /> Tampered</span>;
  return <span className="chain-badge" title={`Verified on-chain — block #${chain.blockNumber}, tx ${chain.txHash.slice(0, 18)}…, record version ${chain.version}`}><ShieldCheck size={11} /> {label ?? 'On-chain'} #{chain.blockNumber}</span>;
}

export function Card({ children, className = '', tone, flush }: { children: ReactNode; className?: string; tone?: 'bad' | 'warn' | 'ok' | 'chain'; flush?: boolean }): JSX.Element {
  return <section className={`card ${tone ? `tone-${tone}` : ''} ${flush ? 'flush' : ''} ${className}`}>{children}</section>;
}
export function CardHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }): JSX.Element {
  return <div className="card-head"><div><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>{right ? <div className="row">{right}</div> : null}</div>;
}
export const CardBody = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`card-body ${className}`}>{children}</div>;

export function PageHead({ eyebrow, title, sub, right }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }): JSX.Element {
  return <div className="page-head"><div>{eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}<h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div>{right ? <div className="row no-print">{right}</div> : null}</div>;
}

export function Kpi({ label, value, unit, sub, to, icon, tone }: { label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode; to?: string; icon?: ReactNode; tone?: Color }): JSX.Element {
  const body = <><div className="label"><span>{label}</span>{icon ?? null}</div><div className="value">{value}{unit ? <small>{unit}</small> : null}</div>{sub ? <div className="sub">{sub}</div> : null}</>;
  const cls = `card kpi ${tone === 'red' ? 'tone-bad' : tone === 'yellow' ? 'tone-warn' : tone === 'green' ? 'tone-ok' : ''}`;
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: ReactNode; count?: number | string; tone?: 'bad' | 'warn' }[]; value: K; onChange: (k: K) => void }): JSX.Element {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'on' : ''}`} onClick={() => onChange(t.key)} data-testid={`tab-${t.key}`}>{t.label}{t.count !== undefined ? <span className={`count ${t.tone ?? ''}`}>{t.count}</span> : null}</button>)}</div>;
}
export function Seg<K extends string>({ options, value, onChange }: { options: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void }): JSX.Element {
  return <div className="seg" role="group">{options.map((o) => <button key={o.key} className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)}>{o.label}</button>)}</div>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }): JSX.Element {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true"><div className="modal-head"><h2 style={{ fontSize: 16 }}>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={16} /></button></div><div className="modal-body">{children}</div>{footer ? <div className="modal-foot">{footer}</div> : null}</div></div>;
}
export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }): JSX.Element {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <><div className="modal-scrim" style={{ background: 'hsl(0 0% 0% / .3)' }} onMouseDown={onClose} /><aside className="drawer"><div className="modal-head"><h2 style={{ fontSize: 16 }}>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={16} /></button></div><div className="modal-body">{children}</div></aside></>;
}

export const Field = ({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) => <div className="field"><label>{label}</label>{children}{hint ? <span className="hint">{hint}</span> : null}</div>;
export const Notice = ({ tone = 'info', children, icon }: { tone?: 'info' | 'warn' | 'bad' | 'ok' | 'chain'; children: ReactNode; icon?: ReactNode }) => <div className={`notice ${tone}`}>{icon ?? (tone === 'bad' ? <XCircle size={16} /> : tone === 'warn' ? <AlertTriangle size={16} /> : tone === 'ok' ? <CheckCircle2 size={16} /> : tone === 'chain' ? <ShieldCheck size={16} /> : <Check size={16} />)}<div className="grow">{children}</div></div>;
export const Spinner = ({ label }: { label?: string }) => <div className="row muted small" style={{ padding: 20, justifyContent: 'center' }}><Loader2 className="spin" size={16} /> {label ?? 'Loading…'}</div>;
export const Skeleton = ({ h = 90 }: { h?: number }) => <div className="skeleton" style={{ height: h }} />;
export function Loading({ q, children }: { q: { isLoading: boolean; error: unknown; data: unknown }; children: ReactNode }): JSX.Element {
  if (q.error) return <Notice tone="bad">{q.error instanceof Error ? q.error.message : 'Unable to load'}</Notice>;
  if (q.isLoading || q.data === undefined) return <div className="stack"><Skeleton h={110} /><Skeleton h={220} /></div>;
  return <>{children}</>;
}
export const Fact = ({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) => <div className="fact"><span>{label}</span><b>{children}</b>{sub ? <small>{sub}</small> : null}</div>;
export const Swatch = ({ hex, name }: { hex: string | null | undefined; name?: string }) => <span className="row" style={{ gap: 6, display: 'inline-flex' }}><span className="swatch" style={{ background: hex ?? '#ccc' }} />{name}</span>;
export const Tip = ({ text }: { text: string }) => <span className="tip-i" title={text} aria-label={text}>i</span>;
export function Collapse({ title, defaultOpen = false, children, right }: { title: ReactNode; defaultOpen?: boolean; children: ReactNode; right?: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return <div><button className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{title}<span style={{ marginLeft: 'auto' }}>{right}</span></button>{open ? <div style={{ paddingTop: 8 }}>{children}</div> : null}</div>;
}
export function JsonBlock({ value, max }: { value: unknown; max?: number }): JSX.Element {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  return <pre className="json mono" style={max ? { maxHeight: max } : undefined}>{text}</pre>;
}
export const Hash = ({ value, n = 12 }: { value: string | null | undefined; n?: number }) => <span className="hash" title={value ?? ''}>{value ? `${value.slice(0, n)}…${value.slice(-4)}` : '—'}</span>;

// ------------------------------------------------------------------ journey stepper
const STAGE_ICON: Record<Stage, typeof Cog> = { BALE: Warehouse, BR: Wind, CARD: Layers, DFB: Merge, DFF: Merge, COMB: Scissors, FF: Waypoints, RF: Cog, AW: Disc3, PACK: Package, FG: Boxes, DISP: Truck, DELIV: PackageCheck };
export const StageIcon = ({ stage, size = 16 }: { stage: Stage; size?: number }) => { const I = STAGE_ICON[stage] ?? MapPin; return <I size={size} />; };

export function StageStepper({ journey }: { journey: JourneyStage[] }): JSX.Element {
  return <div className="stepper" aria-label="Lot journey">
    {journey.map((s) => {
      const cls = s.state === 'DONE' ? `done ${s.worst === 'red' || s.worst === 'yellow' ? s.worst : ''}` : s.state === 'CURRENT' ? 'current' : s.state === 'NEXT' ? 'next' : 'pending';
      const machines = [...new Set(s.machines.map((m) => m.label))];
      return <div key={s.stage} className={`step ${cls}`} data-testid={`step-${s.stage}`}>
        <div className="node">{s.state === 'DONE' && s.worst === 'red' ? <XCircle size={16} /> : s.state === 'DONE' && s.worst === 'yellow' ? <AlertTriangle size={16} /> : <StageIcon stage={s.stage} />}</div>
        <div className="name">{s.label}</div>
        <div className="when">{s.inAt ? <>IN {fmtDTShort(s.inAt)}</> : s.state === 'NEXT' ? 'Waiting' : 'Pending'}{s.outAt ? <><br />OUT {fmtDTShort(s.outAt)}</> : s.state === 'CURRENT' ? <><br />in progress</> : null}</div>
        {machines.length ? <div className="mach">{machines.join(' · ')}</div> : s.location ? <div className="mach">{s.location}</div> : null}
        {s.inAt ? <div className="tip">
          <b>{s.label}</b>
          <div className="muted" style={{ margin: '3px 0 6px' }}>{s.plain}</div>
          <div>IN {fmtDTShort(s.inAt)}{s.outAt ? <> · OUT {fmtDTShort(s.outAt)}</> : null}</div>
          {s.durationMs !== null ? <div>Duration {fmtDuration(s.durationMs)}</div> : null}
          {s.dwellBeforeMs !== null ? <div>Waited {fmtDuration(s.dwellBeforeMs)} since the previous stage</div> : null}
          {s.kgIn ? <div>Input {s.kgIn.toLocaleString('en-IN')} kg → output {s.kgOut.toLocaleString('en-IN')} kg{s.wastePct !== null ? ` · waste ${s.wastePct}%` : ''}</div> : null}
          {s.machines.map((m, i) => <div key={i} className="muted">{m.label} · shift {m.shift}{m.operator ? ` · ${m.operator}` : ''}</div>)}
          {s.batchRefs.length ? <div className="mono tiny muted">{s.batchRefs.join(' · ')}</div> : null}
        </div> : null}
      </div>;
    })}
  </div>;
}

export function KeyValues({ items }: { items: [string, ReactNode][] }): JSX.Element {
  return <dl className="kv">{items.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
}
