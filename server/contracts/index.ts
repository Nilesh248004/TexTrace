import { AccessContract } from './access';
import { QualityContract } from './quality';
import { AssetIdContract } from './assetId';
import { TransferContract } from './transfer';
import { ProcessEventContract } from './processEvent';
import { MasterContract } from './master';
import type { ContractModule } from './types';

export const CONTRACT_MODULES: ContractModule[] = [AccessContract, AssetIdContract, ProcessEventContract, QualityContract, MasterContract, TransferContract];
