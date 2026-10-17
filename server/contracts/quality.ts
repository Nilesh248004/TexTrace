import { COMPLAINT_TYPES, type ComplaintStatus, type ComplaintType } from '@shared/types';
import { paramsFor } from '@shared/params';
import { evaluate } from '@shared/quality';
import { hashObject } from '../lib/hash';
import { sanitizeHtml } from '../lib/sanitize';
import type { ContractModule } from './types';

interface ComplaintInput {
  complainantName: string; type: ComplaintType; customerId: string; lotId: string; description: string; documentId?: string | null; receivedDate?: string; seq?: number;
}

export const QualityContract: ContractModule = {
  name: 'Quality',
  description: 'Laboratory quality, standards, complaints, and release decisions',
  functions: {
    registerComplaint: {
      key: 'Quality.registerComplaint', description: 'Register a customer complaint', rules: ['customer-exists','lot-exists','lot-dispatched-to-customer','type-valid','description-length','complainant-required','received-date'],
      handler(ctx, args: ComplaintInput) {
        const customer = ctx.get<{ id: string; name: string }>('SELECT id,name FROM customers WHERE id=?', args.customerId);
        const lot = ctx.get<{ id: string; lot_no: string; lot_code: string }>('SELECT id,lot_no,lot_code FROM lots WHERE id=?', args.lotId);
        ctx.check('customer-exists', !!customer, `Customer ${args.customerId} does not exist`, 'NOT_FOUND');
        ctx.check('lot-exists', !!lot, `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        const dispatch = ctx.get<{ id: string; dispatch_date: string }>(`SELECT d.id,d.dispatch_date FROM dispatches d JOIN dispatch_lots dl ON dl.dispatch_id=d.id
          WHERE d.customer_id=? AND dl.lot_id=? ORDER BY d.dispatch_date DESC LIMIT 1`, args.customerId, args.lotId);
        ctx.check('lot-dispatched-to-customer', !!dispatch, `${lot?.lot_no ?? args.lotId} was never dispatched to ${customer?.name ?? args.customerId}`);
        ctx.check('type-valid', COMPLAINT_TYPES.includes(args.type), `Complaint type ${args.type} is invalid`, 'VALIDATION_FAILED');
        ctx.check('description-length', String(args.description ?? '').trim().length >= 10, 'Description must be at least 10 characters', 'VALIDATION_FAILED');
        ctx.check('complainant-required', String(args.complainantName ?? '').trim().length > 0, 'Complainant name is required', 'VALIDATION_FAILED');
        if (args.documentId) ctx.check('document-exists', !!ctx.get('SELECT id FROM documents WHERE id=?', args.documentId), `Document ${args.documentId} does not exist`, 'NOT_FOUND');
        const receivedDate = args.receivedDate ?? ctx.settings.businessDate;
        ctx.check('received-date', receivedDate >= (dispatch?.dispatch_date ?? '9999') && receivedDate <= ctx.settings.businessDate, 'Received date must be between dispatch date and business date', 'VALIDATION_FAILED');
        const year = Number(receivedDate.slice(0, 4));
        const seq = args.seq ?? ctx.nextSeq(`complaint:${year}`);
        if (args.seq) ctx.db.prepare(`INSERT INTO sequences(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=MAX(value,excluded.value)`).run(`complaint:${year}`, args.seq);
        const id = `CMP-${seq}-${year}`;
        const row = ctx.insert('complaint', { id, complaint_no: `${seq}/${year}`, seq, year, complainant_name: args.complainantName.trim(), type: args.type, customer_id: args.customerId, lot_id: args.lotId, dispatch_id: dispatch?.id ?? null, description: args.description.trim(), document_id: args.documentId ?? null, status: 'OPEN', received_date: receivedDate, created_by: ctx.actor.id, created_at: ctx.timestamp, updated_at: ctx.timestamp });
        ctx.insert('complaint_event', { id: ctx.newId('CE'), complaint_id: id, from_status: null, to_status: 'OPEN', note: 'Complaint registered on ledger', by_user_id: ctx.actor.id, at: ctx.timestamp });
        ctx.setPayload({ complaintId: id, complaintNo: `${seq}/${year}`, customerId: args.customerId, lotId: args.lotId, dispatchId: dispatch?.id ?? null });
        ctx.notify({ severity: 'warning', title: `New complaint ${seq}/${year}`, body: `${customer?.name ?? args.customerId}, lot ${lot?.lot_no ?? args.lotId}`, link: `/complaints/${id}` });
        return row;
      },
    },
    transitionComplaint: {
      key: 'Quality.transitionComplaint', description: 'Change complaint workflow status', rules: ['complaint-exists','transition-allowed','reopen-role','no-direct-resolve'],
      handler(ctx, args: { complaintId: string; to: ComplaintStatus; note: string }) {
        const complaint = ctx.get<{ id: string; status: ComplaintStatus; complaint_no: string }>('SELECT * FROM complaints WHERE id=?', args.complaintId);
        ctx.check('complaint-exists', !!complaint, `Complaint ${args.complaintId} does not exist`, 'NOT_FOUND');
        ctx.check('no-direct-resolve', args.to !== 'RESOLVED', 'Use Resolve & Close (Quality.recordConclusion)');
        const allowed = complaint?.status === 'OPEN' && args.to === 'UNDER_ANALYSIS' || complaint?.status === 'UNDER_ANALYSIS' && args.to === 'OPEN' || complaint?.status === 'RESOLVED' && args.to === 'UNDER_ANALYSIS';
        ctx.check('transition-allowed', allowed, `Cannot transition complaint from ${complaint?.status} to ${args.to}`);
        if (complaint?.status === 'RESOLVED') ctx.check('reopen-role', ['ADMIN','QA'].includes(ctx.actor.role), 'Only ADMIN or QA may reopen a resolved complaint', 'PERMISSION_DENIED');
        ctx.check('note-required', String(args.note ?? '').trim().length > 0, 'A transition note is required', 'VALIDATION_FAILED');
        const updated = ctx.update('complaint', args.complaintId, { status: args.to, updated_at: ctx.timestamp });
        ctx.insert('complaint_event', { id: ctx.newId('CE'), complaint_id: args.complaintId, from_status: complaint?.status, to_status: args.to, note: args.note.trim(), by_user_id: ctx.actor.id, at: ctx.timestamp });
        ctx.setPayload({ complaintId: args.complaintId, from: complaint?.status, to: args.to, note: args.note });
        return updated;
      },
    },
    recordConclusion: {
      key: 'Quality.recordConclusion', description: 'Record manual QA conclusion and resolve complaint', rules: ['complaint-exists','status-under-analysis','not-concluded','fields-required','analysis-belongs'],
      handler(ctx, args: { complaintId: string; conclusionHtml: string; rootCause: string; correctiveAction: string; preventiveAction: string; analysisId?: string | null }) {
        const complaint = ctx.get<{ id: string; status: ComplaintStatus; complaint_no: string; lot_id: string }>('SELECT * FROM complaints WHERE id=?', args.complaintId);
        ctx.check('complaint-exists', !!complaint, `Complaint ${args.complaintId} does not exist`, 'NOT_FOUND');
        ctx.check('status-under-analysis', complaint?.status === 'UNDER_ANALYSIS', 'Complaint must be Under Analysis before it can be closed');
        ctx.check('not-concluded', !ctx.get('SELECT id FROM conclusions WHERE complaint_id=?', args.complaintId), 'Complaint already has a conclusion');
        const html = sanitizeHtml(args.conclusionHtml ?? '');
        const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        ctx.check('fields-required', text.length >= 20 && args.rootCause.trim().length >= 10 && args.correctiveAction.trim().length >= 10 && args.preventiveAction.trim().length >= 10, 'Conclusion, root cause, corrective action, and preventive action must be complete', 'VALIDATION_FAILED');
        if (args.analysisId) ctx.check('analysis-belongs', !!ctx.get('SELECT id FROM analyses WHERE id=? AND complaint_id=? AND lot_id=?', args.analysisId, args.complaintId, complaint?.lot_id), 'Analysis does not belong to this complaint and lot');
        const conclusion = ctx.insert('conclusion', { id: ctx.newId('CON'), complaint_id: args.complaintId, analysis_id: args.analysisId ?? null, conclusion_html: html, root_cause: args.rootCause.trim(), corrective_action: args.correctiveAction.trim(), preventive_action: args.preventiveAction.trim(), concluded_by: ctx.actor.id, concluded_at: ctx.timestamp });
        const updated = ctx.update('complaint', args.complaintId, { status: 'RESOLVED', updated_at: ctx.timestamp });
        ctx.insert('complaint_event', { id: ctx.newId('CE'), complaint_id: args.complaintId, from_status: complaint?.status, to_status: 'RESOLVED', note: `Resolved & closed: ${args.rootCause.trim()}`, by_user_id: ctx.actor.id, at: ctx.timestamp });
        ctx.setPayload({ complaintId: args.complaintId, conclusionId: conclusion.id, analysisId: args.analysisId ?? null, rootCause: args.rootCause.trim() });
        ctx.notify({ severity: 'info', title: `Complaint ${complaint?.complaint_no} resolved`, body: args.rootCause.trim(), link: `/complaints/${args.complaintId}` });
        return { complaint: updated, conclusion };
      },
    },
    recordTestResult: {
      key: 'Quality.recordTestResult', description: 'Record a laboratory test result', rules: ['lot-exists','dept-testable','stage-started','sample-machine','values-keys','values-sane','date-window'],
      handler(ctx, args: { lotId: string; department: string; machineId?: string | null; sampleType: 'LOT'|'MACHINE'; testDate: string; shift?: string | null; values: Record<string, number>; instrument?: string; remarks?: string }) {
        const lot = ctx.get<{ id: string; line: string; count_id: string; status: string; lot_no: string; start_date: string }>('SELECT * FROM lots WHERE id=?', args.lotId);
        ctx.check('lot-exists', !!lot, `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        const testable = ['CARD','DF','FF','RF','AW'].includes(args.department);
        ctx.check('dept-testable', testable, `${args.department} is not a testable department`, 'VALIDATION_FAILED');
        const first = ctx.get<{ date: string }>('SELECT MIN(event_date) AS date FROM production_events WHERE lot_id=? AND department=?', args.lotId, args.department);
        ctx.check('stage-started', !!first?.date, `No ${args.department} production event exists for lot ${lot?.lot_no ?? args.lotId}`);
        if (args.sampleType === 'MACHINE') {
          const machine = args.machineId ? ctx.get<{ department: string; line: string }>('SELECT department,line FROM machines WHERE id=?', args.machineId) : undefined;
          ctx.check('sample-machine', !!machine && machine.department === args.department && machine.line === lot?.line, 'Machine sample must use a machine in the lot line and department', 'VALIDATION_FAILED');
        } else ctx.check('sample-machine', !args.machineId, 'LOT samples must not specify a machine', 'VALIDATION_FAILED');
        const allowed = paramsFor(args.department as never, 'QUALITY').map((param) => param.key);
        const keys = Object.keys(args.values ?? {});
        ctx.check('values-keys', keys.length > 0 && keys.every((key) => allowed.includes(key)), 'Test values include no measurements or unsupported parameters', 'VALIDATION_FAILED');
        ctx.check('values-sane', Object.entries(args.values).every(([key,value]) => Number.isFinite(value) && value >= 0 && (!['U','CV','COUNT_CV'].includes(key) || value < 60) && (!['IPI'].includes(key) || value < 5000)), 'Test values must be finite and within physical ranges', 'VALIDATION_FAILED');
        ctx.check('date-window', !!first?.date && args.testDate >= first.date && args.testDate <= ctx.settings.businessDate, 'Test date must fall between first production event and business date', 'VALIDATION_FAILED');
        let dayIndex: number | null = null;
        if (args.sampleType === 'MACHINE') {
          const days = ctx.all<{ event_date: string }>('SELECT DISTINCT event_date FROM production_events WHERE lot_id=? AND department=? AND event_date<=? ORDER BY event_date', args.lotId, args.department, args.testDate);
          dayIndex = Math.max(1, days.length);
        }
        const test = ctx.insert('test_result', { id: ctx.newId('TR'), lot_id: args.lotId, department: args.department, machine_id: args.machineId ?? null, sample_type: args.sampleType, test_date: args.testDate, day_index: dayIndex, shift: args.shift ?? null, values_json: JSON.stringify(args.values), instrument: args.instrument ?? '', tested_by: ctx.actor.id, remarks: args.remarks ?? '', created_at: ctx.timestamp });
        let lotRed = false;
        for (const [key, value] of Object.entries(args.values)) {
          const standard = ctx.get<{ std: number; lower_limit: number | null; upper_limit: number | null }>('SELECT std,lower_limit,upper_limit FROM standards WHERE count_id=? AND department=? AND parameter=? AND active=1', lot?.count_id, args.department, key);
          const evaluated = evaluate(value, standard ? { std: standard.std, lower: standard.lower_limit, upper: standard.upper_limit } : null, ctx.settings.warnFraction);
          if (evaluated.color !== 'green' && evaluated.color !== 'none') ctx.note(`tolerance:${args.department}:${key}`, `${key} ${value} is ${evaluated.color.toUpperCase()} — flagged`);
          if (evaluated.color === 'red' && args.sampleType === 'LOT') lotRed = true;
          if (evaluated.color === 'red') ctx.notify({ severity: args.sampleType === 'LOT' ? 'critical' : 'warning', title: `${args.department} ${key} ${evaluated.color.toUpperCase()}`, body: `Lot ${lot?.lot_no} recorded ${value}${args.sampleType === 'LOT' ? ' — release hold required' : ''}`, link: `/lots/${args.lotId}` });
        }
        if (lotRed && lot && lot.status !== 'ON_HOLD') ctx.update('lot', lot.id, { status: 'ON_HOLD' });
        ctx.setPayload({ testResultId: test.id, lotId: args.lotId, department: args.department, sampleType: args.sampleType, values: args.values });
        return test;
      },
    },
    upsertStandard: {
      key: 'Quality.upsertStandard', description: 'Create or update a count-wise quality standard', rules: ['count-exists','parameter-valid','limits-present','limits-order','reason-required'],
      handler(ctx, args: { countId: string; department: string; parameter: string; category: string; std: number; lower: number|null; upper: number|null; unit?: string; reason?: string }) {
        ctx.check('count-exists', !!ctx.get('SELECT id FROM counts WHERE id=?', args.countId), `Count ${args.countId} does not exist`, 'NOT_FOUND');
        const param = paramsFor(args.department as never).find((candidate) => candidate.key === args.parameter);
        ctx.check('parameter-valid', !!param && param.category === args.category, `${args.parameter} is not valid for ${args.department} / ${args.category}`, 'VALIDATION_FAILED');
        ctx.check('limits-present', args.lower !== null || args.upper !== null, 'At least one tolerance limit is required', 'VALIDATION_FAILED');
        ctx.check('limits-order', (args.lower === null || args.lower <= args.std) && (args.upper === null || args.std <= args.upper), 'Limits must satisfy lower ≤ standard ≤ upper', 'VALIDATION_FAILED');
        const id = `STD-${args.countId}-${args.department}-${args.parameter}`;
        const previous = ctx.get<{ version: number; std: number; lower_limit: number|null; upper_limit: number|null; active: number }>('SELECT * FROM standards WHERE id=?', id);
        if (previous) ctx.check('reason-required', String(args.reason ?? '').trim().length >= 5, 'A reason of at least 5 characters is required when updating a standard', 'VALIDATION_FAILED');
        const row = previous
          ? ctx.update('standard', id, { std: args.std, lower_limit: args.lower, upper_limit: args.upper, unit: args.unit ?? param?.unit ?? '', active: 1, updated_by: ctx.actor.id, updated_at: ctx.timestamp })
          : ctx.insert('standard', { id, count_id: args.countId, department: args.department, parameter: args.parameter, category: args.category, std: args.std, lower_limit: args.lower, upper_limit: args.upper, unit: args.unit ?? param?.unit ?? '', active: 1, updated_by: ctx.actor.id, updated_at: ctx.timestamp });
        const version = Number(row.version);
        ctx.insertRaw('standards_history', { standard_id: id, version, change_type: previous ? 'UPDATE' : 'CREATE', std: args.std, lower_limit: args.lower, upper_limit: args.upper, reason: args.reason ?? '', changed_by: ctx.actor.id, changed_at: ctx.timestamp });
        ctx.setPayload({ standardId: id, version, std: args.std, lower: args.lower, upper: args.upper, reason: args.reason ?? '' });
        ctx.notify({ severity: 'info', title: 'Quality standard updated', body: `${args.countId} ${args.department} ${args.parameter} standard is now ${args.std}.`, link: '/standards' });
        return row;
      },
    },
    anchorAnalysis: {
      key: 'Quality.anchorAnalysis', description: 'Anchor a deterministic analysis run and its evidence digests', rules: ['lot-exists','complaint-lot-match','comparison-limit','input-hash-format','output-hash'],
      handler(ctx, args: { id: string; complaintId?: string | null; lotId: string; runNo: number; context: unknown; comparisonLotIds: string[]; result: unknown; inputHash: string; outputHash: string; llm: unknown }) {
        const lot = ctx.get<{ id: string; count_id: string; lot_no: string }>('SELECT id,count_id,lot_no FROM lots WHERE id=?', args.lotId);
        ctx.check('lot-exists', !!lot, `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        if (args.complaintId) {
          const complaint = ctx.get<{ lot_id: string }>('SELECT lot_id FROM complaints WHERE id=?', args.complaintId);
          ctx.check('complaint-lot-match', !!complaint && complaint.lot_id === args.lotId, 'Complaint must belong to the analyzed lot', 'NOT_FOUND');
        }
        ctx.check('comparison-limit', Array.isArray(args.comparisonLotIds) && args.comparisonLotIds.length <= 15, 'At most 15 comparison lots may be analyzed', 'VALIDATION_FAILED');
        ctx.check('input-hash-format', /^[0-9a-f]{64}$/.test(args.inputHash), 'Input digest must be a lowercase SHA-256 hash', 'VALIDATION_FAILED');
        ctx.check('output-hash', hashObject(args.result) === args.outputHash, 'Output hash does not match the analysis result', 'VALIDATION_FAILED');
        for (const comparisonId of args.comparisonLotIds) {
          const comparison = ctx.get<{ count_id: string }>('SELECT count_id FROM lots WHERE id=?', comparisonId);
          ctx.check('comparison-lot', !!comparison && comparison.count_id === lot?.count_id && comparisonId !== args.lotId, `${comparisonId} must be a different lot of the same count`, 'VALIDATION_FAILED');
        }
        const id = args.id || ctx.newId('AN', 4);
        const row = ctx.insert('analysis', { id, complaint_id: args.complaintId ?? null, lot_id: args.lotId, run_no: args.runNo, context: JSON.stringify(args.context), comparison_lot_ids: JSON.stringify(args.comparisonLotIds), result: JSON.stringify(args.result), input_hash: args.inputHash, output_hash: args.outputHash, llm: JSON.stringify(args.llm), created_by: ctx.actor.id, created_at: ctx.timestamp });
        ctx.setPayload({ analysisId: id, complaintId: args.complaintId ?? null, lotId: args.lotId, runNo: args.runNo, inputHash: args.inputHash, outputHash: args.outputHash, engineVersion: (args.result as { engineVersion?: string })?.engineVersion ?? 'stat-1.0' });
        return row;
      },
    },
    evaluateGate: {
      key: 'Quality.evaluateGate', description: 'Evaluate lot release quality for dispatch', rules: ['lots-present','lot-exists','release-reds','qa-override'],
      handler(ctx, args: { lotIds: string[] }) {
        ctx.check('lots-present', Array.isArray(args.lotIds) && args.lotIds.length > 0, 'Select at least one lot', 'VALIDATION_FAILED');
        const lots = args.lotIds.map((id) => ctx.get<{ id:string; lot_no:string; count_id:string }>('SELECT id,lot_no,count_id FROM lots WHERE id=?',id));
        ctx.check('lot-exists', lots.every(Boolean), 'One or more selected lots do not exist', 'NOT_FOUND');
        const gateLots = lots.filter((lot): lot is {id:string;lot_no:string;count_id:string} => !!lot).map((lot) => {
          const override=ctx.get<{id:string}>('SELECT id FROM qa_overrides WHERE lot_id=? ORDER BY created_at DESC LIMIT 1',lot.id);
          const redItems:Record<string,unknown>[]=[]; const yellowItems:Record<string,unknown>[]=[]; const machineLevelRed:Record<string,unknown>[]=[];
          const tests=ctx.all<{id:string;department:string;sample_type:string;machine_id:string|null;test_date:string;day_index:number|null;shift:string|null;values_json:string}>('SELECT * FROM test_results WHERE lot_id=? ORDER BY test_date DESC',lot.id);
          for(const test of tests){const values=JSON.parse(test.values_json) as Record<string,number>;for(const [parameter,value] of Object.entries(values)){const std=ctx.get<{std:number;lower_limit:number|null;upper_limit:number|null}>('SELECT std,lower_limit,upper_limit FROM standards WHERE count_id=? AND department=? AND parameter=? AND active=1',lot.count_id,test.department,parameter);if(!std)continue;const evaluation=evaluate(value,{std:std.std,lower:std.lower_limit,upper:std.upper_limit},ctx.settings.warnFraction);if(evaluation.color==='green'||evaluation.color==='none')continue;const item={department:test.department,parameter,value,std:std.std,lower:std.lower_limit,upper:std.upper_limit,color:evaluation.color,testResultId:test.id,machineId:test.machine_id,dayIndex:test.day_index,shift:test.shift};if(test.sample_type==='MACHINE'){if(evaluation.color==='red')machineLevelRed.push(item);}else if(evaluation.color==='red')redItems.push(item);else yellowItems.push(item);}}
          const blocked=redItems.length>0&&!override;
          return {lotId:lot.id,lotNo:lot.lot_no,worst:redItems.length?'red':yellowItems.length?'yellow':'green',redItems,yellowItems,machineLevelRed,overrideId:override?.id??null,blocked};
        });
        const blocked=gateLots.filter((lot)=>lot.blocked);
        const passed=blocked.length===0;
        const machineLevelRed=gateLots.reduce((sum,lot)=>sum+lot.machineLevelRed.length,0);
        const message=passed?(machineLevelRed?`Quality gate passed with ${machineLevelRed} machine-level warning(s).`:'Quality gate passed.'):`Quality gate blocked: ${blocked.map((lot)=>lot.lotNo).join(', ')} has lot-level red results.`;
        const result={passed,overridden:gateLots.some((lot)=>!!lot.overrideId),checkedAt:ctx.timestamp,lots:gateLots,message};
        ctx.setPayload({lotIds:args.lotIds,passed,blocked:blocked.map((lot)=>lot.lotId),machineLevelRed});
        return result;
      },
    },
    deleteStandard: {
      key: 'Quality.deleteStandard', description: 'Retire a standard while preserving its version history', rules: ['exists-active','reason-required'],
      handler(ctx,args:{id:string;reason:string}) {
        const previous=ctx.get<{id:string;std:number;lower_limit:number|null;upper_limit:number|null;active:number}>('SELECT * FROM standards WHERE id=?',args.id);
        ctx.check('exists-active',!!previous&&previous.active===1,`Active standard ${args.id} does not exist`,'NOT_FOUND');
        ctx.check('reason-required',String(args.reason??'').trim().length>=5,'A reason of at least 5 characters is required','VALIDATION_FAILED');
        const standard=ctx.update('standard',args.id,{active:0,updated_by:ctx.actor.id,updated_at:ctx.timestamp});
        ctx.insertRaw('standards_history',{standard_id:args.id,version:standard.version,change_type:'DELETE',std:standard.std,lower_limit:standard.lower_limit,upper_limit:standard.upper_limit,reason:args.reason.trim(),changed_by:ctx.actor.id,changed_at:ctx.timestamp});
        ctx.setPayload({standardId:args.id,version:standard.version,changeType:'DELETE',reason:args.reason.trim()});
        ctx.notify({severity:'warning',title:'Quality standard retired',body:`${args.id} is inactive.`,link:'/standards'});
        return standard;
      },
    },
  },
};