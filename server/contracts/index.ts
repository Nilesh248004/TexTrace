import { AccessContract } from './access';
import { QualityContract } from './quality';
import { AssetIdContract } from './assetId';
import { TransferContract } from './transfer';
import { ProcessEventContract } from './processEvent';
import type { ContractModule } from './types';

export const CONTRACT_MODULES: ContractModule[] = [AccessContract, AssetIdContract, ProcessEventContract, QualityContract, TransferContract];
