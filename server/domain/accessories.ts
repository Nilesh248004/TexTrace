// Accessory ages (traveller, cots, aprons, spacer, card wire …) derived from the accessory_changes history.
import type { DB } from '../db';
import { ACCESSORY_INFO, type AccessoryKind, type Stage } from '@shared/params';

const DAY = 86_400_000;

export interface AccessoryAge { kind: AccessoryKind; param: string; spec: string; value: number | null; changedAt: string; ageDays: number | null }

export async function accessoryAgesAt(db: DB, machineId: string, stage: Stage, atIso: string): Promise<AccessoryAge[]> {
  const rows = await db.prepare('SELECT kind,spec,value,changed_at FROM accessory_changes WHERE machine_id=? AND changed_at<=? ORDER BY changed_at').all<{ kind: AccessoryKind; spec: string; value: number | null; changed_at: string }>(machineId, atIso);
  const last = new Map<AccessoryKind, (typeof rows)[number]>();
  for (const r of rows) last.set(r.kind, r);
  const at = Date.parse(atIso);
  const out: AccessoryAge[] = [];
  for (const [kind, r] of last) {
    const info = ACCESSORY_INFO[kind];
    if (!info || !info.stages.includes(stage)) continue;
    out.push({ kind, param: info.param, spec: r.spec, value: r.value, changedAt: r.changed_at, ageDays: kind === 'SPACER' ? null : Math.floor((at - Date.parse(r.changed_at)) / DAY) });
  }
  return out;
}

/** Snapshot stored on a stage run: { TRAVELLER_AGE_DAYS: 29, …, specs: { TRAVELLER: 'C1 EL 4/0' } }. */
export async function accessorySnapshot(db: DB, machineId: string, stage: Stage, atIso: string): Promise<Record<string, unknown>> {
  const ages = await accessoryAgesAt(db, machineId, stage, atIso);
  const out: Record<string, unknown> = {}; const specs: Record<string, string> = {};
  for (const a of ages) { out[a.param] = a.kind === 'SPACER' ? a.value : a.ageDays; specs[a.kind] = a.spec; }
  return { ...out, specs };
}
