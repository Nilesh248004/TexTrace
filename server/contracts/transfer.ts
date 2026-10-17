import type { GateResult } from '@shared/types';
import { sha256Hex } from '../lib/hash';
import type { ContractModule } from './types';

export const TransferContract: ContractModule = {
  name: 'Transfer', description: 'Transfer custody of packed yarn to customers',
  functions: {
    createDispatch: {
      key:'Transfer.createDispatch',description:'Create a quality-gated customer dispatch',rules:['customer-exists','lots-present','lot-count-match','quantity-positive','mass-balance-custody','quality-gate','pack-weight','vehicle-format','lr-required','dispatch-date'],
      handler(ctx,args:{customerId:string;countId:string;dispatchDate:string;lots:{lotId:string;quantityKg:number}[];packWeightKg:number;conesCount?:number;vehicleNo:string;lrNo:string;invoiceNo?:string;gate:GateResult;seq?:number}) {
        const customer=ctx.get<{id:string}>('SELECT id FROM customers WHERE id=?',args.customerId);
        ctx.check('customer-exists',!!customer,`Customer ${args.customerId} does not exist`,'NOT_FOUND');
        ctx.check('lots-present',args.lots.length>0,'At least one lot is required','VALIDATION_FAILED');
        ctx.check('pack-weight',args.packWeightKg>=10&&args.packWeightKg<=100,'Pack weight must be between 10 and 100 kg','VALIDATION_FAILED');
        ctx.check('vehicle-format',/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{3,4}$/i.test(args.vehicleNo),'Vehicle registration format is invalid','VALIDATION_FAILED');
        ctx.check('lr-required',String(args.lrNo??'').trim().length>0,'Lorry receipt number is required','VALIDATION_FAILED');
        const unique=new Set(args.lots.map((lot)=>lot.lotId));
        ctx.check('lots-unique',unique.size===args.lots.length,'A lot may only appear once in a dispatch','VALIDATION_FAILED');
        const lotRows=args.lots.map((entry)=>{const lot=ctx.get<{id:string;lot_no:string;count_id:string;status:string}>('SELECT id,lot_no,count_id,status FROM lots WHERE id=?',entry.lotId);const packing=ctx.get<{pack_date:string;packed:number;dispatched:number;cones:number}>('SELECT MIN(pack_date) pack_date,COALESCE(SUM(total_kg),0) packed,COALESCE((SELECT SUM(quantity_kg) FROM dispatch_lots WHERE lot_id=?),0) dispatched,COALESCE(MAX(cones_per_pack),30) cones FROM packing WHERE lot_id=?',entry.lotId,entry.lotId);return {entry,lot,packing};});
        ctx.check('lot-count-match',lotRows.every(({lot})=>lot?.count_id===args.countId),`Every lot must have count ${args.countId}`,'VALIDATION_FAILED');
        ctx.check('quantity-positive',lotRows.every(({entry})=>Number.isFinite(entry.quantityKg)&&entry.quantityKg>0),'Dispatch quantities must be positive','VALIDATION_FAILED');
        for(const {entry,lot,packing} of lotRows){ctx.check('mass-balance:custody',!!lot&&!!packing&&entry.quantityKg<=packing.packed-packing.dispatched+0.01,`Mass balance: lot ${lot?.lot_no??entry.lotId} has ${packing?.packed.toFixed(1)??'0.0'} kg packed & undispatched, requested ${entry.quantityKg.toFixed(1)} kg`);ctx.check('dispatch-date',!!packing?.pack_date&&args.dispatchDate>=packing.pack_date&&args.dispatchDate<=ctx.settings.businessDate,`Dispatch date for ${lot?.lot_no??entry.lotId} must follow packing and not exceed business date`);}
        ctx.check('quality-gate',args.gate.passed,'Quality gate has blocked lots. Record a QA override before dispatching.');
        const year=Number(args.dispatchDate.slice(0,4));const seq=args.seq??ctx.nextSeq(`dispatch:${year}`);if(args.seq)ctx.db.prepare('INSERT INTO sequences(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=MAX(value,excluded.value)').run(`dispatch:${year}`,args.seq);
        const id=`DSP-${year}-${String(seq).padStart(4,'0')}`;const totalKg=args.lots.reduce((sum,lot)=>sum+lot.quantityKg,0);const packsCount=Math.ceil(totalKg/args.packWeightKg);const inferredCones=lotRows.reduce((sum,item)=>sum+Math.ceil(item.entry.quantityKg/args.packWeightKg)*(item.packing?.cones??30),0);const conesCount=args.conesCount??inferredCones;const passportCode=`PP-${sha256Hex(`${id}:${ctx.timestamp}`).slice(0,8).toUpperCase()}`;
        const dispatch=ctx.insert('dispatch',{id,dispatch_no:`DSP/${year}/${String(seq).padStart(4,'0')}`,customer_id:args.customerId,count_id:args.countId,quantity_kg:totalKg,dispatch_date:args.dispatchDate,pack_weight_kg:args.packWeightKg,packs_count:packsCount,cones_count:conesCount,vehicle_no:args.vehicleNo.trim().toUpperCase(),lr_no:args.lrNo.trim(),invoice_no:args.invoiceNo??'',gate:JSON.stringify(args.gate),override_ids:JSON.stringify(args.gate.lots.map((lot)=>lot.overrideId).filter(Boolean)),passport_code:passportCode,status:'DISPATCHED',created_by:ctx.actor.id,created_at:ctx.timestamp});
        for(const {entry,lot} of lotRows){ctx.insert('dispatch_lot',{id:`DL-${id}-${entry.lotId}`,dispatch_id:id,lot_id:entry.lotId,quantity_kg:entry.quantityKg});if(lot&&lot.status!=='DISPATCHED')ctx.update('lot',lot.id,{status:'DISPATCHED'});}
        ctx.setPayload({dispatchId:id,dispatchNo:dispatch.dispatch_no,customerId:args.customerId,countId:args.countId,lots:args.lots,quantityKg:totalKg,passportCode,gate:{passed:args.gate.passed,overridden:args.gate.overridden}});
        ctx.notify({severity:'info',title:`Dispatch ${dispatch.dispatch_no}`,body:`${totalKg.toFixed(1)} kg transferred to customer.`,link:`/dispatch/${id}`});
        return dispatch;
      },
    },
  },
};