import './portal.css';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDot, Clock, Hourglass, Minus, PackageCheck, Truck, XCircle } from 'lucide-react';
import type { ComplaintStatus } from '@shared/params';
import { displayCount } from '@shared/format';
import { useGet } from '../../lib/api';
import { Pill } from '../ui';
import type { MetaLite, PortalLotRow } from './types';

export const useMeta = () => useGet<MetaLite>('/api/meta', { staleTime: 60_000 });

/** count id ('40CH') → the friendly name the mill uses ('40s CH'). */
export function useCountName(): (id: string) => string {
  const m = useMeta();
  const map = new Map((m.data?.counts ?? []).map((c) => [c.id, c.display]));
  return (id) => map.get(id) ?? displayCount(id);
}

export const kgText = (n: number | null | undefined): string => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${n.toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: Number.isInteger(n) ? 0 : 1 })} kg`);
export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
/** whole days from `nowIso` to a YYYY-MM-DD date (negative = overdue) */
export function daysUntil(date: string, nowIso: string | undefined): number | null {
  if (!nowIso) return null;
  const d = Date.parse(`${date.slice(0, 10)}T00:00:00+05:30`); const n = Date.parse(nowIso);
  return Number.isNaN(d) || Number.isNaN(n) ? null : Math.round((d - n) / 86_400_000);
}
export const dueHint = (days: number | null): string => (days === null ? '' : days > 1 ? `in ${days} days` : days === 1 ? 'tomorrow' : days === 0 ? 'today' : `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`);

// ------------------------------------------------------------------ layout bits
export function PHead({ eyebrow, title, lead, right }: { eyebrow?: string; title: ReactNode; lead?: ReactNode; right?: ReactNode }): JSX.Element {
  return <div className="pt-head"><div>{eyebrow ? <div className="pt-eyebrow">{eyebrow}</div> : null}<h1 className="pt-h1">{title}</h1>{lead ? <p className="pt-lead">{lead}</p> : null}</div>{right ? <div className="row no-print">{right}</div> : null}</div>;
}

export function PCard({ title, icon, iconTone, lead, right, children, tone, flush, id, testId }: { title?: ReactNode; icon?: ReactNode; iconTone?: 'green' | 'chain' | 'amber'; lead?: ReactNode; right?: ReactNode; children?: ReactNode; tone?: 'ok' | 'warn' | 'bad'; flush?: boolean; id?: string; testId?: string }): JSX.Element {
  return <section id={id} data-testid={testId} className={`pt-card ${tone ? `tone-${tone}` : ''} ${flush ? 'flush' : ''}`}>
    {title ? <div className="pt-card-head row between" style={{ alignItems: 'flex-start' }}><div><h2 className="pt-h2">{icon ? <span className={`ico ${iconTone ?? ''}`}>{icon}</span> : null}{title}</h2>{lead ? <p className="pt-sub">{lead}</p> : null}</div>{right ? <div className="row no-print">{right}</div> : null}</div> : null}
    {children}
  </section>;
}

export function Tile({ to, icon, tone = 'blue', value, label, sub }: { to?: string; icon: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'chain' | 'red'; value: ReactNode; label: string; sub?: ReactNode }): JSX.Element {
  const body = <><span className="ico">{icon}</span><span className="num">{value}</span><span className="lbl">{label}</span>{sub ? <span className="sub">{sub}</span> : null}</>;
  return to ? <Link to={to} className={`pt-tile ${tone}`}>{body}</Link> : <div className={`pt-tile ${tone}`}>{body}</div>;
}

export const VehicleBadge = ({ no }: { no: string }): JSX.Element => <span className="pt-veh" title="Vehicle number"><Truck size={14} />{no}</span>;

// ------------------------------------------------------------------ status pills (colour + icon + words)
export function DispatchPill({ status }: { status: string }): JSX.Element {
  return status === 'DELIVERED' ? <Pill tone="green" icon={<PackageCheck size={14} />}>Delivered</Pill> : <Pill tone="blue" icon={<Truck size={14} />}>On the road</Pill>;
}

export function OrderPill({ status }: { status: string }): JSX.Element {
  if (status === 'COMPLETE') return <Pill tone="green" icon={<CheckCircle2 size={14} />}>Fully shipped</Pill>;
  if (status === 'PARTIAL') return <Pill tone="blue" icon={<Truck size={14} />}>Partly shipped</Pill>;
  return <Pill tone="gray" icon={<Clock size={14} />}>Waiting to ship</Pill>;
}

/** Complaint status exactly as the customer sees it: red "Open — received", yellow "In progress — being investigated", green "Closed". */
export const COMPLAINT_STATUS_UI: Record<ComplaintStatus, { tone: 'red' | 'yellow' | 'green'; label: string; icon: JSX.Element }> = {
  OPEN: { tone: 'red', label: 'Open — received', icon: <CircleDot size={14} /> },
  UNDER_ANALYSIS: { tone: 'yellow', label: 'In progress — being investigated', icon: <Hourglass size={14} /> },
  RESOLVED: { tone: 'green', label: 'Closed', icon: <CheckCircle2 size={14} /> },
};
export function ComplaintPill({ status }: { status: ComplaintStatus }): JSX.Element {
  const s = COMPLAINT_STATUS_UI[status] ?? COMPLAINT_STATUS_UI.OPEN;
  return <Pill tone={s.tone} icon={s.icon}>{s.label}</Pill>;
}

/** "Quality at a glance" in plain words, with colour + icon. */
export function QualityGlance({ tests }: { tests: PortalLotRow['tests'] }): JSX.Element {
  const { total, warning, outOfSpec } = tests; const attention = warning + outOfSpec;
  if (!total) return <Pill tone="gray" icon={<Minus size={14} />}>No test readings yet</Pill>;
  if (!attention) return <span className="pill green pt-glance"><CheckCircle2 size={14} />All {total} test readings are within specification</span>;
  return <span className={`pill ${outOfSpec ? 'red' : 'yellow'} pt-glance`}>{outOfSpec ? <XCircle size={14} /> : <AlertTriangle size={14} />}{attention} of {total} test readings need attention</span>;
}

export function Progress({ value, max }: { value: number; max: number }): JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><div className={`pt-progress grow ${pct >= 100 ? 'done' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% sent`}><i style={{ width: `${pct}%` }} /></div><b style={{ fontSize: 14, minWidth: 38 }}>{pct}%</b></div>;
}

/** plain-language "nothing here" block (only for genuinely empty lists). */
export const Empty = ({ icon, children }: { icon?: ReactNode; children: ReactNode }): JSX.Element => <div className="pt-empty">{icon}<div>{children}</div></div>;
