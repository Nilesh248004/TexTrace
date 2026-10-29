// Complaints: intake, investigation workspace (full trace + AI analysis), conclusion, documents.
import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';
import express from 'express';
import multer from 'multer';
import type { ApiCtx, AuthedRequest } from './common';
import { newRouter } from './common';
import { act, fail, notFound, ok, parseJson, qs } from './common';
import { config } from '../config';
import { createHash } from 'node:crypto';
import { hashObject } from '../lib/hash';
import { nowIso } from '../lib/clock';
import { peekSeq } from '../db';
import { buildPassport, chainOf } from '../domain/lots';
import { runEngine } from '../analysis/engine';
import { narrate } from '../analysis/narrative';
import { DEFAULT_LENS, COMPLAINT_TYPE_LABEL, type ComplaintType } from '@shared/params';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => cb(null, /^(image\/(png|jpe?g|webp|gif|svg\+xml)|application\/pdf)$/.test(file.mimetype)) });

export async function complaintRow(c: ApiCtx, key: string): Promise<Row | undefined> {
  return c.db.prepare(`SELECT cp.*, cu.name customer_name, l.lot_no, l.lot_code, l.count_id, u.name created_by_name FROM complaints cp JOIN customers cu ON cu.id=cp.customer_id JOIN lots l ON l.id=cp.lot_id JOIN users u ON u.id=cp.created_by WHERE cp.id=? OR cp.complaint_no=?`).get<Row>(key, key);
}
export const complaintDto = (x: Row, repeat: number) => ({ id: x.id, complaintNo: x.complaint_no, type: x.type, typeLabel: COMPLAINT_TYPE_LABEL[x.type as ComplaintType] ?? x.type, source: x.source, status: x.status, customerId: x.customer_id, customerName: x.customer_name, lotId: x.lot_id, lotNo: x.lot_no, countId: x.count_id, dispatchId: x.dispatch_id, description: x.description, receivedDate: x.received_date, createdAt: x.created_at, updatedAt: x.updated_at, complainant: x.complainant_name, createdByName: x.created_by_name, documentId: x.document_id, repeatCount: repeat, chain: chainOf('complaint', x) });

export async function saveAnalysis(c: ApiCtx, req: AuthedRequest, x: import('../contracts/types').ActionExecutor, input: { lotId: string; complaintId?: string | null; comparisonLotIds?: string[]; mode?: 'asOf' | 'latest'; focus?: { stage?: never; machineId?: string; parameter?: string } | null }) {
  const now = nowIso();
  const base = await runEngine(c.db, { lotKey: input.lotId, complaintId: input.complaintId ?? null, comparisonLotIds: input.comparisonLotIds, mode: input.mode, focus: input.focus as never }, now);
  if (!base) return null;
  const { result, llm } = await narrate(base);
  const runNo = Number((await c.db.prepare('SELECT COALESCE(MAX(run_no),0)+1 AS n FROM analyses WHERE lot_id=? AND ((? IS NULL AND complaint_id IS NULL) OR complaint_id=?)').get<{ n: number }>(result.lot.id, input.complaintId ?? null, input.complaintId ?? null))?.n ?? 1);
  const id = `AN-${String(runNo).padStart(4, '0')}-${result.lot.lotNo}`;
  const inputHash = hashObject({ lot: result.lot.id, complaint: input.complaintId ?? null, mode: result.mode, lens: result.lens, reference: result.referenceLots.map((r) => r.lotId), observations: result.parameters.map((p) => [p.stage, p.key, p.machineId, p.value, p.color]) });
  const outputHash = hashObject(result);
  const row = await x.call<Row>('Quality.anchorAnalysis', { id, complaintId: input.complaintId ?? null, lotId: result.lot.id, runNo, context: { mode: result.mode, focus: input.focus ?? null }, comparisonLotIds: result.referenceLots.map((r) => r.lotId), result, inputHash, outputHash, llm });
  if (input.complaintId) {
    const cp = await c.db.prepare('SELECT status FROM complaints WHERE id=?').get<{ status: string }>(input.complaintId);
    if (cp?.status === 'OPEN') await x.call('Quality.transitionComplaint', { complaintId: input.complaintId, to: 'UNDER_ANALYSIS', note: `AI evidence analysis ${id} completed — QA review required.` });
  }
  return { id, runNo, result, llm, row };
}
const analysisDto = (a: Row) => ({ id: a.id, complaintId: a.complaint_id, lotId: a.lot_id, runNo: a.run_no, result: parseJson(a.result, null), llm: parseJson(a.llm, null), context: parseJson(a.context, {}), inputHash: a.input_hash, outputHash: a.output_hash, createdBy: a.created_by, createdAt: a.created_at, chain: chainOf('analysis', a) });

