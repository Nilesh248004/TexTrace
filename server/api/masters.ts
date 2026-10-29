// Masters section: versions, spreadsheet-style item editing, clone, CSV import/export, completeness, approval workflow, lens master.
import type { Router } from 'express';
import express from 'express';
import type { ApiCtx, AuthedRequest } from './common';
import { newRouter } from './common';
import { act, fail, notFound, ok, parseJson, qs } from './common';
import { MasterBook, validateItem } from '../domain/masters';
import { chainOf } from '../domain/lots';
import { COMPLAINT_TYPES, DEFAULT_LENS, MASTER_TYPES, PARAMS, STAGES, masterTemplate, masterTypeOf, paramDef, type MasterType, type Scope, type Stage } from '@shared/params';
import type { MasterItemDTO, MasterVersionDTO } from '@shared/domain';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => Number(v ?? 0);

function versionDto(v: Row, names: Map<string, string>, itemCount: number): MasterVersionDTO {
  return { id: str(v.id), masterType: v.master_type as MasterType, countId: str(v.count_id), versionNo: num(v.version_no), status: v.status as never, effectiveFrom: (v.effective_from as string) ?? null, effectiveTo: (v.effective_to as string) ?? null, meta: parseJson(v.meta, {}), note: str(v.note), createdBy: str(v.created_by), createdByName: names.get(str(v.created_by)) ?? str(v.created_by), createdAt: str(v.created_at), approvedBy: (v.approved_by as string) ?? null, approvedByName: v.approved_by ? names.get(str(v.approved_by)) ?? str(v.approved_by) : null, approvedAt: (v.approved_at as string) ?? null, activatedAt: (v.activated_at as string) ?? null, itemCount, chain: chainOf('master_version', v) };
}

