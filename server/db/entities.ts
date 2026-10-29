// Entity registry: which tables are ledger-anchored, their id column, which columns form the hashed
// business snapshot, and which columns hold JSON (parsed before hashing so snapshots are readable and
// field-level tamper diffs can point at e.g. `values_json.U`).
import type { DB } from './index';
import { canonicalize, hashObject, sha256Hex, canonicalJson } from '../lib/hash';

export interface EntityDef {
  type: string; // entity type used in EntityRef.type and URLs
  table: string;
  idColumn: string;
  /** Business columns included in the snapshot/hash (anchor columns tx_hash/block_number/record_hash/version are never included). */
  fields: string[];
  jsonFields: string[];
  /** Domain(s) to invalidate on the client when this entity changes. */
  domains: string[];
  /** Optional extra integrity check (e.g. analysis output_hash must equal sha256(result)). */
  verifyExtra?: (row: Record<string, unknown>) => { ok: true } | { ok: false; field: string; expected: unknown; actual: unknown };
}

export const ANCHOR_COLUMNS = ['tx_hash', 'block_number', 'record_hash', 'version'] as const;

const def = (d: Omit<EntityDef, 'jsonFields'> & { jsonFields?: string[] }): EntityDef => ({ jsonFields: [], ...d });

export const ENTITIES: Record<string, EntityDef> = {
  customer: def({ type: 'customer', table: 'customers', idColumn: 'id', fields: ['id', 'code', 'name', 'city', 'contact_name', 'email', 'phone', 'address', 'created_at'], domains: ['customers'] }),
  machine: def({ type: 'machine', table: 'machines', idColumn: 'id', fields: ['id', 'department', 'machine_no', 'label', 'line', 'make', 'model', 'spindles', 'created_at'], domains: ['lots', 'production'] }),
  bale: def({
    type: 'bale', table: 'bales', idColumn: 'id',
    fields: ['id', 'bale_no', 'supplier', 'station', 'variety', 'gin_lot', 'weight_kg', 'remaining_kg', 'received_at', 'bay', 'bin', 'status', 'issued_at', 'mix_id', 'fibre', 'created_at'],
    jsonFields: ['fibre'], domains: ['bales', 'lots'],
  }),
  mix: def({
    type: 'mix', table: 'mixes', idColumn: 'id',
    fields: ['id', 'mix_no', 'count_id', 'status', 'planned_at', 'issued_at', 'total_kg', 'recipe', 'fibre', 'master_version_id', 'blow_room_line', 'created_by', 'created_at'],
    jsonFields: ['recipe', 'fibre'], domains: ['bales', 'lots'],
  }),
  mix_bale: def({ type: 'mix_bale', table: 'mix_bales', idColumn: 'id', fields: ['id', 'mix_id', 'bale_id', 'kg_used', 'pct'], domains: ['bales', 'lots'] }),
  lot: def({
    type: 'lot', table: 'lots', idColumn: 'id',
    fields: ['id', 'lot_no', 'lot_code', 'seq', 'year', 'count_id', 'mix_id', 'line', 'status', 'planned_kg', 'start_date', 'end_date', 'qa_release_at', 'qa_release_by', 'created_at'],
    domains: ['lots', 'dashboard'],
  }),
  stage_run: def({
    type: 'stage_run', table: 'stage_runs', idColumn: 'id',
    fields: ['id', 'lot_id', 'stage', 'machine_id', 'location', 'shift', 'operator_id', 'in_at', 'out_at', 'input_kg', 'output_kg', 'waste_kg', 'waste_type', 'batch_ref', 'input_refs', 'params', 'accessories', 'notes', 'created_at'],
    jsonFields: ['input_refs', 'params', 'accessories'], domains: ['lots', 'production', 'dashboard'],
  }),
  test_result: def({
    type: 'test_result', table: 'test_results', idColumn: 'id',
    fields: ['id', 'sample_id', 'lot_id', 'stage', 'machine_id', 'sample_type', 'pos', 'test_date', 'tested_at', 'shift', 'values_json', 'instrument', 'tested_by', 'remarks', 'created_at'],
    jsonFields: ['values_json'], domains: ['lots', 'quality', 'dashboard'],
  }),
  master_version: def({
    type: 'master_version', table: 'master_versions', idColumn: 'id',
    fields: ['id', 'master_type', 'count_id', 'version_no', 'status', 'effective_from', 'effective_to', 'meta', 'note', 'created_by', 'created_at', 'approved_by', 'approved_at', 'activated_by', 'activated_at'],
    jsonFields: ['meta'], domains: ['masters', 'lots', 'dashboard'],
  }),
  master_item: def({
    type: 'master_item', table: 'master_items', idColumn: 'id',
    fields: ['id', 'version_id', 'master_type', 'count_id', 'scope', 'parameter', 'std', 'lower_limit', 'upper_limit', 'unit', 'frequency', 'instrument', 'note'],
    domains: ['masters'],
  }),
  lens: def({ type: 'lens', table: 'complaint_lens', idColumn: 'id', fields: ['id', 'complaint_type', 'items', 'updated_by', 'updated_at'], jsonFields: ['items'], domains: ['masters', 'complaints'] }),
  accessory_change: def({
    type: 'accessory_change', table: 'accessory_changes', idColumn: 'id',
    fields: ['id', 'machine_id', 'kind', 'spec', 'value', 'changed_at', 'changed_by', 'note', 'created_at'],
    domains: ['accessories', 'dashboard'],
  }),
  packing: def({
    type: 'packing', table: 'packing', idColumn: 'id',
    fields: ['id', 'lot_id', 'packed_at', 'packer_id', 'package_type', 'cones_packed', 'partial_cones', 'cartons', 'net_kg', 'tare_kg', 'gross_kg', 'avg_cone_kg', 'color_actual', 'color_master', 'color_ok', 'slip_no', 'carton_from', 'carton_to', 'label_template', 'pallets', 'fg_location', 'notes', 'created_at'],
    domains: ['lots', 'dispatches', 'accessories', 'dashboard'],
  }),
  qa_override: def({ type: 'qa_override', table: 'qa_overrides', idColumn: 'id', fields: ['id', 'lot_id', 'reason', 'approved_by', 'created_at'], domains: ['dispatches', 'lots'] }),
  dispatch: def({
    type: 'dispatch', table: 'dispatches', idColumn: 'id',
    fields: ['id', 'dispatch_no', 'customer_id', 'order_id', 'count_id', 'quantity_kg', 'dispatch_date', 'dispatched_at', 'invoice_no', 'invoice_date', 'vehicle_no', 'driver_name', 'driver_phone', 'transporter', 'lr_no', 'destination', 'cartons', 'cones_count', 'net_kg', 'gross_kg', 'delivered_at', 'gate', 'override_ids', 'qa_released', 'passport_code', 'status', 'remarks', 'created_by', 'created_at'],
    jsonFields: ['gate', 'override_ids'], domains: ['dispatches', 'lots', 'dashboard'],
  }),
  dispatch_lot: def({ type: 'dispatch_lot', table: 'dispatch_lots', idColumn: 'id', fields: ['id', 'dispatch_id', 'lot_id', 'quantity_kg', 'cartons'], domains: ['dispatches', 'lots'] }),
  passport: def({ type: 'passport', table: 'passports', idColumn: 'code', fields: ['code', 'dispatch_id', 'issued_at'], domains: ['dispatches'] }),
  document: def({
    type: 'document', table: 'documents', idColumn: 'id',
    fields: ['id', 'sha256', 'filename', 'mime_type', 'size_bytes', 'storage_path', 'ref_type', 'ref_id', 'uploaded_by', 'uploaded_at'],
    domains: ['documents', 'complaints'],
  }),
  complaint: def({
    type: 'complaint', table: 'complaints', idColumn: 'id',
    fields: ['id', 'complaint_no', 'seq', 'year', 'complainant_name', 'type', 'source', 'customer_id', 'lot_id', 'dispatch_id', 'description', 'document_id', 'status', 'received_date', 'created_by', 'created_at', 'updated_at'],
    domains: ['complaints', 'dashboard'],
  }),
  complaint_event: def({
    type: 'complaint_event', table: 'complaint_events', idColumn: 'id',
    fields: ['id', 'complaint_id', 'from_status', 'to_status', 'note', 'by_user_id', 'at'],
    domains: ['complaints'],
  }),
  analysis: def({
    type: 'analysis', table: 'analyses', idColumn: 'id',
    // Large JSON (result/llm/context) is NOT in the snapshot; it is covered by input_hash/output_hash (see verifyExtra).
    fields: ['id', 'complaint_id', 'lot_id', 'run_no', 'comparison_lot_ids', 'input_hash', 'output_hash', 'created_by', 'created_at'],
    jsonFields: ['comparison_lot_ids'], domains: ['analysis', 'complaints', 'dashboard'],
    verifyExtra: (row) => {
      const parsed = safeParse(row.result as string);
      const actual = sha256Hex(canonicalJson(parsed));
      return actual === row.output_hash ? { ok: true } : { ok: false, field: 'result', expected: row.output_hash, actual };
    },
  }),
  conclusion: def({
    type: 'conclusion', table: 'conclusions', idColumn: 'id',
    fields: ['id', 'complaint_id', 'analysis_id', 'conclusion_html', 'root_cause', 'corrective_action', 'preventive_action', 'customer_reply', 'concluded_by', 'concluded_at'],
    domains: ['complaints', 'dashboard'],
  }),
};

