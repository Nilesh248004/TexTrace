import type { ReactNode } from 'react';
import { BadgeCheck, CheckCircle2, FilePenLine, History, XCircle, Layers, FlaskConical, Factory, PackageOpen, Palette } from 'lucide-react';
import { canInvoke, ROLE_LABEL, type ContractFunction } from '@shared/permissions';
import { STAGE_INFO, paramDef, type MasterStatus, type MasterType, type Scope } from '@shared/params';
import { useGet } from '../../lib/api';
import { useSession, useUi } from '../../lib/store';
import { Pill } from '../ui';

// ------------------------------------------------------------------ permissions (the matrix shared with the server)
/**
 * Whether the signed-in role may invoke a contract function. In Developer mode buttons stay enabled so that the
 * contract denial can be demonstrated; the server still rejects the call.
 */
export function useCan(fn: ContractFunction): { can: boolean; why: string | undefined } {
  const role = useSession((s) => s.user?.role);
  const dev = useUi((s) => s.dev);
  const allowed = canInvoke(role, fn);
  return { can: allowed || dev, why: allowed ? undefined : `Your role (${role ? ROLE_LABEL[role] : 'signed out'}) is not allowed to do this${dev ? ' — Developer mode lets you try it so the contract denial can be shown.' : '.'}` };
}

export interface MillMeta { millName: string; now: string; businessDate: string; counts: { id: string; label: string; display: string; ne: number; usesComber: number }[] }
export const useMillMeta = () => useGet<MillMeta>('/api/meta');

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong');

// ------------------------------------------------------------------ labels
export const MASTER_ICON: Record<MasterType, ReactNode> = {
  COUNT_MIX: <Layers size={16} />, QUALITY: <FlaskConical size={16} />, PRODUCTION: <Factory size={16} />, ACCESSORIES: <PackageOpen size={16} />, COLOR: <Palette size={16} />,
};
/** Short names used in tables and chips. */
export const MASTER_SHORT: Record<MasterType, string> = { COUNT_MIX: 'Count & Mix', QUALITY: 'Quality', PRODUCTION: 'Production', ACCESSORIES: 'Accessories', COLOR: 'Color Code' };

export const STATUS_META: Record<MasterStatus, { label: string; tone: 'green' | 'yellow' | 'red' | 'gray' | 'blue'; icon: ReactNode; plain: string }> = {
  DRAFT: { label: 'DRAFT', tone: 'yellow', icon: <FilePenLine size={12} />, plain: 'Being prepared — can still be edited. Not used to judge results yet.' },
  QA_APPROVED: { label: 'QA approved', tone: 'blue', icon: <BadgeCheck size={12} />, plain: 'Approved by QA, waiting to be activated from an effective date.' },
  ACTIVE: { label: 'ACTIVE', tone: 'green', icon: <CheckCircle2 size={12} />, plain: 'In force — results produced from its effective date are judged against it.' },
  SUPERSEDED: { label: 'SUPERSEDED', tone: 'gray', icon: <History size={12} />, plain: 'Replaced by a newer active version. Still used for results produced while it was in force.' },
  REJECTED: { label: 'REJECTED', tone: 'red', icon: <XCircle size={12} />, plain: 'Rejected by QA — never used.' },
};
export function MasterStatusPill({ status }: { status: MasterStatus }): JSX.Element {
  const m = STATUS_META[status];
  return <Pill tone={m.tone} icon={m.icon} title={m.plain}>{m.label}</Pill>;
}

/** 'Mix (blended cotton)' for the MIX scope, otherwise the stage name. */
export const scopeLabel = (s: Scope | string): string => (s === 'MIX' ? 'Mix (blended cotton)' : STAGE_INFO[s as keyof typeof STAGE_INFO]?.label ?? s);
export const scopeShort = (s: Scope | string): string => (s === 'MIX' ? 'Mix' : STAGE_INFO[s as keyof typeof STAGE_INFO]?.short ?? s);

const META_LABEL: Record<string, string> = {
  route: 'Process route', recipe: 'Mix recipe (must add up to 100%)', targetWastePct: 'Target waste %', targetRealizationPct: 'Target realization %',
  packageType: 'Package type', coneType: 'Cone type', cartonType: 'Carton type', polybag: 'Polybag', strapping: 'Strapping', labelTemplate: 'Label template', palletWrap: 'Pallet wrap',
  travellerType: 'Traveller type', travellerNo: 'Traveller number', clearerClass: 'Clearer class', colorName: 'Colour name', hex: 'Colour (hex)', tip: 'Tip description', code: 'Colour code',
};
/** Plain label of a missing master item: a parameter at a stage, or one of the recipe / packing / colour fields. */
export function missingLabel(m: { scope: Scope; key: string }): string {
  const def = paramDef(m.key);
  if (def) return `${def.label} — ${m.scope === 'MIX' ? 'blended mix' : STAGE_INFO[m.scope]?.label ?? m.scope}`;
  return META_LABEL[m.key] ?? m.key;
}

export const pctTone = (pct: number): 'green' | 'yellow' | 'red' => (pct >= 99 ? 'green' : pct >= 90 ? 'yellow' : 'red');
const TONE_VAR = { green: '--ok', yellow: '--warn', red: '--bad' } as const;
export function CompletenessBar({ pct, label, height = 8 }: { pct: number; label?: ReactNode; height?: number }): JSX.Element {
  const tone = pctTone(pct);
  return <div className="stack tight" role="img" aria-label={`${pct}% complete`}>
    <div className="row between small"><span className={`judged ${tone}`} style={{ cursor: 'default' }}>{tone === 'green' ? <CheckCircle2 size={12} /> : tone === 'yellow' ? <FilePenLine size={12} /> : <XCircle size={12} />}{pct}% complete</span>{label ? <span className="muted tiny">{label}</span> : null}</div>
    <div className="bar" style={{ height }}><i style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: `hsl(var(${TONE_VAR[tone]}))` }} /></div>
  </div>;
}

/** Parse a number typed or pasted into a cell: '' → null, '17,200' → 17200, anything else non-numeric → NaN. */
export function parseNum(s: string | null | undefined): number | null {
  const t = String(s ?? '').trim();
  if (t === '') return null;
  const clean = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(clean)) return Number.NaN;
  return Number(clean);
}
