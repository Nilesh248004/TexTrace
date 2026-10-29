// Deterministic generator for a real-looking cotton spinning mill (demo date 28 Oct 2026, 15:10 IST).
// Pure: produces a Plan (rows with timestamps); server/seed/loader.ts inserts it and anchors every row on the ledger.
//
// Story built in (so every screen has something to say):
//   * Lot 101 (40s CH, PD Textiles) left the mill yesterday. Its mix M-001 contains DCH-32 bales with a high short-fibre index,
//     and it was spun on RF-6, which ran above the spindle-speed master with a traveller 29 days old (master: 14) until 21 Oct.
//   * Lots 102, 110–112 share the RF-6 window / the M-001 mix, so the AI finds a recall scope. Lot 110 already has an open
//     hairiness complaint (Ganga Garments). The complaint for lot 101 is NOT seeded: it is registered live in the demo.
import { config } from '../config';
import { ACCESSORY_INFO, DEFAULT_LENS, MASTER_TYPES, PARAMS, STAGE_INFO, paramDef, shiftOf, type AccessoryKind, type MasterType, type Scope, type Stage } from '@shared/params';
import { istDate } from '@shared/format';
import { evaluate } from '@shared/quality';
import { sha256Hex } from '../lib/hash';
import { COUNTS, COLOR_OF, accessoriesMeta, buildItems, countMixMeta, type CountSpec, type SpecItem } from './masterValues';

// ------------------------------------------------------------------ plan types
export interface HistoryStep { at: string; actor: string; contract: string; fn: string; label: string; patch: Record<string, unknown>; payload?: Record<string, unknown> }
export interface SeedRow {
  type: string;
  /** Initial state (version 1). The stored row is this + every history patch (version = 1 + history.length). */
  row: Record<string, unknown>;
  at: string;
  actor: string;
  contract: string;
  fn: string;
  label: string;
  method?: string;
  path?: string;
  /** Rows with the same bundle id are committed in ONE transaction (e.g. a master version's items). */
  bundle?: string;
  history?: HistoryStep[];
  payload?: Record<string, unknown>;
}
export interface SeedFile { path: string; content: string }
export interface Plan {
  notifications: Record<string, unknown>[];
  users: Record<string, unknown>[];
  counts: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  rows: SeedRow[];
  files: SeedFile[];
  settings: Record<string, unknown>;
  sequences: Record<string, number>;
  facts: Record<string, unknown>;
}

// ------------------------------------------------------------------ prng + time
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NOW = Date.parse(config.seedNowIso);
const IST = 330 * 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const istMs = (date: string, h: number, m = 0) => Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60_000 - IST;
const dayStr = (offset: number) => istDate(iso(NOW + offset * DAY));
const r1 = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pad = (n: number, w = 3) => String(n).padStart(w, '0');

