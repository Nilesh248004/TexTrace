// AssetID contract: register traceable assets — bales, mixes, lots, customers, machines, documents, passports.
import { MASTER_TYPES, STAGES, paramDef, type Stage } from '@shared/params';
import type { CountMixMeta } from '@shared/domain';
import { MasterBook } from '../domain/masters';
import { hashObject } from '../lib/hash';
import type { ContractModule } from './types';

const r1 = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const FIBRE_KEYS = ['MIC', 'UHML', 'UI', 'STR', 'SFI', 'TRASH', 'MOIST', 'RD', 'PLUS_B'];

export const AssetIdContract: ContractModule = {
  name: 'AssetID',
  description: 'Register and identify traceable assets',
  functions: {
    registerBale: {
      key: 'AssetID.registerBale', description: 'Register a bale into the bale store', rules: ['bale-no-unique', 'weight-positive', 'hvi-complete', 'bay-bin-present'],
      async handler(ctx, args: { baleNo: string; supplier: string; station: string; variety: string; ginLot: string; weightKg: number; bay: string; bin: string; fibre: Record<string, number>; receivedAt?: string; arrivalDate?: string }) {
        const no = String(args.baleNo ?? '').trim();
        ctx.check('bale-no-unique', !!no && !(await ctx.get('SELECT id FROM bales WHERE bale_no=?', no)), `Bale number ${no || '(blank)'} is missing or already registered`, 'CONFLICT');
        ctx.check('weight-positive', Number(args.weightKg) > 100 && Number(args.weightKg) < 300, 'Bale weight must be between 100 and 300 kg', 'VALIDATION_FAILED');
        ctx.check('hvi-complete', FIBRE_KEYS.every((k) => Number.isFinite(Number(args.fibre?.[k]))), `HVI data required: ${FIBRE_KEYS.join(', ')}`, 'VALIDATION_FAILED');
        ctx.check('bay-bin-present', !!args.bay?.trim() && !!args.bin?.trim() && !!args.supplier?.trim() && !!args.variety?.trim(), 'Supplier, variety, bay and bin are required', 'VALIDATION_FAILED');
        const arrivalDate = args.arrivalDate ?? args.receivedAt ?? ctx.timestamp;
        const receivedAt = args.receivedAt ?? arrivalDate;
        const row = await ctx.insert('bale', { id: `BALE-${no}`, bale_no: no, supplier: args.supplier.trim(), station: args.station?.trim() ?? '', variety: args.variety.trim(), gin_lot: args.ginLot?.trim() ?? '', weight_kg: Number(args.weightKg), remaining_kg: Number(args.weightKg), received_at: receivedAt, arrival_date: arrivalDate, bay: args.bay.trim(), bin: args.bin.trim(), status: 'IN_STORE', issued_at: null, mix_id: null, fibre: JSON.stringify(args.fibre), created_at: ctx.timestamp });
        ctx.setPayload({ baleId: row.id, variety: args.variety, bay: args.bay, bin: args.bin, weightKg: args.weightKg });
        return row;
      },
    },
    registerMix: {
      key: 'AssetID.registerMix', description: 'Form a mix from bales; the recipe is checked against the Count & Mix master', rules: ['count-exists', 'bales-in-store', 'variety-in-recipe', 'recipe-within-master-band'],
      async handler(ctx, args: { countId: string; baleIds: string[]; blowRoomLine?: string }) {
        const count = await ctx.get<{ id: string; display: string }>('SELECT id,display FROM counts WHERE id=?', args.countId);
        ctx.check('count-exists', !!count, `Count ${args.countId} does not exist`, 'NOT_FOUND');
        ctx.check('bales-in-store', Array.isArray(args.baleIds) && args.baleIds.length >= 3, 'Select at least 3 bales', 'VALIDATION_FAILED');
        const bales: { id: string; bale_no: string; variety: string; weight_kg: number; status: string; mix_id: string | null; fibre: string }[] = [];
        for (const id of args.baleIds) { const b = await ctx.get<(typeof bales)[number]>('SELECT id,bale_no,variety,weight_kg,status,mix_id,fibre FROM bales WHERE id=?', id); ctx.check('bales-in-store', !!b && b.status === 'IN_STORE' && !b.mix_id, `Bale ${id} is missing, already issued or reserved`, 'CONFLICT'); bales.push(b!); }
        const book = await MasterBook.load(ctx.db);
        const cm = book.countMix(args.countId, ctx.timestamp);
        ctx.check('count-exists', !!cm, `No active Count & Mix master for ${args.countId}`, 'NOT_FOUND');
        const meta = cm!.meta as CountMixMeta;
        const baleComponents = meta.recipe.filter((c) => c.source === 'BALE');
        const unknown = bales.filter((b) => !baleComponents.some((c) => c.variety === b.variety));
        ctx.check('variety-in-recipe', unknown.length === 0, `Bale ${unknown[0]?.bale_no} (${unknown[0]?.variety}) is not part of the ${count?.display} recipe`, 'CONTRACT_REJECTED');
        const baleKg = bales.reduce((s, b) => s + Number(b.weight_kg), 0);
        const baleShare = baleComponents.reduce((s, c) => s + c.pct, 0) / 100;
        const totalKg = r1(baleKg / baleShare, 0);
        const recipe = meta.recipe.map((c) => {
          const kg = c.source === 'BALE' ? bales.filter((b) => b.variety === c.variety).reduce((s, b) => s + Number(b.weight_kg), 0) : totalKg - baleKg;
          return { key: c.key, label: c.label, source: c.source, pct: r1((kg / totalKg) * 100, 1), kg: r1(kg, 0), minPct: c.minPct, maxPct: c.maxPct };
        });
        for (const c of recipe) if (c.pct < c.minPct || c.pct > c.maxPct) { ctx.note(`recipe:${c.key}`, `${c.label} ${c.pct}% is outside the master band ${c.minPct}–${c.maxPct}% — flagged`); ctx.notify({ severity: 'warning', title: `Mix recipe deviation (${count?.display})`, body: `${c.label} is ${c.pct}% (master ${c.minPct}–${c.maxPct}%).`, link: '/masters' }); }
        const fibre = Object.fromEntries(FIBRE_KEYS.map((k) => [k, r1(bales.reduce((s, b) => s + (JSON.parse(b.fibre) as Record<string, number>)[k] * Number(b.weight_kg), 0) / baleKg, paramDef(k)?.decimals ?? 1)]));
        const no = await ctx.nextSeq('mix:2026');
        const id = `MIX-${String(no).padStart(3, '0')}`;
        const mix = await ctx.insert('mix', { id, mix_no: `M-${String(no).padStart(3, '0')}`, count_id: args.countId, status: 'PLANNED', planned_at: ctx.timestamp, issued_at: null, total_kg: totalKg, recipe: JSON.stringify(recipe), fibre: JSON.stringify(fibre), master_version_id: cm!.version.id, blow_room_line: args.blowRoomLine ?? 'BR-1', created_by: ctx.actor.id, created_at: ctx.timestamp });
        for (const b of bales) {
          await ctx.insert('mix_bale', { id: `MB-${id}-${b.id}`, mix_id: id, bale_id: b.id, kg_used: Number(b.weight_kg), pct: r1((Number(b.weight_kg) / totalKg) * 100, 1) });
          await ctx.update('bale', b.id, { mix_id: id });
        }
        ctx.setPayload({ mixId: id, countId: args.countId, baleIds: args.baleIds, recipe, masterVersion: cm!.version.id });
        return mix;
      },
    },
    registerLot: {
      key: 'AssetID.registerLot', description: 'Register a yarn lot on a mix', rules: ['mix-exists', 'kg-positive'],
      async handler(ctx, args: { mixId: string; plannedKg?: number }) {
        const mix = await ctx.get<{ id: string; count_id: string; status: string; total_kg: number; mix_no: string }>('SELECT id,count_id,status,total_kg,mix_no FROM mixes WHERE id=?', args.mixId);
        ctx.check('mix-exists', !!mix, `Mix ${args.mixId} does not exist`, 'NOT_FOUND');
        const kg = Number(args.plannedKg ?? mix!.total_kg / 2);
        ctx.check('kg-positive', kg > 100, 'Planned kg must be more than 100', 'VALIDATION_FAILED');
        const seq = await ctx.nextSeq('lot:2026');
        const earliest = await ctx.get<{ t: string }>('SELECT MIN(b.received_at) t FROM mix_bales mb JOIN bales b ON b.id=mb.bale_id WHERE mb.mix_id=?', mix!.id);
        const count = await ctx.get<{ uses_comber: number }>('SELECT uses_comber FROM counts WHERE id=?', mix!.count_id);
        const id = `LOT-${seq}`;
        const row = await ctx.insert('lot', { id, lot_no: String(seq), lot_code: `${mix!.count_id}-${seq}`, seq, year: 2026, count_id: mix!.count_id, mix_id: mix!.id, line: count?.uses_comber ? 'Compact' : 'Carded', status: mix!.status === 'ISSUED' ? 'IN_PRODUCTION' : 'PLANNED', planned_kg: kg, start_date: ctx.timestamp.slice(0, 10), end_date: null, qa_release_at: null, qa_release_by: null, created_at: ctx.timestamp });
        const baleKg = (await ctx.get<{ s: number }>('SELECT COALESCE(SUM(kg_used),0) s FROM mix_bales WHERE mix_id=?', mix!.id))?.s ?? 0;
        const lotCount = Number((await ctx.get<{ n: number }>('SELECT COUNT(*) n FROM lots WHERE mix_id=?', mix!.id))?.n ?? 1);
        await ctx.insert('stage_run', { id: await ctx.newId('SR'), lot_id: id, stage: 'BALE', machine_id: null, location: 'Bale store', shift: 'A', operator_id: ctx.actor.id, in_at: earliest?.t ?? ctx.timestamp, out_at: mix!.status === 'ISSUED' ? ctx.timestamp : null, input_kg: r1(Number(baleKg) / lotCount, 1), output_kg: r1(Number(baleKg) / lotCount, 1), waste_kg: 0, waste_type: null, batch_ref: `BALES-${mix!.mix_no}`, input_refs: '[]', params: '{}', accessories: '{}', notes: 'Bales reserved for the lot', created_at: ctx.timestamp });
        ctx.setPayload({ lotId: id, mixId: mix!.id, countId: mix!.count_id, plannedKg: kg });
        return row;
      },
    },
    registerCustomer: {
      key: 'AssetID.registerCustomer', description: 'Register a customer', rules: ['name-required', 'code-unique'],
      async handler(ctx, args: { code: string; name: string; city: string; contactName?: string; email?: string; phone?: string; address?: string }) {
        const code = String(args.code ?? '').trim().toUpperCase();
        ctx.check('name-required', code.length >= 2 && !!args.name?.trim() && !!args.city?.trim(), 'Code, name and city are required', 'VALIDATION_FAILED');
        ctx.check('code-unique', !(await ctx.get('SELECT id FROM customers WHERE code=?', code)), `Customer code ${code} already exists`, 'CONFLICT');
        const row = await ctx.insert('customer', { id: `CUST-${code}`, code, name: args.name.trim(), city: args.city.trim(), contact_name: args.contactName ?? '', email: args.email ?? '', phone: args.phone ?? '', address: args.address ?? '', created_at: ctx.timestamp });
        ctx.setPayload({ customerId: row.id, name: args.name });
        return row;
      },
    },
    registerMachine: {
      key: 'AssetID.registerMachine', description: 'Register a machine', rules: ['department-valid', 'machine-unique'],
      async handler(ctx, args: { department: Stage; machineNo: number; make?: string; model?: string; spindles?: number; line?: string }) {
        ctx.check('department-valid', STAGES.includes(args.department) && ['BR', 'CARD', 'DFB', 'DFF', 'COMB', 'FF', 'RF', 'AW'].includes(args.department), `${args.department} is not a machine department`, 'VALIDATION_FAILED');
        const id = `${args.department}-${args.machineNo}`;
        ctx.check('machine-unique', !(await ctx.get('SELECT id FROM machines WHERE id=?', id)), `Machine ${id} already exists`, 'CONFLICT');
        const row = await ctx.insert('machine', { id, department: args.department, machine_no: args.machineNo, label: `${args.department} ${args.machineNo}`, line: args.line ?? null, make: args.make ?? '', model: args.model ?? '', spindles: args.spindles ?? 0, created_at: ctx.timestamp });
        ctx.setPayload({ machineId: id });
        return row;
      },
    },
    anchorDocument: {
      key: 'AssetID.anchorDocument', description: 'Anchor a document by SHA-256', rules: ['sha256-format', 'size-limit'],
      async handler(ctx, args: { filename: string; mimeType: string; sizeBytes: number; sha256: string; storagePath: string; refType?: string; refId?: string }) {
        ctx.check('sha256-format', /^[0-9a-f]{64}$/.test(args.sha256), 'SHA-256 must be 64 hex characters', 'VALIDATION_FAILED');
        ctx.check('size-limit', args.sizeBytes > 0 && args.sizeBytes <= 8 * 1024 * 1024, 'Files must be between 1 byte and 8 MB', 'VALIDATION_FAILED');
        const row = await ctx.insert('document', { id: await ctx.newId('DOC', 4), sha256: args.sha256, filename: args.filename, mime_type: args.mimeType, size_bytes: args.sizeBytes, storage_path: args.storagePath, ref_type: args.refType ?? '', ref_id: args.refId ?? '', uploaded_by: ctx.actor.id, uploaded_at: ctx.timestamp });
        ctx.setPayload({ documentId: row.id, sha256: args.sha256, filename: args.filename });
        return row;
      },
    },
    issuePassport: {
      key: 'AssetID.issuePassport', description: 'Issue a public product passport for a dispatch', rules: ['dispatch-exists', 'not-issued'],
      async handler(ctx, args: { dispatchId: string }) {
        const dispatch = await ctx.get<{ id: string; passport_code: string }>('SELECT id,passport_code FROM dispatches WHERE id=?', args.dispatchId);
        ctx.check('dispatch-exists', !!dispatch, `Dispatch ${args.dispatchId} does not exist`, 'NOT_FOUND');
        ctx.check('not-issued', !(await ctx.get('SELECT code FROM passports WHERE dispatch_id=?', args.dispatchId)), 'Passport already issued', 'CONFLICT');
        const passport = await ctx.insert('passport', { code: dispatch!.passport_code, dispatch_id: args.dispatchId, issued_at: ctx.timestamp });
        ctx.setPayload({ dispatchId: args.dispatchId, passportCode: dispatch!.passport_code, issuedAt: ctx.timestamp, proofDigest: hashObject(passport) });
        return passport;
      },
    },
  },
};
void MASTER_TYPES;
