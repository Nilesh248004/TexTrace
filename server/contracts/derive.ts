// Derived lot quantities (never stored, SPEC §3) and day-index helpers.
// Shared by the contracts (mass-balance rules) and the read services (lot views, dashboards).
import type { DB } from '../db';
import { DEPARTMENTS, STAGE_ORDER, type Department } from '@shared/params';

export interface LotQuantities {
  /** Σ AW (autoconer) output_kg — finished yarn on cones. */
  producedKg: number;
  /** Σ packing.total_kg */
  packedKg: number;
  /** Σ dispatch_lots.quantity_kg */
  dispatchedKg: number;
  /** Last stage (STAGE_ORDER) with at least one production event; PACK when packing exists; RM when nothing yet. */
  currentStage: Department;
}

export interface StageOutput {
  inputKg: number;
  outputKg: number;
  wasteKg: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Number of distinct production dates (D1..Dn). */
  days: number;
}

/** Round to gram precision to keep float noise out of sums (display rounding is 1 decimal). */
export function roundKg(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}

export async function lotQuantities(db: DB, lotId: string): Promise<LotQuantities> {
  const produced = await db
    .prepare(`SELECT COALESCE(SUM(output_kg), 0) AS kg FROM production_events WHERE lot_id = ? AND department = 'AW'`)
    .get<{ kg: number | string }>(lotId);
  const packed = await db
    .prepare(`SELECT COALESCE(SUM(total_kg), 0) AS kg, COUNT(*) AS n FROM packing WHERE lot_id = ?`)
    .get<{ kg: number | string; n: number | string }>(lotId);
  const dispatched = await db
    .prepare(`SELECT COALESCE(SUM(quantity_kg), 0) AS kg FROM dispatch_lots WHERE lot_id = ?`)
    .get<{ kg: number | string }>(lotId);
  const depts = await db
    .prepare(`SELECT DISTINCT department FROM production_events WHERE lot_id = ?`)
    .all<{ department: string }>(lotId);

  let currentStage: Department = 'RM';
  if (Number(packed?.n ?? 0) > 0) {
    currentStage = 'PACK';
  } else {
    const present = new Set(depts.map((d) => d.department));
    for (const d of STAGE_ORDER) if (present.has(d)) currentStage = d;
  }
  return {
    producedKg: roundKg(Number(produced?.kg ?? 0)),
    packedKg: roundKg(Number(packed?.kg ?? 0)),
    dispatchedKg: roundKg(Number(dispatched?.kg ?? 0)),
    currentStage,
  };
}

/** Per-department totals of the lot's production events (every department present, zeros when no events). */
export async function stageOutputs(db: DB, lotId: string): Promise<Record<Department, StageOutput>> {
  const rows = await db
    .prepare(
      `SELECT department,
              COALESCE(SUM(input_kg), 0)  AS input_kg,
              COALESCE(SUM(output_kg), 0) AS output_kg,
              COALESCE(SUM(waste_kg), 0)  AS waste_kg,
              MIN(event_date) AS first_date,
              MAX(event_date) AS last_date,
              COUNT(DISTINCT event_date) AS days
         FROM production_events WHERE lot_id = ? GROUP BY department`,
    )
    .all<{
    department: Department;
    input_kg: number;
    output_kg: number;
    waste_kg: number;
    first_date: string | null;
    last_date: string | null;
    days: number;
  }>(lotId);
  const out = {} as Record<Department, StageOutput>;
  for (const d of DEPARTMENTS) out[d] = { inputKg: 0, outputKg: 0, wasteKg: 0, firstDate: null, lastDate: null, days: 0 };
  for (const r of rows) {
    if (!(r.department in out)) continue;
    out[r.department] = {
      inputKg: roundKg(r.input_kg),
      outputKg: roundKg(r.output_kg),
      wasteKg: roundKg(r.waste_kg),
      firstDate: r.first_date,
      lastDate: r.last_date,
      days: Number(r.days),
    };
  }
  return out;
}

/** Sorted distinct production dates of one department for one lot (D1 = first element). */
export async function deptEventDates(db: DB, lotId: string, dept: Department | string): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT DISTINCT event_date FROM production_events WHERE lot_id = ? AND department = ? ORDER BY event_date`)
    .all<{ event_date: string }>(lotId, dept);
  return rows.map((r) => r.event_date);
}

/**
 * 1-based day index of `date` within the sorted distinct `dates` (D1..Dn).
 * A date that is not a production date maps to the nearest previous production date; a date before the first
 * production date (or an empty list) maps to 1.
 */
export function dayIndexFor(dates: string[], date: string): number {
  let idx = 0;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] <= date) idx = i + 1;
    else break;
  }
  return Math.max(idx, 1);
}

/** Previous stage in STAGE_ORDER (null for RM). */
export function previousStage(dept: Department): Department | null {
  const i = STAGE_ORDER.indexOf(dept);
  return i > 0 ? STAGE_ORDER[i - 1] : null;
}