function safeParse(s: string | null | undefined): unknown {
  if (s === null || s === undefined) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function entityDef(type: string): EntityDef {
  const d = ENTITIES[type];
  if (!d) throw new Error(`Unknown entity type: ${type}`);
  return d;
}

/** Canonical business snapshot of a DB row (JSON columns parsed). */
export function snapshotOf(type: string, row: Record<string, unknown>): Record<string, unknown> {
  const d = entityDef(type);
  const snap: Record<string, unknown> = { __type: type };
  for (const f of d.fields) {
    const v = row[f];
    snap[f] = d.jsonFields.includes(f) ? safeParse(v as string) : v ?? null;
  }
  return canonicalize(snap) as Record<string, unknown>;
}

/** SHA-256 record hash of a DB row. */
export function recordHashOf(type: string, row: Record<string, unknown>): string {
  return hashObject(snapshotOf(type, row));
}

export async function loadRow(db: DB, type: string, id: string): Promise<Record<string, unknown> | undefined> {
  const d = entityDef(type);
  return await db.prepare(`SELECT * FROM ${d.table} WHERE ${d.idColumn} = ?`).get(id) as Record<string, unknown> | undefined;
}

/** Field-level diff between an anchored snapshot and the current snapshot (dot paths into JSON fields). */
export function diffSnapshots(anchored: Record<string, unknown>, current: Record<string, unknown>): { field: string; expected: unknown; actual: unknown }[] {
  const out: { field: string; expected: unknown; actual: unknown }[] = [];
  const walk = (a: unknown, b: unknown, p: string) => {
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
      for (const k of keys) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], p ? `${p}.${k}` : k);
      return;
    }
    if (canonicalJson(a) !== canonicalJson(b)) out.push({ field: p, expected: a ?? null, actual: b ?? null });
  };
  walk(anchored, current, '');
  return out;
}

/** Map entity types touched by an action to client query domains. */
export function domainsFor(types: Iterable<string>): string[] {
  const s = new Set<string>(['ledger', 'audit', 'dashboard']);
  for (const t of types) for (const d of ENTITIES[t]?.domains ?? []) s.add(d);
  return [...s];
}