/** Minimal RFC-4180 CSV parser (quotes, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; } else cell += ch;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
const csvCell = (v: unknown) => { const s = str(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function mastersRouter(c: ApiCtx): Router {
  const r = newRouter();
  const { db } = c;
  const names = async () => new Map((await db.prepare('SELECT id,name FROM users').all<Row>()).map((u) => [str(u.id), str(u.name)]));

  r.get('/masters/overview', async (_req, res) => {
    const book = await MasterBook.load(db);
    const [versions, counts, itemCounts, nm] = await Promise.all([db.prepare('SELECT * FROM master_versions ORDER BY count_id, master_type, version_no').all<Row>(), db.prepare('SELECT * FROM counts ORDER BY ne,id').all<Row>(), db.prepare('SELECT version_id v, COUNT(*) n FROM master_items GROUP BY version_id').all<Row>(), names()]);
    const nOf = new Map(itemCounts.map((x) => [str(x.v), num(x.n)]));
    ok(res, {
      types: MASTER_TYPES,
      counts: counts.map((cn) => ({ id: cn.id, display: cn.display, label: cn.label, usesComber: !!num(cn.uses_comber), completeness: book.completeness(str(cn.id)), versions: versions.filter((v) => v.count_id === cn.id).map((v) => versionDto(v, nm, nOf.get(str(v.id)) ?? 0)) })),
    });
  });
  r.get('/masters/versions/:id', async (req, res) => {
    const v = await db.prepare('SELECT * FROM master_versions WHERE id=?').get<Row>(req.params.id);
    if (!v) return notFound(res, 'Master version');
    const [items, siblings, count, nm] = await Promise.all([
      db.prepare('SELECT * FROM master_items WHERE version_id=?').all<Row>(str(v.id)),
      db.prepare('SELECT id,version_no FROM master_versions WHERE count_id=? AND master_type=? AND version_no<?  ORDER BY version_no DESC LIMIT 1').all<Row>(str(v.count_id), str(v.master_type), num(v.version_no)),
      db.prepare('SELECT uses_comber FROM counts WHERE id=?').get<Row>(str(v.count_id)), names(),
    ]);
    const prev = siblings[0] ? await db.prepare('SELECT scope,parameter,std,lower_limit,upper_limit FROM master_items WHERE version_id=?').all<Row>(str(siblings[0].id)) : [];
    const prevMap = new Map(prev.map((p) => [`${p.scope}|${p.parameter}`, p]));
    const type = v.master_type as MasterType;
    const have = new Map(items.map((i) => [`${i.scope}|${i.parameter}`, i]));
    const template = masterTemplate(!!num(count?.uses_comber)).filter((t) => t.master === type);
    const rows: (Omit<MasterItemDTO, 'id'> & { id: string | null; prev: { std: number; lower: number | null; upper: number | null } | null; missing: boolean; chain?: unknown })[] = [];
    for (const t of template) {
      const it = have.get(`${t.scope}|${t.key}`); const def = paramDef(t.key); const p = prevMap.get(`${t.scope}|${t.key}`);
      rows.push({ id: it ? str(it.id) : null, versionId: str(v.id), scope: t.scope, parameter: t.key, label: def?.label ?? t.key, unit: str(it?.unit) || def?.unit || '', std: it ? num(it.std) : (null as unknown as number), lower: it ? (it.lower_limit === null ? null : num(it.lower_limit)) : null, upper: it ? (it.upper_limit === null ? null : num(it.upper_limit)) : null, frequency: str(it?.frequency), instrument: str(it?.instrument), note: str(it?.note), required: t.required, missing: !it, prev: p ? { std: num(p.std), lower: p.lower_limit === null ? null : num(p.lower_limit), upper: p.upper_limit === null ? null : num(p.upper_limit) } : null, chain: it ? chainOf('master_item', it) : undefined });
    }
    const book = await MasterBook.load(db);
    ok(res, { version: versionDto(v, nm, items.length), items: rows, previousVersionNo: siblings[0] ? num(siblings[0].version_no) : null, completeness: book.completeness(str(v.count_id)), editable: v.status === 'DRAFT' });
  });
  r.post('/masters/versions', async (req: AuthedRequest, res) => act(c, req, res, { action: 'master.create-version', label: `Create ${str(req.body?.masterType)} master version for ${str(req.body?.countId)}`, created: true, run: (x) => x.call('Master.createVersion', req.body) }));
  r.put('/masters/versions/:id/items', async (req: AuthedRequest, res) => act(c, req, res, { action: 'master.upsert-items', label: `Edit master items of ${req.params.id}`, body: { versionId: req.params.id, items: req.body?.items }, run: (x) => x.call('Master.upsertItems', { versionId: req.params.id, items: req.body?.items }) }));
  r.put('/masters/versions/:id/meta', async (req: AuthedRequest, res) => act(c, req, res, { action: 'master.upsert-meta', label: `Edit master recipe/spec of ${req.params.id}`, body: { versionId: req.params.id, meta: req.body?.meta }, run: (x) => x.call('Master.upsertMeta', { versionId: req.params.id, meta: req.body?.meta }) }));
  r.post('/masters/versions/:id/approve', async (req: AuthedRequest, res) => act(c, req, res, { action: 'master.approve', label: `QA approval of ${req.params.id}`, body: { versionId: req.params.id, ...req.body }, run: (x) => x.call('Master.approve', { versionId: req.params.id, note: req.body?.note }) }));
  r.post('/masters/versions/:id/reject', async (req: AuthedRequest, res) => act(c, req, res, { action: 'master.reject', label: `Reject master version ${req.params.id}`, body: { versionId: req.params.id, ...req.body }, run: (x) => x.call('Master.reject', { versionId: req.params.id, reason: req.body?.reason }) }));
  r.post('/masters/versions/:id/activate', async (req: AuthedRequest, res) => act(c, req, res, { action: 'master.activate', label: `Activate master version ${req.params.id}`, body: { versionId: req.params.id, ...req.body }, run: (x) => x.call('Master.activate', { versionId: req.params.id, effectiveFrom: req.body?.effectiveFrom }) }));
  r.post('/masters/versions/:id/approve-activate', async (req: AuthedRequest, res) => act(c, req, res, { action: 'master.approve-activate', label: `Approve & activate master version ${req.params.id}`, body: { versionId: req.params.id, ...req.body }, run: async (x) => { await x.call('Master.approve', { versionId: req.params.id, note: req.body?.note }); return x.call('Master.activate', { versionId: req.params.id, effectiveFrom: req.body?.effectiveFrom }); } }));

  r.get('/masters/versions/:id/export', async (req, res) => {
    const v = await db.prepare('SELECT * FROM master_versions WHERE id=?').get<Row>(req.params.id);
    if (!v) return notFound(res, 'Master version');
    const items = await db.prepare('SELECT * FROM master_items WHERE version_id=?').all<Row>(str(v.id));
    const order = (i: Row) => STAGES.indexOf(str(i.scope) as Stage) * 1000 + PARAMS.findIndex((p) => p.key === i.parameter);
    const lines = ['scope,parameter,label,unit,std,lower,upper,frequency,instrument,note', ...items.sort((a, b) => order(a) - order(b)).map((i) => [i.scope, i.parameter, paramDef(str(i.parameter))?.label, i.unit, i.std, i.lower_limit ?? '', i.upper_limit ?? '', i.frequency, i.instrument, i.note].map(csvCell).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${str(v.id)}.csv"`); res.send(lines.join('\n'));
  });
  r.post('/masters/versions/:id/import', async (req: AuthedRequest, res) => {
    const v = await db.prepare('SELECT * FROM master_versions WHERE id=?').get<Row>(req.params.id);
    if (!v) return notFound(res, 'Master version');
    const rows = parseCsv(String(req.body?.csv ?? ''));
    if (rows.length < 2) return fail(res, 422, 'VALIDATION_FAILED', 'The CSV needs a header row and at least one data row');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (n: string) => head.indexOf(n);
    for (const need of ['scope', 'parameter', 'std']) if (col(need) < 0) return fail(res, 422, 'VALIDATION_FAILED', `Missing column "${need}". Expected: scope,parameter,std,lower,upper[,unit,frequency,instrument,note]`);
    const type = v.master_type as MasterType; const errors: string[] = [];
    const items = rows.slice(1).map((cells, i) => {
      const get = (n: string) => (col(n) >= 0 ? (cells[col(n)] ?? '').trim() : '');
      const scope = get('scope') as Scope; const parameter = get('parameter'); const def = paramDef(parameter);
      const lower = get('lower') === '' ? null : Number(get('lower')); const upper = get('upper') === '' ? null : Number(get('upper')); const std = Number(get('std'));
      if (!def) errors.push(`line ${i + 2}: unknown parameter "${parameter}"`);
      else if (!(type === 'COUNT_MIX' ? scope === 'MIX' && def.kind === 'FIBRE' : masterTypeOf(def.kind) === type && def.stages.includes(scope as Stage))) errors.push(`line ${i + 2}: ${parameter} at ${scope} does not belong to a ${type} master`);
      const e = validateItem({ std: get('std') === '' ? null : std, lower, upper }); if (e) errors.push(`line ${i + 2} (${scope} ${parameter}): ${e}`);
      return { scope, parameter, std, lower, upper, unit: get('unit') || undefined, frequency: get('frequency') || undefined, instrument: get('instrument') || undefined, note: get('note') || undefined };
    });
    if (req.query.dryRun === '1' || errors.length) return ok(res, { ok: errors.length === 0, rows: items.length, errors });
    await act(c, req, res, { action: 'master.import', label: `Import ${items.length} master items into ${req.params.id}`, body: { versionId: req.params.id, rows: items.length }, run: (x) => x.call('Master.upsertItems', { versionId: req.params.id, items }) });
  });

  r.get('/masters/lens', async (_req, res) => {
    const rows = await db.prepare('SELECT * FROM complaint_lens').all<Row>();
    ok(res, COMPLAINT_TYPES.map((t) => { const row = rows.find((x) => x.complaint_type === t); return { complaintType: t, items: row ? parseJson(row.items, DEFAULT_LENS[t]) : DEFAULT_LENS[t], updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null, chain: row ? chainOf('lens', row) : null }; }));
  });
  r.put('/masters/lens/:type', async (req: AuthedRequest, res) => act(c, req, res, { action: 'master.lens', label: `Edit complaint lens for ${req.params.type}`, body: { complaintType: req.params.type, items: req.body?.items }, run: (x) => x.call('Quality.upsertLens', { complaintType: req.params.type, items: req.body?.items }) }));
  void qs;
  return r;
}
