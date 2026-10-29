// Master lookup + judgement. Every value shown anywhere in the product is judged here against the master VERSION that was
// active on its production date (mode 'asOf') or against the latest active version ('latest' – the "what if" view).
import type { DB } from '../db';
import { evaluate, COLOR_LABEL, DEFAULT_WARN_FRACTION } from '@shared/quality';
import { MASTER_TYPES, PARAMS, masterTemplate, paramDef, type MasterType, type Scope } from '@shared/params';
import type { AccessoriesMeta, ColorMeta, Completeness, CountMixMeta, Judged } from '@shared/domain';

export interface VersionRow {
  id: string; master_type: MasterType; count_id: string; version_no: number; status: string;
  effective_from: string | null; effective_to: string | null; meta: Record<string, unknown>;
}
export interface ItemRow {
  id: string; version_id: string; master_type: MasterType; count_id: string; scope: Scope; parameter: string;
  std: number; lower: number | null; upper: number | null; unit: string; frequency: string; instrument: string;
}
export type JudgeMode = 'asOf' | 'latest';

let cache: MasterBook | null = null;
export function invalidateMasters(): void { cache = null; }

export class MasterBook {
  private versions = new Map<string, VersionRow[]>(); // `${count}|${type}` -> versions sorted by version_no
  private items = new Map<string, Map<string, ItemRow>>(); // versionId -> `${scope}|${param}` -> item
  private counts = new Map<string, { id: string; ne: number; usesComber: boolean }>();
  warnFraction = DEFAULT_WARN_FRACTION;

  static async load(db: DB): Promise<MasterBook> {
    if (cache) return cache;
    const book = new MasterBook();
    const vrows = await db.prepare('SELECT * FROM master_versions ORDER BY count_id, master_type, version_no').all<Record<string, unknown>>();
    for (const r of vrows) {
      const v: VersionRow = {
        id: String(r.id), master_type: r.master_type as MasterType, count_id: String(r.count_id), version_no: Number(r.version_no), status: String(r.status),
        effective_from: (r.effective_from as string | null) ?? null, effective_to: (r.effective_to as string | null) ?? null,
        meta: safeJson(r.meta) as Record<string, unknown>,
      };
      const k = `${v.count_id}|${v.master_type}`;
      if (!book.versions.has(k)) book.versions.set(k, []);
      book.versions.get(k)!.push(v);
    }
    const irows = await db.prepare('SELECT id,version_id,master_type,count_id,scope,parameter,std,lower_limit,upper_limit,unit,frequency,instrument FROM master_items').all<Record<string, unknown>>();
    for (const r of irows) {
      const it: ItemRow = {
        id: String(r.id), version_id: String(r.version_id), master_type: r.master_type as MasterType, count_id: String(r.count_id), scope: r.scope as Scope,
        parameter: String(r.parameter), std: Number(r.std), lower: r.lower_limit === null ? null : Number(r.lower_limit), upper: r.upper_limit === null ? null : Number(r.upper_limit),
        unit: String(r.unit ?? ''), frequency: String(r.frequency ?? ''), instrument: String(r.instrument ?? ''),
      };
      if (!book.items.has(it.version_id)) book.items.set(it.version_id, new Map());
      book.items.get(it.version_id)!.set(`${it.scope}|${it.parameter}`, it);
    }
    const crows = await db.prepare('SELECT id,ne,uses_comber FROM counts').all<{ id: string; ne: number; uses_comber: number }>();
    for (const c of crows) book.counts.set(c.id, { id: c.id, ne: Number(c.ne), usesComber: !!c.uses_comber });
    const w = await db.prepare(`SELECT value FROM settings WHERE key='warnFraction'`).get<{ value: string }>();
    if (w) book.warnFraction = Number(JSON.parse(w.value)) || DEFAULT_WARN_FRACTION;
    cache = book;
    return book;
  }

  versionsOf(countId: string, type: MasterType): VersionRow[] { return this.versions.get(`${countId}|${type}`) ?? []; }

  /** Version in force on `date`; falls back to the earliest effective version so a lot never lacks a master. */
  versionAt(countId: string, type: MasterType, date: string, mode: JudgeMode = 'asOf'): VersionRow | undefined {
    const effective = this.versionsOf(countId, type).filter((v) => (v.status === 'ACTIVE' || v.status === 'SUPERSEDED') && v.effective_from);
    if (!effective.length) return undefined;
    if (mode === 'latest') return effective.find((v) => v.status === 'ACTIVE') ?? effective[effective.length - 1];
    const d = date.slice(0, 10);
    const hit = effective.filter((v) => (v.effective_from as string) <= d && (!v.effective_to || d < v.effective_to));
    return hit.length ? hit[hit.length - 1] : effective[0];
  }

  item(countId: string, type: MasterType, scope: Scope, key: string, date: string, mode: JudgeMode = 'asOf'): { item: ItemRow; version: VersionRow } | undefined {
    const version = this.versionAt(countId, type, date, mode);
    if (!version) return undefined;
    const item = this.items.get(version.id)?.get(`${scope}|${key}`);
    return item ? { item, version } : undefined;
  }

  itemsOf(versionId: string): ItemRow[] { return [...(this.items.get(versionId)?.values() ?? [])]; }