export function complaintsRouter(c: ApiCtx): Router {
  const r = newRouter();
  const { db } = c;
  r.get('/complaints/next-number', async (_req, res) => { const year = Number(nowIso().slice(0, 4)); const seq = await peekSeq(db, `complaint:${year}`); ok(res, { complaintNo: `${seq}/${year}`, seq, year }); });
  r.get('/complaints', async (req, res) => {
    const rows = await db.prepare(`SELECT cp.*, cu.name customer_name, l.lot_no, l.lot_code, l.count_id, u.name created_by_name FROM complaints cp JOIN customers cu ON cu.id=cp.customer_id JOIN lots l ON l.id=cp.lot_id JOIN users u ON u.id=cp.created_by ORDER BY cp.year DESC, cp.seq DESC`).all<Row>();
    const status = qs(req.query.status); const count = qs(req.query.count); const q = qs(req.query.q).toLowerCase(); const type = qs(req.query.type); const customer = qs(req.query.customer);
    const dto = rows.map((x) => complaintDto(x, rows.filter((o) => o.customer_id === x.customer_id && o.type === x.type && o.id !== x.id).length));
    ok(res, dto.filter((x) => (!status || status === 'ALL' || x.status === status) && (!count || count === 'ALL' || x.countId === count) && (!type || x.type === type) && (!customer || x.customerId === customer) && (!q || `${x.complaintNo} ${x.customerName} ${x.lotNo} ${x.typeLabel} ${x.description}`.toLowerCase().includes(q))));
  });
  r.post('/complaints', async (req: AuthedRequest, res) => act(c, req, res, { action: 'complaint.register', label: 'Register customer complaint', created: true, run: (x) => x.call('Quality.registerComplaint', req.body) }));
  r.get('/complaints/:id', async (req, res) => {
    const x = await complaintRow(c, req.params.id);
    if (!x) return notFound(res, 'Complaint');
    const id = str(x.id);
    const [events, analyses, conclusion, doc, same, byCount, lensRow, passport] = await Promise.all([
      db.prepare('SELECT ce.*, u.name by_name FROM complaint_events ce JOIN users u ON u.id=ce.by_user_id WHERE ce.complaint_id=? ORDER BY ce.at').all<Row>(id),
      db.prepare('SELECT * FROM analyses WHERE complaint_id=? ORDER BY created_at DESC').all<Row>(id),
      db.prepare('SELECT cn.*, u.name by_name FROM conclusions cn JOIN users u ON u.id=cn.concluded_by WHERE cn.complaint_id=?').get<Row>(id),
      x.document_id ? db.prepare('SELECT * FROM documents WHERE id=?').get<Row>(str(x.document_id)) : Promise.resolve(undefined),
      db.prepare(`SELECT cp.id, cp.complaint_no, cp.type, cp.status, cp.received_date, l.lot_no FROM complaints cp JOIN lots l ON l.id=cp.lot_id WHERE cp.customer_id=? AND cp.id<>? ORDER BY cp.received_date DESC`).all<Row>(str(x.customer_id), id),
      db.prepare(`SELECT cp.id, cp.complaint_no, cp.type, cp.status, cp.received_date, l.lot_no, cu.name customer_name FROM complaints cp JOIN lots l ON l.id=cp.lot_id JOIN customers cu ON cu.id=cp.customer_id WHERE l.count_id=? AND cp.id<>? ORDER BY cp.received_date DESC`).all<Row>(str(x.count_id), id),
      db.prepare('SELECT items FROM complaint_lens WHERE complaint_type=?').get<Row>(str(x.type)),
      buildPassport(db, str(x.lot_id), 'asOf', nowIso()),
    ]);
    const repeat = same.filter((s) => s.type === x.type);
    ok(res, {
      complaint: complaintDto(x, repeat.length), events: events.map((e) => ({ id: e.id, from: e.from_status, to: e.to_status, note: e.note, by: e.by_name, at: e.at, chain: chainOf('complaint_event', e) })),
      analyses: analyses.map(analysisDto), conclusion: conclusion ? { id: conclusion.id, html: conclusion.conclusion_html, rootCause: conclusion.root_cause, correctiveAction: conclusion.corrective_action, preventiveAction: conclusion.preventive_action, customerReply: conclusion.customer_reply, by: conclusion.by_name, at: conclusion.concluded_at, analysisId: conclusion.analysis_id, chain: chainOf('conclusion', conclusion) } : null,
      document: doc ? { id: doc.id, filename: doc.filename, mimeType: doc.mime_type, sizeBytes: doc.size_bytes, sha256: doc.sha256, url: `/api/documents/${doc.id}/file`, chain: chainOf('document', doc) } : null,
      history: { sameCustomer: same.map((s) => ({ id: s.id, complaintNo: s.complaint_no, type: s.type, typeLabel: COMPLAINT_TYPE_LABEL[s.type as ComplaintType], status: s.status, receivedDate: s.received_date, lotNo: s.lot_no })), sameCount: byCount.map((s) => ({ id: s.id, complaintNo: s.complaint_no, type: s.type, typeLabel: COMPLAINT_TYPE_LABEL[s.type as ComplaintType], status: s.status, receivedDate: s.received_date, lotNo: s.lot_no, customerName: s.customer_name })), repeatAlert: repeat.length > 0 ? `${str(x.customer_name)} has raised ${repeat.length} earlier ${COMPLAINT_TYPE_LABEL[x.type as ComplaintType]?.toLowerCase()} complaint${repeat.length > 1 ? 's' : ''} (${repeat.map((s) => s.complaint_no).join(', ')}).` : null },
      lens: lensRow ? parseJson(lensRow.items, DEFAULT_LENS[x.type as ComplaintType]) : DEFAULT_LENS[x.type as ComplaintType], passport,
    });
  });
  r.post('/complaints/:id/transition', async (req: AuthedRequest, res) => act(c, req, res, { action: 'complaint.transition', label: 'Update complaint status', body: { complaintId: req.params.id, ...req.body }, run: (x) => x.call('Quality.transitionComplaint', { ...req.body, complaintId: req.params.id }) }));
  r.post('/complaints/:id/conclusion', async (req: AuthedRequest, res) => act(c, req, res, { action: 'complaint.conclusion', label: 'Close complaint with QA conclusion', body: { complaintId: req.params.id, ...req.body }, run: (x) => x.call('Quality.recordConclusion', { ...req.body, complaintId: req.params.id }) }));

  r.get('/analysis/status', (_req, res) => ok(res, { llmEnabled: config.ai.enabled, provider: config.ai.enabled ? config.ai.provider : null, model: config.ai.enabled ? config.ai.model : null }));
  r.post('/analysis/run', async (req: AuthedRequest, res) => {
    const body = req.body as { lotId?: string; complaintId?: string | null; comparisonLotIds?: string[]; mode?: 'asOf' | 'latest'; focus?: never };
    let lotId = body.lotId ?? '';
    if (body.complaintId) { const cp = await db.prepare('SELECT lot_id FROM complaints WHERE id=? OR complaint_no=?').get<{ lot_id: string }>(body.complaintId, body.complaintId); if (!cp) return notFound(res, 'Complaint'); lotId = cp.lot_id; }
    if (!lotId) return fail(res, 422, 'VALIDATION_FAILED', 'lotId or complaintId is required');
    let out: Awaited<ReturnType<typeof saveAnalysis>> = null;
    const complaintId = body.complaintId ? str((await complaintRow(c, body.complaintId))?.id) : null;
    await act(c, req, res, { action: 'analysis.run', label: `Analyze lot ${lotId.replace('LOT-', '')}`, created: true, body: { ...body, lotId, complaintId }, run: async (x) => { out = await saveAnalysis(c, req, x, { lotId, complaintId, comparisonLotIds: body.comparisonLotIds, mode: body.mode, focus: body.focus }); if (!out) throw new Error('Lot not found'); return { id: out.id, runNo: out.runNo, result: out.result, llm: out.llm }; } });
  });
  r.get('/analysis', async (req, res) => {
    const rows = await db.prepare('SELECT * FROM analyses WHERE (?=\'\' OR complaint_id=?) AND (?=\'\' OR lot_id=?) ORDER BY created_at DESC LIMIT 100').all<Row>(qs(req.query.complaintId), qs(req.query.complaintId), qs(req.query.lotId), qs(req.query.lotId));
    ok(res, rows.map(analysisDto));
  });

  // ---------------------------------------------------------------- documents (photos / PDFs)
  r.post('/documents', upload.single('file'), async (req: AuthedRequest, res) => {
    const f = req.file;
    if (!f) return fail(res, 422, 'VALIDATION_FAILED', 'Attach a photo (PNG/JPG/WebP/SVG) or PDF up to 8 MB');
    const hash = createHash('sha256').update(f.buffer).digest('hex');
    const rel = path.join('uploads', `${hash.slice(0, 12)}-${f.originalname.replace(/[^\w.-]/g, '_')}`);
    const full = path.join(config.uploadsDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.buffer);
    await act(c, req, res, { action: 'document.anchor', label: `Anchor document ${f.originalname}`, created: true, body: { filename: f.originalname, sha256: hash, size: f.size }, run: (x) => x.call('AssetID.anchorDocument', { filename: f.originalname, mimeType: f.mimetype, sizeBytes: f.size, sha256: hash, storagePath: rel, refType: qs(req.body?.refType), refId: qs(req.body?.refId) }) });
  });
  r.get('/documents/:id/file', async (req: AuthedRequest, res) => {
    const d = await db.prepare('SELECT * FROM documents WHERE id=?').get<Row>(req.params.id);
    if (!d) return notFound(res, 'Document');
    if (req.actor?.role === 'BUYER') { const mine = await db.prepare('SELECT id FROM complaints WHERE document_id=? AND customer_id=?').get(req.params.id, req.actor.customerId); if (!mine && d.uploaded_by !== req.actor.id) return fail(res, 403, 'PERMISSION_DENIED', 'Not your document'); }
    const full = path.join(config.uploadsDir, str(d.storage_path));
    if (!full.startsWith(config.uploadsDir) || !fs.existsSync(full)) return notFound(res, 'File');
    res.setHeader('Content-Type', str(d.mime_type)); res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"); res.sendFile(full);
  });
  return r;
}
