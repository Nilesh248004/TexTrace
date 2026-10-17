import { hashObject } from '../lib/hash';
import type { ContractModule } from './types';

export const AssetIdContract: ContractModule = {
  name: 'AssetID', description: 'Register and identify traceable assets',
  functions: {
    issuePassport: {
      key: 'AssetID.issuePassport', description: 'Issue a public product passport for a dispatch', rules: ['dispatch-exists','not-issued'],
      async handler(ctx,args:{dispatchId:string}) {
        const dispatch=await ctx.get<{id:string;passport_code:string}>('SELECT id,passport_code FROM dispatches WHERE id=?',args.dispatchId);
        ctx.check('dispatch-exists',!!dispatch,`Dispatch ${args.dispatchId} does not exist`,'NOT_FOUND');
        ctx.check('not-issued',!await ctx.get('SELECT code FROM passports WHERE dispatch_id=?',args.dispatchId),'Passport already issued','CONFLICT');
        const passport=await ctx.insert('passport',{code:dispatch?.passport_code,dispatch_id:args.dispatchId,issued_at:ctx.timestamp});
        ctx.setPayload({dispatchId:args.dispatchId,passportCode:dispatch?.passport_code,issuedAt:ctx.timestamp,proofDigest:hashObject(passport)});
        return passport;
      },
    },
  },
};