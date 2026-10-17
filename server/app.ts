import { randomHex } from './lib/hash';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { DB } from './db';
import { getSettings, peekSeq } from './db';
import type { LedgerService } from './ledger/types';
import { createRuntime } from './contracts/runtime';
import type { ContractRuntime, Actor } from './contracts/types';
import { ROLE_LABEL, ROLE_ORG } from '@shared/permissions';
import { PARAMS } from '@shared/params';
import { config } from './config';
import { evaluate } from '@shared/quality';
import { hashObject } from './lib/hash';
import { analyzeEvidence } from './analysis/engine';
import type { AnalysisContext, AnalysisResult, AnalysisRun, Complaint, Dispatch, GateItem, GateLotResult, GateResult, LlmMeta, Lot, ProductionEvent, Standard, TestResult } from '@shared/types';

interface AuthedRequest extends Request { actor?: Actor }
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ ok: true, data });

function actorFor(row: Record<string, unknown>): Actor {
  return { id: String(row.id), username: String(row.username), name: String(row.name), role: row.role as Actor['role'], org: String(row.org) };
}

export function createApp(db: DB, ledger: LedgerService, runtime: ContractRuntime = createRuntime(db, ledger)): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Express 4 ignores rejected promises from async handlers; forward them to the error handler instead of crashing the process.
  for (const method of ['use', 'get', 'post', 'put', 'delete'] as const) {
    const original = (app[method] as (...args: unknown[]) => unknown).bind(app);
    (app as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => original(...args.map((arg) => {
      if (typeof arg !== 'function' || arg.length === 4) return arg;
      return (req: Request, res: Response, next: NextFunction) => {
        try { Promise.resolve((arg as (...a: unknown[]) => unknown)(req, res, next)).catch(next); } catch (error) { next(error); }
      };
    }));
  }
  app.use(express.json({ limit: '1mb' }));
  const evaluateGateFor = async (lotIds: string[]): Promise<GateResult> => {
    const settings = await getSettings(db);
    const lots = await Promise.all(lotIds.map(async (lotId) => {
      const lot = await db.prepare('SELECT id,lot_no,count_id FROM lots WHERE id=?').get(lotId) as {id:string;lot_no:string;count_id:string}|undefined;
      if (!lot) return null;
      const rows = await db.prepare('SELECT * FROM test_results WHERE lot_id=? ORDER BY test_date DESC,id DESC').all(lotId) as Record<string,unknown>[];
      const latestLotByDept = new Set<string>();
      const redItems:GateItem[]=[]; const yellowItems:GateItem[]=[]; const machineLevelRed:GateItem[]=[];
      for(const row of rows){
        if(row.sample_type==='LOT'&&latestLotByDept.has(String(row.department)))continue;
        if(row.sample_type==='LOT')latestLotByDept.add(String(row.department));
        const values=JSON.parse(String(row.values_json)) as Record<string,number>;
        for(const [parameter,value] of Object.entries(values)){
          const standard=await db.prepare('SELECT std,lower_limit,upper_limit FROM standards WHERE count_id=? AND department=? AND parameter=? AND active=1').get(lot.count_id,row.department,parameter) as {std:number;lower_limit:number|null;upper_limit:number|null}|undefined;
          if(!standard)continue;
          const evaluation=evaluate(value,{std:standard.std,lower:standard.lower_limit,upper:standard.upper_limit},settings.warnFraction);
          if(evaluation.color==='green'||evaluation.color==='none')continue;
          const item:GateItem={department:row.department as GateItem['department'],parameter,value,std:standard.std,lower:standard.lower_limit,upper:standard.upper_limit,color:evaluation.color,testResultId:String(row.id),machineId:row.machine_id as string|null,dayIndex:row.day_index as number|null,shift:row.shift as GateItem['shift']};
          if(row.sample_type==='MACHINE'){if(evaluation.color==='red')machineLevelRed.push(item);}else if(evaluation.color==='red')redItems.push(item);else yellowItems.push(item);
        }
      }
      const override=await db.prepare('SELECT id FROM qa_overrides WHERE lot_id=? ORDER BY created_at DESC LIMIT 1').get(lotId) as {id:string}|undefined;
      const blocked=redItems.length>0&&!override;
      return {lotId,lotNo:lot.lot_no,worst:redItems.length?'red':yellowItems.length?'yellow':'green',redItems,yellowItems,machineLevelRed,overrideId:override?.id??null,blocked} satisfies GateLotResult;
    }));
    const validLots=lots.filter((lot):lot is NonNullable<typeof lot>=>!!lot);
    const blocked=validLots.filter((lot)=>lot.blocked);const machineWarnings=validLots.reduce((sum,lot)=>sum+lot.machineLevelRed.length,0);const passed=blocked.length===0;
    return {passed,overridden:validLots.some((lot)=>!!lot.overrideId&&lot.redItems.length>0),checkedAt:new Date().toISOString(),lots:validLots,message:passed?(machineWarnings?`Quality gate passed with ${machineWarnings} machine-level warning(s).`:'Quality gate passed.'):`Quality gate blocked: ${blocked.map((lot)=>lot.lotNo).join(', ')} has lot-level red results.`};
  };

  app.get('/api/health', async (_req, res) => ok(res, { millName: config.millName, ledger: await ledger.stats() }));
  app.get('/api/meta', async (_req, res) => ok(res, {
    millName: config.millName,
    counts: await db.prepare('SELECT * FROM counts ORDER BY ne').all(),
    parameters: PARAMS,
    settings: await getSettings(db),
    roles: Object.entries(ROLE_LABEL).map(([role, label]) => ({ role, label })),
    permissions: {},
    ai: { llmEnabled: config.ai.enabled, provider: config.ai.enabled ? config.ai.provider : null, model: config.ai.enabled ? config.ai.model : null },
    ledger: { adapter: ledger.adapter, validators: ledger.validators(), policy: ledger.policy() },
    serverTime: new Date().toISOString(),
  }));

  app.post('/api/auth/login', async (req, res) => {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const row = await db.prepare('SELECT * FROM users WHERE username = ?').get(username) as Record<string, unknown> | undefined;
    if (!row) return res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Unknown user' } });
    const actor = actorFor(row);
    const action = await runtime.run({ action: 'auth.login', label: `Sign in as ${actor.name}`, actor, request: { method: 'POST', path: req.path, query: {}, body: req.body } }, (x) => x.call('Access.login', { userId: actor.id }));
    if (!action.ok) return res.status(action.status).json({ ok: false, error: action.error, trace: action.trace });
    const token = randomHex(24);
    await db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, actor.id, new Date().toISOString());
    return res.json({ ok: true, data: { token, user: { id: actor.id, username: actor.username, name: actor.name, role: actor.role, org: actor.org, title: row.title, customerId: row.customer_id ?? null } }, trace: action.trace });
  });

  app.get('/api/passports/:code', async (req, res) => {
    const row = await db.prepare(`SELECT p.code, p.dispatch_id, p.issued_at, p.tx_hash, p.block_number, d.dispatch_no, d.dispatch_date, d.quantity_kg,
      d.count_id, c.name AS customer_name, d.passport_code FROM passports p JOIN dispatches d ON d.id=p.dispatch_id
      JOIN customers c ON c.id=d.customer_id WHERE p.code=?`).get(req.params.code) as Record<string,unknown>|undefined;
    if (!row) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Passport not found' } });
    const lots=await db.prepare(`SELECT l.id lotId,l.lot_no lotNo,l.lot_code lotCode FROM dispatch_lots dl JOIN lots l ON l.id=dl.lot_id WHERE dl.dispatch_id=?`).all(row.dispatch_id) as {lotId:string;lotNo:string;lotCode:string}[];
    const journey:{label:string;detail:string}[]=[];
    for(const lot of lots){
      const bales=await db.prepare(`SELECT b.variety,b.station,COUNT(*) bale_count FROM lot_bales lb JOIN bales b ON b.id=lb.bale_id WHERE lb.lot_id=? GROUP BY b.variety,b.station`).all(lot.lotId) as {variety:string;station:string;bale_count:number}[];
      if(bales.length)journey.push({label:`Fibre mix · ${lot.lotNo}`,detail:bales.map((bale)=>`${bale.variety} from ${bale.station} (${bale.bale_count} bales)`).join(' · ')});
      const events=await db.prepare(`SELECT e.department,e.machine_id,e.event_date,e.output_kg FROM production_events e WHERE e.lot_id=? ORDER BY e.event_date,e.department LIMIT 8`).all(lot.lotId) as {department:string;machine_id:string|null;event_date:string;output_kg:number}[];
      for(const event of events)journey.push({label:`${event.department} production`,detail:`${event.machine_id??'Stage record'} · ${event.event_date} · ${Number(event.output_kg).toFixed(1)} kg output`});
      const testCount=Number((await db.prepare('SELECT COUNT(*) n FROM test_results WHERE lot_id=?').get(lot.lotId) as {n:number|string}).n);
      if(testCount)journey.push({label:'Laboratory quality',detail:`${testCount} anchored test samples linked to this lot.`});
      const packing=await db.prepare('SELECT COALESCE(SUM(total_kg),0) kg,COALESCE(SUM(packs_count),0) packs,MAX(pack_date) pack_date FROM packing WHERE lot_id=?').get(lot.lotId) as {kg:number;packs:number;pack_date:string|null};
      if(Number(packing?.kg))journey.push({label:'Cone packing',detail:`${packing.packs} packs · ${Number(packing.kg).toFixed(1)} kg · ${packing.pack_date}`});
    }
    const blockNumber=Number(row.block_number);const txHash=String(row.tx_hash??'');const block=await ledger.getBlock(blockNumber);const proof=txHash?await ledger.getMerkleProof(txHash):[];
    const tx=txHash?await ledger.getTx(txHash):null;const verified=!!block&&!!tx&&ledger.verifyMerkleProof(txHash,proof,block.merkleRoot)&&tx.entityRefs.some((ref)=>ref.type==='passport'&&ref.id===row.code);
    return ok(res,{...row,lots,journey,ledgerProof:{txHash,blockNumber,blockHash:block?.hash??null,merkleRoot:block?.merkleRoot??null,merkleProof:proof,approvals:block?.approvals??[],verified,verifiedAt:new Date().toISOString()}});
  });

  app.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const row = token ? await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(token) as Record<string, unknown> | undefined : undefined;
    if (!row) return res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } });
    req.actor = actorFor(row);
    next();
  });

  app.get('/api/auth/me', async (req: AuthedRequest, res) => {
    const row = await db.prepare('SELECT id,username,name,role,org,title,customer_id AS customerId FROM users WHERE id=?').get(req.actor?.id);
    return ok(res, row);
  });
  app.get('/api/users', async (_req, res) => ok(res, await db.prepare('SELECT id,username,name,role,org,title,customer_id AS customerId FROM users ORDER BY username').all()));
  app.get('/api/counts', async (_req, res) => ok(res, await db.prepare('SELECT * FROM counts ORDER BY ne').all()));
  app.get('/api/customers', async (_req, res) => ok(res, await db.prepare('SELECT id,code,name,city,contact_name AS contactName,email FROM customers ORDER BY name').all()));
  app.get('/api/machines', async (req, res) => ok(res, await db.prepare('SELECT id,department,machine_no AS machineNo,label,line,make,model FROM machines WHERE (? IS NULL OR department=?) ORDER BY department,machine_no').all(req.query.department ?? null, req.query.department ?? null)));
  app.get('/api/dashboard/summary', async (_req, res) => {
    const count = async (sql: string) => Number((await db.prepare(sql).get() as { n: number|string }).n);
    const stats = await ledger.stats();
    const settings = await getSettings(db);
    const d = settings.businessDate;
    const sevenDaysAgo = new Date(`${d}T00:00:00.000Z`);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    const testRows = await db.prepare(`SELECT t.values_json,l.count_id FROM test_results t JOIN lots l ON l.id=t.lot_id
      WHERE t.test_date >= ? AND t.test_date <= ?`).all(sevenDaysAgo.toISOString().slice(0,10), d) as { values_json: string; count_id: string }[];
    const standardRows = await db.prepare('SELECT count_id,parameter,std,lower_limit,upper_limit FROM standards WHERE active=1').all() as { count_id: string; parameter: string; std: number; lower_limit: number | null; upper_limit: number | null }[];
    const standardIndex = new Map(standardRows.map((row) => [`${row.count_id}:${row.parameter}`, row]));
    let redAlerts = 0; let yellowAlerts = 0;
    for (const test of testRows) {
      const values = JSON.parse(test.values_json) as Record<string, number>;
      for (const [parameter, value] of Object.entries(values)) {
        const standard = standardIndex.get(`${test.count_id}:${parameter}`);
        if (!standard) continue;
        const result = evaluate(value, { std: standard.std, lower: standard.lower_limit, upper: standard.upper_limit }, settings.warnFraction);
        if (result.color === 'red') redAlerts += 1;
        if (result.color === 'yellow') yellowAlerts += 1;
      }
    }
    return ok(res, {
      millName: config.millName, businessDate: d,
      complaints: { total: await count('SELECT COUNT(*) n FROM complaints'), open: await count("SELECT COUNT(*) n FROM complaints WHERE status='OPEN'"), underAnalysis: await count("SELECT COUNT(*) n FROM complaints WHERE status='UNDER_ANALYSIS'"), resolved: await count("SELECT COUNT(*) n FROM complaints WHERE status='RESOLVED'") },
      lots: { total: await count('SELECT COUNT(*) n FROM lots'), inProduction: await count("SELECT COUNT(*) n FROM lots WHERE status IN ('PLANNED','IN_PRODUCTION')"), onHold: await count("SELECT COUNT(*) n FROM lots WHERE status='ON_HOLD'"), dispatched: await count("SELECT COUNT(*) n FROM lots WHERE status='DISPATCHED'") },
      qualityAlerts: { red: redAlerts, yellow: yellowAlerts, windowDays: 7 },
      dispatches: { month: d.slice(0, 7), count: await count(`SELECT COUNT(*) n FROM dispatches WHERE substr(dispatch_date,1,7)='${d.slice(0, 7)}'`), quantityKg: Number((await db.prepare(`SELECT COALESCE(SUM(quantity_kg),0) n FROM dispatches WHERE substr(dispatch_date,1,7)=?`).get(d.slice(0, 7)) as { n: number|string }).n) },
      ledger: { blocks: stats.blocks, transactions: stats.transactions, invalidTx: stats.invalidTx, lastBlockAt: stats.lastBlockAt },
      analyses: { completed: await count('SELECT COUNT(*) n FROM analyses'), llmEnabled: config.ai.enabled },
    });
  });
  app.get('/api/dashboard/activity', async (req, res) => ok(res, await db.prepare("SELECT action_id AS id,timestamp AS at,COALESCE(username,'system') AS actorName,COALESCE(role,'SYSTEM') AS actorRole,action,label,accepted,block_number AS blockNumber FROM audit_log ORDER BY timestamp DESC LIMIT ?").all(Math.min(Number(req.query.limit) || 10, 100))));
  app.get('/api/notifications', async (_req, res) => ok(res, await db.prepare('SELECT id,severity,title,body,link,created_at AS createdAt,read FROM notifications ORDER BY created_at DESC').all()));

  app.get('/api/complaints/next-number', async (_req, res) => {
    const year = Number((await getSettings(db)).businessDate.slice(0, 4));
    const seq = await peekSeq(db, `complaint:${year}`);
    return ok(res, { complaintNo: `${seq}/${year}`, seq, year });
  });
  app.post('/api/complaints', async (req: AuthedRequest, res) => {
    const body = req.body ?? {};
    const action = await runtime.run({ action: 'complaint.register', label: 'Register customer complaint', actor: req.actor!, request: { method: 'POST', path: req.path, query: {}, body } }, (x) => x.call('Quality.registerComplaint', body));
    return action.ok ? res.status(201).json({ ok: true, data: action.result, trace: action.trace }) : res.status(action.status).json({ ok: false, error: action.error, trace: action.trace });
  });
  app.get('/api/complaints/:id', async (req, res) => {
    const complaint = await db.prepare(`SELECT cp.*,c.name customer_name,l.lot_no,l.lot_code,u.name created_by_name
      FROM complaints cp JOIN customers c ON c.id=cp.customer_id JOIN lots l ON l.id=cp.lot_id JOIN users u ON u.id=cp.created_by
      WHERE cp.id=? OR cp.complaint_no=?`).get(req.params.id, req.params.id) as Record<string, unknown> | undefined;
    if (!complaint) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Complaint not found' } });
    const complaintId = String(complaint.id);
    const [lot,customer,dispatch,document,events,analyses,conclusion] = await Promise.all([
      db.prepare('SELECT * FROM lots WHERE id=?').get(complaint.lot_id),
      db.prepare('SELECT * FROM customers WHERE id=?').get(complaint.customer_id),
      complaint.dispatch_id ? db.prepare('SELECT * FROM dispatches WHERE id=?').get(complaint.dispatch_id) : Promise.resolve(null),
      complaint.document_id ? db.prepare('SELECT * FROM documents WHERE id=?').get(complaint.document_id) : Promise.resolve(null),
      db.prepare('SELECT ce.*,u.name by_name FROM complaint_events ce JOIN users u ON u.id=ce.by_user_id WHERE ce.complaint_id=? ORDER BY ce.at').all(complaintId),
      db.prepare('SELECT * FROM analyses WHERE complaint_id=? ORDER BY created_at DESC').all(complaintId),
      db.prepare('SELECT * FROM conclusions WHERE complaint_id=?').get(complaintId),
    ]);
    return ok(res, {
      complaint,
      lot, customer, dispatch, document, events, analyses, conclusion: conclusion ?? null,
    });
  });
  app.post('/api/complaints/:id/transition', async (req: AuthedRequest, res) => {
    const body = { ...(req.body ?? {}), complaintId: req.params.id };
    const action = await runtime.run({ action: 'complaint.transition', label: 'Update complaint status', actor: req.actor!, request: { method: 'POST', path: req.path, query: {}, body: req.body } }, (x) => x.call('Quality.transitionComplaint', body));
    return action.ok ? res.json({ ok: true, data: action.result, trace: action.trace }) : res.status(action.status).json({ ok: false, error: action.error, trace: action.trace });
  });
  app.post('/api/complaints/:id/conclusion', async (req: AuthedRequest, res) => {
    const body = { ...(req.body ?? {}), complaintId: req.params.id };
    const action = await runtime.run({ action: 'complaint.conclusion', label: 'Resolve and close complaint', actor: req.actor!, request: { method: 'POST', path: req.path, query: {}, body: req.body } }, (x) => x.call('Quality.recordConclusion', body));
    return action.ok ? res.json({ ok: true, data: action.result, trace: action.trace }) : res.status(action.status).json({ ok: false, error: action.error, trace: action.trace });
  });

  app.get('/api/analysis/status', (_req, res) => ok(res, { llmEnabled: config.ai.enabled, provider: config.ai.enabled ? config.ai.provider : null, model: config.ai.enabled ? config.ai.model : null }));
  app.get('/api/analysis/candidates', async (req, res) => {
    const target = await db.prepare('SELECT id,count_id,start_date FROM lots WHERE id=?').get(req.query.lotId) as { id:string; count_id:string; start_date:string } | undefined;
    if (!target) return res.status(404).json({ ok:false,error:{code:'NOT_FOUND',message:'Lot not found'} });
    const anchor = new Date(`${target.start_date}T00:00:00Z`);const lower = new Date(anchor);lower.setUTCDate(lower.getUTCDate()-30);const upper = new Date(anchor);upper.setUTCDate(upper.getUTCDate()+30);
    const start = lower.toISOString().slice(0,10);const end = upper.toISOString().slice(0,10);
    const candidates = await db.prepare(`SELECT id,lot_no,lot_code,seq,year,count_id,line,status,planned_kg,start_date FROM lots
      WHERE count_id=? AND id<>? AND start_date BETWEEN ? AND ? ORDER BY start_date LIMIT 15`).all(target.count_id,target.id,start,end) as Record<string,unknown>[];
    return ok(res,candidates.map((lot)=>({lot:{...lot,producedKg:0,packedKg:0,dispatchedKg:0,currentStage:'RF',countDisplay:'30 CH',worstColor:'green',redCount:0,yellowCount:0,customers:[],chain:{txHash:null,blockNumber:null,recordHash:null,version:1,verified:false}},defaultSelected:true,reason:'Same count and production window.'})));
  });
  app.post('/api/analysis/run', async (req: AuthedRequest, res) => {
    const body = req.body as { lotId?:string; complaintId?:string|null; comparisonLotIds?:string[]; context?:Partial<AnalysisContext> };
    const lotRow = await db.prepare(`SELECT l.*,c.display count_display,COALESCE((SELECT SUM(output_kg) FROM production_events WHERE lot_id=l.id AND department='AW'),0) produced_kg,
      COALESCE((SELECT SUM(total_kg) FROM packing WHERE lot_id=l.id),0) packed_kg,COALESCE((SELECT SUM(quantity_kg) FROM dispatch_lots WHERE lot_id=l.id),0) dispatched_kg FROM lots l JOIN counts c ON c.id=l.count_id WHERE l.id=?`).get(body.lotId) as Record<string,unknown>|undefined;
    if (!lotRow) return res.status(404).json({ok:false,error:{code:'NOT_FOUND',message:'Lot not found'}});
    const lot: Lot = { id:String(lotRow.id),lotNo:String(lotRow.lot_no),lotCode:String(lotRow.lot_code),seq:Number(lotRow.seq),year:Number(lotRow.year),countId:String(lotRow.count_id),line:lotRow.line as Lot['line'],status:lotRow.status as Lot['status'],currentStage:'RF',plannedKg:Number(lotRow.planned_kg),producedKg:Number(lotRow.produced_kg),packedKg:Number(lotRow.packed_kg),dispatchedKg:Number(lotRow.dispatched_kg),startDate:String(lotRow.start_date),endDate:lotRow.end_date as string|null,chain:{txHash:lotRow.tx_hash as string|null,blockNumber:lotRow.block_number as number|null,recordHash:lotRow.record_hash as string|null,version:Number(lotRow.version),verified:!!lotRow.record_hash} };
    const testRows = await db.prepare('SELECT * FROM test_results WHERE lot_id=? ORDER BY test_date,id').all(lot.id) as Record<string,unknown>[];
    const tests = testRows.map((row): Pick<TestResult,'id'|'department'|'sampleType'|'machineId'|'testDate'|'dayIndex'|'shift'|'values'>=>({id:String(row.id),department:row.department as TestResult['department'],sampleType:row.sample_type as TestResult['sampleType'],machineId:row.machine_id as string|null,testDate:String(row.test_date),dayIndex:row.day_index as number|null,shift:row.shift as TestResult['shift'],values:JSON.parse(String(row.values_json)) as Record<string,number>}));
    const eventRows = await db.prepare('SELECT * FROM production_events WHERE lot_id=? ORDER BY event_date,id').all(lot.id) as Record<string,unknown>[];
    const events = eventRows.map((row): Pick<ProductionEvent,'id'|'department'|'machineId'|'eventDate'|'dayIndex'|'params'|'notes'>=>({id:String(row.id),department:row.department as ProductionEvent['department'],machineId:row.machine_id as string|null,eventDate:String(row.event_date),dayIndex:Number(row.day_index),params:JSON.parse(String(row.params)) as Record<string,number>,notes:String(row.notes)}));
    const standardRows = await db.prepare('SELECT * FROM standards WHERE count_id=? AND active=1').all(lot.countId) as Record<string,unknown>[];
    const standards = standardRows.map((row): Pick<Standard,'id'|'department'|'parameter'|'std'|'lower'|'upper'>=>({id:String(row.id),department:row.department as Standard['department'],parameter:String(row.parameter),std:Number(row.std),lower:row.lower_limit as number|null,upper:row.upper_limit as number|null}));
    const complaintRow = body.complaintId ? await db.prepare('SELECT id,complaint_no,type FROM complaints WHERE id=?').get(body.complaintId) as {id:string;complaint_no:string;type:Complaint['type']}|undefined : undefined;
    if (body.complaintId && !complaintRow) return res.status(404).json({ok:false,error:{code:'NOT_FOUND',message:'Complaint not found'}});
    const complaint = complaintRow ? {id:complaintRow.id,complaintNo:complaintRow.complaint_no,type:complaintRow.type} as Pick<Complaint,'id'|'complaintNo'|'type'> : null;
    const dispatchRows = await db.prepare(`SELECT d.*,c.name customer_name FROM dispatches d JOIN customers c ON c.id=d.customer_id JOIN dispatch_lots dl ON dl.dispatch_id=d.id WHERE dl.lot_id=?`).all(lot.id) as Record<string,unknown>[];
    const dispatches = dispatchRows.map((row): Pick<Dispatch,'id'|'dispatchNo'|'customerId'|'customerName'|'dispatchDate'|'quantityKg'|'lots'>=>({id:String(row.id),dispatchNo:String(row.dispatch_no),customerId:String(row.customer_id),customerName:String(row.customer_name),dispatchDate:String(row.dispatch_date),quantityKg:Number(row.quantity_kg),lots:[{lotId:lot.id,lotNo:lot.lotNo,lotCode:lot.lotCode,quantityKg:Number(row.quantity_kg)}]}));
    const context:AnalysisContext={source:body.context?.source??(body.complaintId?'complaint':'manual'),department:body.context?.department??null,machineId:body.context?.machineId??null,dayIndex:body.context?.dayIndex??null,date:body.context?.date??null,shift:body.context?.shift??null,parameter:body.context?.parameter??null};
    const comparisonLotIds=(body.comparisonLotIds??[]).slice(0,15);
    const comparisonRows=await Promise.all(comparisonLotIds.map((id)=>db.prepare('SELECT id,lot_no FROM lots WHERE id=? AND count_id=?').get(id,lot.countId) as Promise<{id:string;lot_no:string}|undefined>));
    const comparisonLots=comparisonRows.filter((row):row is {id:string;lot_no:string}=>!!row).map((row)=>({id:row.id,lotNo:row.lot_no}));
    const result:AnalysisResult=analyzeEvidence({lot,tests,events,standards,complaint,dispatches,context,comparisonLots,warnFraction:(await getSettings(db)).warnFraction});
    const inputDigest={lotId:lot.id,comparisonLotIds,context,complaintId:body.complaintId??null,standards:standardRows.map((r)=>({id:r.id,version:r.version,std:r.std,lower:r.lower_limit,upper:r.upper_limit})),tests:testRows.map((r)=>({id:r.id,recordHash:r.record_hash})),events:eventRows.map((r)=>({id:r.id,recordHash:r.record_hash}))};
    const inputHash=hashObject(inputDigest); const outputHash=hashObject(result); const llm:LlmMeta={enabled:false,status:'disabled',provider:null,model:null,latencyMs:null,prompt:null,inputJson:null,outputJson:null,error:null,validation:null};
    const runNoRow=await db.prepare('SELECT COALESCE(MAX(run_no),0)+1 AS n FROM analyses WHERE ((? IS NULL AND complaint_id IS NULL) OR complaint_id=?) AND lot_id=?').get(body.complaintId??null,body.complaintId??null,lot.id) as {n:number|string};
    const runNo=Number(runNoRow.n); const id=`AN-${String(runNo).padStart(4,'0')}-${lot.seq}`;
    const actor=req.actor!;
    const action=await runtime.run({action:'analysis.run',label:`Analyze lot ${lot.lotNo}`,actor,request:{method:'POST',path:req.path,query:{},body},extra:{model:null,latencyMs:0,inputJson:inputDigest,outputJson:result}},async(x)=>{const analysis=await x.call('Quality.anchorAnalysis',{id,complaintId:body.complaintId??null,lotId:lot.id,runNo,context,comparisonLotIds,result,inputHash,outputHash,llm});if(complaintRow){const status=await db.prepare('SELECT status FROM complaints WHERE id=?').get(complaintRow.id) as {status:string};if(status.status==='OPEN')await x.call('Quality.transitionComplaint',{complaintId:complaintRow.id,to:'UNDER_ANALYSIS',note:'AI evidence analysis completed; QA review required.'});}return analysis;});
    if(!action.ok)return res.status(action.status).json({ok:false,error:action.error,trace:action.trace});
    const saved=await db.prepare('SELECT * FROM analyses WHERE id=?').get(id) as Record<string,unknown>;
    const response={id,complaintId:body.complaintId??null,lotId:lot.id,lotNo:lot.lotNo,version:runNo,context,comparisonLotIds,result,inputHash,outputHash,llm,createdBy:actor.id,createdByName:actor.name,createdAt:String(saved.created_at),chain:{txHash:saved.tx_hash as string|null,blockNumber:saved.block_number as number|null,recordHash:saved.record_hash as string|null,version:Number(saved.version),verified:true}} satisfies Partial<AnalysisRun>;
    return res.status(201).json({ok:true,data:response,trace:action.trace});
  });
  app.get('/api/analysis', async (req,res) => {
    const rows=await db.prepare('SELECT * FROM analyses WHERE (? IS NULL OR complaint_id=?) AND (? IS NULL OR lot_id=?) ORDER BY created_at DESC').all(req.query.complaintId??null,req.query.complaintId??null,req.query.lotId??null,req.query.lotId??null) as Record<string,unknown>[];
    return ok(res,rows.map((row)=>({id:row.id,complaintId:row.complaint_id,lotId:row.lot_id,runNo:row.run_no,context:JSON.parse(String(row.context)),comparisonLotIds:JSON.parse(String(row.comparison_lot_ids)),result:JSON.parse(String(row.result)),inputHash:row.input_hash,outputHash:row.output_hash,llm:JSON.parse(String(row.llm)),createdBy:row.created_by,createdAt:row.created_at,chain:{txHash:row.tx_hash,blockNumber:row.block_number,recordHash:row.record_hash,version:row.version,verified:true}})));
  });

  app.get('/api/lots', async (req, res) => {
    const query = `%${String(req.query.q ?? '').replaceAll('%', '')}%`;
    const rows = await db.prepare(`SELECT l.*, c.display AS count_display, COALESCE((SELECT SUM(output_kg) FROM production_events e WHERE e.lot_id=l.id AND e.department='AW'),0) produced_kg,
      COALESCE((SELECT SUM(total_kg) FROM packing p WHERE p.lot_id=l.id),0) packed_kg,
      COALESCE((SELECT SUM(quantity_kg) FROM dispatch_lots dl WHERE dl.lot_id=l.id),0) dispatched_kg
      FROM lots l JOIN counts c ON c.id=l.count_id WHERE (?='%%' OR l.lot_no LIKE ? OR l.lot_code LIKE ? OR l.id LIKE ?) ORDER BY l.seq DESC`).all(query, query, query, query) as Record<string, unknown>[];
    return ok(res, rows.map((row) => ({ id: row.id, lotNo: row.lot_no, lotCode: row.lot_code, seq: row.seq, year: row.year, countId: row.count_id, countDisplay: row.count_display, line: row.line, status: row.status, plannedKg: row.planned_kg, producedKg: row.produced_kg, packedKg: row.packed_kg, dispatchedKg: row.dispatched_kg, startDate: row.start_date, currentStage: row.status === 'PACKED' ? 'PACK' : 'RF', worstColor: row.status === 'ON_HOLD' ? 'red' : 'green', redCount: row.status === 'ON_HOLD' ? 1 : 0, yellowCount: 0, customers: [], chain: { txHash: row.tx_hash, blockNumber: row.block_number, recordHash: row.record_hash, version: row.version, verified: !!row.record_hash } })));
  });
  app.get('/api/lots/search', (req, res) => res.redirect(`/api/lots?q=${encodeURIComponent(String(req.query.q ?? ''))}`));
  app.get('/api/lots/:id', async (req, res) => {
    const row = await db.prepare('SELECT * FROM lots WHERE id=? OR lot_no=? OR lot_code=?').get(req.params.id, req.params.id, req.params.id);
    return row ? ok(res, row) : res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Lot not found' } });
  });
  app.get('/api/lots/:id/events', async (req, res) => ok(res, await db.prepare('SELECT * FROM production_events WHERE lot_id=? AND (? IS NULL OR department=?) ORDER BY event_date,department').all(req.params.id, req.query.department ?? null, req.query.department ?? null)));
  app.get('/api/lots/:id/quality', async (req, res) => ok(res, await db.prepare('SELECT * FROM test_results WHERE lot_id=? ORDER BY test_date DESC').all(req.params.id)));
  app.post('/api/production-events',async(req:AuthedRequest,res)=>{const body=req.body??{};const action=await runtime.run({action:'production.log-event',label:'Log production stage event',actor:req.actor!,request:{method:'POST',path:req.path,query:{},body}},(x)=>x.call('ProcessEvent.logStageEvent',body));return action.ok?res.status(201).json({ok:true,data:action.result,trace:action.trace}):res.status(action.status).json({ok:false,error:action.error,trace:action.trace});});
  app.post('/api/test-results',async(req:AuthedRequest,res)=>{const body=req.body??{};const action=await runtime.run({action:'quality.record-test',label:'Record laboratory test result',actor:req.actor!,request:{method:'POST',path:req.path,query:{},body}},(x)=>x.call('Quality.recordTestResult',body));return action.ok?res.status(201).json({ok:true,data:action.result,trace:action.trace}):res.status(action.status).json({ok:false,error:action.error,trace:action.trace});});
  app.get('/api/test-results/:id',async(req,res)=>{const row=await db.prepare('SELECT * FROM test_results WHERE id=?').get(req.params.id);return row?ok(res,row):res.status(404).json({ok:false,error:{code:'NOT_FOUND',message:'Test result not found'}});});
  app.post('/api/packing',async(req:AuthedRequest,res)=>{const body=req.body??{};const action=await runtime.run({action:'packing.record',label:'Record finished-yarn packing',actor:req.actor!,request:{method:'POST',path:req.path,query:{},body}},(x)=>x.call('ProcessEvent.recordPacking',body));return action.ok?res.status(201).json({ok:true,data:action.result,trace:action.trace}):res.status(action.status).json({ok:false,error:action.error,trace:action.trace});});
  app.get('/api/complaints', async (req, res) => {
    const status = String(req.query.status ?? 'ALL');
    const q = `%${String(req.query.q ?? '')}%`;
    const items = await db.prepare(`SELECT cp.*, c.name customer_name, l.lot_no, l.lot_code, u.name created_by_name
      FROM complaints cp JOIN customers c ON c.id=cp.customer_id JOIN lots l ON l.id=cp.lot_id JOIN users u ON u.id=cp.created_by
      WHERE (?='ALL' OR cp.status=?) AND (?='%%' OR cp.complaint_no LIKE ? OR c.name LIKE ? OR l.lot_no LIKE ? OR cp.complainant_name LIKE ?)
      ORDER BY cp.year DESC,cp.seq DESC`).all(status, status, q, q, q, q, q);
    return ok(res, { items, total: items.length, page: 1, pageSize: items.length });
  });
  app.get('/api/standards', async (req, res) => ok(res, await db.prepare('SELECT * FROM standards WHERE (? IS NULL OR count_id=?) AND (active=1 OR ?) ORDER BY count_id,department,parameter').all(req.query.countId ?? null, req.query.countId ?? null, req.query.includeInactive === 'true' ? 1 : 0)));
  app.post('/api/standards',async(req:AuthedRequest,res)=>{const body=req.body??{};const action=await runtime.run({action:'standard.create',label:'Create quality standard',actor:req.actor!,request:{method:'POST',path:req.path,query:{},body}},(x)=>x.call('Quality.upsertStandard',body));return action.ok?res.status(201).json({ok:true,data:action.result,trace:action.trace}):res.status(action.status).json({ok:false,error:action.error,trace:action.trace});});
  app.put('/api/standards/:id',async(req:AuthedRequest,res)=>{const current=await db.prepare('SELECT * FROM standards WHERE id=?').get(req.params.id) as Record<string,unknown>|undefined;if(!current)return res.status(404).json({ok:false,error:{code:'NOT_FOUND',message:'Standard not found'}});const body={countId:current.count_id,department:current.department,parameter:current.parameter,category:current.category,unit:current.unit,...req.body};const action=await runtime.run({action:'standard.update',label:`Update standard ${req.params.id}`,actor:req.actor!,request:{method:'PUT',path:req.path,query:{},body:req.body}},(x)=>x.call('Quality.upsertStandard',body));return action.ok?res.json({ok:true,data:action.result,trace:action.trace}):res.status(action.status).json({ok:false,error:action.error,trace:action.trace});});
  app.delete('/api/standards/:id',async(req:AuthedRequest,res)=>{const body={id:req.params.id,reason:String(req.body?.reason??'')};const action=await runtime.run({action:'standard.delete',label:`Retire standard ${req.params.id}`,actor:req.actor!,request:{method:'DELETE',path:req.path,query:{},body:req.body}},(x)=>x.call('Quality.deleteStandard',body));return action.ok?res.json({ok:true,data:action.result,trace:action.trace}):res.status(action.status).json({ok:false,error:action.error,trace:action.trace});});
  app.get('/api/standards/:id/history',async(_req,res)=>ok(res,await db.prepare(`SELECT h.*,u.name changed_by_name FROM standards_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.standard_id=? ORDER BY h.version DESC`).all(_req.params.id)));
  app.get('/api/dispatches', async (_req, res) => ok(res, await db.prepare('SELECT d.*,c.name customer_name FROM dispatches d JOIN customers c ON c.id=d.customer_id ORDER BY dispatch_date DESC').all()));
  app.post('/api/dispatches/gate-check', async (req, res) => ok(res, await evaluateGateFor(Array.isArray(req.body?.lotIds)?req.body.lotIds.map(String):[])));
  app.post('/api/dispatches', async (req:AuthedRequest,res) => {
    const body=req.body as {customerId:string;countId:string;dispatchDate:string;lots:{lotId:string;quantityKg:number}[];packWeightKg:number;conesCount?:number;vehicleNo:string;lrNo:string;invoiceNo?:string};
    const action=await runtime.run({action:'dispatch.create',label:'Create customer dispatch',actor:req.actor!,request:{method:'POST',path:req.path,query:{},body}},async(x)=>{
      const checked=await x.call<GateResult>('Quality.evaluateGate',{lotIds:(body.lots??[]).map((lot)=>lot.lotId)});
      const dispatch=await x.call<Record<string,unknown>>('Transfer.createDispatch',{...body,gate:checked});
      return x.call('AssetID.issuePassport',{dispatchId:String(dispatch.id)});
    });
    if(!action.ok)return res.status(action.status).json({ok:false,error:action.error,trace:action.trace});
    const dispatch=await db.prepare('SELECT d.*,c.name customer_name FROM dispatches d JOIN customers c ON c.id=d.customer_id WHERE d.id=?').get((action.result as Record<string,unknown>).dispatch_id ?? (action.result as Record<string,unknown>).id) as Record<string,unknown>|undefined;
    if(!dispatch)return res.status(500).json({ok:false,error:{code:'INTERNAL',message:'Dispatch was anchored but could not be reloaded'},trace:action.trace});
    const lots=await db.prepare('SELECT dl.lot_id lotId,l.lot_no lotNo,l.lot_code lotCode,dl.quantity_kg quantityKg FROM dispatch_lots dl JOIN lots l ON l.id=dl.lot_id WHERE dl.dispatch_id=?').all(dispatch.id);
    const response={id:dispatch.id,dispatchNo:dispatch.dispatch_no,customerId:dispatch.customer_id,customerName:dispatch.customer_name,countId:dispatch.count_id,quantityKg:dispatch.quantity_kg,dispatchDate:dispatch.dispatch_date,lots,packWeightKg:dispatch.pack_weight_kg,packsCount:dispatch.packs_count,conesCount:dispatch.cones_count,vehicleNo:dispatch.vehicle_no,lrNo:dispatch.lr_no,invoiceNo:dispatch.invoice_no,gate:JSON.parse(String(dispatch.gate)),overrideIds:JSON.parse(String(dispatch.override_ids)),passportCode:dispatch.passport_code,status:dispatch.status,createdBy:dispatch.created_by,createdAt:dispatch.created_at,chain:{txHash:dispatch.tx_hash,blockNumber:dispatch.block_number,recordHash:dispatch.record_hash,version:dispatch.version,verified:true}};
    return res.status(201).json({ok:true,data:response,trace:action.trace});
  });
  app.get('/api/dispatches/:id',async(req,res)=>{const row=await db.prepare('SELECT d.*,c.name customer_name FROM dispatches d JOIN customers c ON c.id=d.customer_id WHERE d.id=? OR d.dispatch_no=?').get(req.params.id,req.params.id) as Record<string,unknown>|undefined;if(!row)return res.status(404).json({ok:false,error:{code:'NOT_FOUND',message:'Dispatch not found'}});return ok(res,{...row,lots:await db.prepare('SELECT dl.lot_id lotId,l.lot_no lotNo,l.lot_code lotCode,dl.quantity_kg quantityKg FROM dispatch_lots dl JOIN lots l ON l.id=dl.lot_id WHERE dl.dispatch_id=?').all(row.id),gate:JSON.parse(String(row.gate)),overrideIds:JSON.parse(String(row.override_ids))});});
  app.get('/api/ledger/stats', async (_req, res) => ok(res, await ledger.stats()));
  app.get('/api/ledger/blocks', async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const blocks = await db.prepare('SELECT * FROM ledger_blocks ORDER BY number DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
    return ok(res, { items: blocks, total: (await ledger.stats()).blocks, page, pageSize });
  });

  app.use((_req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'API route not found' } }));
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error(`[api] ${req.method} ${req.path} failed:`, error);
    if (res.headersSent) return;
    const status = (error as { type?: string }).type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ ok: false, error: { code: status === 400 ? 'BAD_REQUEST' : 'INTERNAL', message: status === 400 ? 'Malformed request body' : 'Internal server error' } });
  });
  return app;
}