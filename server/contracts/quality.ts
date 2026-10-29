// Quality contract: lab tests (judged against the master active on the test date), QA release / override, dispatch gate,
// complaints (register → investigate → conclude), AI analysis anchoring, complaint lens master.
import { COMPLAINT_TYPES, MACHINE_STAGES, PARAMS, DEFAULT_LENS, STAGES, type ComplaintStatus, type ComplaintType, type LensItem, type Stage } from '@shared/params';
import { evaluateGate } from '../domain/gate';
import { MasterBook } from '../domain/masters';
import { today } from '../lib/clock';
import { hashObject } from '../lib/hash';
import { sanitizeHtml } from '../lib/sanitize';
import type { ContractModule } from './types';

const isoOk = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const shiftOfIso = (iso: string) => { const h = new Date(Date.parse(iso) + 330 * 60_000).getUTCHours(); return h >= 6 && h < 14 ? 'A' : h >= 14 && h < 22 ? 'B' : 'C'; };

export const QualityContract: ContractModule = {
  name: 'Quality',
  description: 'Laboratory quality, QA release, complaints, AI analysis anchoring',
  functions: {
    recordTestResult: {
      key: 'Quality.recordTestResult', description: 'Record a lab test (judged against the active master)', rules: ['lot-exists', 'stage-testable', 'stage-started', 'machine-in-department', 'values-keys', 'values-sane', 'time-valid'],
      async handler(ctx, args: { lotId: string; stage: Stage; machineId?: string | null; sampleType: 'LOT' | 'MACHINE'; pos?: string; testedAt?: string; values: Record<string, number>; instrument?: string; remarks?: string }) {
        const lot = await ctx.get<{ id: string; lot_no: string; count_id: string; status: string }>('SELECT id,lot_no,count_id,status FROM lots WHERE id=?', args.lotId);
        ctx.check('lot-exists', !!lot, `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        ctx.check('stage-testable', MACHINE_STAGES.includes(args.stage), `${args.stage} is not a testable department`, 'VALIDATION_FAILED');
        const started = await ctx.get<{ first: string | null }>('SELECT MIN(in_at) first FROM stage_runs WHERE lot_id=? AND stage=?', args.lotId, args.stage);
        ctx.check('stage-started', !!started?.first, `No ${args.stage} production run exists yet for lot ${lot?.lot_no}`, 'CONTRACT_REJECTED');
        if (args.sampleType === 'MACHINE') {
          const m = args.machineId ? await ctx.get<{ department: string }>('SELECT department FROM machines WHERE id=?', args.machineId) : undefined;
          ctx.check('machine-in-department', !!m && m.department === args.stage, 'A machine sample needs a machine of that department', 'VALIDATION_FAILED');
        } else ctx.check('machine-in-department', !args.machineId, 'A lot composite sample must not name a machine', 'VALIDATION_FAILED');
        const allowed = new Set(PARAMS.filter((p) => (p.kind === 'QUALITY' || p.kind === 'FIBRE') && p.stages.includes(args.stage)).map((p) => p.key));
        const keys = Object.keys(args.values ?? {});
        ctx.check('values-keys', keys.length > 0 && keys.every((k) => allowed.has(k)), `Values must be ${args.stage} test parameters (${[...allowed].slice(0, 8).join(', ')}…)`, 'VALIDATION_FAILED');
        ctx.check('values-sane', Object.values(args.values).every((v) => Number.isFinite(Number(v)) && Number(v) >= 0), 'Values must be non-negative numbers', 'VALIDATION_FAILED');
        const at = args.testedAt ?? ctx.timestamp;
        ctx.check('time-valid', isoOk(at) && Date.parse(at) <= Date.parse(ctx.timestamp) + 60_000 && Date.parse(at) >= Date.parse(started!.first as string) - 3600_000, 'Test time must be valid, not in the future and after the stage started', 'VALIDATION_FAILED');
        const book = await MasterBook.load(ctx.db);
        const machineLabel = args.machineId ? (await ctx.get<{ label: string }>('SELECT label FROM machines WHERE id=?', args.machineId))?.label : 'lot composite';
        const seq = Number((await ctx.get<{ n: number }>('SELECT COUNT(*)+1 n FROM test_results WHERE lot_id=? AND stage=? AND COALESCE(machine_id,\'\')=?', args.lotId, args.stage, args.machineId ?? ''))?.n ?? 1);
        const test = await ctx.insert('test_result', {
          id: await ctx.newId('TR'), sample_id: `S-${lot!.lot_no}-${(args.machineId ?? args.stage).replace('-', '')}${args.sampleType === 'LOT' ? '-LOT' : ''}-${shiftOfIso(at)}-${String(seq).padStart(2, '0')}`, lot_id: args.lotId, stage: args.stage, machine_id: args.machineId ?? null,
          sample_type: args.sampleType, pos: args.pos ?? null, test_date: new Date(Date.parse(at) + 330 * 60_000).toISOString().slice(0, 10), tested_at: at, shift: shiftOfIso(at), values_json: JSON.stringify(args.values),
          instrument: args.instrument ?? '', tested_by: ctx.actor.id, remarks: args.remarks ?? '', created_at: ctx.timestamp,
        });
        let lotRed = false;
        for (const [k, v] of Object.entries(args.values)) {
          const j = book.judge(lot!.count_id, 'QUALITY', args.stage, k, Number(v), String(test.test_date));
          if (j.color === 'red' || j.color === 'yellow') ctx.note(`tolerance:${args.stage}:${k}`, `${j.label} ${v} is ${j.color.toUpperCase()} (master v${j.versionNo}: ${j.lower ?? '–'} … ${j.std} … ${j.upper ?? '–'}) — flagged`);
          if (j.color === 'red') {
            if (args.sampleType === 'LOT') lotRed = true;
            ctx.notify({ severity: args.sampleType === 'LOT' ? 'critical' : 'warning', title: `${j.label} out of limits (${machineLabel})`, body: `Lot ${lot?.lot_no}: ${v} vs master ${j.lower ?? '–'}…${j.upper ?? '–'}${args.sampleType === 'LOT' ? ' — release hold' : ''}`, link: `/lots/${lot?.id}` });
          }
        }
        if (lotRed && ['IN_PRODUCTION', 'PACKED'].includes(lot!.status)) await ctx.update('lot', lot!.id, { status: 'ON_HOLD' });
        ctx.setPayload({ testResultId: test.id, lotId: args.lotId, stage: args.stage, machineId: args.machineId ?? null, sampleType: args.sampleType, values: args.values });
        return test;
      },
    },
    releaseLot: {
      key: 'Quality.releaseLot', description: 'QA release of a packed lot for dispatch', rules: ['lot-exists', 'lot-packed', 'not-released', 'composite-tested', 'no-open-red'],
      async handler(ctx, args: { lotId: string; note?: string }) {
        const lot = await ctx.get<{ id: string; lot_no: string; status: string; qa_release_at: string | null }>('SELECT id,lot_no,status,qa_release_at FROM lots WHERE id=?', args.lotId);
        ctx.check('lot-exists', !!lot, `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        ctx.check('lot-packed', ['PACKED', 'ON_HOLD'].includes(lot!.status) && !!(await ctx.get('SELECT id FROM packing WHERE lot_id=?', lot!.id)), `Lot ${lot?.lot_no} must be packed before QA release`, 'CONFLICT');
        ctx.check('not-released', !lot!.qa_release_at, `Lot ${lot?.lot_no} is already released`, 'CONFLICT');
        const composite = await ctx.get<{ n: number }>(`SELECT COUNT(*) n FROM test_results WHERE lot_id=? AND sample_type='LOT'`, lot!.id);
        ctx.check('composite-tested', Number(composite?.n) > 0, 'A lot composite test is required for release', 'CONTRACT_REJECTED');
        const gate = await evaluateGate(ctx.db, [lot!.id], ctx.timestamp);
        ctx.check('no-open-red', gate.passed, gate.message + ' Record a QA override with a reason to release.', 'CONTRACT_REJECTED');
        const row = await ctx.update('lot', lot!.id, { qa_release_at: ctx.timestamp, qa_release_by: ctx.actor.id, status: lot!.status === 'ON_HOLD' ? 'PACKED' : lot!.status });
        ctx.setPayload({ lotId: lot!.id, releasedBy: ctx.actor.id, note: args.note ?? '' });
        return row;
      },
    },
    recordOverride: {
      key: 'Quality.recordOverride', description: 'QA override for a lot with red lot-level results', rules: ['lot-exists', 'reason-required'],
      async handler(ctx, args: { lotId: string; reason: string }) {
        ctx.check('lot-exists', !!(await ctx.get('SELECT id FROM lots WHERE id=?', args.lotId)), `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        ctx.check('reason-required', String(args.reason ?? '').trim().length >= 15, 'A reason of at least 15 characters is required', 'VALIDATION_FAILED');
        const row = await ctx.insert('qa_override', { id: await ctx.newId('OVR', 4), lot_id: args.lotId, reason: args.reason.trim(), approved_by: ctx.actor.id, created_at: ctx.timestamp });
        ctx.setPayload({ overrideId: row.id, lotId: args.lotId, reason: args.reason.trim() });
        return row;
      },
    },
    evaluateGate: {
      key: 'Quality.evaluateGate', description: 'Evaluate the dispatch quality gate', rules: ['lots-present', 'lot-exists'],
      async handler(ctx, args: { lotIds: string[] }) {
        ctx.check('lots-present', Array.isArray(args.lotIds) && args.lotIds.length > 0, 'Select at least one lot', 'VALIDATION_FAILED');
        const result = await evaluateGate(ctx.db, args.lotIds, ctx.timestamp);
        ctx.check('lot-exists', result.lots.length === args.lotIds.length, 'One or more lots do not exist', 'NOT_FOUND');
        ctx.setPayload({ lotIds: args.lotIds, passed: result.passed, blocked: result.lots.filter((l) => l.blocked).map((l) => l.lotId) });
        return result;
      },
    },
    registerComplaint: {
      key: 'Quality.registerComplaint', description: 'Register a customer complaint', rules: ['customer-exists', 'own-customer', 'lot-exists', 'lot-dispatched-to-customer', 'type-valid', 'description-length', 'document-exists'],
      async handler(ctx, args: { customerId?: string; lotId: string; type: ComplaintType; description: string; complainantName?: string; documentId?: string | null; source?: 'PORTAL' | 'MILL' }) {
        const user = await ctx.get<{ customer_id: string | null; name: string; title: string }>('SELECT customer_id,name,title FROM users WHERE id=?', ctx.actor.id);
        const customerId = ctx.actor.role === 'BUYER' ? user?.customer_id ?? '' : args.customerId ?? '';
        const customer = await ctx.get<{ id: string; name: string; contact_name: string }>('SELECT id,name,contact_name FROM customers WHERE id=?', customerId);
        ctx.check('customer-exists', !!customer, `Customer ${customerId || '(none)'} does not exist`, 'NOT_FOUND');
        ctx.check('own-customer', ctx.actor.role !== 'BUYER' || !args.customerId || args.customerId === customerId, 'Customers can only report problems for their own lots', 'PERMISSION_DENIED');
        const lot = await ctx.get<{ id: string; lot_no: string }>('SELECT id,lot_no FROM lots WHERE id=? OR lot_no=?', args.lotId, args.lotId);
        ctx.check('lot-exists', !!lot, `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        const dispatch = await ctx.get<{ id: string; dispatch_no: string }>(`SELECT d.id,d.dispatch_no FROM dispatches d JOIN dispatch_lots dl ON dl.dispatch_id=d.id WHERE d.customer_id=? AND dl.lot_id=? ORDER BY d.dispatched_at DESC LIMIT 1`, customerId, lot!.id);
        ctx.check('lot-dispatched-to-customer', !!dispatch, `Lot ${lot?.lot_no} was never dispatched to ${customer?.name}`, 'CONTRACT_REJECTED');
        ctx.check('type-valid', COMPLAINT_TYPES.includes(args.type), `Complaint type ${args.type} is invalid`, 'VALIDATION_FAILED');
        ctx.check('description-length', String(args.description ?? '').trim().length >= 10, 'Please describe the problem (at least 10 characters)', 'VALIDATION_FAILED');
        if (args.documentId) ctx.check('document-exists', !!(await ctx.get('SELECT id FROM documents WHERE id=?', args.documentId)), `Document ${args.documentId} does not exist`, 'NOT_FOUND');
        const received = today();
        const year = Number(received.slice(0, 4));
        const seq = await ctx.nextSeq(`complaint:${year}`);
        const id = `CMP-${seq}-${year}`;
        const complainant = args.complainantName?.trim() || (ctx.actor.role === 'BUYER' ? `${user?.name} (${customer?.name})` : `${customer?.contact_name} (${customer?.name})`);
        const row = await ctx.insert('complaint', { id, complaint_no: `${seq}/${year}`, seq, year, complainant_name: complainant, type: args.type, source: ctx.actor.role === 'BUYER' ? 'PORTAL' : (args.source ?? 'MILL'), customer_id: customerId, lot_id: lot!.id, dispatch_id: dispatch!.id, description: args.description.trim(), document_id: args.documentId ?? null, status: 'OPEN', received_date: received, created_by: ctx.actor.id, created_at: ctx.timestamp, updated_at: ctx.timestamp });
        if (args.documentId) await ctx.update('document', args.documentId, { ref_type: 'complaint', ref_id: id });
        await ctx.insert('complaint_event', { id: await ctx.newId('CE'), complaint_id: id, from_status: null, to_status: 'OPEN', note: 'Complaint registered on ledger', by_user_id: ctx.actor.id, at: ctx.timestamp });
        const repeat = Number((await ctx.get<{ n: number }>(`SELECT COUNT(*) n FROM complaints WHERE customer_id=? AND type=? AND id<>?`, customerId, args.type, id))?.n ?? 0);
        ctx.setPayload({ complaintId: id, complaintNo: `${seq}/${year}`, customerId, lotId: lot!.id, dispatchId: dispatch!.id, type: args.type, repeatOfSameType: repeat });
        ctx.notify({ severity: repeat > 0 ? 'critical' : 'warning', title: `New complaint ${seq}/${year}${repeat > 0 ? ' — REPEAT' : ''}`, body: `${customer?.name}, lot ${lot?.lot_no}, ${args.type}${repeat > 0 ? ` (${repeat} earlier ${args.type} complaint(s) from this customer)` : ''}`, link: `/complaints/${id}` });
        return row;
      },
    },
    transitionComplaint: {
      key: 'Quality.transitionComplaint', description: 'Change complaint workflow status', rules: ['complaint-exists', 'no-direct-close', 'transition-allowed', 'reopen-role', 'note-required'],
      async handler(ctx, args: { complaintId: string; to: ComplaintStatus; note: string }) {
        const c = await ctx.get<{ id: string; status: ComplaintStatus; complaint_no: string }>('SELECT id,status,complaint_no FROM complaints WHERE id=?', args.complaintId);
        ctx.check('complaint-exists', !!c, `Complaint ${args.complaintId} does not exist`, 'NOT_FOUND');
        ctx.check('no-direct-close', args.to !== 'RESOLVED', 'Use Close with conclusion (Quality.recordConclusion)', 'CONTRACT_REJECTED');
        const allowed = (c!.status === 'OPEN' && args.to === 'UNDER_ANALYSIS') || (c!.status === 'UNDER_ANALYSIS' && args.to === 'OPEN') || (c!.status === 'RESOLVED' && args.to === 'UNDER_ANALYSIS');
        ctx.check('transition-allowed', allowed, `Cannot move complaint from ${c!.status} to ${args.to}`, 'CONTRACT_REJECTED');
        if (c!.status === 'RESOLVED') ctx.check('reopen-role', ['ADMIN', 'QA'].includes(ctx.actor.role), 'Only ADMIN or QA may reopen a closed complaint', 'PERMISSION_DENIED');
        ctx.check('note-required', String(args.note ?? '').trim().length > 0, 'A note is required', 'VALIDATION_FAILED');
        const row = await ctx.update('complaint', c!.id, { status: args.to, updated_at: ctx.timestamp });
        await ctx.insert('complaint_event', { id: await ctx.newId('CE'), complaint_id: c!.id, from_status: c!.status, to_status: args.to, note: args.note.trim(), by_user_id: ctx.actor.id, at: ctx.timestamp });
        ctx.setPayload({ complaintId: c!.id, from: c!.status, to: args.to, note: args.note.trim() });
        return row;
      },
    },
    recordConclusion: {
      key: 'Quality.recordConclusion', description: 'Manual QA conclusion; closes the complaint', rules: ['complaint-exists', 'status-in-progress', 'not-concluded', 'fields-required', 'analysis-belongs'],
      async handler(ctx, args: { complaintId: string; conclusionHtml: string; rootCause: string; correctiveAction: string; preventiveAction: string; customerReply: string; analysisId?: string | null }) {
        const c = await ctx.get<{ id: string; status: ComplaintStatus; complaint_no: string; lot_id: string }>('SELECT id,status,complaint_no,lot_id FROM complaints WHERE id=?', args.complaintId);
        ctx.check('complaint-exists', !!c, `Complaint ${args.complaintId} does not exist`, 'NOT_FOUND');
        ctx.check('status-in-progress', c!.status === 'UNDER_ANALYSIS', 'The complaint must be In progress before it can be closed', 'CONTRACT_REJECTED');
        ctx.check('not-concluded', !(await ctx.get('SELECT id FROM conclusions WHERE complaint_id=?', c!.id)), 'Complaint already has a conclusion', 'CONFLICT');
        const html = sanitizeHtml(args.conclusionHtml ?? '');
        const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        ctx.check('fields-required', text.length >= 20 && args.rootCause?.trim().length >= 10 && args.correctiveAction?.trim().length >= 10 && args.preventiveAction?.trim().length >= 10 && args.customerReply?.trim().length >= 20, 'Conclusion, root cause, corrective action, preventive action and customer reply are required', 'VALIDATION_FAILED');
        if (args.analysisId) ctx.check('analysis-belongs', !!(await ctx.get('SELECT id FROM analyses WHERE id=? AND complaint_id=?', args.analysisId, c!.id)), 'Analysis does not belong to this complaint', 'VALIDATION_FAILED');
        const con = await ctx.insert('conclusion', { id: await ctx.newId('CON', 4), complaint_id: c!.id, analysis_id: args.analysisId ?? null, conclusion_html: html, root_cause: args.rootCause.trim(), corrective_action: args.correctiveAction.trim(), preventive_action: args.preventiveAction.trim(), customer_reply: args.customerReply.trim(), concluded_by: ctx.actor.id, concluded_at: ctx.timestamp });
        const row = await ctx.update('complaint', c!.id, { status: 'RESOLVED', updated_at: ctx.timestamp });
        await ctx.insert('complaint_event', { id: await ctx.newId('CE'), complaint_id: c!.id, from_status: c!.status, to_status: 'RESOLVED', note: `Closed by QA: ${args.rootCause.trim()}`, by_user_id: ctx.actor.id, at: ctx.timestamp });
        ctx.setPayload({ complaintId: c!.id, conclusionId: con.id, analysisId: args.analysisId ?? null, rootCause: args.rootCause.trim(), signedOffBy: ctx.actor.id });
        ctx.notify({ severity: 'info', title: `Complaint ${c!.complaint_no} closed`, body: args.rootCause.trim(), link: `/complaints/${c!.id}` });
        return { complaint: row, conclusion: con };
      },
    },
    anchorAnalysis: {
      key: 'Quality.anchorAnalysis', description: 'Anchor an analysis run and the digests of its evidence', rules: ['lot-exists', 'complaint-lot-match', 'comparison-limit', 'input-hash-format', 'output-hash'],
      async handler(ctx, args: { id: string; complaintId?: string | null; lotId: string; runNo: number; context: unknown; comparisonLotIds: string[]; result: unknown; inputHash: string; outputHash: string; llm: unknown }) {
        ctx.check('lot-exists', !!(await ctx.get('SELECT id FROM lots WHERE id=?', args.lotId)), `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        if (args.complaintId) {
          const c = await ctx.get<{ lot_id: string }>('SELECT lot_id FROM complaints WHERE id=?', args.complaintId);
          ctx.check('complaint-lot-match', !!c && c.lot_id === args.lotId, 'Complaint must belong to the analyzed lot', 'NOT_FOUND');
        }
        ctx.check('comparison-limit', Array.isArray(args.comparisonLotIds) && args.comparisonLotIds.length <= 25, 'At most 25 comparison lots', 'VALIDATION_FAILED');
        ctx.check('input-hash-format', /^[0-9a-f]{64}$/.test(args.inputHash), 'Input digest must be a SHA-256 hash', 'VALIDATION_FAILED');
        ctx.check('output-hash', hashObject(args.result) === args.outputHash, 'Output hash does not match the analysis result', 'VALIDATION_FAILED');
        const row = await ctx.insert('analysis', { id: args.id, complaint_id: args.complaintId ?? null, lot_id: args.lotId, run_no: args.runNo, context: JSON.stringify(args.context), comparison_lot_ids: JSON.stringify(args.comparisonLotIds), result: JSON.stringify(args.result), input_hash: args.inputHash, output_hash: args.outputHash, llm: JSON.stringify(args.llm), created_by: ctx.actor.id, created_at: ctx.timestamp });
        ctx.setPayload({ analysisId: args.id, complaintId: args.complaintId ?? null, lotId: args.lotId, runNo: args.runNo, inputHash: args.inputHash, outputHash: args.outputHash, engineVersion: (args.result as { engineVersion?: string })?.engineVersion ?? 'stat-2.0' });
        return row;
      },
    },
    upsertLens: {
      key: 'Quality.upsertLens', description: 'Edit the Complaint-Type → Relevant-Parameters mapping', rules: ['type-valid', 'items-valid'],
      async handler(ctx, args: { complaintType: ComplaintType; items: LensItem[] }) {
        ctx.check('type-valid', COMPLAINT_TYPES.includes(args.complaintType), `Unknown complaint type ${args.complaintType}`, 'VALIDATION_FAILED');
        const bad = (args.items ?? []).filter((i) => !STAGES.includes(i.stage) || !(PARAMS.some((p) => p.key === i.key && p.stages.includes(i.stage))) || !(Number(i.weight) >= 0 && Number(i.weight) <= 5));
        ctx.check('items-valid', Array.isArray(args.items) && args.items.length > 0 && bad.length === 0, bad.length ? `Invalid mapping: ${bad.slice(0, 3).map((b) => `${b.stage}.${b.key}`).join(', ')}` : 'At least one parameter is required', 'VALIDATION_FAILED');
        const id = `LENS-${args.complaintType}`;
        const prev = await ctx.get('SELECT id FROM complaint_lens WHERE id=?', id);
        const items = JSON.stringify(args.items.map((i) => ({ stage: i.stage, key: i.key, weight: Number(i.weight), why: i.why ?? '' })));
        const row = prev ? await ctx.update('lens', id, { items, updated_by: ctx.actor.id, updated_at: ctx.timestamp }) : await ctx.insert('lens', { id, complaint_type: args.complaintType, items, updated_by: ctx.actor.id, updated_at: ctx.timestamp });
        ctx.setPayload({ lensId: id, params: args.items.map((i) => `${i.stage}.${i.key}×${i.weight}`) });
        return row;
      },
    },
  },
};
void DEFAULT_LENS;
