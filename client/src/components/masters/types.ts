import type { Completeness, LensItem, MasterItemDTO, MasterVersionDTO } from '@shared/domain';
import type { ComplaintType, MasterType } from '@shared/params';
import type { OnChainRef } from '@shared/types';

export interface MasterCountOverview {
  id: string;
  display: string;
  label: string;
  usesComber: boolean;
  completeness: Completeness;
  versions: MasterVersionDTO[];
}
export interface MastersOverview { types: MasterType[]; counts: MasterCountOverview[] }

/** One template row of a master version (a missing row has no id and a null std). */
export interface MasterRow extends Omit<MasterItemDTO, 'id' | 'std'> {
  id: string | null;
  std: number | null;
  prev: { std: number; lower: number | null; upper: number | null } | null;
  missing: boolean;
  chain?: OnChainRef;
}
export interface MasterVersionDetail {
  version: MasterVersionDTO;
  items: MasterRow[];
  previousVersionNo: number | null;
  completeness: Completeness;
  editable: boolean;
}

export interface LensMaster {
  complaintType: ComplaintType;
  items: LensItem[];
  updatedBy: string | null;
  updatedAt: string | null;
  chain: OnChainRef | null;
}
export interface ColorCode { countId: string; display: string; colorName: string; hex: string; tip: string; code: string }

export interface ImportPreview { ok: boolean; rows: number; errors: string[] }
