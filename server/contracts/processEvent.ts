import { STAGE_ORDER } from '@shared/params';
import { paramsFor } from '@shared/params';
import type { ContractModule } from './types';

export const ProcessEventContract:ContractModule={
  name:'ProcessEvent',description:'Record production stage events and packing operations',
  functions:{
    logStageEvent:{
      key:'ProcessEvent.logStageEvent',description:'Log a lot production event at a department',rules:['lot-exists','lot-open','stage-order','machine-required','machine-dept','machine-line','mass-balance:event','date-window','params-keys'],
      async handler(ctx,args:{lotId:string;department:string;machineId?:string|null;eventDate:string;shift?:string|null;inputKg:number;outputKg:number;wasteKg:number;params:Record<string,number>;notes?:string}){
        const lot=await ctx.get<{id:string;lot_no:string;line:string;status:string;start_date:string;count_id:string}>('SELECT * FROM lots WHERE id=?',args.lotId);
        ctx.check('lot-exists',!!lot,`Lot ${args.lotId} does not exist`,'NOT_FOUND');
        ctx.check('lot-open',lot?.status!=='DISPATCHED'||args.department==='PACK',`Lot ${lot?.lot_no} is already dispatched`,'CONFLICT');
        const stageIndex=STAGE_ORDER.indexOf(args.department as never);
        ctx.check('stage-valid',stageIndex>=0&&args.department!=='PACK',`Production department ${args.department} is invalid`,'VALIDATION_FAILED');
        if(stageIndex>0){const prev=STAGE_ORDER[stageIndex-1];ctx.check('stage-order',!!await ctx.get('SELECT id FROM production_events WHERE lot_id=? AND department=? LIMIT 1',args.lotId,prev),`Stage order violation: cannot log ${args.department} before ${prev} has started for lot ${lot?.lot_no}`);}
        const needsMachine=['CARD','DF','FF','RF','AW'].includes(args.department);
        ctx.check('machine-required',!needsMachine||!!args.machineId,`${args.department} events require a machine`,`VALIDATION_FAILED`);
        if(args.machineId){const machine=await ctx.get<{department:string;line:string|null}>('SELECT department,line FROM machines WHERE id=?',args.machineId);ctx.check('machine-dept',!!machine&&machine.department===args.department,`Machine ${args.machineId} does not belong to ${args.department}`);ctx.check('machine-line',!!machine&&machine.line===lot?.line,`Machine ${args.machineId} is not on line ${lot?.line}`);}
        const massError=Math.abs(args.inputKg-(args.outputKg+args.wasteKg));ctx.check('mass-balance:event',args.inputKg>0&&args.outputKg>=0&&args.wasteKg>=0&&massError<=args.inputKg*.005+.5,`Mass balance: input ${args.inputKg.toFixed(1)} kg must equal output + waste (${(args.outputKg+args.wasteKg).toFixed(1)} kg)`,'VALIDATION_FAILED');
        ctx.check('date-window',!!lot&&args.eventDate>=lot.start_date&&args.eventDate<=ctx.settings.businessDate,'Event date must be between lot start date and business date','VALIDATION_FAILED');
        const allowed=paramsFor(args.department as never,'PROCESS').map((parameter)=>parameter.key);
        ctx.check('params-keys',Object.entries(args.params??{}).every(([key,value])=>allowed.includes(key)&&Number.isFinite(value)),'Process values contain unsupported or non-finite parameters','VALIDATION_FAILED');
        const previousStages=await ctx.all<{output:number|string|null}>('SELECT SUM(output_kg) output FROM production_events WHERE lot_id=? AND department=?',args.lotId,STAGE_ORDER[stageIndex-1]??'RM');
        if(stageIndex>0&&previousStages[0]?.output!==null&&previousStages[0]?.output!==undefined)ctx.check('mass-balance:stage',args.outputKg<=Number(previousStages[0].output)*1.01+1,`Stage output ${args.outputKg.toFixed(1)} kg exceeds upstream cumulative output`);
        const dayIndex=(await ctx.all<{event_date:string}>('SELECT DISTINCT event_date FROM production_events WHERE lot_id=? AND department=? AND event_date<=? ORDER BY event_date',args.lotId,args.department,args.eventDate)).length+1;
        const id=await ctx.newId('PE');
        const event=await ctx.insert('production_event',{id,lot_id:args.lotId,department:args.department,machine_id:args.machineId??null,event_date:args.eventDate,day_index:dayIndex,shift:args.shift??null,input_kg:args.inputKg,output_kg:args.outputKg,waste_kg:args.wasteKg,params:JSON.stringify(args.params??{}),notes:args.notes??'',operator_id:ctx.actor.id,created_at:ctx.timestamp});
        if(lot?.status==='PLANNED')await ctx.update('lot',lot.id,{status:'IN_PRODUCTION'});
        ctx.setPayload({eventId:id,lotId:args.lotId,department:args.department,machineId:args.machineId??null,eventDate:args.eventDate,inputKg:args.inputKg,outputKg:args.outputKg,wasteKg:args.wasteKg,params:args.params??{}});
        return event;
      },
    },
    recordPacking:{
      key:'ProcessEvent.recordPacking',description:'Record finished-yarn packs for a lot',rules:['lot-exists','aw-started','pack-weight','packs-positive','mass-balance:packing','date-window'],
      async handler(ctx,args:{lotId:string;packDate:string;packWeightKg:number;packsCount:number;conesPerPack:number}){
        const lot=await ctx.get<{id:string;lot_no:string;status:string;start_date:string}>('SELECT * FROM lots WHERE id=?',args.lotId);
        ctx.check('lot-exists',!!lot,`Lot ${args.lotId} does not exist`,'NOT_FOUND');
        const aw=await ctx.get<{kg:number|string}>('SELECT COALESCE(SUM(output_kg),0) kg FROM production_events WHERE lot_id=? AND department=\'AW\'',args.lotId);
        ctx.check('aw-started',Number(aw?.kg)>0,`Autoconer production has not started for lot ${lot?.lot_no}`);
        ctx.check('pack-weight',args.packWeightKg>=10&&args.packWeightKg<=100,'Pack weight must be between 10 and 100 kg','VALIDATION_FAILED');
        ctx.check('packs-positive',Number.isInteger(args.packsCount)&&args.packsCount>0&&Number.isInteger(args.conesPerPack)&&args.conesPerPack>0,'Pack and cone counts must be positive integers','VALIDATION_FAILED');
        const totalKg=args.packWeightKg*args.packsCount;const prior=await ctx.get<{kg:number|string}>('SELECT COALESCE(SUM(total_kg),0) kg FROM packing WHERE lot_id=?',args.lotId);
        ctx.check('mass-balance:packing',Number(prior?.kg??0)+totalKg<=Number(aw?.kg??0)*1.005,`Packed quantity ${(Number(prior?.kg??0)+totalKg).toFixed(1)} kg exceeds autoconer output`);
        ctx.check('date-window',!!lot&&args.packDate>=lot.start_date&&args.packDate<=ctx.settings.businessDate,'Packing date must fall within the lot production window','VALIDATION_FAILED');
        const seq=await ctx.nextSeq(`pack:${args.lotId}`);const from=seq;const to=seq+args.packsCount-1;
        await ctx.db.prepare('INSERT INTO sequences(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=CASE WHEN sequences.value>excluded.value THEN sequences.value ELSE excluded.value END').run(`pack:${args.lotId}`,to);
        const packing=await ctx.insert('packing',{id:await ctx.newId('PK'),lot_id:args.lotId,pack_date:args.packDate,pack_weight_kg:args.packWeightKg,packs_count:args.packsCount,cones_per_pack:args.conesPerPack,total_kg:totalKg,pack_from:`P${String(lot?.lot_no).split('/')[0]}-${String(from).padStart(4,'0')}`,pack_to:`P${String(lot?.lot_no).split('/')[0]}-${String(to).padStart(4,'0')}`,created_by:ctx.actor.id,created_at:ctx.timestamp});
        if(lot?.status==='IN_PRODUCTION')await ctx.update('lot',lot.id,{status:'PACKED'});
        ctx.setPayload({packingId:packing.id,lotId:args.lotId,packDate:args.packDate,totalKg,packsCount:args.packsCount,packWeightKg:args.packWeightKg});
        return packing;
      },
    },
  },
};