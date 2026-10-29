import { evaluate, type QualityColor } from '@shared/quality';
import type { MasterType, Scope } from '@shared/params';
import type { MasterVersionDTO } from '@shared/domain';
import { useGet } from './api';

export interface MasterRow { scope: Scope; parameter: string; std: number | null; lower: number | null; upper: number | null; unit: string; missing: boolean }
interface Overview { counts: { id: string; versions: MasterVersionDTO[] }[] }
interface VersionPayload { version: MasterVersionDTO; items: MasterRow[] }

/** Items of the ACTIVE master of a type for a count (used for live colour previews while typing results). */
export function useActiveMaster(countId: string | null | undefined, type: MasterType): { rows: MasterRow[]; versionNo: number | null; find: (scope: string, key: string) => MasterRow | undefined } {
  const ov = useGet<Overview>('/api/masters/overview');
  const id = countId ? ov.data?.counts.find((c) => c.id === countId)?.versions.find((v) => v.masterType === type && v.status === 'ACTIVE')?.id ?? null : null;
  const v = useGet<VersionPayload>(id ? `/api/masters/versions/${id}` : null);
  const rows = (v.data?.items ?? []).filter((r) => !r.missing);
  return { rows, versionNo: v.data?.version.versionNo ?? null, find: (scope, key) => rows.find((r) => r.scope === scope && r.parameter === key) };
}

export function previewColor(row: MasterRow | undefined, value: number | null): QualityColor {
  if (!row || value === null || Number.isNaN(value) || row.std === null) return 'none';
  return evaluate(value, { std: row.std, lower: row.lower, upper: row.upper }).color;
}