export function generatePlan(seed = 20261028): Plan {
  const rnd = mulberry32(seed);
  const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const between = (a: number, b: number) => a + (b - a) * rnd();
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const rows: SeedRow[] = [];
  const files: SeedFile[] = [];
  const idSeq: Record<string, number> = {};
  const nid = (prefix: string, w = 6) => `${prefix}-${pad((idSeq[prefix] = (idSeq[prefix] ?? 0) + 1), w)}`;
  const TODAY = dayStr(0);

  // ---------------------------------------------------------------- users
  const users: Record<string, unknown>[] = [
    ['U-ADMIN', 'admin', 'R. Senthil Kumar', 'ADMIN', 'MillOrg', 'Mill Owner', null],
    ['U-DEV', 'dev', 'A. Karthik', 'DEVELOPER', 'MillOrg', 'Blockchain Developer', null],
    ['U-OPERATOR', 'operator', 'M. Ravi', 'PRODUCTION', 'MillOrg', 'Spinning Supervisor', null],
    ['U-QA', 'qa', 'S. Priya', 'QA', 'QualityOrg', 'QA Head', null],
    ['U-DISPATCH', 'dispatch', 'K. Murugan', 'DISPATCH', 'MillOrg', 'Dispatch & Packing In-charge', null],
    ['U-CS', 'cs', 'J. Anitha', 'CUSTOMER_SERVICE', 'MillOrg', 'Customer Service Executive', null],
    ['U-AUDITOR', 'auditor', 'V. Ramesh', 'AUDITOR', 'AuditOrg', 'Internal Auditor', null],
    ['U-PDT', 'pdt', 'D. Prakash', 'BUYER', 'BuyerOrg', 'QA Manager, PD Textiles', 'CUST-PDT'],
    ['U-VKF', 'vkf', 'S. Velan', 'BUYER', 'BuyerOrg', 'Proprietor, Velan Knit Fabrics', 'CUST-VKF'],
    ['U-SLH', 'slh', 'L. Lakshmi', 'BUYER', 'BuyerOrg', 'Lab Head, Sri Lakshmi Hosiery', 'CUST-SLH'],
    ['U-KVW', 'kvw', 'K. Murali', 'BUYER', 'BuyerOrg', 'QA, Kaveri Weaves', 'CUST-KVW'],
    ['U-GGT', 'ggt', 'P. Gangadharan', 'BUYER', 'BuyerOrg', 'Purchase, Ganga Garments', 'CUST-GGT'],
    ...[['U-OP1', 'op1', 'K. Selvam'], ['U-OP2', 'op2', 'P. Arun'], ['U-OP3', 'op3', 'S. Dinesh'], ['U-OP4', 'op4', 'R. Mohan'], ['U-OP5', 'op5', 'T. Suresh'], ['U-OP6', 'op6', 'V. Karthi']]
      .map(([id, u, n]) => [id, u, n, 'PRODUCTION', 'MillOrg', 'Machine Operator', null]),
    ['U-LAB1', 'lab1', 'N. Kavitha', 'QA', 'QualityOrg', 'Lab Technician', null],
    ['U-LAB2', 'lab2', 'B. Harini', 'QA', 'QualityOrg', 'Lab Technician', null],
    ['U-PACK1', 'pack1', 'C. Balaji', 'DISPATCH', 'MillOrg', 'Packer', null],
    ['U-PACK2', 'pack2', 'E. Vijay', 'DISPATCH', 'MillOrg', 'Packer', null],
  ].map(([id, username, name, role, org, title, customer_id]) => ({ id, username, name, role, org, title, customer_id }));
  const operatorsByShift: Record<string, string[]> = { A: ['U-OP1', 'U-OP2'], B: ['U-OP3', 'U-OP4'], C: ['U-OP5', 'U-OP6'] };
  const labTechs = ['U-LAB1', 'U-LAB2'];

  const counts = COUNTS.map((c) => ({ id: c.id, label: c.label, display: c.display, ne: c.ne, uses_comber: c.comber ? 1 : 0 }));
  const countOf = (id: string) => COUNTS.find((c) => c.id === id) as CountSpec;

  // ---------------------------------------------------------------- customers
  const CUSTOMERS = [
    { id: 'CUST-PDT', code: 'PDT', name: 'PD Textiles', city: 'Tiruppur', contact_name: 'D. Prakash', email: 'qa@pdtextiles.example', phone: '+91 98420 11234', address: '14, Kangeyam Road, Tiruppur 641604' },
    { id: 'CUST-VKF', code: 'VKF', name: 'Velan Knit Fabrics', city: 'Tiruppur', contact_name: 'S. Velan', email: 'quality@velanknit.example', phone: '+91 98940 22871', address: '3/45, Avinashi Road, Tiruppur 641603' },
    { id: 'CUST-SLH', code: 'SLH', name: 'Sri Lakshmi Hosiery', city: 'Coimbatore', contact_name: 'L. Lakshmi', email: 'lab@srihosiery.example', phone: '+91 94430 55102', address: '88, Sathy Road, Coimbatore 641006' },
    { id: 'CUST-KVW', code: 'KVW', name: 'Kaveri Weaves', city: 'Erode', contact_name: 'K. Murali', email: 'qa@kaveriweaves.example', phone: '+91 90030 41877', address: '21, Perundurai Road, Erode 638011' },
    { id: 'CUST-GGT', code: 'GGT', name: 'Ganga Garments', city: 'Karur', contact_name: 'P. Gangadharan', email: 'purchase@gangagarments.example', phone: '+91 97910 66320', address: '7, Kovai Road, Karur 639002' },
  ];
  const t0 = istMs('2026-08-20', 10);
  CUSTOMERS.forEach((c, i) => rows.push({ type: 'customer', row: { ...c, created_at: iso(t0 + i * 3 * HOUR) }, at: iso(t0 + i * 3 * HOUR), actor: 'U-ADMIN', contract: 'AssetID', fn: 'registerCustomer', label: `Register customer ${c.name}`, method: 'POST', path: '/api/customers' }));
  const customerName = (id: string) => CUSTOMERS.find((c) => c.id === id)?.name ?? id;

  // ---------------------------------------------------------------- machines
  interface Mach { id: string; stage: Stage; no: number; label: string; line: string; make: string; model: string; spindles: number }
  const machines: Mach[] = [];
  const addM = (stage: Stage, n: number, make: string, model: string, spindles = 0, line = '') => {
    machines.push({ id: `${stage}-${n}`, stage, no: n, label: `${STAGE_INFO[stage].machinePrefix} ${n}`, line, make, model, spindles });
  };
  for (let i = 1; i <= 2; i++) addM('BR', i, 'Trützschler', 'Blow-room line BO-A', 0, `Line ${i}`);
  for (let i = 1; i <= 12; i++) addM('CARD', i, 'LMW', 'LC 300 A', 0);
  for (let i = 1; i <= 2; i++) addM('DFB', i, 'Rieter', 'RSB-D 24', 0);
  for (let i = 1; i <= 3; i++) addM('DFF', i, 'Rieter', 'RSB-D 26', 0);
  for (let i = 1; i <= 2; i++) addM('COMB', i, 'LMW', 'LK 69', 0);
  for (let i = 1; i <= 4; i++) addM('FF', i, 'LMW', 'LF 1400 A', 120);
  for (let i = 1; i <= 10; i++) addM('RF', i, i >= 9 ? 'LMW' : i >= 6 ? 'Rieter' : 'LMW', i >= 9 ? 'LR 9/AX Compact' : i >= 6 ? 'G 38' : 'LR 6/S', i >= 9 ? 1008 : i >= 6 ? 1200 : 1056, i >= 9 ? 'Compact' : 'Carded');
  for (let i = 1; i <= 4; i++) addM('AW', i, 'Schlafhorst', 'Autoconer X5', 60);
  const mach = (id: string) => machines.find((m) => m.id === id) as Mach;
  const t1 = istMs('2026-08-21', 11);
  machines.forEach((m, i) => rows.push({
    type: 'machine', row: { id: m.id, department: m.stage, machine_no: m.no, label: m.label, line: m.line || null, make: m.make, model: m.model, spindles: m.spindles, created_at: iso(t1 + i * 20 * 60_000) },
    at: iso(t1 + i * 20 * 60_000), actor: 'U-ADMIN', contract: 'AssetID', fn: 'registerMachine', label: `Register machine ${m.label}`, method: 'POST', path: '/api/machines',
  }));

  const GROUPS: Record<string, Record<string, string[]>> = {
    BR: { '20S': ['BR-1'], '30CH': ['BR-1'], '40CH': ['BR-2'], '40CP': ['BR-2'] },
    CARD: { '20S': ['CARD-1', 'CARD-2', 'CARD-3'], '30CH': ['CARD-4', 'CARD-5', 'CARD-6'], '40CH': ['CARD-7', 'CARD-8', 'CARD-9'], '40CP': ['CARD-10', 'CARD-11', 'CARD-12'] },
    DFB: { '20S': ['DFB-1'], '30CH': ['DFB-1'], '40CH': ['DFB-2'], '40CP': ['DFB-2'] },
    DFF: { '20S': ['DFF-1'], '30CH': ['DFF-1'], '40CH': ['DFF-2'], '40CP': ['DFF-3'] },
    COMB: { '40CP': ['COMB-1', 'COMB-2'] },
    FF: { '20S': ['FF-1'], '30CH': ['FF-2'], '40CH': ['FF-3'], '40CP': ['FF-4'] },
    RF: { '20S': ['RF-1', 'RF-2'], '30CH': ['RF-3', 'RF-4', 'RF-5'], '40CH': ['RF-6', 'RF-7', 'RF-8'], '40CP': ['RF-9', 'RF-10'] },
    AW: { '20S': ['AW-1'], '30CH': ['AW-1', 'AW-4'], '40CH': ['AW-2', 'AW-3'], '40CP': ['AW-3', 'AW-4'] },
  };

  // ---------------------------------------------------------------- masters
  const OMIT: Record<string, string[]> = {
    '40CP': ['QUALITY|COMB|LAP_NEPS', 'QUALITY|COMB|SLV_NEPS', 'QUALITY|AW|CONTAM_CUTS', 'QUALITY|AW|SHADE_FAULTS', 'PRODUCTION|COMB|COMB_RATE', 'PRODUCTION|RF|BREAKS_100SH', 'ACCESSORIES|DFF|COT_AGE_DAYS'],
    '40CH': ['QUALITY|AW|SHADE_FAULTS'],
  };
  const itemsOf: Record<string, SpecItem[]> = {};
  const limits = new Map<string, SpecItem>(); // `${count}|${type}|${scope}|${key}` (version 1 masters, used to generate data)
  const versionId = (c: string, t: MasterType, n: number) => `MV-${c}-${t}-${n}`;
  const mixMeta = (c: CountSpec) => countMixMeta(c);
  const mastersAt = istMs('2026-08-26', 10);
  const SEED_QA = 'U-QA';
  let mvSeq = 0;
  for (const c of COUNTS) {
    const all = buildItems(c).filter((i) => !(OMIT[c.id] ?? []).includes(`${i.master}|${i.scope}|${i.key}`));
    itemsOf[c.id] = all;
    for (const i of all) limits.set(`${c.id}|${i.master}|${i.scope}|${i.key}`, i);
    for (const type of MASTER_TYPES) {
      const id = versionId(c.id, type, 1);
      const created = mastersAt + (mvSeq++) * 17 * 60_000;
      const approved = created + 2 * DAY + HOUR;
      const activated = approved + 3 * DAY;
      const meta = type === 'COUNT_MIX' ? mixMeta(c) : type === 'ACCESSORIES' ? accessoriesMeta(c) : type === 'COLOR' ? COLOR_OF[c.id] : {};
      const v2 = c.id === '40CH' && type === 'QUALITY';
      rows.push({
        type: 'master_version', bundle: `MV-${id}`,
        row: {
          id, master_type: type, count_id: c.id, version_no: 1, status: 'DRAFT', effective_from: null, effective_to: null, meta: JSON.stringify(meta),
          note: 'Initial master set', created_by: SEED_QA, created_at: iso(created), approved_by: null, approved_at: null, activated_by: null, activated_at: null,
        },
        at: iso(created), actor: SEED_QA, contract: 'Master', fn: 'createVersion', label: `Create ${type} master v1 for ${c.display}`, method: 'POST', path: '/api/masters/versions',
        history: [
          { at: iso(approved), actor: SEED_QA, contract: 'Master', fn: 'approve', label: `QA approved ${type} master v1 (${c.display})`, patch: { status: 'QA_APPROVED', approved_by: SEED_QA, approved_at: iso(approved) } },
          { at: iso(activated), actor: 'U-ADMIN', contract: 'Master', fn: 'activate', label: `Activated ${type} master v1 (${c.display})`,
            patch: { status: v2 ? 'SUPERSEDED' : 'ACTIVE', effective_from: '2026-09-01', effective_to: v2 ? '2026-10-20' : null, activated_by: 'U-ADMIN', activated_at: iso(activated) } },
        ],
      });
      for (const i of all.filter((x) => x.master === type)) {
        rows.push({
          type: 'master_item', bundle: `MV-${id}`,
          row: { id: `MI-${id}-${i.scope}-${i.key}`, version_id: id, master_type: type, count_id: c.id, scope: i.scope, parameter: i.key, std: i.std, lower_limit: i.lower, upper_limit: i.upper, unit: i.unit ?? '', frequency: i.frequency, instrument: i.instrument, note: '' },
          at: iso(created), actor: SEED_QA, contract: 'Master', fn: 'upsertItems', label: `Master items for ${type} v1 (${c.display})`,
        });
      }
    }
  }
  // 40s CH quality master v2 (hairiness tightened) — effective 20 Oct 2026. Lot 101 (13–15 Oct) is judged against v1.
  {
    const c = countOf('40CH');
    const id = versionId('40CH', 'QUALITY', 2);
    const created = istMs('2026-10-16', 11);
    const tweak: Record<string, Partial<SpecItem>> = {
      'RF|H': { std: 6.02, lower: 5.62, upper: 6.42 }, 'RF|S3': { std: 1050, upper: 1250 }, 'BR|SFI': { std: 7.8, upper: 8.5 }, 'AW|H': { std: 6.25, lower: 5.8, upper: 6.7 },
    };
    rows.push({
      type: 'master_version', bundle: `MV-${id}`,
      row: { id, master_type: 'QUALITY', count_id: '40CH', version_no: 2, status: 'DRAFT', effective_from: null, effective_to: null, meta: '{}', note: 'Tighten hairiness (H, S3) and short-fibre limits after customer feedback', created_by: SEED_QA, created_at: iso(created), approved_by: null, approved_at: null, activated_by: null, activated_at: null },
      at: iso(created), actor: SEED_QA, contract: 'Master', fn: 'createVersion', label: `Clone QUALITY master v1 → v2 for ${c.display}`, method: 'POST', path: '/api/masters/versions',
      history: [
        { at: iso(created + 2 * DAY), actor: SEED_QA, contract: 'Master', fn: 'approve', label: 'QA approved QUALITY master v2 (40s CH)', patch: { status: 'QA_APPROVED', approved_by: SEED_QA, approved_at: iso(created + 2 * DAY) } },
        { at: iso(istMs('2026-10-20', 9)), actor: 'U-ADMIN', contract: 'Master', fn: 'activate', label: 'Activated QUALITY master v2 (40s CH)', patch: { status: 'ACTIVE', effective_from: '2026-10-20', activated_by: 'U-ADMIN', activated_at: iso(istMs('2026-10-20', 9)) } },
      ],
    });
    for (const i of itemsOf['40CH'].filter((x) => x.master === 'QUALITY')) {
      const t = tweak[`${i.scope}|${i.key}`] ?? {};
      rows.push({
        type: 'master_item', bundle: `MV-${id}`,
        row: { id: `MI-${id}-${i.scope}-${i.key}`, version_id: id, master_type: 'QUALITY', count_id: '40CH', scope: i.scope, parameter: i.key, std: t.std ?? i.std, lower_limit: t.lower !== undefined ? t.lower : i.lower, upper_limit: t.upper !== undefined ? t.upper : i.upper, unit: i.unit ?? '', frequency: i.frequency, instrument: i.instrument, note: t.std !== undefined ? 'Tightened in v2' : '' },
        at: iso(created), actor: SEED_QA, contract: 'Master', fn: 'upsertItems', label: 'Master items for QUALITY v2 (40s CH)',
      });
    }
  }
  // Pending workflow examples: a DRAFT (30s CH production) and a QA-approved version waiting to be activated (40s compact accessories).
  {
    const id = versionId('30CH', 'PRODUCTION', 2);
    const created = istMs('2026-10-26', 15);
    rows.push({
      type: 'master_version', bundle: `MV-${id}`,
      row: { id, master_type: 'PRODUCTION', count_id: '30CH', version_no: 2, status: 'DRAFT', effective_from: null, effective_to: null, meta: '{}', note: 'Raise spindle speed 16,800 → 17,200 rpm after trial on RF-4 (awaiting QA approval)', created_by: 'U-OPERATOR', created_at: iso(created), approved_by: null, approved_at: null, activated_by: null, activated_at: null },
      at: iso(created), actor: 'U-OPERATOR', contract: 'Master', fn: 'createVersion', label: 'Clone PRODUCTION master v1 → v2 for 30s CH', method: 'POST', path: '/api/masters/versions',
    });
    for (const i of itemsOf['30CH'].filter((x) => x.master === 'PRODUCTION')) {
      const spind = i.scope === 'RF' && i.key === 'SPINDLE_RPM';
      rows.push({
        type: 'master_item', bundle: `MV-${id}`,
        row: { id: `MI-${id}-${i.scope}-${i.key}`, version_id: id, master_type: 'PRODUCTION', count_id: '30CH', scope: i.scope, parameter: i.key, std: spind ? 17200 : i.std, lower_limit: spind ? 16700 : i.lower, upper_limit: spind ? 17700 : i.upper, unit: i.unit ?? '', frequency: i.frequency, instrument: i.instrument, note: spind ? 'Trial value' : '' },
        at: iso(created), actor: 'U-OPERATOR', contract: 'Master', fn: 'upsertItems', label: 'Master items for PRODUCTION v2 (30s CH)',
      });
    }
    const id2 = versionId('40CP', 'ACCESSORIES', 2);
    const created2 = istMs('2026-10-25', 12);
    const meta2 = { ...accessoriesMeta(countOf('40CP')), labelTemplate: 'LBL-40CP-V2', polybag: 'LDPE 70 micron, 3 cone separators' };
    rows.push({
      type: 'master_version', bundle: `MV-${id2}`,
      row: { id: id2, master_type: 'ACCESSORIES', count_id: '40CP', version_no: 2, status: 'DRAFT', effective_from: null, effective_to: null, meta: JSON.stringify(meta2), note: 'New customer label template and heavier polybag', created_by: 'U-OPERATOR', created_at: iso(created2), approved_by: null, approved_at: null, activated_by: null, activated_at: null },
      at: iso(created2), actor: 'U-OPERATOR', contract: 'Master', fn: 'createVersion', label: 'Clone ACCESSORIES master v1 → v2 for 40s compact', method: 'POST', path: '/api/masters/versions',
      history: [{ at: iso(created2 + 26 * HOUR), actor: SEED_QA, contract: 'Master', fn: 'approve', label: 'QA approved ACCESSORIES master v2 (40s compact)', patch: { status: 'QA_APPROVED', approved_by: SEED_QA, approved_at: iso(created2 + 26 * HOUR) } }],
    });
    for (const i of itemsOf['40CP'].filter((x) => x.master === 'ACCESSORIES')) {
      rows.push({
        type: 'master_item', bundle: `MV-${id2}`,
        row: { id: `MI-${id2}-${i.scope}-${i.key}`, version_id: id2, master_type: 'ACCESSORIES', count_id: '40CP', scope: i.scope, parameter: i.key, std: i.std, lower_limit: i.lower, upper_limit: i.upper, unit: i.unit ?? '', frequency: i.frequency, instrument: i.instrument, note: '' },
        at: iso(created2), actor: 'U-OPERATOR', contract: 'Master', fn: 'upsertItems', label: 'Master items for ACCESSORIES v2 (40s compact)',
      });
    }
  }
  // Complaint-type → relevant-parameters mapping (editable master)
  Object.entries(DEFAULT_LENS).forEach(([type, items], i) => {
    const at = iso(mastersAt + i * 9 * 60_000);
    rows.push({ type: 'lens', row: { id: `LENS-${type}`, complaint_type: type, items: JSON.stringify(items), updated_by: SEED_QA, updated_at: at }, at, actor: SEED_QA, contract: 'Quality', fn: 'upsertLens', label: `Complaint lens for ${type}`, method: 'PUT', path: `/api/masters/lens/${type}` });
  });

  const lim = (count: string, type: MasterType, scope: Scope, key: string) => limits.get(`${count}|${type}|${scope}|${key}`);

  // value sampler against master limits
  const biasMap = new Map<string, number>();
  const biasOf = (k: string, sd = 0.12) => { if (!biasMap.has(k)) biasMap.set(k, gauss() * sd); return biasMap.get(k) as number; };
  function sample(it: SpecItem | undefined, key: string, bias = 0, sig = 1): number | null {
    if (!it) return null;
    const d = paramDef(key)?.decimals ?? 2;
    let v: number;
    if (it.lower !== null && it.upper !== null) {
      const W = it.upper - it.lower;
      v = W <= 0 ? it.std : it.std + (gauss() * 0.19 * sig + bias) * W;
    } else if (it.upper !== null) {
      const h = it.upper - it.std;
      v = Math.max(it.std * 0.4, it.std + (gauss() * 0.42 * sig + bias) * h);
    } else {
      const h = it.std - (it.lower as number);
      v = it.std + (gauss() * 0.42 * sig + bias) * h;
    }
    return r1(v, d);
  }
  /** value placed at a given position of the band: 0 = std, 1 = limit. */
  const atLimit = (it: SpecItem, frac: number, side: 'high' | 'low' = 'high', key = ''): number => {
    const d = paramDef(key)?.decimals ?? 2;
    const hi = it.upper !== null ? it.upper - it.std : (it.lower !== null ? it.std - it.lower : 0);
    const lo = it.lower !== null ? it.std - it.lower : hi;
    return r1(side === 'high' ? it.std + frac * hi : it.std - frac * lo, d);
  };

  // ---------------------------------------------------------------- bales + mixes
  const VAR = {
    'Shankar-6': { n: 66, sup: [['Saurashtra Ginning Co.', 'Rajkot'], ['Amba Cotton Ginners', 'Surendranagar']], mic: 4.2, uhml: 28.8, ui: 82, str: 29.5, sfi: 8.0, trash: 2.3, rd: 75, b: 8.8, bays: ['Bay A', 'Bay B'] },
    'MCU-5': { n: 15, sup: [['Kaveri Cotton Traders', 'Salem']], mic: 4.0, uhml: 26.0, ui: 81, str: 28.0, sfi: 8.8, trash: 2.5, rd: 72, b: 9.4, bays: ['Bay C'] },
    'DCH-32': { n: 32, sup: [['Sri Venkateswara Ginning', 'Adoni'], ['Raichur Agro Ginning', 'Raichur']], mic: 3.8, uhml: 31.0, ui: 83, str: 31, sfi: 7.2, trash: 2.0, rd: 76, b: 8.5, bays: ['Bay D', 'Bay E'] },
    Suvin: { n: 7, sup: [['Palani Suvin Growers Ginning', 'Dindigul']], mic: 3.6, uhml: 33.0, ui: 84, str: 33, sfi: 6.4, trash: 1.8, rd: 78, b: 8.0, bays: ['Bay F'] },
  } as const;
  type Variety = keyof typeof VAR;
  interface Bale { id: string; no: number; variety: Variety; supplier: string; station: string; ginLot: string; kg: number; recv: number; bay: string; bin: string; fibre: Record<string, number>; mixId: string | null; issued: number | null; planted?: boolean }
  const bales: Bale[] = [];
  const recvStart = istMs('2026-09-18', 9);
  const recvEnd = NOW - 14 * HOUR;
  const specs: { v: Variety; recv: number }[] = [];
  (Object.keys(VAR) as Variety[]).forEach((v) => { for (let i = 0; i < VAR[v].n; i++) specs.push({ v, recv: recvStart + rnd() * (recvEnd - recvStart) }); });
  specs.sort((a, b) => a.recv - b.recv);
  const binNo: Record<string, number> = {};
  specs.forEach((s, i) => {
    const info = VAR[s.v];
    const [sup, stn] = pick(info.sup as unknown as string[][]);
    const bay = pick(info.bays as unknown as string[]);
    binNo[bay] = (binNo[bay] ?? 0) + 1;
    const no = 9001 + i;
    bales.push({
      id: `BALE-${no}`, no, variety: s.v, supplier: sup, station: stn, ginLot: `${stn.slice(0, 2).toUpperCase()}-26-${pad(Math.floor(rnd() * 900 + 100), 4)}`,
      kg: r1(168 + rnd() * 14, 0), recv: s.recv, bay, bin: `${bay.slice(-1)}-${pad(binNo[bay], 2)}`, mixId: null, issued: null,
      fibre: {
        MIC: r1(info.mic + gauss() * 0.12, 2), UHML: r1(info.uhml + gauss() * 0.35, 1), UI: r1(info.ui + gauss() * 0.5, 1), STR: r1(info.str + gauss() * 0.5, 1), SFI: r1(info.sfi + gauss() * 0.35, 1),
        TRASH: r1(info.trash + gauss() * 0.15, 2), MOIST: r1(7.4 + gauss() * 0.25, 1), RD: r1(info.rd + gauss() * 0.8, 1), PLUS_B: r1(info.b + gauss() * 0.3, 1),
      },
    });
  });

  interface MixPlan { no: number; id: string; count: CountSpec; customer: string; lots: number; nBales: number; split: Record<string, number>; start: number | null; planned: boolean; bales: Bale[]; totalKg: number; baleKg: number; fibre: Record<string, number>; recipe: Record<string, unknown>[]; brLine: string }
  const MIXES: [string, string, number, number, Record<string, number>, boolean?][] = [
    ['40CH', 'CUST-PDT', 2, 7, { 'Shankar-6': 5, 'DCH-32': 2 }], ['30CH', 'CUST-VKF', 3, 7, { 'Shankar-6': 5, 'MCU-5': 2 }], ['40CH', 'CUST-KVW', 2, 6, { 'Shankar-6': 4, 'DCH-32': 2 }],
    ['40CP', 'CUST-KVW', 2, 7, { 'DCH-32': 5, Suvin: 2 }], ['40CH', 'CUST-GGT', 3, 7, { 'Shankar-6': 5, 'DCH-32': 2 }], ['30CH', 'CUST-PDT', 2, 6, { 'Shankar-6': 4, 'MCU-5': 2 }],
    ['40CH', 'CUST-SLH', 3, 7, { 'Shankar-6': 5, 'DCH-32': 2 }], ['40CH', 'CUST-KVW', 2, 7, { 'Shankar-6': 5, 'DCH-32': 2 }], ['30CH', 'CUST-SLH', 3, 7, { 'Shankar-6': 5, 'MCU-5': 2 }],
    ['40CP', 'CUST-PDT', 3, 8, { 'DCH-32': 7, Suvin: 1 }], ['20S', 'CUST-GGT', 2, 6, { 'Shankar-6': 4, 'MCU-5': 2 }], ['30CH', 'CUST-VKF', 2, 6, { 'Shankar-6': 4, 'MCU-5': 2 }],
    ['40CH', 'CUST-PDT', 3, 7, { 'Shankar-6': 5, 'DCH-32': 2 }], ['40CP', 'CUST-KVW', 2, 7, { 'DCH-32': 5, Suvin: 2 }], ['20S', 'CUST-SLH', 2, 6, { 'Shankar-6': 4, 'MCU-5': 2 }],
    ['40CH', 'CUST-GGT', 2, 7, { 'Shankar-6': 5, 'DCH-32': 2 }, true], ['30CH', 'CUST-PDT', 2, 7, { 'Shankar-6': 5, 'MCU-5': 2 }, true],
  ];
  // explicit starts: the last mixes are close together so every stage has a lot in it at "now"
  const MIX_STARTS = ['2026-10-12 06:00', '2026-10-13 09:30', '2026-10-14 12:50', '2026-10-15 16:15', '2026-10-16 19:40', '2026-10-17 23:10', '2026-10-19 02:35', '2026-10-20 06:00', '2026-10-21 09:30', '2026-10-22 12:50', '2026-10-24 06:00', '2026-10-25 18:00', '2026-10-26 20:00', '2026-10-27 12:00', '2026-10-28 04:00'].map((x) => { const [d, t] = x.split(' '); const [h, m] = t.split(':').map(Number); return istMs(d, h, m); });
  const mixes: MixPlan[] = MIXES.map(([cid, customer, lots, nBales, split, planned], i) => ({
    no: i + 1, id: `MIX-${pad(i + 1)}`, count: countOf(cid), customer, lots, nBales, split, planned: !!planned, start: planned ? null : MIX_STARTS[i],
    bales: [], totalKg: 0, baleKg: 0, fibre: {}, recipe: [], brLine: GROUPS.BR[cid][0],
  }));
  const free = bales.slice();
  // planted: the two earliest DCH-32 bales feed M-001 with a high short-fibre index
  const dchEarly = bales.filter((b) => b.variety === 'DCH-32').slice(0, 2);
  dchEarly.forEach((b) => { b.supplier = 'Sri Venkateswara Ginning'; b.station = 'Adoni'; b.fibre.SFI = r1(12.4 + rnd() * 0.5, 1); b.fibre.UI = r1(79.2 + rnd() * 0.6, 1); b.fibre.UHML = r1(30.2 + rnd() * 0.3, 1); b.planted = true; });
  for (const m of mixes) {
    for (const [variety, n] of Object.entries(m.split)) {
      for (let k = 0; k < n; k++) {
        const limit = m.start === null ? NOW : m.start - DAY;
        let idx = -1;
        if (m.no === 1 && variety === 'DCH-32') idx = free.findIndex((b) => b.planted && !b.mixId);
        if (idx < 0) idx = free.findIndex((b) => b.variety === variety && !b.mixId && b.recv <= limit && !b.planted);
        if (idx < 0) idx = free.findIndex((b) => b.variety === variety && !b.mixId && !b.planted);
        const b = free[idx];
        b.mixId = m.id;
        m.bales.push(b);
      }
    }
    const meta = mixMeta(m.count);
    const baleShare = meta.recipe.filter((c) => c.source === 'BALE').reduce((s, c) => s + c.pct, 0) / 100;
    m.baleKg = m.bales.reduce((s, b) => s + b.kg, 0);
    m.totalKg = r1(m.baleKg / baleShare, 0);
    const w = (key: string) => m.bales.reduce((s, b) => s + b.fibre[key] * b.kg, 0) / m.baleKg;
    m.fibre = Object.fromEntries(['MIC', 'UHML', 'UI', 'STR', 'SFI', 'TRASH', 'MOIST', 'RD', 'PLUS_B'].map((k) => [k, r1(w(k), k === 'MIC' || k === 'TRASH' ? 2 : 1)]));
    const recipeVar = meta.recipe.filter((c) => c.source === 'BALE');
    m.recipe = meta.recipe.map((c) => {
      const kg = c.source === 'BALE' ? m.bales.filter((b) => b.variety === c.variety).reduce((s, b) => s + b.kg, 0) : m.totalKg - m.baleKg;
      return { key: c.key, label: c.label, source: c.source, pct: r1((kg / m.totalKg) * 100, 1), kg: r1(kg, 0), minPct: c.minPct, maxPct: c.maxPct };
    });
    void recipeVar;
    if (!m.planned && m.start !== null) {
      const issued = m.start - 30 * 60_000;
      m.bales.forEach((b) => { b.issued = issued; });
    }
  }

  // ---------------------------------------------------------------- accessory histories
  interface Change { id: string; machine: string; kind: AccessoryKind; spec: string; value: number | null; at: number; actor: string; note: string }
  const changes: Change[] = [];
  const baseInterval: Record<AccessoryKind, number> = { TRAVELLER: 11, COT_BUFF: 23, COT: 85, APRON: 62, SPACER: 150, CARD_WIRE: 260, FLAT_GRIND: 52 };
  const travellerSpec = (c: CountSpec) => accessoriesMeta(c).travellerType;
  const machCount = (m: Mach): CountSpec => {
    const g = GROUPS[m.stage];
    const cid = g ? Object.keys(g).find((k) => g[k].includes(m.id)) : undefined;
    return countOf(cid ?? '40CH');
  };
  const accStart = istMs('2026-07-01', 9);
  const kindsFor = (m: Mach): AccessoryKind[] => (Object.keys(ACCESSORY_INFO) as AccessoryKind[]).filter((k) => ACCESSORY_INFO[k].stages.includes(m.stage));
  for (const m of machines) {
    const c = machCount(m);
    for (const kind of kindsFor(m)) {
      if (kind === 'SPACER') {
        changes.push({ id: nid('AC'), machine: m.id, kind, spec: `${c.compact ? '2.00' : '2.50'} mm`, value: c.compact ? 2.0 : 2.5, at: accStart + 3 * DAY, actor: 'U-OPERATOR', note: 'Spacer set during overhaul' });
        continue;
      }
      let t = accStart - rnd() * baseInterval[kind] * DAY;
      const interval = baseInterval[kind] * (kind === 'TRAVELLER' && c.ne <= 30 ? 1.25 : 1);
      while (t < NOW - HOUR) {
        if (t >= accStart) changes.push({ id: nid('AC'), machine: m.id, kind, spec: kind === 'TRAVELLER' ? travellerSpec(c) : kind === 'APRON' ? 'Apron 38×1.0' : kind.startsWith('COT') ? 'Cot 80° shore' : kind === 'CARD_WIRE' ? 'Card wire MCC 5010' : 'Flats re-ground', value: null, at: t, actor: pick(['U-OP1', 'U-OP3', 'U-OP5', 'U-OPERATOR']), note: '' });
        t += interval * (0.85 + rnd() * 0.3) * DAY;
      }
    }
  }
  const dropAfter = (machine: string, kind: AccessoryKind, from: number, to = Infinity) => {
    for (let i = changes.length - 1; i >= 0; i--) if (changes[i].machine === machine && changes[i].kind === kind && changes[i].at >= from && changes[i].at < to) changes.splice(i, 1);
  };
  const setLast = (machine: string, kind: AccessoryKind, at: number, note: string) => {
    dropAfter(machine, kind, at - 0.5 * DAY);
    const m = mach(machine); const c = machCount(m);
    changes.push({ id: nid('AC'), machine, kind, spec: kind === 'TRAVELLER' ? travellerSpec(c) : kind === 'APRON' ? 'Apron 38×1.0' : kind.startsWith('COT') ? 'Cot 80° shore' : kind === 'CARD_WIRE' ? 'Card wire MCC 5010' : 'Flats re-ground', value: null, at, actor: 'U-OPERATOR', note });
  };
  // planted: RF-6 traveller changed 14 Sep and again 21 Oct — 29 days old when lot 101 ran (master 14 d)
  const RF6_FIX = istMs('2026-10-21', 9);
  dropAfter('RF-6', 'TRAVELLER', istMs('2026-09-10', 0), RF6_FIX + DAY);
  changes.push({ id: nid('AC'), machine: 'RF-6', kind: 'TRAVELLER', spec: travellerSpec(countOf('40CH')), value: null, at: istMs('2026-09-14', 10), actor: 'U-OP3', note: 'Routine change' });
  changes.push({ id: nid('AC'), machine: 'RF-6', kind: 'TRAVELLER', spec: travellerSpec(countOf('40CH')), value: null, at: RF6_FIX, actor: 'U-OPERATOR', note: 'Overdue change done after hairiness trend noticed; spindle speed reset to master' });
  // overdue / warning accessories right now (drives the alerts panel)
  setLast('RF-2', 'TRAVELLER', NOW - 21 * DAY, 'Overdue — not yet changed');
  setLast('RF-9', 'COT_BUFF', NOW - 36 * DAY, 'Buffing overdue');
  setLast('FF-3', 'APRON', NOW - 112 * DAY, 'Aprons overdue');
  setLast('CARD-5', 'FLAT_GRIND', NOW - 95 * DAY, 'Flat grinding overdue');
  setLast('RF-4', 'TRAVELLER', NOW - 17.4 * DAY, 'Due soon');
  setLast('RF-7', 'TRAVELLER', istMs('2026-10-22', 10), 'Routine change');
  changes.sort((a, b) => a.at - b.at);
  const accAt = (machine: string, kind: AccessoryKind, t: number): Change | undefined => {
    let found: Change | undefined;
    for (const c of changes) if (c.machine === machine && c.kind === kind && c.at <= t) found = c;
    return found;
  };
  const accessorySnapshot = (m: Mach, t: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {}; const specs: Record<string, string> = {};
    for (const kind of kindsFor(m)) {
      const c = accAt(m.id, kind, t);
      if (!c) continue;
      const key = ACCESSORY_INFO[kind].param;
      if (kind === 'SPACER') out[key] = c.value; else out[key] = Math.floor((t - c.at) / DAY);
      specs[kind] = c.spec;
    }
    return { ...out, specs };
  };
  changes.forEach((c) => rows.push({
    type: 'accessory_change',
    row: { id: c.id, machine_id: c.machine, kind: c.kind, spec: c.spec, value: c.value, changed_at: iso(c.at), changed_by: c.actor, note: c.note, created_at: iso(c.at) },
    at: iso(c.at), actor: c.actor, contract: 'ProcessEvent', fn: 'recordAccessoryChange', label: `${ACCESSORY_INFO[c.kind].label} change on ${mach(c.machine).label}`, method: 'POST', path: '/api/accessory-changes',
  }));

  // ---------------------------------------------------------------- lots, journeys, tests
  interface LotPlan { no: number; id: string; mix: MixPlan; idx: number; kg: number; baleKg: number; customer: string }
  const lots: LotPlan[] = [];
  let lotNo = 101;
  for (const m of mixes) for (let j = 0; j < m.lots; j++) lots.push({ no: lotNo, id: `LOT-${lotNo++}`, mix: m, idx: j, kg: r1(m.totalKg / m.lots, 0), baleKg: r1(m.baleKg / m.lots, 0), customer: m.customer });
  const lotOf = (no: number) => lots.find((l) => l.no === no) as LotPlan;

  interface Run {
    id: string; lot: LotPlan; stage: Stage; machine: string | null; location: string | null; shift: string; operator: string | null; inAt: number; outAt: number | null;
    inKg: number; outKg: number; wasteKg: number; wasteType: string | null; batch: string | null; inputRefs: string[]; params: Record<string, number>; acc: Record<string, unknown>; notes: string;
  }
  interface Test { id: string; sampleId: string; lot: LotPlan; stage: Stage; machine: string | null; type: 'LOT' | 'MACHINE'; pos: string | null; at: number; values: Record<string, number>; instrument: string; by: string; remarks: string }
  const runs: Run[] = [];
  const tests: Test[] = [];
  const freeAt: Record<string, number> = {};
  const rfSpeed = (m: Mach, c: CountSpec, rpm: number) => {
    const tpi = (lim(c.id, 'PRODUCTION', 'RF', 'TPI_SET')?.std ?? 22);
    const delivery = rpm / (tpi * 39.37);
    return m.spindles * 0.93 * delivery * 60 * (590.5 / c.ne) / 1e6;
  };
  const RATE: Record<string, number> = { BR: 600, CARD: 38, DFB: 160, DFF: 150, COMB: 28, FF: 26, AW: 50 };
  const dwell = () => (2 + rnd() * 6) * HOUR;
  const operatorFor = (t: number) => pick(operatorsByShift[shiftOf(iso(t))]);

  const WASTE_TYPE: Record<string, string> = { BR: 'Blow-room waste', CARD: 'Card waste + flat strips', DFB: 'Sliver waste', DFF: 'Sliver waste', COMB: 'Comber noil', FF: 'Roving waste', RF: 'Ring-frame hard waste', AW: 'Winding / cone waste' };

  function prodParams(L: LotPlan, stage: Stage, m: Mach | null, inAt: number, wastePct: number, yieldPct: number, hours: number, outKg: number, special: Record<string, number> = {}): Record<string, number> {
    const c = L.mix.count;
    const params: Record<string, number> = {};
    for (const p of PARAMS) {
      if (p.kind !== 'PRODUCTION' || !p.stages.includes(stage)) continue;
      const it = lim(c.id, 'PRODUCTION', stage, p.key);
      if (!it) continue;
      let v: number | null;
      if (p.key === 'WASTE_PCT') v = r1(wastePct, 2);
      else if (p.key === 'YIELD_PCT') v = r1(yieldPct, 1);
      else if (p.key === 'PROD_KG_SHIFT') v = r1((outKg / Math.max(hours, 1)) * 8, 0);
      else v = sample(it, p.key, m ? biasOf(`${m.id}|${p.key}`, 0.12) : 0);
      if (v === null) continue;
      params[p.key] = v;
    }
    Object.assign(params, special);
    return params;
  }

  function simulateLot(L: LotPlan): void {
    const mix = L.mix; const c = mix.count; const cid = c.id;
    const lotTag = `L${L.no}`;
    const mixTag = `M${pad(mix.no)}`;
    const meta = mixMeta(c);
    // ---- bale store
    const earliest = Math.min(...mix.bales.map((b) => b.recv));
    const baleRun: Run = {
      id: nid('SR'), lot: L, stage: 'BALE', machine: null, location: [...new Set(mix.bales.map((b) => b.bay))].join(', '), shift: 'A', operator: 'U-OPERATOR', inAt: earliest, outAt: mix.planned ? null : (mix.start as number) - 30 * 60_000,
      inKg: L.baleKg, outKg: L.baleKg, wasteKg: 0, wasteType: null, batch: null, inputRefs: [], params: {}, acc: {}, notes: mix.planned ? 'Bales reserved for the next mix — still in store' : `Bales ${mix.bales.map((b) => b.no).join(', ')} issued to blow room`,
    };
    runs.push(baleRun);
    if (mix.planned) return;

    const wasteSample = (stage: Stage, factor = 1) => {
      const it = lim(cid, 'PRODUCTION', stage, 'WASTE_PCT');
      return it ? Math.max(0.1, it.std + gauss() * (it.upper! - it.std) * 0.32 * factor) : 1;
    };
    // ---- blow room (slice of the mix run)
    const brM = mach(mix.brLine);
    const brHours = Math.max(1.2, L.kg / RATE.BR);
    const brIn = (mix.start as number) + L.idx * (brHours * HOUR + 10 * 60_000);
    const brW = wasteSample('BR');
    const brOutKg = r1(L.kg * (1 - brW / 100), 1);
    runs.push({
      id: nid('SR'), lot: L, stage: 'BR', machine: brM.id, location: null, shift: shiftOf(iso(brIn)), operator: operatorFor(brIn), inAt: brIn, outAt: brIn + brHours * HOUR,
      inKg: L.kg, outKg: brOutKg, wasteKg: r1(L.kg - brOutKg, 1), wasteType: WASTE_TYPE.BR, batch: `MX-${mixTag}`, inputRefs: [`BALES-${mixTag}`], acc: {}, notes: L.idx > 0 ? 'Continuation of the mix run' : `Mix ${mixTag} opened (${meta.recipe.map((r) => `${r.label} ${r.pct}%`).join(' + ')})`,
      params: prodParams(L, 'BR', brM, brIn, brW, 100 - brW, brHours, brOutKg),
    });
    let ready = brIn + brHours * HOUR + dwell();
    let kg = brOutKg;
    let refs = [`MX-${mixTag}`];
    const stageRuns = (stage: Stage, machineIds: string[], weights: number[], rateFor: (m: Mach) => number, batchOf: (m: Mach, i: number) => string, notes = '', factor = 1, special?: (m: Mach, start: number) => Record<string, number>) => {
      const w = wasteSample(stage, factor);
      const out: { kg: number; end: number; refs: string[] } = { kg: 0, end: 0, refs: [] };
      const total = weights.reduce((s, x) => s + x, 0);
      machineIds.forEach((id, i) => {
        const m = mach(id);
        const share = kg * (weights[i] / total);
        const hours = Math.max(1.5, share / rateFor(m));
        const start = Math.max(ready + i * 12 * 60_000, freeAt[id] ?? 0);
        const end = start + hours * HOUR;
        freeAt[id] = end + 25 * 60_000;
        const wi = Math.max(0.05, w + gauss() * w * 0.06);
        const outKg = r1(share * (1 - wi / 100), 1);
        const batch = batchOf(m, i);
        runs.push({
          id: nid('SR'), lot: L, stage, machine: id, location: null, shift: shiftOf(iso(start)), operator: operatorFor(start), inAt: start, outAt: end,
          inKg: r1(share, 1), outKg, wasteKg: r1(share - outKg, 1), wasteType: WASTE_TYPE[stage] ?? null, batch, inputRefs: refs.slice(), acc: accessorySnapshot(m, start), notes,
          params: prodParams(L, stage, m, start, wi, 100 - wi, hours, outKg, special?.(m, start)),
        });
        out.kg += outKg; out.end = Math.max(out.end, end); out.refs.push(batch);
      });
      kg = r1(out.kg, 1); ready = out.end + dwell(); refs = out.refs;
    };
    const split = (n: number, tilt = 0.12) => Array.from({ length: n }, () => 1 + (rnd() - 0.5) * tilt * 2);
    const cards = GROUPS.CARD[cid];
    // planted: card 4's waste is too high on lot 123 (red on the production master)
    stageRuns('CARD', cards, split(cards.length), () => RATE.CARD * between(0.95, 1.05), (m) => `CS-${mixTag}-C${pad(m.no, 2)}-${lotTag}`, '', L.no === 123 ? 1.9 : 1);
    stageRuns('DFB', GROUPS.DFB[cid], [1], () => RATE.DFB, (m) => `DB-${mixTag}-${lotTag}`, 'Breaker drawing, 6 doublings');
    if (c.comber) stageRuns('COMB', GROUPS.COMB[cid], split(2, 0.05), () => RATE.COMB, (m, i) => `CB-${mixTag}-${lotTag}-${i + 1}`, 'Lap formed and combed');
    stageRuns('DFF', GROUPS.DFF[cid], [1], () => RATE.DFF, () => `DF-${mixTag}-${lotTag}`, 'Finisher drawing');
    stageRuns('FF', GROUPS.FF[cid], [1], (m) => RATE.FF * (m.no === 1 ? 1.15 : m.no === 2 ? 1.08 : 1), (m) => `RV-${mixTag}-${lotTag}-F${m.no}`, '');

    // ---- ring frame: choose two frames; planted RF-6 window for 40s CH
    const grp = GROUPS.RF[cid].slice().sort((a, b) => (freeAt[a] ?? 0) - (freeAt[b] ?? 0));
    let rfIds = grp.slice(0, 2);
    const rf6Window = cid === '40CH' && ready < RF6_FIX && (mix.no === 1 || mix.no === 5);
    if (rf6Window) rfIds = ['RF-6', L.no === 102 ? 'RF-8' : 'RF-7'];
    else if (cid === '40CH' && ready < RF6_FIX) rfIds = ['RF-7', 'RF-8'];
    const rfWeights = rf6Window ? [0.6, 0.4] : [0.5, 0.5].map((x) => x * (0.9 + rnd() * 0.2));
    const rfMachineStart = (id: string) => Math.max(ready, freeAt[id] ?? 0);
    const rfSpecial = (m: Mach, start: number): Record<string, number> => {
      if (m.id === 'RF-6' && start < RF6_FIX) return { SPINDLE_RPM: r1(19800 + gauss() * 40, 0), RH_PCT: r1(50.8 + gauss() * 0.3, 0) };
      return {};
    };
    const rpmOf = (m: Mach, start: number) => (m.id === 'RF-6' && start < RF6_FIX ? 19800 : (lim(cid, 'PRODUCTION', 'RF', 'SPINDLE_RPM')?.std ?? 18200));
    const rfRunsBefore = runs.length;
    // frames start at the same time (the lot is doffed together)
    ready = Math.max(...rfIds.map(rfMachineStart));
    // planted mass-balance breach: lot 118 loses 1.2 % of its ring-frame input without a waste record
    stageRuns('RF', rfIds, rfWeights, (m) => rfSpeed(m, c, rpmOf(m, rfMachineStart(m.id))), (m) => `YN-${lotTag}-RF${m.no}`, '', 1, rfSpecial);
    if (L.no === 118) for (const r of runs.slice(rfRunsBefore, rfRunsBefore + 1)) { const lost = r1(r.inKg * 0.012, 1); r.outKg = r1(r.outKg - lost, 1); kg = r1(kg - lost, 1); r.notes = 'Output short at doffing — no waste recorded'; }
    const rfRuns = runs.slice(rfRunsBefore);
    // ---- winding
    const awIds = GROUPS.AW[cid].slice(0, cid === '20S' ? 1 : 2);
    const awBefore = runs.length;
    stageRuns('AW', awIds, split(awIds.length, 0.1), (m) => RATE.AW * (m.no === 2 ? 1.1 : 1), (m) => `CN-${lotTag}-AW${m.no}`, '');
    const awRuns = runs.slice(awBefore);
    const awEnd = Math.max(...awRuns.map((r) => r.outAt as number));
    // ---- packing + FG store (rows added here, packing / dispatch entities later)
    const packIn = awEnd + (1 + rnd() * 2) * HOUR;
    const coneKg = lim(cid, 'ACCESSORIES', 'PACK', 'NET_WT_CONE')?.std ?? 2;
    const cpc = lim(cid, 'ACCESSORIES', 'PACK', 'CONES_PER_CARTON')?.std ?? 24;
    const avgCone = r1(coneKg * (1 + gauss() * 0.006), 3);
    const cones = Math.max(1, Math.floor(kg / avgCone));
    const netKg = r1(cones * avgCone, 1);
    const cartons = Math.ceil(cones / cpc);
    const partial = cones % cpc; // cones in the last, partly filled carton
    const packHours = Math.max(1.5, cartons / 9);
    lotPack.set(L.no, { packIn, packOut: packIn + packHours * HOUR, cartons, cones, partial, netKg, avgCone, inKg: kg });
    runs.push({
      id: nid('SR'), lot: L, stage: 'PACK', machine: null, location: 'Packing hall', shift: shiftOf(iso(packIn)), operator: pick(['U-PACK1', 'U-PACK2']), inAt: packIn, outAt: packIn + packHours * HOUR,
      inKg: kg, outKg: netKg, wasteKg: r1(Math.max(0, kg - netKg), 1), wasteType: 'Loose yarn / ends', batch: `PK-${lotTag}`, inputRefs: refs.slice(), params: {}, acc: {}, notes: `${cones} cones in ${cartons} cartons`,
    });
    void rfRuns;
  }
  const lotPack = new Map<number, { packIn: number; packOut: number; cartons: number; cones: number; partial: number; netKg: number; avgCone: number; inKg: number }>();
  for (const L of lots) simulateLot(L);

  // ---- truncate at NOW: drop what has not started, mark running stages
  const runsByLot = new Map<number, Run[]>();
  for (const r of runs) { if (!runsByLot.has(r.lot.no)) runsByLot.set(r.lot.no, []); runsByLot.get(r.lot.no)!.push(r); }

  // ---------------------------------------------------------------- packing / dispatch timeline per lot
  interface Ship { lot: LotPlan; fgIn: number; dispatchAt: number | null; deliveredAt: number | null; held: boolean }
  const ships = new Map<number, Ship>();
  const HOLD_LOT = 126; const NO_RELEASE_LOT = 112; const COLOR_BAD_LOT = 119; const OVERRIDE_LOT = 117;
  const FORCE_DISPATCH: Record<number, number> = { 101: istMs('2026-10-27', 8, 30), 102: istMs('2026-10-27', 8, 30), 119: istMs('2026-10-26', 10, 15) };
  for (const L of lots) {
    const pk = lotPack.get(L.no);
    if (!pk) continue;
    const fgIn = pk.packOut;
    const held = L.no === HOLD_LOT;
    let dispatchAt: number | null = FORCE_DISPATCH[L.no] ?? fgIn + (14 + rnd() * 46) * HOUR;
    if (held || dispatchAt > NOW - 2 * HOUR) dispatchAt = FORCE_DISPATCH[L.no] ?? null;
    if (dispatchAt && dispatchAt > NOW) dispatchAt = null;
    const transit = (10 + rnd() * 34) * HOUR;
    const deliveredAt = dispatchAt && dispatchAt + transit <= NOW - HOUR ? dispatchAt + transit : null;
    if (L.no === 101) { /* in transit: left yesterday morning */ }
    ships.set(L.no, { lot: L, fgIn, dispatchAt, deliveredAt: L.no === 101 || L.no === 102 ? null : L.no === 119 ? istMs('2026-10-27', 11, 30) : deliveredAt, held });
  }

  // ---- finalize runs: truncate, ids, FG / DISP / DELIV rows
  const finalRuns: Run[] = [];
  const fgBay = new Map<number, string>();
  for (const L of lots) {
    const list = (runsByLot.get(L.no) ?? []).filter((r) => r.inAt <= NOW);
    for (const r of list) {
      if (r.outAt !== null && r.outAt > NOW) {
        const f = Math.max(0.05, (NOW - r.inAt) / (r.outAt - r.inAt));
        r.inKg = r1(r.inKg * f, 1); r.outKg = r1(r.outKg * f, 1); r.wasteKg = r1(r.wasteKg * f, 1); r.outAt = null;
        for (const k of ['PROD_KG_SHIFT']) void k;
        r.notes = r.notes || 'Running';
      }
      finalRuns.push(r);
    }
    const s = ships.get(L.no);
    const pk = lotPack.get(L.no);
    const packDone = list.find((r) => r.stage === 'PACK' && r.outAt !== null);
    if (s && pk && packDone) {
      const bay = `FG-${pick(['A', 'B', 'C'])}${Math.floor(rnd() * 8 + 1)}`;
      fgBay.set(L.no, bay);
      const fgOut = s.dispatchAt ? s.dispatchAt - HOUR : null;
      finalRuns.push({ id: nid('SR'), lot: L, stage: 'FG', machine: null, location: bay, shift: shiftOf(iso(s.fgIn)), operator: 'U-DISPATCH', inAt: s.fgIn, outAt: fgOut, inKg: pk.netKg, outKg: pk.netKg, wasteKg: 0, wasteType: null, batch: `PK-L${L.no}`, inputRefs: [], params: {}, acc: {}, notes: s.held ? 'On QA hold — not released for dispatch' : fgOut ? 'Held in FG store until customer lifting' : 'Awaiting dispatch' });
      if (s.dispatchAt) {
        finalRuns.push({ id: nid('SR'), lot: L, stage: 'DISP', machine: null, location: 'Gate 2', shift: shiftOf(iso(s.dispatchAt)), operator: 'U-DISPATCH', inAt: s.dispatchAt - HOUR, outAt: s.dispatchAt, inKg: pk.netKg, outKg: pk.netKg, wasteKg: 0, wasteType: null, batch: `PK-L${L.no}`, inputRefs: [], params: {}, acc: {}, notes: 'Loaded and gate-passed' });
        if (s.deliveredAt) finalRuns.push({ id: nid('SR'), lot: L, stage: 'DELIV', machine: null, location: customerName(L.customer), shift: shiftOf(iso(s.deliveredAt)), operator: null, inAt: s.deliveredAt, outAt: null, inKg: pk.netKg, outKg: pk.netKg, wasteKg: 0, wasteType: null, batch: `PK-L${L.no}`, inputRefs: [], params: {}, acc: {}, notes: 'Received and signed by customer' });
      }
    }
  }
  // ================================================================ lab tests
  const finalByLot = new Map<number, Run[]>();
  for (const r of finalRuns) { if (!finalByLot.has(r.lot.no)) finalByLot.set(r.lot.no, []); finalByLot.get(r.lot.no)!.push(r); }
  const INSTR_OF: Record<string, string> = {
    BR: 'HVI 1000 / AFIS', CARD: 'Uster Tester 6 (sliver)', DFB: 'Uster Tester 6 (sliver)', DFF: 'Uster Tester 6 (sliver)', COMB: 'Uster Tester 6 (sliver)',
    FF: 'Uster Tester 6 (roving)', RF: 'Uster Tester 6 + Tensorapid', AW: 'Uster Quantum 3',
  };
  const testSeq: Record<string, number> = {};
  const addTest = (L: LotPlan, stage: Stage, machine: string | null, type: 'LOT' | 'MACHINE', pos: string | null, at: number, values: Record<string, number>, remarks = ''): Test | null => {
    if (at > NOW - 20 * 60_000 || !Object.keys(values).length) return null;
    const key = `${L.no}-${machine ?? stage}-${type}`;
    testSeq[key] = (testSeq[key] ?? 0) + 1;
    const sh = shiftOf(iso(at));
    const t: Test = { id: nid('TR'), sampleId: `S-${L.no}-${(machine ?? stage).replace('-', '')}${type === 'LOT' ? '-LOT' : ''}-${sh}-${pad(testSeq[key], 2)}`, lot: L, stage, machine, type, pos, at, values, instrument: INSTR_OF[stage] ?? '', by: pick(labTechs), remarks };
    tests.push(t);
    return t;
  };
  const qvals = (L: LotPlan, stage: Stage, m: Mach | null): Record<string, number> => {
    const c = L.mix.count; const out: Record<string, number> = {};
    for (const p of PARAMS) {
      if (!(p.kind === 'QUALITY' || p.kind === 'FIBRE') || !p.stages.includes(stage)) continue;
      const it = lim(c.id, 'QUALITY', stage, p.key);
      if (!it) continue;
      const v = sample(it, p.key, m ? biasOf(`${m.id}|${p.key}`, 0.12) : 0);
      if (v !== null) out[p.key] = v;
    }
    return out;
  };
  const mean = (list: Test[], key: string): number | null => {
    const xs = list.map((t) => t.values[key]).filter((v) => typeof v === 'number');
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
  };
  for (const L of lots) {
    const list = finalByLot.get(L.no) ?? [];
    const c = L.mix.count;
    const sfiStd = lim(c.id, 'QUALITY', 'BR', 'SFI')?.std ?? 8;
    const mixEff = Math.max(0, (L.mix.fibre.SFI ?? sfiStd) - sfiStd); // short-fibre excess of the mix
    const rfTests: Test[] = []; const awTests: Test[] = [];
    for (const r of list) {
      if (!r.machine || !STAGE_INFO[r.stage].machine) continue;
      const m = mach(r.machine);
      const dur = (r.outAt ?? NOW) - r.inAt;
      const at = (f: number) => r.inAt + f * dur;
      if (r.stage === 'BR') {
        for (const f of [0.35, 0.85]) {
          const v = qvals(L, 'BR', m);
          for (const k of Object.keys(L.mix.fibre)) if (lim(c.id, 'QUALITY', 'BR', k)) v[k] = r1(L.mix.fibre[k] + gauss() * (k === 'UHML' ? 0.2 : k === 'MIC' ? 0.04 : 0.15), paramDef(k)?.decimals ?? 1);
          addTest(L, 'BR', m.id, 'MACHINE', 'Mix sample', at(f), v);
        }
      } else if (r.stage === 'CARD') {
        const fr = dur > 6 * HOUR ? [0.5, 0.9] : [0.55];
        fr.forEach((f, i) => addTest(L, 'CARD', m.id, 'MACHINE', `Can ${i + 1}`, at(f), qvals(L, 'CARD', m)));
      } else if (r.stage === 'DFB' || r.stage === 'DFF' || r.stage === 'FF') {
        [0.33, 0.7].forEach((f, i) => addTest(L, r.stage, m.id, 'MACHINE', r.stage === 'FF' ? `Doff ${i + 1}` : `Can ${i + 1}`, at(f), qvals(L, r.stage, m)));
      } else if (r.stage === 'COMB') {
        addTest(L, 'COMB', m.id, 'MACHINE', 'Can 1', at(0.5), qvals(L, 'COMB', m));
      } else if (r.stage === 'RF') {
        const rf6 = m.id === 'RF-6' && r.inAt < RF6_FIX;
        const hLim = lim(c.id, 'QUALITY', 'RF', 'H'); const s3Lim = lim(c.id, 'QUALITY', 'RF', 'S3');
        for (const f of [0.4, 0.8]) for (const side of ['L', 'R']) {
          const v = qvals(L, 'RF', m);
          if (hLim && v.H !== undefined) v.H = r1(v.H + 0.28 * mixEff, 2);
          if (s3Lim && v.S3 !== undefined) v.S3 = Math.round(v.S3 + 80 * mixEff);
          if (rf6 && hLim && s3Lim) {
            v.H = r1(hLim.std + 1.05 + rnd() * 0.3 + 0.28 * mixEff, 2);
            v.S3 = Math.round((s3Lim.upper as number) * (1.12 + rnd() * 0.1));
            if (v.U !== undefined) v.U = r1(v.U + 0.28, 2);
            if (v.CV !== undefined) v.CV = r1(v.CV + 0.35, 2);
            if (v.THICK !== undefined) v.THICK = Math.round(v.THICK * 1.18);
            if (v.NEPS !== undefined) v.NEPS = Math.round(v.NEPS * 1.12);
            if (v.TPI_CV !== undefined) v.TPI_CV = r1(v.TPI_CV + 0.6, 2);
          }
          if (v.THIN !== undefined && v.THICK !== undefined && v.NEPS !== undefined && v.IPI !== undefined) v.IPI = Math.round(v.THIN + v.THICK + v.NEPS);
          const t = addTest(L, 'RF', m.id, 'MACHINE', `Side ${side}`, at(f) + (side === 'R' ? 14 * 60_000 : 0), v);
          if (t) rfTests.push(t);
        }
      } else if (r.stage === 'AW') {
        [0.4, 0.8].forEach((f, i) => {
          const v = qvals(L, 'AW', m);
          const rfH = mean(tests.filter((t) => t.lot === L && t.stage === 'RF' && t.type === 'MACHINE'), 'H');
          const rfS3 = mean(tests.filter((t) => t.lot === L && t.stage === 'RF' && t.type === 'MACHINE'), 'S3');
          if (rfH !== null && v.H !== undefined) v.H = r1(rfH * 1.035 + gauss() * 0.04, 2);
          if (rfS3 !== null && v.S3 !== undefined) v.S3 = Math.round(rfS3 * 1.04 + gauss() * 15);
          const t = addTest(L, 'AW', m.id, 'MACHINE', `Drum ${12 + i * 17}`, at(f), v);
          if (t) awTests.push(t);
        });
      }
    }
    // lot-level composite samples (basis of QA release and the dispatch gate)
    const rfRunsDone = list.filter((r) => r.stage === 'RF');
    if (rfRunsDone.length && rfRunsDone.every((r) => r.outAt !== null) && rfTests.length) {
      const at = Math.max(...rfRunsDone.map((r) => r.outAt as number)) + 35 * 60_000;
      const keys = Object.keys(rfTests[0].values);
      const v: Record<string, number> = {};
      for (const k of keys) v[k] = r1(mean(rfTests, k) as number, paramDef(k)?.decimals ?? 2);
      const ipiLim = lim(c.id, 'QUALITY', 'RF', 'IPI'); const cvLim = lim(c.id, 'QUALITY', 'RF', 'COUNT_CV');
      if (L.no === OVERRIDE_LOT && ipiLim) v.IPI = r1((ipiLim.upper as number) * 1.1, 0);
      if (L.no === HOLD_LOT && cvLim) v.COUNT_CV = r1((cvLim.upper as number) * 1.24, 2);
      addTest(L, 'RF', null, 'LOT', 'Composite', at, v, 'Lot composite — basis for QA release');
    }
    const awRunsDone = list.filter((r) => r.stage === 'AW');
    if (awRunsDone.length && awRunsDone.every((r) => r.outAt !== null) && awTests.length) {
      const at = Math.max(...awRunsDone.map((r) => r.outAt as number)) + 40 * 60_000;
      const v: Record<string, number> = {};
      for (const k of Object.keys(awTests[0].values)) v[k] = r1(mean(awTests, k) as number, paramDef(k)?.decimals ?? 2);
      addTest(L, 'AW', null, 'LOT', 'Final composite', at, v, 'Final yarn composite');
    }
  }

  // ================================================================ entity rows
  const stepsSort = (steps: HistoryStep[]) => steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const BALE_ACTOR = 'U-OPERATOR';
  for (const m of mixes) {
    const plannedAt = m.start !== null ? m.start - 2 * DAY : NOW - (m.no === 16 ? 20 : 8) * HOUR;
    const mvId = versionId(m.count.id, 'COUNT_MIX', 1);
    const mixRow: SeedRow = {
      type: 'mix',
      row: { id: m.id, mix_no: `M-${pad(m.no)}`, count_id: m.count.id, status: 'PLANNED', planned_at: iso(plannedAt), issued_at: null, total_kg: m.totalKg, recipe: JSON.stringify(m.recipe), fibre: JSON.stringify(m.fibre), master_version_id: mvId, blow_room_line: m.brLine, created_by: BALE_ACTOR, created_at: iso(plannedAt) },
      at: iso(plannedAt), actor: BALE_ACTOR, contract: 'AssetID', fn: 'registerMix', label: `Form mix M-${pad(m.no)} for ${m.count.display} (${m.bales.length} bales)`, method: 'POST', path: '/api/mixes',
      payload: { mixId: m.id, countId: m.count.id, baleIds: m.bales.map((b) => b.id), recipe: m.recipe, masterVersion: mvId },
    };
    if (m.start !== null) mixRow.history = [{ at: iso(m.start - 30 * 60_000), actor: BALE_ACTOR, contract: 'ProcessEvent', fn: 'issueBales', label: `Issue ${m.bales.length} bales of M-${pad(m.no)} to ${m.brLine}`, patch: { status: 'ISSUED', issued_at: iso(m.start - 30 * 60_000) } }];
    rows.push(mixRow);
    for (const b of m.bales) rows.push({ type: 'mix_bale', row: { id: `MB-${m.id}-${b.id}`, mix_id: m.id, bale_id: b.id, kg_used: b.kg, pct: r1((b.kg / m.totalKg) * 100, 1) }, at: iso(plannedAt), actor: BALE_ACTOR, contract: 'AssetID', fn: 'registerMix', label: `Bale ${b.no} → mix M-${pad(m.no)}` });
  }
  for (const b of bales) {
    const mix = b.mixId ? mixes.find((x) => x.id === b.mixId) : undefined;
    const history: HistoryStep[] = [];
    if (mix) {
      const plannedAt = mix.start !== null ? mix.start - 2 * DAY : NOW - (mix.no === 16 ? 20 : 8) * HOUR;
      history.push({ at: iso(Math.max(plannedAt, b.recv + HOUR)), actor: BALE_ACTOR, contract: 'AssetID', fn: 'registerMix', label: `Bale ${b.no} reserved for mix M-${pad(mix.no)}`, patch: { mix_id: mix.id } });
      if (mix.start !== null) history.push({ at: iso(mix.start - 30 * 60_000), actor: BALE_ACTOR, contract: 'ProcessEvent', fn: 'issueBales', label: `Bale ${b.no} issued to blow room`, patch: { status: 'ISSUED', issued_at: iso(mix.start - 30 * 60_000), remaining_kg: 0 } });
    }
    rows.push({
      type: 'bale',
      row: { id: b.id, bale_no: String(b.no), supplier: b.supplier, station: b.station, variety: b.variety, gin_lot: b.ginLot, weight_kg: b.kg, remaining_kg: b.kg, received_at: iso(b.recv), bay: b.bay, bin: b.bin, status: 'IN_STORE', issued_at: null, mix_id: null, fibre: JSON.stringify(b.fibre), created_at: iso(b.recv) },
      at: iso(b.recv), actor: BALE_ACTOR, contract: 'AssetID', fn: 'registerBale', label: `Receive bale ${b.no} (${b.variety}) into ${b.bay} / ${b.bin}`, method: 'POST', path: '/api/bales', history,
    });
  }

  // ---- dispatch groups (lots of the same mix leaving together share one vehicle)
  interface Group { lots: LotPlan[]; at: number; deliveredAt: number | null; customer: string }
  const groups: Group[] = [];
  for (const L of lots) {
    const s = ships.get(L.no);
    if (!s || !s.dispatchAt) continue;
    const g = groups.find((x) => x.lots[0].mix === L.mix && Math.abs(x.at - (s.dispatchAt as number)) < 10 * HOUR);
    if (g) { g.lots.push(L); g.at = Math.max(g.at, s.dispatchAt); g.deliveredAt = g.deliveredAt === null || s.deliveredAt === null ? null : Math.max(g.deliveredAt, s.deliveredAt); }
    else groups.push({ lots: [L], at: s.dispatchAt, deliveredAt: s.deliveredAt, customer: L.customer });
  }
  groups.sort((a, b) => a.at - b.at);

  // ---- packing + QA release + gate evaluation helpers
  const packingOf = new Map<number, { id: string; slip: string; cartons: number; cones: number; net: number; tare: number; gross: number; at: number; colorOk: boolean }>();
  let slipSeq = 140;
  const colorOf = (cid: string) => COLOR_OF[cid].colorName;
  for (const L of lots) {
    const pk = lotPack.get(L.no);
    const done = (finalByLot.get(L.no) ?? []).find((r) => r.stage === 'PACK' && r.outAt !== null);
    if (!pk || !done) continue;
    const cid = L.mix.count.id;
    const tareStd = lim(cid, 'ACCESSORIES', 'PACK', 'CARTON_TARE')?.std ?? 1;
    const tare = r1(pk.cartons * (tareStd + gauss() * 0.02), 2);
    const gross = r1(pk.netKg + tare, 1);
    const packer = (done.operator as string) ?? 'U-PACK1';
    const wrong = L.no === COLOR_BAD_LOT;
    const bay = fgBay.get(L.no) ?? 'FG-A1';
    const id = nid('PK');
    const slip = `PS/26/${pad(++slipSeq, 4)}`;
    const at = done.outAt as number;
    packingOf.set(L.no, { id, slip, cartons: pk.cartons, cones: pk.cones, net: pk.netKg, tare, gross, at, colorOk: !wrong });
    rows.push({
      type: 'packing',
      row: { id, lot_id: L.id, packed_at: iso(at), packer_id: packer, package_type: 'CONE', cones_packed: pk.cones, partial_cones: pk.partial, cartons: pk.cartons, net_kg: pk.netKg, tare_kg: tare, gross_kg: gross, avg_cone_kg: pk.avgCone, color_actual: wrong ? 'Blue' : colorOf(cid), color_master: colorOf(cid), color_ok: wrong ? 0 : 1, slip_no: slip, carton_from: `C-${L.no}-001`, carton_to: `C-${L.no}-${pad(pk.cartons)}`, label_template: accessoriesMeta(L.mix.count).labelTemplate, pallets: Math.ceil(pk.cartons / 20), fg_location: bay, notes: wrong ? 'Blue-tip cones used from the 30s CH line by mistake' : '', created_at: iso(at) },
      at: iso(at), actor: packer, contract: 'ProcessEvent', fn: 'recordPacking', label: `Pack lot ${L.no}: ${pk.cartons} cartons / ${pk.netKg} kg`, method: 'POST', path: '/api/packing',
    });
  }
  const lotLevel = (L: LotPlan) => tests.filter((t) => t.lot === L && t.type === 'LOT');
  const gateItems = (L: LotPlan) => {
    const red: Record<string, unknown>[] = []; const yellow: Record<string, unknown>[] = [];
    for (const t of lotLevel(L)) for (const [k, v] of Object.entries(t.values)) {
      const it = lim(L.mix.count.id, 'QUALITY', t.stage, k);
      if (!it) continue;
      const ev = evaluate(v, { std: it.std, lower: it.lower, upper: it.upper }, 0.2);
      if (ev.color === 'red' || ev.color === 'yellow') (ev.color === 'red' ? red : yellow).push({ stage: t.stage, parameter: k, value: v, std: it.std, lower: it.lower, upper: it.upper, color: ev.color, testResultId: t.id, machineId: null });
    }
    return { red, yellow };
  };
  const overrideRow = (() => {
    const L = lotOf(OVERRIDE_LOT); const pk = packingOf.get(L.no);
    if (!pk) return null;
    const at = pk.at + 3 * HOUR;
    const row: SeedRow = { type: 'qa_override', row: { id: nid('OVR', 4), lot_id: L.id, reason: 'Lot IPI 10% above limit; customer (Ganga Garments) accepted for non-premium knit with price concession. Blended with last good lot at dispatch.', approved_by: 'U-QA', created_at: iso(at) }, at: iso(at), actor: 'U-QA', contract: 'Quality', fn: 'recordOverride', label: `QA override for lot ${L.no}`, method: 'POST', path: '/api/overrides' };
    rows.push(row);
    return row;
  })();

  // ---- lots
  const lotRowsById = new Map<number, SeedRow>();
  for (const L of lots) {
    const m = L.mix;
    const list = finalByLot.get(L.no) ?? [];
    const brRun = list.find((r) => r.stage === 'BR');
    const startMs = brRun ? brRun.inAt : NOW + DAY;
    const createdAt = m.start !== null ? m.start - 2 * DAY + L.idx * 60_000 : NOW - (m.no === 16 ? 20 : 8) * HOUR + L.idx * 60_000;
    const steps: HistoryStep[] = [];
    const pk = packingOf.get(L.no); const s = ships.get(L.no);
    if (pk) steps.push({ at: iso(pk.at), actor: 'U-DISPATCH', contract: 'ProcessEvent', fn: 'recordPacking', label: `Lot ${L.no} packed`, patch: { status: 'PACKED', end_date: istDate(iso(pk.at)) } });
    const releasable = pk && L.no !== HOLD_LOT && L.no !== NO_RELEASE_LOT;
    if (pk && L.no === HOLD_LOT) steps.push({ at: iso(pk.at + 50 * 60_000), actor: 'U-QA', contract: 'Quality', fn: 'recordTestResult', label: 'Lot 126 held: composite count CV out of limits', patch: { status: 'ON_HOLD' } });
    if (pk && releasable) steps.push({ at: iso(pk.at + (40 + rnd() * 80) * 60_000), actor: 'U-QA', contract: 'Quality', fn: 'releaseLot', label: `QA release of lot ${L.no}`, patch: { qa_release_at: iso(pk.at + 90 * 60_000), qa_release_by: 'U-QA' } });
    if (s?.dispatchAt) steps.push({ at: iso(s.dispatchAt), actor: 'U-DISPATCH', contract: 'Transfer', fn: 'createDispatch', label: `Lot ${L.no} dispatched`, patch: { status: 'DISPATCHED' } });
    if (s?.deliveredAt) steps.push({ at: iso(s.deliveredAt), actor: 'U-DISPATCH', contract: 'Transfer', fn: 'markDelivered', label: `Lot ${L.no} delivered`, patch: { status: 'DELIVERED' } });
    stepsSort(steps);
    // release timestamp patch must equal its step time
    for (const st of steps) if (st.fn === 'releaseLot') st.patch = { qa_release_at: st.at, qa_release_by: 'U-QA' };
    const row: SeedRow = {
      type: 'lot',
      row: { id: L.id, lot_no: String(L.no), lot_code: `${m.count.id}-${L.no}`, seq: L.no, year: 2026, count_id: m.count.id, mix_id: m.id, line: m.count.compact ? 'Compact' : 'Carded', status: m.planned ? 'PLANNED' : 'IN_PRODUCTION', planned_kg: L.kg, start_date: istDate(iso(startMs)), end_date: null, qa_release_at: null, qa_release_by: null, created_at: iso(createdAt) },
      at: iso(createdAt), actor: 'U-OPERATOR', contract: 'AssetID', fn: 'registerLot', label: `Register lot ${L.no} (${m.count.display}) on mix M-${pad(m.no)}`, method: 'POST', path: '/api/lots', history: steps,
    };
    lotRowsById.set(L.no, row);
    rows.push(row);
  }

  // ---- stage runs
  for (const r of finalRuns) {
    const at = r.outAt ?? Math.min(r.stage === 'DELIV' ? r.inAt : NOW - 5 * 60_000, NOW - 60_000);
    const fn = r.stage === 'BALE' ? 'issueBales' : 'logStageRun';
    const actor = r.operator ?? 'U-DISPATCH';
    rows.push({
      type: 'stage_run',
      row: { id: r.id, lot_id: r.lot.id, stage: r.stage, machine_id: r.machine, location: r.location, shift: r.shift, operator_id: r.operator, in_at: iso(r.inAt), out_at: r.outAt === null ? null : iso(r.outAt), input_kg: r.inKg, output_kg: r.outKg, waste_kg: r.wasteKg, waste_type: r.wasteType, batch_ref: r.batch, input_refs: JSON.stringify(r.inputRefs), params: JSON.stringify(r.params), accessories: JSON.stringify(r.acc), notes: r.notes, created_at: iso(at) },
      at: iso(at), actor, contract: 'ProcessEvent', fn, label: `${STAGE_INFO[r.stage].label}${r.machine ? ` · ${mach(r.machine).label}` : ''} · lot ${r.lot.no}${r.outAt === null ? ' (running)' : ''}`, method: 'POST', path: '/api/production-events',
    });
  }
  for (const t of tests) {
    const a = t.at + 25 * 60_000;
    rows.push({
      type: 'test_result',
      row: { id: t.id, sample_id: t.sampleId, lot_id: t.lot.id, stage: t.stage, machine_id: t.machine, sample_type: t.type, pos: t.pos, test_date: istDate(iso(t.at)), tested_at: iso(t.at), shift: shiftOf(iso(t.at)), values_json: JSON.stringify(t.values), instrument: t.instrument, tested_by: t.by, remarks: t.remarks, created_at: iso(a) },
      at: iso(Math.min(a, NOW - 60_000)), actor: t.by, contract: 'Quality', fn: 'recordTestResult', label: `${STAGE_INFO[t.stage].label} test${t.machine ? ` · ${mach(t.machine).label}` : ' (lot composite)'} · lot ${t.lot.no}`, method: 'POST', path: '/api/test-results',
    });
  }

  // ================================================================ dispatches, orders, passports
  const orders: Record<string, unknown>[] = [];
  const orderOf = new Map<string, string>(); // `${customer}|${count}` -> order id
  let ordSeq = 0;
  const orderFor = (customer: string, cid: string, kg: number, firstAt: number) => {
    const key = `${customer}|${cid}`;
    if (!orderOf.has(key)) {
      const n = ++ordSeq; const id = `ORD-2026-${pad(n)}`;
      const code = CUSTOMERS.find((c) => c.id === customer)!.code;
      orderOf.set(key, id);
      orders.push({ id, order_no: id, po_no: `PO/${code}/2026/${100 + n * 7}`, customer_id: customer, count_id: cid, qty_kg: 0, ordered_at: iso(firstAt - (6 + rnd() * 4) * DAY), due_date: istDate(iso(NOW + (4 + rnd() * 10) * DAY)), status: 'OPEN', _kg: 0 });
    }
    const o = orders.find((x) => x.id === orderOf.get(key)) as Record<string, unknown>;
    o._kg = (o._kg as number) + kg;
    return o.id as string;
  };
  for (const L of lots) orderFor(L.customer, L.mix.count.id, 0, (lotRowsById.get(L.no)?.at ? Date.parse(lotRowsById.get(L.no)!.at) : NOW) );
  const DRIVERS = ['R. Murugesan', 'A. Palanisamy', 'S. Kannan', 'M. Raja', 'T. Velmurugan', 'K. Subramani', 'P. Anbu'];
  const TRANSPORT: [string, string][] = [['SRM Roadways', 'SRM'], ['VRL Logistics', 'VRL'], ['Sri Murugan Transport', 'SMT'], ['Southern Express Cargo', 'SEC']];
  const dispatchOfLot = new Map<number, { id: string; no: string; at: number; deliveredAt: number | null }>();
  let dspSeq = 97; let invSeq = 411;
  const specialDispatch: Record<number, { vehicle: string; driver: string; phone: string; transporter: string; lr: string; invoice: string; remarks: string }> = {
    101: { vehicle: 'TN-39-AB-4521', driver: 'R. Murugesan', phone: '+91 98427 70418', transporter: 'SRM Roadways', lr: 'SRM/26/10543', invoice: 'INV/26-27/0412', remarks: 'Held in FG bay for PD Textiles lifting schedule; lifted 27 Oct 08:30.' },
  };
  for (const g of groups) {
    const seq = ++dspSeq; const id = `DSP-2026-${pad(seq, 4)}`;
    const cust = CUSTOMERS.find((c) => c.id === g.customer)!;
    const cid = g.lots[0].mix.count.id;
    const pks = g.lots.map((l) => packingOf.get(l.no)!);
    const cartons = pks.reduce((s, p) => s + p.cartons, 0); const cones = pks.reduce((s, p) => s + p.cones, 0);
    const net = r1(pks.reduce((s, p) => s + p.net, 0), 1); const gross = r1(pks.reduce((s, p) => s + p.gross, 0), 1);
    const sp = specialDispatch[g.lots[0].no];
    const [tName, tCode] = sp ? [sp.transporter, 'SRM'] : pick(TRANSPORT);
    const vehicle = sp?.vehicle ?? `TN-${pick(['38', '39', '37', '56', '33', '43'])}-${pick(['AB', 'BC', 'CD', 'AX', 'BY', 'CK', 'DE'])}-${1000 + Math.floor(rnd() * 8999)}`;
    const noRelease = g.lots.some((l) => l.no === NO_RELEASE_LOT);
    const override = overrideRow && g.lots.some((l) => l.no === OVERRIDE_LOT) ? overrideRow.row.id as string : null;
    const gateLots = g.lots.map((l) => {
      const gi = gateItems(l);
      const ovr = l.no === OVERRIDE_LOT ? override : null;
      return { lotId: l.id, lotNo: String(l.no), worst: gi.red.length ? 'red' : gi.yellow.length ? 'yellow' : 'green', redItems: gi.red, yellowItems: gi.yellow, machineLevelRed: [], overrideId: ovr, blocked: false };
    });
    const gate = { passed: true, overridden: !!override, checkedAt: iso(g.at - 2 * HOUR), lots: gateLots, message: override ? 'Quality gate passed with a QA override.' : 'Quality gate passed.' };
    const orderId = orderFor(g.customer, cid, net, g.at);
    const delivered = g.deliveredAt;
    const row: Record<string, unknown> = {
      id, dispatch_no: `DSP/2026/${pad(seq, 4)}`, customer_id: g.customer, order_id: orderId, count_id: cid, quantity_kg: net, dispatch_date: istDate(iso(g.at)), dispatched_at: iso(g.at),
      invoice_no: sp?.invoice ?? `INV/26-27/${pad(++invSeq, 4)}`, invoice_date: istDate(iso(g.at)), vehicle_no: vehicle, driver_name: sp?.driver ?? pick(DRIVERS), driver_phone: sp?.phone ?? `+91 9${Math.floor(1e8 + rnd() * 8.9e8)}`.replace(/(\+91 \d{5})(\d{5})/, '$1 $2'),
      transporter: tName, lr_no: sp?.lr ?? `${tCode}/26/${10000 + Math.floor(rnd() * 8999)}`, destination: `${cust.city} — ${cust.address}`, cartons, cones_count: cones, net_kg: net, gross_kg: gross, delivered_at: null,
      gate: JSON.stringify(gate), override_ids: JSON.stringify(override ? [override] : []), qa_released: noRelease ? 0 : 1, passport_code: `PP-${sha256Hex(id).slice(0, 8).toUpperCase()}`, status: 'DISPATCHED',
      remarks: sp?.remarks ?? (noRelease ? 'Dispatched on customer request before QA sign-off — needs regularisation' : ''), created_by: 'U-DISPATCH', created_at: iso(g.at),
    };
    const history: HistoryStep[] = delivered ? [{ at: iso(delivered), actor: 'U-DISPATCH', contract: 'Transfer', fn: 'markDelivered', label: `Delivery of ${row.dispatch_no} confirmed at ${cust.name}`, patch: { status: 'DELIVERED', delivered_at: iso(delivered) } }] : [];
    rows.push({ type: 'dispatch', row, at: iso(g.at), actor: 'U-DISPATCH', contract: 'Transfer', fn: 'createDispatch', label: `Dispatch ${row.dispatch_no} to ${cust.name} (${net} kg, lots ${g.lots.map((l) => l.no).join('+')})`, method: 'POST', path: '/api/dispatches', history, bundle: `DSP-${id}` });
    for (const l of g.lots) {
      const pk = packingOf.get(l.no)!;
      rows.push({ type: 'dispatch_lot', row: { id: `DL-${id}-${l.id}`, dispatch_id: id, lot_id: l.id, quantity_kg: pk.net, cartons: pk.cartons }, at: iso(g.at), actor: 'U-DISPATCH', contract: 'Transfer', fn: 'createDispatch', label: `Dispatch ${row.dispatch_no} lot ${l.no}`, bundle: `DSP-${id}` });
      dispatchOfLot.set(l.no, { id, no: row.dispatch_no as string, at: g.at, deliveredAt: delivered });
    }
    rows.push({ type: 'passport', row: { code: row.passport_code, dispatch_id: id, issued_at: iso(g.at) }, at: iso(g.at + 60_000), actor: 'U-DISPATCH', contract: 'AssetID', fn: 'issuePassport', label: `Issue product passport ${row.passport_code}`, method: 'POST', path: '/api/passports' });
  }
  for (const o of orders) {
    const kg = o._kg as number;
    const dispatched = [...dispatchOfLot.keys()].filter((no) => lotOf(no).customer === o.customer_id && lotOf(no).mix.count.id === o.count_id).reduce((s, no) => s + packingOf.get(no)!.net, 0);
    o.qty_kg = Math.max(500, Math.ceil((kg * 1.1) / 500) * 500);
    o.status = dispatched >= (o.qty_kg as number) * 0.95 ? 'COMPLETE' : dispatched > 0 ? 'PARTIAL' : 'OPEN';
    delete o._kg;
  }

  // ================================================================ complaints (lot 101's is NOT seeded: it is registered live)
  const svg = (title: string, sub: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#f4f1ea"/><g stroke="#8a7f6a" stroke-width="2" fill="none">${Array.from({ length: 18 }, (_, i) => `<path d="M0 ${20 + i * 21} q80 ${(i % 3) * 6 - 6} 160 0 t160 0 t160 0 t160 0"/>`).join('')}</g><rect x="0" y="330" width="640" height="70" fill="#1f2937" opacity=".85"/><text x="20" y="362" font-family="sans-serif" font-size="20" fill="#fff">${title}</text><text x="20" y="386" font-family="sans-serif" font-size="13" fill="#d1d5db">${sub}</text></svg>`;
  interface CSpec { seq: number; customer: string; counts: string[]; prefer?: number; type: string; status: 'OPEN' | 'UNDER_ANALYSIS' | 'RESOLVED'; source: 'PORTAL' | 'MILL'; desc: string; attach?: boolean; conclusion?: { root: string; corrective: string; preventive: string; reply: string; html: string }; ageDays: number }
  const CS: CSpec[] = [
    { seq: 14, customer: 'CUST-SLH', counts: ['20S', '30CH', '40CH'], type: 'EVENNESS', status: 'RESOLVED', source: 'MILL', ageDays: 7, desc: 'Barré streaks in single jersey fabric knitted from this lot. About 4 rolls affected.', conclusion: { root: 'Knitting-machine feeder tension variation at the customer end; yarn U% and CV within master on all frames.', corrective: 'Customer advised to re-tension feeders and re-knit the 4 rolls with a second cone batch.', preventive: 'Share the lot passport with the customer at dispatch so mill data can be compared with fabric faults.', reply: 'Dear Sri Lakshmi Hosiery, our tests show the yarn U% and CV inside master limits on every machine. The streaks match feeder-tension variation. We have attached the lot passport and re-sent a second cone batch for the 4 rolls.', html: '<p>Lot tests (U%, CV, thin/thick) were all within the active master. No spinning-side cause found; customer-side feeder tension suspected and confirmed on a joint visit.</p>' } },
    { seq: 15, customer: 'CUST-KVW', counts: ['40CP'], type: 'THIN_THICK_NEPS', status: 'RESOLVED', source: 'PORTAL', ageDays: 6, desc: 'Visible neps (white specks) in dyed fabric from this lot.', conclusion: { root: 'Card-nep level on CARD-11 at the upper limit during the run; nep removal efficiency dipped (yellow).', corrective: 'Card-11 flats re-ground and wire checked; 1 carton replaced from a clean lot.', preventive: 'Added CARD NEP_REMOVAL to the shift-start checklist for compact lots.', reply: 'Dear Kaveri Weaves, we traced the neps to reduced nep removal on one card during this run. One carton has been replaced and the card has been serviced.', html: '<p>Card nep removal on CARD-11 was in the warning zone; combined with compact yarn’s finer appearance the neps showed after dyeing.</p>' } },
    { seq: 16, customer: 'CUST-PDT', counts: ['30CH', '40CH', '40CP'], type: 'CONTAMINATION', status: 'RESOLVED', source: 'PORTAL', ageDays: 5, desc: 'Two cones with yellow polypropylene fibres in the yarn.', attach: true, conclusion: { root: 'Foreign-fibre (PP) from a bale strap fragment that passed the blow-room cleaner.', corrective: 'Both cones removed; lot swept at winder with contamination clearer sensitivity raised.', preventive: 'Bale-opening checklist now includes strap and wrapper removal sign-off.', reply: 'Dear PD Textiles, the PP fibres came from a bale wrapper fragment. The affected cones have been replaced and winder clearer sensitivity was raised for the rest of the lot.', html: '<p>Contamination cuts at the winder were higher on one drum; wrapper fragment identified under magnification.</p>' } },
    { seq: 17, customer: 'CUST-VKF', counts: ['30CH'], prefer: 104, type: 'COUNT_VARIATION', status: 'UNDER_ANALYSIS', source: 'PORTAL', ageDays: 2, desc: 'Cones from different cartons knit with a visible count difference (about 1 count finer on some).', attach: true },
    { seq: 18, customer: 'CUST-KVW', counts: ['40CH'], prefer: 119, type: 'PACKING_COLOR', status: 'UNDER_ANALYSIS', source: 'MILL', ageDays: 1, desc: 'Cones in the carton have BLUE tips but we ordered 40s CH (green tip). Please confirm the count.', attach: true },
    { seq: 19, customer: 'CUST-VKF', counts: ['30CH', '20S'], type: 'SHORT_WEIGHT', status: 'OPEN', source: 'PORTAL', ageDays: 1, desc: 'Carton weighed 46.8 kg on our weighbridge against 50 kg shown on the label.' },
    { seq: 20, customer: 'CUST-GGT', counts: ['40CH'], prefer: 110, type: 'HAIRINESS', status: 'OPEN', source: 'PORTAL', ageDays: 1, desc: 'Fabric from lot 110 shows more fuzz / hairiness than previous lots — pilling in the first wash.', attach: true },
    { seq: 21, customer: 'CUST-PDT', counts: ['40CP', '30CH', '40CH'], type: 'STRENGTH', status: 'OPEN', source: 'MILL', ageDays: 0.5, desc: 'Yarn breakages on our circular knitting machines increased with this lot (frequent end breaks).' },
  ];
  const used = new Set<number>([101]);
  for (const cs of CS) {
    const cands = [...dispatchOfLot.entries()].filter(([no]) => lotOf(no).customer === cs.customer && cs.counts.includes(lotOf(no).mix.count.id) && !used.has(no)).sort((a, b) => a[1].at - b[1].at);
    const hit = cs.prefer && dispatchOfLot.has(cs.prefer) ? cs.prefer : cands[0]?.[0];
    if (!hit) continue;
    used.add(hit);
    const L = lotOf(hit); const d = dispatchOfLot.get(hit)!;
    const cust = CUSTOMERS.find((c) => c.id === cs.customer)!;
    const receivedAt = Math.min(NOW - cs.ageDays * DAY, NOW - 3 * HOUR);
    const rcv = Math.max(receivedAt, d.at + 6 * HOUR);
    const id = `CMP-${cs.seq}-2026`;
    const buyerUser = (users.find((u) => u.customer_id === cs.customer)?.id as string) ?? 'U-CS';
    const creator = cs.source === 'PORTAL' ? buyerUser : 'U-CS';
    const complainant = `${cust.contact_name} (${cust.name})`;
    let docId: string | null = null;
    if (cs.attach) {
      docId = nid('DOC', 4);
      const content = svg(`Complaint ${cs.seq}/2026 — lot ${L.no}`, `${cust.name} · ${COMPLAINT_FILE[cs.type] ?? 'photo'}`);
      const rel = `complaints/${id}/photo-1.svg`;
      files.push({ path: rel, content });
      rows.push({ type: 'document', row: { id: docId, sha256: sha256Hex(content), filename: 'photo-1.svg', mime_type: 'image/svg+xml', size_bytes: Buffer.byteLength(content), storage_path: rel, ref_type: 'complaint', ref_id: id, uploaded_by: creator, uploaded_at: iso(rcv) }, at: iso(rcv), actor: creator, contract: 'AssetID', fn: 'anchorDocument', label: `Anchor complaint photo for ${cs.seq}/2026`, method: 'POST', path: '/api/documents' });
    }
    const t1 = Math.min(rcv + 4 * HOUR, NOW - HOUR); const t2 = Math.min(Math.max(t1 + 20 * HOUR, rcv + 2 * DAY), NOW - HOUR);
    const history: HistoryStep[] = [];
    if (cs.status !== 'OPEN') history.push({ at: iso(t1), actor: 'U-QA', contract: 'Quality', fn: 'transitionComplaint', label: `Complaint ${cs.seq}/2026 → In progress`, patch: { status: 'UNDER_ANALYSIS', updated_at: iso(t1) } });
    if (cs.status === 'RESOLVED') history.push({ at: iso(t2), actor: 'U-QA', contract: 'Quality', fn: 'recordConclusion', label: `Complaint ${cs.seq}/2026 → Closed`, patch: { status: 'RESOLVED', updated_at: iso(t2) } });
    rows.push({
      type: 'complaint',
      row: { id, complaint_no: `${cs.seq}/2026`, seq: cs.seq, year: 2026, complainant_name: complainant, type: cs.type, source: cs.source, customer_id: cs.customer, lot_id: L.id, dispatch_id: d.id, description: cs.desc, document_id: docId, status: 'OPEN', received_date: istDate(iso(rcv)), created_by: creator, created_at: iso(rcv), updated_at: iso(rcv) },
      at: iso(rcv), actor: creator, contract: 'Quality', fn: 'registerComplaint', label: `Register complaint ${cs.seq}/2026 (${cs.type}) — lot ${L.no}, ${cust.name}`, method: 'POST', path: '/api/complaints', history,
    });
    rows.push({ type: 'complaint_event', row: { id: nid('CE'), complaint_id: id, from_status: null, to_status: 'OPEN', note: 'Complaint registered on ledger', by_user_id: creator, at: iso(rcv) }, at: iso(rcv), actor: creator, contract: 'Quality', fn: 'registerComplaint', label: `Complaint ${cs.seq}/2026 opened` });
    if (cs.status !== 'OPEN') rows.push({ type: 'complaint_event', row: { id: nid('CE'), complaint_id: id, from_status: 'OPEN', to_status: 'UNDER_ANALYSIS', note: 'Investigation started by QA', by_user_id: 'U-QA', at: iso(t1) }, at: iso(t1), actor: 'U-QA', contract: 'Quality', fn: 'transitionComplaint', label: `Complaint ${cs.seq}/2026 investigation started` });
    if (cs.status === 'RESOLVED' && cs.conclusion) {
      rows.push({ type: 'conclusion', row: { id: nid('CON', 4), complaint_id: id, analysis_id: null, conclusion_html: cs.conclusion.html, root_cause: cs.conclusion.root, corrective_action: cs.conclusion.corrective, preventive_action: cs.conclusion.preventive, customer_reply: cs.conclusion.reply, concluded_by: 'U-QA', concluded_at: iso(t2) }, at: iso(t2), actor: 'U-QA', contract: 'Quality', fn: 'recordConclusion', label: `Conclusion recorded for complaint ${cs.seq}/2026` });
      rows.push({ type: 'complaint_event', row: { id: nid('CE'), complaint_id: id, from_status: 'UNDER_ANALYSIS', to_status: 'RESOLVED', note: `Resolved & closed: ${cs.conclusion.root}`, by_user_id: 'U-QA', at: iso(t2) }, at: iso(t2), actor: 'U-QA', contract: 'Quality', fn: 'recordConclusion', label: `Complaint ${cs.seq}/2026 closed` });
    }
  }

  const notifications = [
    { id: 'N-1', severity: 'critical', title: 'Lot 126 on QA hold', body: 'Composite count CV is out of limits — dispatch blocked.', link: '/lots/LOT-126', created_at: iso(NOW - 3 * HOUR) },
    { id: 'N-2', severity: 'warning', title: 'Traveller overdue on RF-2', body: 'Traveller age 21 days vs master 18.', link: '/accessories', created_at: iso(NOW - 5 * HOUR) },
    { id: 'N-3', severity: 'warning', title: 'Cone colour mismatch at packing (lot 119)', body: 'Blue tip used for 40s CH (master: green).', link: '/lots/LOT-119', created_at: iso(NOW - 2 * DAY) },
    { id: 'N-4', severity: 'info', title: 'Master v2 awaiting approval', body: '30s CH Production master v2 (spindle speed trial).', link: '/masters', created_at: iso(NOW - 2 * DAY) },
  ];
  const sequences: Record<string, number> = { 'complaint:2026': 21, 'dispatch:2026': dspSeq, 'lot:2026': 140, 'mix:2026': mixes.length, 'slip:2026': slipSeq };
  for (const [k, v] of Object.entries(idSeq)) sequences[`id:${k}`] = v;
  return {
    users, counts, orders, rows, files, notifications,
    settings: { millName: 'Model Spinning Mill — Unit 1', warnFraction: 0.2, businessDate: TODAY, nowIso: config.seedNowIso },
    sequences,
    facts: { demoLot: 'LOT-101', rf6Fix: iso(RF6_FIX), holdLot: HOLD_LOT, noReleaseLot: NO_RELEASE_LOT, colorBadLot: COLOR_BAD_LOT, overrideLot: OVERRIDE_LOT, lots: lots.length, bales: bales.length, mixes: mixes.length },
  };
}

const COMPLAINT_FILE: Record<string, string> = { HAIRINESS: 'fabric close-up', COUNT_VARIATION: 'cone comparison', PACKING_COLOR: 'carton photo', CONTAMINATION: 'yarn close-up' };
