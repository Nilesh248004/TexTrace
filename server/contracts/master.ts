// Master contract: versioned masters (Count & Mix, Quality, Production, Accessories, Color Code).
// DRAFT → QA_APPROVED → ACTIVE (previous ACTIVE becomes SUPERSEDED on the activation date).
import { MASTER_TYPES, PARAMS, STAGES, masterTypeOf, paramDef, masterTemplate, type MasterType, type Scope, type Stage } from '@shared/params';
import type { AccessoriesMeta, ColorMeta, CountMixMeta } from '@shared/domain';
import { validateItem, MasterBook } from '../domain/masters';
import { today } from '../lib/clock';
import type { ContractModule, ExecContext } from './types';

interface VersionRow { id: string; master_type: MasterType; count_id: string; version_no: number; status: string; effective_from: string | null; meta: string; created_by: string; note: string }
interface ItemInput { scope: Scope; parameter: string; std: number; lower?: number | null; upper?: number | null; unit?: string; frequency?: string; instrument?: string; note?: string }

const versionOf = (ctx: ExecContext, id: string) => ctx.get<VersionRow>('SELECT * FROM master_versions WHERE id=?', id);

function validateMeta(ctx: ExecContext, type: MasterType, meta: Record<string, unknown>): void {
  if (type === 'COUNT_MIX') {
    const m = meta as unknown as CountMixMeta;
    ctx.check('route-valid', Array.isArray(m.route) && m.route.length >= 6 && m.route.every((s) => STAGES.includes(s as Stage)), 'Process route must list valid stages', 'VALIDATION_FAILED');
    ctx.check('recipe-present', Array.isArray(m.recipe) && m.recipe.length >= 1, 'A mix recipe is required', 'VALIDATION_FAILED');
    const total = (m.recipe ?? []).reduce((s, r) => s + Number(r.pct), 0);
    ctx.check('recipe-sums-100', Math.abs(total - 100) < 0.01, `Recipe percentages add up to ${total.toFixed(1)}%, must be 100%`, 'VALIDATION_FAILED');
    ctx.check('recipe-band', (m.recipe ?? []).every((r) => r.minPct <= r.pct && r.pct <= r.maxPct), 'Each component needs min ≤ % ≤ max', 'VALIDATION_FAILED');
    ctx.check('targets', Number(m.targetRealizationPct) > 0 && Number(m.targetRealizationPct) <= 100 && Number(m.targetWastePct) >= 0, 'Realization and waste targets must be valid percentages', 'VALIDATION_FAILED');
  } else if (type === 'ACCESSORIES') {
    const m = meta as unknown as AccessoriesMeta;
    for (const k of ['packageType', 'coneType', 'cartonType', 'polybag', 'strapping', 'labelTemplate', 'palletWrap', 'travellerType', 'travellerNo', 'clearerClass'] as const)
      ctx.check(`meta:${k}`, !!String((m as unknown as Record<string, unknown>)[k] ?? '').trim(), `${k} is required`, 'VALIDATION_FAILED');
  } else if (type === 'COLOR') {
    const m = meta as unknown as ColorMeta;
    ctx.check('color-name', !!m.colorName?.trim() && !!m.tip?.trim() && !!m.code?.trim(), 'Colour name, tip description and code are required', 'VALIDATION_FAILED');
    ctx.check('color-hex', /^#[0-9a-fA-F]{6}$/.test(m.hex ?? ''), 'Colour must be a #rrggbb hex value', 'VALIDATION_FAILED');
  }
}

export const MasterContract: ContractModule = {
  name: 'Master',
  description: 'Versioned masters judged against by every result',
  functions: {
    createVersion: {
      key: 'Master.createVersion', description: 'Create a draft master version (blank or cloned)', rules: ['count-exists', 'type-valid', 'single-open-draft', 'clone-source-exists', 'clone-same-type'],
      async handler(ctx, args: { countId: string; masterType: MasterType; cloneFrom?: string | null; note?: string }) {
        ctx.check('count-exists', !!(await ctx.get('SELECT id FROM counts WHERE id=?', args.countId)), `Count ${args.countId} does not exist`, 'NOT_FOUND');
        ctx.check('type-valid', MASTER_TYPES.includes(args.masterType), `Unknown master type ${args.masterType}`, 'VALIDATION_FAILED');
        const open = await ctx.get<{ id: string }>(`SELECT id FROM master_versions WHERE count_id=? AND master_type=? AND status IN ('DRAFT','QA_APPROVED')`, args.countId, args.masterType);
        ctx.check('single-open-draft', !open, `A draft/approved version (${open?.id}) already exists for this master — activate or reject it first`, 'CONFLICT');
        const source = args.cloneFrom ? await versionOf(ctx, args.cloneFrom) : undefined;
        if (args.cloneFrom) { ctx.check('clone-source-exists', !!source, `Source version ${args.cloneFrom} does not exist`, 'NOT_FOUND'); ctx.check('clone-same-type', source?.master_type === args.masterType, 'Can only clone a master of the same type', 'VALIDATION_FAILED'); }
        const next = Number((await ctx.get<{ n: number }>('SELECT COALESCE(MAX(version_no),0)+1 AS n FROM master_versions WHERE count_id=? AND master_type=?', args.countId, args.masterType))?.n ?? 1);
        const id = `MV-${args.countId}-${args.masterType}-${next}`;
        const row = await ctx.insert('master_version', {
          id, master_type: args.masterType, count_id: args.countId, version_no: next, status: 'DRAFT', effective_from: null, effective_to: null, meta: source?.meta ?? '{}',
          note: args.note?.trim() || (source ? `Cloned from ${source.id}` : 'New master version'), created_by: ctx.actor.id, created_at: ctx.timestamp, approved_by: null, approved_at: null, activated_by: null, activated_at: null,
        });
        let copied = 0;
        if (source) {
          const items = await ctx.all<Record<string, unknown>>('SELECT * FROM master_items WHERE version_id=?', source.id);
          for (const it of items) {
            await ctx.insert('master_item', { id: `MI-${id}-${it.scope}-${it.parameter}`, version_id: id, master_type: args.masterType, count_id: args.countId, scope: it.scope, parameter: it.parameter, std: it.std, lower_limit: it.lower_limit, upper_limit: it.upper_limit, unit: it.unit, frequency: it.frequency, instrument: it.instrument, note: '' });
            copied += 1;
          }
        }
        ctx.setPayload({ versionId: id, countId: args.countId, masterType: args.masterType, versionNo: next, clonedFrom: source?.id ?? null, itemsCopied: copied });
        return row;
      },
    },
    upsertItems: {
      key: 'Master.upsertItems', description: 'Add or change items in a draft master version', rules: ['version-exists', 'version-is-draft', 'items-present', 'param-valid-for-scope', 'lower<=std<=upper'],
      async handler(ctx, args: { versionId: string; items: ItemInput[] }) {
        const v = await versionOf(ctx, args.versionId);
        ctx.check('version-exists', !!v, `Master version ${args.versionId} does not exist`, 'NOT_FOUND');
        ctx.check('version-is-draft', v?.status === 'DRAFT', `Only a DRAFT version can be edited (this one is ${v?.status})`, 'CONFLICT');
        ctx.check('items-present', Array.isArray(args.items) && args.items.length > 0 && args.items.length <= 600, 'Provide 1–600 items', 'VALIDATION_FAILED');
        const errors: string[] = [];
        args.items.forEach((it, i) => {
          const def = paramDef(it.parameter);
          if (!def) { errors.push(`row ${i + 1}: unknown parameter ${it.parameter}`); return; }
          const okScope = v!.master_type === 'COUNT_MIX' ? it.scope === 'MIX' && def.kind === 'FIBRE' : masterTypeOf(def.kind) === v!.master_type && def.stages.includes(it.scope as Stage);
          if (!okScope) { errors.push(`row ${i + 1}: ${it.parameter} is not a ${v!.master_type} parameter at ${it.scope}`); return; }
          const err = validateItem(it);
          if (err) errors.push(`row ${i + 1} (${it.scope} ${it.parameter}): ${err}`);
        });
        ctx.check('lower<=std<=upper', errors.length === 0, errors.slice(0, 5).join('; ') + (errors.length > 5 ? ` … (+${errors.length - 5} more)` : ''), 'VALIDATION_FAILED');
        let created = 0; let updated = 0;
        for (const it of args.items) {
          const id = `MI-${v!.id}-${it.scope}-${it.parameter}`;
          const patch = { std: Number(it.std), lower_limit: it.lower === undefined || it.lower === null || (it.lower as unknown) === '' ? null : Number(it.lower), upper_limit: it.upper === undefined || it.upper === null || (it.upper as unknown) === '' ? null : Number(it.upper), unit: it.unit ?? paramDef(it.parameter)?.unit ?? '', frequency: it.frequency ?? '', instrument: it.instrument ?? '', note: it.note ?? '' };
          const prev = await ctx.get<Record<string, unknown>>('SELECT * FROM master_items WHERE id=?', id);
          if (prev) { await ctx.update('master_item', id, { ...patch, unit: it.unit ?? prev.unit, frequency: it.frequency ?? prev.frequency, instrument: it.instrument ?? prev.instrument }); updated += 1; }
          else { await ctx.insert('master_item', { id, version_id: v!.id, master_type: v!.master_type, count_id: v!.count_id, scope: it.scope, parameter: it.parameter, ...patch }); created += 1; }
        }
        ctx.setPayload({ versionId: v!.id, created, updated, digest: args.items.map((i) => `${i.scope}.${i.parameter}=${i.std}[${i.lower ?? ''},${i.upper ?? ''}]`).slice(0, 40) });
        return { created, updated };
      },
    },
    upsertMeta: {
      key: 'Master.upsertMeta', description: 'Edit recipe / route / packing specification / colour of a draft version', rules: ['version-exists', 'version-is-draft', 'meta-valid'],
      async handler(ctx, args: { versionId: string; meta: Record<string, unknown> }) {
        const v = await versionOf(ctx, args.versionId);
        ctx.check('version-exists', !!v, `Master version ${args.versionId} does not exist`, 'NOT_FOUND');
        ctx.check('version-is-draft', v?.status === 'DRAFT', `Only a DRAFT version can be edited (this one is ${v?.status})`, 'CONFLICT');
        validateMeta(ctx, v!.master_type, args.meta);
        const row = await ctx.update('master_version', v!.id, { meta: JSON.stringify(args.meta) });
        ctx.setPayload({ versionId: v!.id, meta: args.meta });
        return row;
      },
    },
    approve: {
      key: 'Master.approve', description: 'QA approval of a draft version', rules: ['version-exists', 'status-draft', 'completeness>=90%', 'four-eyes-note'],
      async handler(ctx, args: { versionId: string; note?: string }) {
        const v = await versionOf(ctx, args.versionId);
        ctx.check('version-exists', !!v, `Master version ${args.versionId} does not exist`, 'NOT_FOUND');
        ctx.check('status-draft', v?.status === 'DRAFT', `Only a DRAFT version can be approved (this one is ${v?.status})`, 'CONFLICT');
        const count = await ctx.get<{ uses_comber: number }>('SELECT uses_comber FROM counts WHERE id=?', v!.count_id);
        const keys = new Set((await ctx.all<{ scope: string; parameter: string }>('SELECT scope,parameter FROM master_items WHERE version_id=?', v!.id)).map((i) => `${i.scope}|${i.parameter}`));
        const required = masterTemplate(!!count?.uses_comber).filter((t) => t.required && t.master === v!.master_type);
        if (required.length) {
          const missing = required.filter((t) => !keys.has(`${t.scope}|${t.key}`));
          const pct = ((required.length - missing.length) / required.length) * 100;
          ctx.check('completeness>=90%', pct >= 90, `Master is only ${pct.toFixed(1)}% complete (missing e.g. ${missing.slice(0, 4).map((m) => `${m.scope} ${m.key}`).join(', ')}) — complete it before approval`, 'VALIDATION_FAILED');
        }
        validateMeta(ctx, v!.master_type, JSON.parse(v!.meta) as Record<string, unknown>);
        if (v!.created_by === ctx.actor.id) ctx.note('four-eyes', 'Approved by the same user who created the draft — recorded for audit');
        const row = await ctx.update('master_version', v!.id, { status: 'QA_APPROVED', approved_by: ctx.actor.id, approved_at: ctx.timestamp, note: args.note?.trim() ? `${v!.note} · QA: ${args.note.trim()}` : v!.note });
        ctx.setPayload({ versionId: v!.id, approvedBy: ctx.actor.id });
        return row;
      },
    },
    reject: {
      key: 'Master.reject', description: 'Reject a draft / approved version', rules: ['version-exists', 'status-open', 'reason-required'],
      async handler(ctx, args: { versionId: string; reason: string }) {
        const v = await versionOf(ctx, args.versionId);
        ctx.check('version-exists', !!v, `Master version ${args.versionId} does not exist`, 'NOT_FOUND');
        ctx.check('status-open', v?.status === 'DRAFT' || v?.status === 'QA_APPROVED', `Cannot reject a ${v?.status} version`, 'CONFLICT');
        ctx.check('reason-required', String(args.reason ?? '').trim().length >= 5, 'A reason of at least 5 characters is required', 'VALIDATION_FAILED');
        const row = await ctx.update('master_version', v!.id, { status: 'REJECTED', note: `${v!.note} · Rejected: ${args.reason.trim()}` });
        ctx.setPayload({ versionId: v!.id, reason: args.reason.trim() });
        return row;
      },
    },
    activate: {
      key: 'Master.activate', description: 'Activate an approved version; the active one is superseded on the effective date', rules: ['version-exists', 'status-approved', 'effective-date-valid', 'supersede-active'],
      async handler(ctx, args: { versionId: string; effectiveFrom?: string }) {
        const v = await versionOf(ctx, args.versionId);
        ctx.check('version-exists', !!v, `Master version ${args.versionId} does not exist`, 'NOT_FOUND');
        ctx.check('status-approved', v?.status === 'QA_APPROVED', `Only a QA-approved version can be activated (this one is ${v?.status})`, 'CONFLICT');
        const date = args.effectiveFrom || today();
        ctx.check('effective-date-valid', /^\d{4}-\d{2}-\d{2}$/.test(date), 'Effective date must be YYYY-MM-DD', 'VALIDATION_FAILED');
        const active = await ctx.get<{ id: string; effective_from: string | null }>(`SELECT id,effective_from FROM master_versions WHERE count_id=? AND master_type=? AND status='ACTIVE'`, v!.count_id, v!.master_type);
        ctx.check('effective-date-valid', !active || !active.effective_from || date > active.effective_from, `Effective date must be after the current version's start (${active?.effective_from})`, 'VALIDATION_FAILED');
        if (active) await ctx.update('master_version', active.id, { status: 'SUPERSEDED', effective_to: date });
        const row = await ctx.update('master_version', v!.id, { status: 'ACTIVE', effective_from: date, effective_to: null, activated_by: ctx.actor.id, activated_at: ctx.timestamp });
        ctx.setPayload({ versionId: v!.id, effectiveFrom: date, supersedes: active?.id ?? null });
        ctx.notify({ severity: 'info', title: `Master activated: ${v!.master_type} v${v!.version_no} (${v!.count_id})`, body: `Effective ${date}${active ? `, supersedes ${active.id}` : ''}. Results are re-judged on the new version from that date.`, link: '/masters' });
        void MasterBook;
        return row;
      },
    },
  },
};
void PARAMS;