  meta<T>(countId: string, type: MasterType, date: string, mode: JudgeMode = 'asOf'): { meta: T; version: VersionRow } | undefined {
    const version = this.versionAt(countId, type, date, mode);
    return version ? { meta: version.meta as T, version } : undefined;
  }
  countMix(countId: string, date: string, mode: JudgeMode = 'asOf') { return this.meta<CountMixMeta>(countId, 'COUNT_MIX', date, mode); }
  accessories(countId: string, date: string, mode: JudgeMode = 'asOf') { return this.meta<AccessoriesMeta>(countId, 'ACCESSORIES', date, mode); }
  color(countId: string, date: string, mode: JudgeMode = 'asOf') { return this.meta<ColorMeta>(countId, 'COLOR', date, mode); }

  /** Judge one value against the master for (count, type, scope, key) active on `date`. */
  judge(countId: string, type: MasterType, scope: Scope, key: string, value: number | null | undefined, date: string, mode: JudgeMode = 'asOf'): Judged {
    const def = paramDef(key);
    const found = this.item(countId, type, scope, key, date, mode);
    const v = value === undefined ? null : value;
    const ev = evaluate(v, found ? { std: found.item.std, lower: found.item.lower, upper: found.item.upper } : null, this.warnFraction);
    return {
      key, label: def?.label ?? key, unit: found?.item.unit || def?.unit || '', decimals: def?.decimals ?? 2, value: v,
      std: found?.item.std ?? null, lower: found?.item.lower ?? null, upper: found?.item.upper ?? null,
      color: ev.color, text: v === null ? 'No data' : COLOR_LABEL[ev.color], side: ev.side, deviation: ev.deviation, deviationPct: ev.deviationPct,
      versionNo: found?.version.version_no ?? null, versionId: found?.version.id ?? null, masterType: type, plain: def?.plain ?? '',
    };
  }

  /** Master completeness for a count, computed on the version active now. */
  completeness(countId: string): Completeness {
    const count = this.counts.get(countId);
    const template = masterTemplate(!!count?.usesComber).filter((t) => t.required);
    const byType = {} as Completeness['byType'];
    for (const type of MASTER_TYPES) {
      const version = this.versionAt(countId, type, '9999-12-31', 'latest');
      const items = version ? this.items.get(version.id) : undefined;
      const required: { scope: Scope; key: string }[] = template.filter((t) => t.master === type).map((t) => ({ scope: t.scope, key: t.key }));
      const missing: { scope: Scope; key: string }[] = required.filter((r) => !items?.has(`${r.scope}|${r.key}`));
      let total = required.length;
      let present = total - missing.length;
      // meta checks
      if (type === 'COUNT_MIX') {
        const m = (version?.meta ?? {}) as Partial<CountMixMeta>;
        const checks: [string, boolean][] = [
          ['route', !!m.route?.length], ['recipe', !!m.recipe?.length && Math.abs(m.recipe.reduce((s, r) => s + r.pct, 0) - 100) < 0.01],
          ['targetWastePct', typeof m.targetWastePct === 'number'], ['targetRealizationPct', typeof m.targetRealizationPct === 'number'],
        ];
        total += checks.length; present += checks.filter((c) => c[1]).length;
        for (const [k, okk] of checks) if (!okk) missing.push({ scope: 'MIX', key: k });
      } else if (type === 'ACCESSORIES') {
        const m = (version?.meta ?? {}) as Partial<AccessoriesMeta>;
        const keys: (keyof AccessoriesMeta)[] = ['packageType', 'coneType', 'cartonType', 'polybag', 'strapping', 'labelTemplate', 'palletWrap', 'travellerType', 'travellerNo', 'clearerClass'];
        total += keys.length;
        for (const k of keys) { if (m[k] !== undefined && m[k] !== '') present += 1; else missing.push({ scope: 'PACK', key: k }); }
      } else if (type === 'COLOR') {
        const m = (version?.meta ?? {}) as Partial<ColorMeta>;
        const keys: (keyof ColorMeta)[] = ['colorName', 'hex', 'tip', 'code'];
        total += keys.length;
        for (const k of keys) { if (m[k]) present += 1; else missing.push({ scope: 'PACK', key: k }); }
      }
      byType[type] = { pct: total ? Math.round((present / total) * 1000) / 10 : 0, present, required: total, missing };
    }
    const all = Object.values(byType);
    const overall = Math.round((all.reduce((s, t) => s + t.present, 0) / Math.max(1, all.reduce((s, t) => s + t.required, 0))) * 1000) / 10;
    return { countId, overall, byType };
  }

  /** All items of the latest active QUALITY/PRODUCTION/ACCESSORIES versions for a count (used by UI cell hints). */
  requiredKeys(): number { return PARAMS.length; }
}

function safeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? {};
  try { return JSON.parse(v); } catch { return {}; }
}

/** Shorthand used by routes: load the (cached) book. */
export const loadMasters = (db: DB) => MasterBook.load(db);

/** Validate a master item; returns an error message or null. lower ≤ std ≤ upper with at least one limit. */
export function validateItem(i: { std: unknown; lower?: unknown; upper?: unknown }): string | null {
  const std = Number(i.std);
  if (i.std === null || i.std === undefined || i.std === '' || !Number.isFinite(std)) return 'Standard value is required';
  const lower = i.lower === null || i.lower === undefined || i.lower === '' ? null : Number(i.lower);
  const upper = i.upper === null || i.upper === undefined || i.upper === '' ? null : Number(i.upper);
  if ((lower !== null && !Number.isFinite(lower)) || (upper !== null && !Number.isFinite(upper))) return 'Limits must be numbers';
  if (lower === null && upper === null) return 'At least one limit (lower or upper) is required';
  if (lower !== null && lower > std) return `Lower limit ${lower} must be ≤ standard ${std}`;
  if (upper !== null && std > upper) return `Standard ${std} must be ≤ upper limit ${upper}`;
  return null;
}
