// ProcessEvent contract: bale issue, production stage runs (IN/OUT, quantities, machine parameters), accessory changes, packing.
import { ACCESSORY_INFO, ACCESSORY_KINDS, PARAMS, PROCESS_STAGES, STAGE_INFO, routeFor, shiftOf, type AccessoryKind, type Stage } from '@shared/params';
import { accessorySnapshot } from '../domain/accessories';
import { MasterBook } from '../domain/masters';
import { today } from '../lib/clock';
import type { ContractModule } from './types';

const r1 = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const isoOk = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s));

export const ProcessEventContract: ContractModule = {
  name: 'ProcessEvent',
  description: 'Production events: bale issue, stage runs, accessory changes, packing',
  functions: {
    issueBales: {
      key: 'ProcessEvent.issueBales', description: 'Issue the bales of a mix from the bale store to the blow room', rules: ['mix-exists', 'mix-planned', 'bales-in-store'],
      async handler(ctx, args: { mixId: string }) {
        const mix = await ctx.get<{ id: string; mix_no: string; status: string }>('SELECT id,mix_no,status FROM mixes WHERE id=?', args.mixId);
        ctx.check('mix-exists', !!mix, `Mix ${args.mixId} does not exist`, 'NOT_FOUND');
        ctx.check('mix-planned', mix?.status === 'PLANNED', `Mix ${mix?.mix_no} is already ${mix?.status}`, 'CONFLICT');
        const bales = await ctx.all<{ id: string; bale_no: string; status: string }>('SELECT b.id,b.bale_no,b.status FROM mix_bales mb JOIN bales b ON b.id=mb.bale_id WHERE mb.mix_id=?', args.mixId);
        ctx.check('bales-in-store', bales.length > 0 && bales.every((b) => b.status === 'IN_STORE'), 'Every bale of the mix must still be in the bale store', 'CONFLICT');
        for (const b of bales) await ctx.update('bale', b.id, { status: 'ISSUED', issued_at: ctx.timestamp, remaining_kg: 0, mix_id: args.mixId });
        await ctx.update('mix', args.mixId, { status: 'ISSUED', issued_at: ctx.timestamp });
        const lots = await ctx.all<{ id: string }>('SELECT id FROM lots WHERE mix_id=?', args.mixId);
        for (const l of lots) {
          const run = await ctx.get<{ id: string }>(`SELECT id FROM stage_runs WHERE lot_id=? AND stage='BALE' AND out_at IS NULL`, l.id);
          if (run) await ctx.update('stage_run', run.id, { out_at: ctx.timestamp, notes: `Bales ${bales.map((b) => b.bale_no).join(', ')} issued to blow room` });
          await ctx.update('lot', l.id, { status: 'IN_PRODUCTION' });
        }
        ctx.setPayload({ mixId: args.mixId, baleIds: bales.map((b) => b.id), lots: lots.map((l) => l.id) });
        return { mixId: args.mixId, bales: bales.length };
      },
    },
    logStageRun: {
      key: 'ProcessEvent.logStageRun', description: 'Log a production stage run on a machine', rules: ['lot-exists', 'stage-valid', 'mix-issued', 'stage-order', 'machine-in-department', 'time-window', 'quantities', 'mass-balance', 'params-keys'],
      async handler(ctx, args: { lotId: string; stage: Stage; machineId: string; inAt: string; outAt?: string | null; inputKg: number; outputKg: number; wasteKg: number; wasteType?: string; batchRef?: string; params?: Record<string, number>; notes?: string; operatorId?: string }) {
        const lot = await ctx.get<{ id: string; lot_no: string; count_id: string; mix_id: string; status: string; uses_comber: number }>('SELECT l.id,l.lot_no,l.count_id,l.mix_id,l.status,c.uses_comber FROM lots l JOIN counts c ON c.id=l.count_id WHERE l.id=?', args.lotId);
        ctx.check('lot-exists', !!lot, `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        ctx.check('stage-valid', PROCESS_STAGES.includes(args.stage) && (args.stage !== 'COMB' || !!lot?.uses_comber), `${args.stage} is not a production stage for this count`, 'VALIDATION_FAILED');
        ctx.check('lot-open', !['DISPATCHED', 'DELIVERED'].includes(lot!.status), `Lot ${lot?.lot_no} has already been dispatched`, 'CONFLICT');
        const mix = await ctx.get<{ status: string }>('SELECT status FROM mixes WHERE id=?', lot!.mix_id);
        ctx.check('mix-issued', mix?.status === 'ISSUED', 'The bales of this lot have not been issued from the bale store yet', 'CONFLICT');
        const route = routeFor(!!lot!.uses_comber).filter((s) => PROCESS_STAGES.includes(s));
        const idx = route.indexOf(args.stage);
        if (idx > 0) {
          const prev = route[idx - 1];
          const done = await ctx.get<{ n: number }>('SELECT COUNT(*) n FROM stage_runs WHERE lot_id=? AND stage=?', lot!.id, prev);
          ctx.check('stage-order', Number(done?.n) > 0, `${STAGE_INFO[args.stage].label} cannot start before ${STAGE_INFO[prev].label} has run for lot ${lot?.lot_no}`, 'CONTRACT_REJECTED');
        }
        const machine = await ctx.get<{ id: string; department: string; label: string }>('SELECT id,department,label FROM machines WHERE id=?', args.machineId);
        ctx.check('machine-in-department', !!machine && machine.department === args.stage, `${args.machineId} is not a ${STAGE_INFO[args.stage].label} machine`, 'VALIDATION_FAILED');
        ctx.check('time-window', isoOk(args.inAt) && (!args.outAt || (isoOk(args.outAt) && Date.parse(args.outAt) >= Date.parse(args.inAt))) && Date.parse(args.inAt) <= Date.parse(ctx.timestamp) + 60_000, 'IN time must be valid, not in the future, and not after OUT time', 'VALIDATION_FAILED');
        const inKg = Number(args.inputKg); const outKg = Number(args.outputKg); const wasteKg = Number(args.wasteKg);
        ctx.check('quantities', [inKg, outKg, wasteKg].every(Number.isFinite) && inKg > 0 && outKg >= 0 && wasteKg >= 0 && outKg <= inKg * 1.001, 'Quantities must be positive and output cannot exceed input', 'VALIDATION_FAILED');
        const diffPct = (Math.abs(inKg - outKg - wasteKg) / inKg) * 100;
        ctx.check('mass-balance', !args.outAt || diffPct <= 5, `Mass balance off by ${diffPct.toFixed(1)}% (input ${inKg} ≠ output ${outKg} + waste ${wasteKg})`, 'VALIDATION_FAILED');
        if (args.outAt && diffPct > 0.3) {
          ctx.note('mass-balance-breach', `Unaccounted ${r1(inKg - outKg - wasteKg)} kg (${diffPct.toFixed(2)}%) — flagged`);
          ctx.notify({ severity: 'warning', title: `Mass-balance breach on lot ${lot?.lot_no}`, body: `${machine?.label}: ${diffPct.toFixed(1)}% of input is unaccounted.`, link: `/lots/${lot?.id}` });
        }
        const allowed = new Set(PARAMS.filter((p) => p.kind === 'PRODUCTION' && p.stages.includes(args.stage)).map((p) => p.key));
        const params: Record<string, number> = { ...(args.params ?? {}) };
        const badKeys = Object.keys(params).filter((k) => !allowed.has(k) || !Number.isFinite(Number(params[k])));
        ctx.check('params-keys', badKeys.length === 0, `Unsupported production parameters for ${args.stage}: ${badKeys.join(', ')}`, 'VALIDATION_FAILED');
        if (args.outAt) { params.WASTE_PCT ??= r1((wasteKg / inKg) * 100, 2); params.YIELD_PCT ??= r1((outKg / inKg) * 100, 1); }
        const book = await MasterBook.load(ctx.db);
        const flagged: string[] = [];
        for (const [k, v] of Object.entries(params)) {
          const j = book.judge(lot!.count_id, 'PRODUCTION', args.stage, k, Number(v), args.inAt);
          if (j.color === 'red' || j.color === 'yellow') { ctx.note(`master:${args.stage}:${k}`, `${j.label} ${v} is ${j.color.toUpperCase()} (master ${j.lower ?? '–'} … ${j.std} … ${j.upper ?? '–'}, v${j.versionNo})`); if (j.color === 'red') flagged.push(`${j.label} ${v}`); }
        }
        if (flagged.length) ctx.notify({ severity: 'warning', title: `${machine?.label}: out-of-master settings`, body: `Lot ${lot?.lot_no}: ${flagged.slice(0, 3).join('; ')}`, link: `/lots/${lot?.id}` });
        const id = await ctx.newId('SR');
        const acc = await accessorySnapshot(ctx.db, args.machineId, args.stage, args.inAt);
        const accJudged = Object.entries(acc).filter(([k]) => k !== 'specs');
        for (const [k, v] of accJudged) { const j = book.judge(lot!.count_id, 'ACCESSORIES', args.stage, k, Number(v), args.inAt); if (j.color === 'red') { ctx.note(`accessory:${k}`, `${j.label} ${v} exceeds master ${j.upper}`); ctx.notify({ severity: 'warning', title: `${machine?.label}: ${j.label} overdue`, body: `${v} vs master limit ${j.upper} (lot ${lot?.lot_no})`, link: '/accessories' }); } }
        const row = await ctx.insert('stage_run', {
          id, lot_id: lot!.id, stage: args.stage, machine_id: args.machineId, location: null, shift: shiftOf(args.inAt), operator_id: args.operatorId ?? ctx.actor.id, in_at: args.inAt, out_at: args.outAt ?? null,
          input_kg: inKg, output_kg: outKg, waste_kg: wasteKg, waste_type: args.wasteType ?? null, batch_ref: args.batchRef ?? `${args.stage}-L${lot!.lot_no}-${machine!.id}`, input_refs: '[]', params: JSON.stringify(params), accessories: JSON.stringify(acc), notes: args.notes ?? '', created_at: ctx.timestamp,
        });
        ctx.setPayload({ stageRunId: id, lotId: lot!.id, stage: args.stage, machineId: args.machineId, inAt: args.inAt, outAt: args.outAt ?? null, inputKg: inKg, outputKg: outKg, wasteKg });
        return row;
      },
    },
    recordAccessoryChange: {
      key: 'ProcessEvent.recordAccessoryChange', description: 'Record a traveller / cot / apron / spacer change on a machine', rules: ['machine-exists', 'kind-valid', 'kind-fits-department', 'time-valid'],
      async handler(ctx, args: { machineId: string; kind: AccessoryKind; spec?: string; value?: number | null; changedAt?: string; note?: string }) {
        const machine = await ctx.get<{ id: string; department: Stage; label: string }>('SELECT id,department,label FROM machines WHERE id=?', args.machineId);
        ctx.check('machine-exists', !!machine, `Machine ${args.machineId} does not exist`, 'NOT_FOUND');
        ctx.check('kind-valid', ACCESSORY_KINDS.includes(args.kind), `Unknown accessory kind ${args.kind}`, 'VALIDATION_FAILED');
        ctx.check('kind-fits-department', ACCESSORY_INFO[args.kind].stages.includes(machine!.department), `${ACCESSORY_INFO[args.kind].label} does not apply to ${machine?.label}`, 'VALIDATION_FAILED');
        const at = args.changedAt ?? ctx.timestamp;
        ctx.check('time-valid', isoOk(at) && Date.parse(at) <= Date.parse(ctx.timestamp) + 60_000, 'Change time must be valid and not in the future', 'VALIDATION_FAILED');
        const row = await ctx.insert('accessory_change', { id: await ctx.newId('AC'), machine_id: args.machineId, kind: args.kind, spec: args.spec ?? '', value: args.value ?? null, changed_at: at, changed_by: ctx.actor.id, note: args.note ?? '', created_at: ctx.timestamp });
        ctx.setPayload({ machineId: args.machineId, kind: args.kind, spec: args.spec ?? '', changedAt: at });
        return row;
      },
    },
    recordPacking: {
      key: 'ProcessEvent.recordPacking', description: 'Record packing of a lot; cone colour is verified against the Color Code master', rules: ['lot-exists', 'winding-complete', 'not-packed', 'quantities', 'cartons-consistent', 'mass-balance-packing', 'color-code-verified'],
      async handler(ctx, args: { lotId: string; cones: number; cartons: number; colorActual: string; netKg?: number; tareKg?: number; packedAt?: string; fgLocation?: string; notes?: string }) {
        const lot = await ctx.get<{ id: string; lot_no: string; count_id: string; status: string }>('SELECT id,lot_no,count_id,status FROM lots WHERE id=?', args.lotId);
        ctx.check('lot-exists', !!lot, `Lot ${args.lotId} does not exist`, 'NOT_FOUND');
        const aw = await ctx.all<{ output_kg: number; out_at: string | null }>(`SELECT output_kg,out_at FROM stage_runs WHERE lot_id=? AND stage='AW'`, lot!.id);
        ctx.check('winding-complete', aw.length > 0 && aw.every((r) => r.out_at), 'Winding must be complete before packing', 'CONTRACT_REJECTED');
        ctx.check('not-packed', !(await ctx.get('SELECT id FROM packing WHERE lot_id=?', lot!.id)), `Lot ${lot?.lot_no} is already packed`, 'CONFLICT');
        const awKg = aw.reduce((s, r) => s + Number(r.output_kg), 0);
        const cones = Math.round(Number(args.cones)); const cartons = Math.round(Number(args.cartons));
        ctx.check('quantities', cones > 0 && cartons > 0 && cones >= cartons, 'Cones and cartons must be positive', 'VALIDATION_FAILED');
        const at = args.packedAt ?? ctx.timestamp;
        const book = await MasterBook.load(ctx.db);
        const cpc = book.item(lot!.count_id, 'ACCESSORIES', 'PACK', 'CONES_PER_CARTON', at)?.item.std ?? 24;
        ctx.check('cartons-consistent', cartons === Math.ceil(cones / cpc), `${cones} cones need ${Math.ceil(cones / cpc)} cartons of ${cpc} cones (Accessories master) — ${cartons} entered`, 'VALIDATION_FAILED');
        const partial = cones % cpc;
        const coneKg = book.item(lot!.count_id, 'ACCESSORIES', 'PACK', 'NET_WT_CONE', at)?.item.std ?? 2;
        const tareStd = book.item(lot!.count_id, 'ACCESSORIES', 'PACK', 'CARTON_TARE', at)?.item.std ?? 1;
        const net = r1(args.netKg ?? Math.min(awKg, cones * coneKg), 1);
        ctx.check('mass-balance-packing', net <= awKg * 1.005, `Net ${net} kg is more than the ${r1(awKg)} kg wound`, 'CONTRACT_REJECTED');
        const tare = r1(args.tareKg ?? cartons * tareStd, 2);
        const color = book.color(lot!.count_id, at)?.meta;
        const masterName = color?.colorName ?? 'Unspecified';
        const colorOk = String(args.colorActual).trim().toLowerCase() === masterName.toLowerCase();
        ctx.note('color-code', colorOk ? `Cone colour ${args.colorActual} matches the master` : `Cone colour ${args.colorActual} ≠ master ${masterName} — mismatch flagged`);
        if (!colorOk) ctx.notify({ severity: 'warning', title: `Cone colour mismatch at packing (lot ${lot?.lot_no})`, body: `Packed with ${args.colorActual}; master colour for this count is ${masterName}.`, link: `/lots/${lot?.id}` });
        const perCone = net / cones; const coneJ = book.judge(lot!.count_id, 'ACCESSORIES', 'PACK', 'NET_WT_CONE', perCone, at);
        if (coneJ.color === 'red') ctx.note('cone-weight', `Average cone ${perCone.toFixed(2)} kg is outside master ${coneJ.lower}–${coneJ.upper}`);
        const meta = book.accessories(lot!.count_id, at)?.meta;
        const slip = `PS/${today().slice(2, 4)}/${String(await ctx.nextSeq('slip:2026')).padStart(4, '0')}`;
        const id = await ctx.newId('PK');
        const bay = args.fgLocation || `FG-${'ABC'[cartons % 3]}${(cartons % 8) + 1}`;
        const row = await ctx.insert('packing', {
          id, lot_id: lot!.id, packed_at: at, packer_id: ctx.actor.id, package_type: meta?.packageType ?? 'CONE', cones_packed: cones, partial_cones: partial, cartons, net_kg: net, tare_kg: tare, gross_kg: r1(net + tare, 1), avg_cone_kg: r1(perCone, 3),
          color_actual: args.colorActual, color_master: masterName, color_ok: colorOk ? 1 : 0, slip_no: slip, carton_from: `C-${lot!.lot_no}-001`, carton_to: `C-${lot!.lot_no}-${String(cartons).padStart(3, '0')}`,
          label_template: meta?.labelTemplate ?? '', pallets: Math.ceil(cartons / 20), fg_location: bay, notes: args.notes ?? '', created_at: ctx.timestamp,
        });
        const inAt = new Date(Math.max(Date.parse(at) - 90 * 60_000, Math.max(...aw.map((r) => Date.parse(r.out_at as string))))).toISOString();
        const common = { lot_id: lot!.id, machine_id: null, shift: shiftOf(at), operator_id: ctx.actor.id, input_refs: '[]', params: '{}', accessories: '{}', created_at: ctx.timestamp };
        await ctx.insert('stage_run', { ...common, id: await ctx.newId('SR'), stage: 'PACK', location: 'Packing hall', in_at: inAt, out_at: at, input_kg: r1(awKg, 1), output_kg: net, waste_kg: r1(Math.max(0, awKg - net), 1), waste_type: 'Unpacked ends / rewind', batch_ref: `PK-L${lot!.lot_no}`, notes: `${cones} cones in ${cartons} cartons${partial ? ` (last carton ${partial} of ${cpc} cones)` : ''}` });
        await ctx.insert('stage_run', { ...common, id: await ctx.newId('SR'), stage: 'FG', location: bay, in_at: at, out_at: null, input_kg: net, output_kg: net, waste_kg: 0, waste_type: null, batch_ref: `PK-L${lot!.lot_no}`, notes: 'Awaiting QA release and dispatch' });
        await ctx.update('lot', lot!.id, { status: lot!.status === 'ON_HOLD' ? 'ON_HOLD' : 'PACKED', end_date: at.slice(0, 10) });
        ctx.setPayload({ packingId: id, lotId: lot!.id, cartons, cones, netKg: net, colorActual: args.colorActual, colorMaster: masterName, colorOk });
        return row;
      },
    },
  },
};
