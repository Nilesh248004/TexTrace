// Domain DTOs exchanged between server and client (camelCase). DB rows are snake_case and mapped in server/services.
import type { Department, ParamCategory, Shift } from './params';
import type { QualityColor } from './quality';
import type { ContractFunction, ContractName, Role } from './permissions';

export type { Department, Shift, QualityColor, Role, ContractName, ContractFunction };

/** Attached to every ledger-anchored record as `chain`. Drives the "Verified on-chain ✔ (block #)" badge. */
export interface OnChainRef {
  txHash: string | null;
  blockNumber: number | null;
  recordHash: string | null;
  version: number;
  /** true when the current DB row re-hashes to the anchored hash (false => tampered off-chain). */
  verified: boolean;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  org: string;
  title: string;
  customerId: string | null; // BUYER users are bound to a customer
}

export interface Count {
  id: string; // '30CH'
  label: string; // '30s Carded Hosiery'
  display: string; // '30 CH'
  ne: number; // 30
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  city: string;
  contactName: string;
  email: string;
  chain: OnChainRef;
}

export interface Machine {
  id: string; // 'RF-3'
  department: Department;
  machineNo: number;
  label: string; // 'RF M/c 3'
  line: 'A' | 'B' | null;
  make: string;
  model: string;
  chain: OnChainRef;
}

export interface Bale {
  id: string;
  baleNo: string; // 'B26-0412'
  supplier: string;
  station: string;
  variety: string;
  ginLot: string;
  weightKg: number;
  remainingKg: number;
  arrivalDate: string; // YYYY-MM-DD
  fibre: Record<string, number>; // MIC, UHML, UI, STR, SFI, TRASH, MOIST
  chain: OnChainRef;
}

export type LotStatus = 'PLANNED' | 'IN_PRODUCTION' | 'PRODUCED' | 'PACKED' | 'DISPATCHED' | 'ON_HOLD';

export interface Lot {
  id: string;
  lotNo: string; // '182/2026'
  lotCode: string; // '30CH 182 X/26 001'
  seq: number;
  year: number;
  countId: string;
  line: 'A' | 'B';
  status: LotStatus;
  currentStage: Department;
  plannedKg: number;
  producedKg: number; // AW output
  packedKg: number;
  dispatchedKg: number;
  startDate: string;
  endDate: string | null;
  chain: OnChainRef;
}

export interface LotBale {
  lotId: string;
  baleId: string;
  kgUsed: number;
}

export interface ProductionEvent {
  id: string;
  lotId: string;
  department: Department;
  machineId: string | null;
  eventDate: string; // YYYY-MM-DD
  dayIndex: number; // 1-based production day of this department for this lot (D1..Dn)
  shift: Shift | null;
  inputKg: number;
  outputKg: number;
  wasteKg: number;
  params: Record<string, number>;
  notes: string;
  operatorId: string;
  operatorName: string;
  createdAt: string;
  chain: OnChainRef;
}

export type SampleType = 'LOT' | 'MACHINE';

export interface TestResult {
  id: string;
  lotId: string;
  department: Department;
  machineId: string | null; // null for LOT samples
  sampleType: SampleType; // LOT = lot release test (QUALITY tab row); MACHINE = machine/day/shift test (heatmap)
  testDate: string; // YYYY-MM-DD
  dayIndex: number | null;
  shift: Shift | null;
  values: Record<string, number>;
  instrument: string;
  testedBy: string; // user id
  testedByName: string;
  remarks: string;
  createdAt: string;
  chain: OnChainRef;
}

export interface Standard {
  id: string;
  countId: string;
  department: Department;
  parameter: string;
  category: ParamCategory;
  std: number;
  lower: number | null;
  upper: number | null;
  unit: string;
  version: number;
  active: boolean;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
  chain: OnChainRef;
}

export interface StandardVersion {
  standardId: string;
  version: number;
  changeType: 'CREATE' | 'UPDATE' | 'DELETE';
  std: number;
  lower: number | null;
  upper: number | null;
  reason: string;
  changedBy: string;
  changedByName: string;
  changedAt: string;
  txHash: string | null;
  blockNumber: number | null;
}

export interface PackingRecord {
  id: string;
  lotId: string;
  packDate: string;
  packWeightKg: number;
  packsCount: number;
  conesPerPack: number;
  totalKg: number;
  packFrom: string; // 'P182-0001'
  packTo: string;
  createdBy: string;
  chain: OnChainRef;
}

export interface GateItem {
  department: Department;
  parameter: string;
  value: number;
  std: number;
  lower: number | null;
  upper: number | null;
  color: QualityColor;
  testResultId: string;
  machineId: string | null;
  dayIndex: number | null;
  shift: Shift | null;
}

export interface GateLotResult {
  lotId: string;
  lotNo: string;
  worst: QualityColor; // worst color among LOT-level (release) results
  redItems: GateItem[]; // LOT-level reds -> block unless override
  yellowItems: GateItem[];
  machineLevelRed: GateItem[]; // MACHINE-level reds -> warning only (shown on dispatch form)
  overrideId: string | null;
  blocked: boolean;
}

export interface GateResult {
  passed: boolean;
  overridden: boolean;
  checkedAt: string;
  lots: GateLotResult[];
  message: string;
}

export interface QaOverride {
  id: string;
  lotId: string;
  lotNo: string;
  reason: string;
  approvedBy: string;
  approvedByName: string;
  createdAt: string;
  chain: OnChainRef;
}

export interface DispatchLot {
  lotId: string;
  lotNo: string;
  lotCode: string;
  quantityKg: number;
}

export interface Dispatch {
  id: string;
  dispatchNo: string; // 'DSP/2026/0112'
  customerId: string;
  customerName: string;
  countId: string;
  quantityKg: number;
  dispatchDate: string; // YYYY-MM-DD
  lots: DispatchLot[];
  packWeightKg: number;
  packsCount: number;
  conesCount: number;
  vehicleNo: string;
  lrNo: string;
  invoiceNo: string;
  gate: GateResult;
  overrideIds: string[];
  passportCode: string;
  status: 'DISPATCHED' | 'DELIVERED';
  createdBy: string;
  createdByName: string;
  createdAt: string;
  chain: OnChainRef;
}

export const COMPLAINT_TYPES = [
  'COUNT_VARIATION',
  'EVENNESS',
  'IMPERFECTIONS',
  'STRENGTH',
  'HAIRINESS',
  'CONTAMINATION',
  'SHADE',
  'PACKING',
  'OTHER',
] as const;
export type ComplaintType = (typeof COMPLAINT_TYPES)[number];

export const COMPLAINT_TYPE_LABEL: Record<ComplaintType, string> = {
  COUNT_VARIATION: 'Count variation',
  EVENNESS: 'U% / evenness',
  IMPERFECTIONS: 'Neps / imperfections',
  STRENGTH: 'Strength',
  HAIRINESS: 'Hairiness',
  CONTAMINATION: 'Contamination',
  SHADE: 'Shade',
  PACKING: 'Packing',
  OTHER: 'Other',
};

/** Parameters most relevant to each complaint type (used to focus AI analysis). */
export const COMPLAINT_TYPE_PARAMS: Record<ComplaintType, string[]> = {
  COUNT_VARIATION: ['COUNT', 'COUNT_CV', 'HANK', 'CV1M', 'CV3M', 'CV10M'],
  EVENNESS: ['U', 'CV', 'THIN', 'THICK', 'CV1M', 'CV3M'],
  IMPERFECTIONS: ['NEPS', 'THICK', 'THIN', 'IPI', 'NEPS_G'],
  STRENGTH: ['CSP', 'RKM', 'ELONG', 'TPI'],
  HAIRINESS: ['H', 'SPINDLE_RPM', 'WIND_SPEED'],
  CONTAMINATION: ['TRASH'],
  SHADE: ['MIC'],
  PACKING: [],
  OTHER: ['U', 'CV', 'IPI', 'H', 'CSP'],
};

export type ComplaintStatus = 'OPEN' | 'UNDER_ANALYSIS' | 'RESOLVED';

/** Status -> color: RED = Open/New, YELLOW = In progress/Under analysis, GREEN = Closed/Resolved. */
export const COMPLAINT_STATUS_META: Record<ComplaintStatus, { label: string; color: QualityColor; icon: string }> = {
  OPEN: { label: 'Open', color: 'red', icon: 'CircleDot' },
  UNDER_ANALYSIS: { label: 'Under Analysis', color: 'yellow', icon: 'Loader' },
  RESOLVED: { label: 'Resolved', color: 'green', icon: 'CheckCircle2' },
};

export interface Complaint {
  id: string;
  complaintNo: string; // '22/2026'
  seq: number;
  year: number;
  complainantName: string;
  type: ComplaintType;
  customerId: string;
  customerName: string;
  lotId: string;
  lotNo: string;
  lotCode: string;
  dispatchId: string | null;
  description: string;
  documentId: string | null;
  status: ComplaintStatus;
  receivedDate: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  chain: OnChainRef;
}

export interface ComplaintEvent {
  id: string;
  complaintId: string;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus;
  note: string;
  byUserId: string;
  byName: string;
  at: string;
  txHash: string | null;
  blockNumber: number | null;
}

export interface DocumentMeta {
  id: string;
  sha256: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  url: string; // '/api/documents/:id/file'
  chain: OnChainRef;
}

export interface Conclusion {
  id: string;
  complaintId: string;
  analysisId: string | null;
  conclusionHtml: string;
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  concludedBy: string;
  concludedByName: string;
  concludedAt: string;
  chain: OnChainRef;
}

export interface Notification {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
}

export interface Settings {
  millName: string;
  lotNoFormat: string;
  lotCodeFormat: string;
  lotMark: string;
  warnFraction: number;
  businessDate: string; // YYYY-MM-DD "today" for dashboards (seed default 2026-10-16)
  qualityColumns: string[]; // visible columns in Lot > QUALITY
}

// ============================================================================================
// Ledger
export interface ValidatorApproval {
  validator: string; // 'validator-1'
  org: string; // 'MillOrg'
  approved: boolean;
  signature: string; // HMAC-SHA256(validatorKey, blockHash) hex
  reason: string | null;
  latencyMs: number;
}

export interface EntityRef {
  type: string; // entity type, e.g. 'complaint'
  id: string;
  version: number;
  recordHash: string;
  snapshot: Record<string, unknown>; // canonical business fields at this version
}

export interface LedgerTx {
  txHash: string;
  blockNumber: number;
  index: number; // position in block
  timestamp: string;
  contract: ContractName | 'System';
  fn: string;
  payload: Record<string, unknown>;
  actorId: string;
  actorRole: Role | 'SYSTEM';
  status: 'VALID' | 'INVALID';
  reason: string | null;
  entityRefs: EntityRef[];
  nonce: string;
}

export interface LedgerBlock {
  number: number;
  timestamp: string;
  prevHash: string;
  merkleRoot: string;
  hash: string;
  txCount: number;
  proposer: string;
  approvals: ValidatorApproval[];
}

export interface LedgerStats {
  height: number; // latest block number
  blocks: number;
  transactions: number;
  validTx: number;
  invalidTx: number;
  lastBlockAt: string | null;
  validators: { id: string; org: string }[];
  policy: string; // e.g. '3-of-4 validator signatures'
  byContract: { contract: string; count: number }[];
}

export type IntegrityIssueKind =
  | 'BLOCK_HASH_MISMATCH'
  | 'PREV_HASH_BROKEN'
  | 'MERKLE_MISMATCH'
  | 'TX_HASH_MISMATCH'
  | 'SIGNATURE_INVALID'
  | 'QUORUM_NOT_MET'
  | 'RECORD_HASH_MISMATCH'
  | 'RECORD_MISSING'
  | 'ANCHOR_MISMATCH';

export interface IntegrityIssue {
  kind: IntegrityIssueKind;
  message: string;
  blockNumber: number | null;
  txHash: string | null;
  entityType: string | null;
  entityId: string | null;
  field: string | null;
  expected: unknown;
  actual: unknown;
}

export interface ChainValidationReport {
  valid: boolean;
  checkedAt: string;
  durationMs: number;
  checkedBlocks: number;
  checkedTxs: number;
  checkedRecords: number;
  issues: IntegrityIssue[];
}

export interface MerkleProofStep {
  position: 'left' | 'right';
  hash: string;
}

// ============================================================================================
// Developer trace — produced for EVERY write action (and logins / denials / uploads / AI runs / tamper).
export interface ValidationCheck {
  rule: string; // e.g. 'stage-order', 'mass-balance', 'tolerance:RF:U', 'permission'
  passed: boolean;
  detail: string;
}

export interface ContractInvocation {
  contract: ContractName;
  fn: string;
  payload: Record<string, unknown>;
  accepted: boolean;
  reason: string | null;
  checks: ValidationCheck[];
  txHash: string | null;
  blockNumber: number | null;
}

export interface DbChange {
  table: string;
  op: 'insert' | 'update' | 'delete';
  key: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface DevTrace {
  actionId: string;
  action: string; // machine name, e.g. 'complaint.register'
  label: string; // human label, e.g. 'Register complaint 22/2026'
  timestamp: string;
  user: { id: string; username: string; name: string; role: Role } | null;
  request: { method: string; path: string; query: Record<string, unknown>; body: unknown };
  response: { status: number; body: unknown };
  invocations: ContractInvocation[];
  accepted: boolean;
  reason: string | null;
  txHashes: string[];
  blockNumber: number | null;
  validatorApprovals: ValidatorApproval[];
  dbDiff: DbChange[];
  durationMs: number;
  /** Action-specific extras, e.g. AI: { prompt, model, latencyMs, inputJson, outputJson }; tamper: { bypassedContracts: true } */
  extra: Record<string, unknown> | null;
}

// ============================================================================================
// Read models
export interface DashboardSummary {
  millName: string;
  businessDate: string;
  complaints: { total: number; open: number; underAnalysis: number; resolved: number };
  lots: { total: number; inProduction: number; onHold: number; dispatched: number };
  qualityAlerts: { red: number; yellow: number; windowDays: number };
  dispatches: { month: string; count: number; quantityKg: number };
  ledger: { blocks: number; transactions: number; invalidTx: number; lastBlockAt: string | null };
  analyses: { completed: number; llmEnabled: boolean };
}

export interface ActivityItem {
  id: string;
  at: string;
  actorName: string;
  actorRole: Role | 'SYSTEM';
  action: string;
  label: string;
  accepted: boolean;
  txHash: string | null;
  blockNumber: number | null;
  link: string | null;
}

export interface QualityTrendPoint {
  date: string;
  value: number;
  lotNo: string;
  n: number;
}

export interface QualityTrend {
  countId: string;
  department: Department;
  parameter: string;
  points: QualityTrendPoint[];
}

export interface LotListItem extends Lot {
  countDisplay: string;
  worstColor: QualityColor; // worst LOT-level color
  redCount: number; // LOT + MACHINE level red values
  yellowCount: number;
  customers: string[];
}

export interface StageParamSummary {
  parameter: string;
  mean: number;
  min: number;
  max: number;
  n: number;
  byMachine: { machineId: string; mean: number; n: number }[];
}

export interface StageSummary {
  department: Department;
  label: string;
  machines: string[];
  firstDate: string | null;
  lastDate: string | null;
  days: number;
  inputKg: number;
  outputKg: number;
  wasteKg: number;
  wastePct: number;
  params: StageParamSummary[];
  events: number;
}

export interface LotProductionView {
  lot: Lot;
  fibre: StageParamSummary[]; // RM: weighted mean of consumed bales' HVI values
  stages: StageSummary[];
}

export interface LotQualityRow {
  department: Department;
  label: string;
  lotTest: TestResult | null; // LOT sample (release test)
  machineTests: number;
}

export interface LotQualityView {
  lot: Lot;
  rows: LotQualityRow[];
  machineTests: TestResult[]; // all MACHINE samples for drill-down
}

export interface TraceStep {
  stage: 'RAW_MATERIAL' | 'PRODUCTION' | 'PACKING' | 'DISPATCH' | 'COMPLAINT';
  department: Department | null;
  label: string;
  startAt: string | null;
  endAt: string | null;
  detail: string;
  txHash: string | null;
  blockNumber: number | null;
  link: string | null;
}

export type TraceNodeType = 'bale' | 'lot' | 'machine' | 'stage' | 'pack' | 'dispatch' | 'customer' | 'complaint';

export interface TraceNode {
  id: string; // e.g. 'lot:LOT-182-2026'
  type: TraceNodeType;
  label: string;
  sublabel: string | null;
  status: QualityColor | null;
  entityId: string;
  link: string | null;
}

export interface TraceEdge {
  id: string;
  source: string;
  target: string;
  label: string | null;
}

export interface TraceGraph {
  root: string;
  nodes: TraceNode[];
  edges: TraceEdge[];
}

export interface LotTraceView {
  lot: Lot;
  chain: TraceStep[]; // Production -> Packing -> Dispatch (with timestamps)
  backward: {
    bales: (Bale & { kgUsed: number })[];
    machines: { department: Department; machines: Machine[] }[];
  };
  forward: { dispatches: Dispatch[]; customers: { customerId: string; name: string; quantityKg: number }[] };
  packing: PackingRecord[];
  complaints: Complaint[];
  graph: TraceGraph;
}

export interface BaleForwardTrace {
  bale: Bale;
  lots: { lot: Lot; kgUsed: number }[];
  dispatches: Dispatch[];
  customers: { customerId: string; name: string; quantityKg: number }[];
  graph: TraceGraph;
}

export interface HeatmapColumn {
  key: string; // 'D2' or 'D2-A'
  dayIndex: number;
  shift: Shift | null;
  date: string;
  label: string; // 'D2' / 'D2 · A'
}

export interface HeatmapCell {
  machineId: string;
  columnKey: string;
  value: number | null; // mean of tests in the cell
  n: number;
  testIds: string[];
}

export interface HeatmapData {
  lotId: string;
  lotNo: string;
  countId: string;
  department: Department;
  parameter: string;
  mode: 'day' | 'shift';
  machines: { id: string; label: string }[];
  columns: HeatmapColumn[];
  cells: HeatmapCell[];
}

export interface PassportView {
  code: string;
  issuedAt: string;
  millName: string;
  dispatch: Pick<Dispatch, 'dispatchNo' | 'customerName' | 'countId' | 'quantityKg' | 'dispatchDate' | 'packsCount' | 'packWeightKg' | 'conesCount'>;
  lots: {
    lotNo: string;
    lotCode: string;
    countDisplay: string;
    quality: { department: Department; values: Record<string, number> }[]; // LOT-level release values
    journey: TraceStep[];
    origin: { varieties: string[]; stations: string[]; bales: number };
  }[];
  standards: Standard[]; // to color quality values client-side
  certifications: { name: string; note: string }[];
  ledgerProof: {
    txHash: string;
    blockNumber: number;
    blockHash: string;
    merkleRoot: string;
    merkleProof: MerkleProofStep[];
    approvals: ValidatorApproval[];
    verified: boolean;
    verifiedAt: string;
  };
}

// ============================================================================================
// AI analysis
export interface AnalysisContext {
  source: 'heatmap' | 'complaint' | 'manual';
  department: Department | null;
  machineId: string | null;
  dayIndex: number | null;
  date: string | null;
  shift: Shift | null;
  parameter: string | null;
}

export interface Deviation {
  rank: number;
  scope: 'LOT' | 'MACHINE_DAY' | 'PROCESS' | 'FIBRE';
  department: Department;
  parameter: string;
  machineId: string | null;
  dayIndex: number | null;
  date: string | null;
  shift: Shift | null;
  value: number;
  std: number | null;
  lower: number | null;
  upper: number | null;
  color: QualityColor;
  deviationFromStd: number | null;
  normalizedDeviation: number | null; // +/-1 at limit
  zScore: number | null; // vs comparison lots (or within-lot peers for MACHINE_DAY)
  comparisonMean: number | null;
  comparisonSd: number | null;
  significance: number; // 0..100
  evidence: string; // one sentence citing the numbers
}

export interface SuspectedLocation {
  department: Department;
  stageLabel: string;
  machineId: string | null;
  machineLabel: string | null;
  dayIndex: number | null;
  date: string | null;
  shifts: Shift[];
  parameter: string;
  value: number;
  confidence: number; // 0..100
  evidence: string[];
}

export interface EvidenceItem {
  text: string;
  values: Record<string, number | string>;
  dataRefs: { kind: 'test' | 'event' | 'standard' | 'lot' | 'bale' | 'dispatch'; id: string }[];
}

export interface RootCause {
  id: string; // stable id from the knowledge base, e.g. 'RF_BREAK_DRAFT'
  title: string;
  category: 'MACHINE_SETTING' | 'MECHANICAL' | 'RAW_MATERIAL' | 'UPSTREAM_PROCESS' | 'ENVIRONMENT' | 'TESTING' | 'HANDLING';
  department: Department;
  machineId: string | null;
  confidence: number; // 0..100
  evidence: EvidenceItem[];
}

export interface Correlation {
  department: Department;
  processParameter: string;
  qualityParameter: string;
  r: number;
  n: number;
  strength: 'strong' | 'moderate' | 'weak';
}

export interface RecallScope {
  lots: { lotId: string; lotNo: string; reason: string; risk: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  dispatches: {
    dispatchId: string;
    dispatchNo: string;
    customerId: string;
    customerName: string;
    lotNo: string;
    quantityKg: number;
    dispatchDate: string;
    risk: 'HIGH' | 'MEDIUM' | 'LOW';
  }[];
  customers: { customerId: string; name: string; quantityKg: number }[];
  totalKgAtRisk: number; // sum of dispatched kg of HIGH/MEDIUM-risk lots
  /** Estimated defective yarn: suspected machine-day share of the lot's output (e.g. 1 of 24 RF machine-days ≈ 4.2%). */
  estimatedAffectedKg: number | null;
  basis: string; // one sentence explaining the estimate, citing numbers
}

export interface Recommendation {
  id: string;
  text: string;
  owner: string; // e.g. 'Ring Frame maintenance'
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  relatedCauseId: string | null;
}

export interface AnalysisNarrative {
  source: 'llm' | 'template';
  headline: string;
  text: string;
  rootCauseExplanations: { causeId: string; explanation: string }[];
  cautions: string[];
}

export interface AnalysisResult {
  engineVersion: string;
  generatedAt: string;
  lot: { id: string; lotNo: string; lotCode: string; countId: string };
  complaint: { id: string; complaintNo: string; type: ComplaintType } | null;
  context: AnalysisContext;
  comparisonLots: { id: string; lotNo: string }[];
  summary: {
    headline: string;
    overallColor: QualityColor;
    deviatingCount: number;
    topParameter: string | null;
    suspectedStage: Department | null;
    dataPoints: number;
  };
  deviations: Deviation[];
  suspected: SuspectedLocation | null;
  rootCauses: RootCause[];
  correlations: Correlation[];
  recallScope: RecallScope;
  actions: { corrective: Recommendation[]; preventive: Recommendation[] };
  narrative: AnalysisNarrative;
}

export interface LlmMeta {
  enabled: boolean;
  status: 'disabled' | 'ok' | 'error' | 'rejected' | 'refusal';
  provider: 'anthropic' | null;
  model: string | null;
  latencyMs: number | null;
  prompt: { system: string; user: string } | null;
  inputJson: unknown;
  outputJson: unknown;
  error: string | null;
  validation: { passed: boolean; issues: string[] } | null;
}

export interface AnalysisRun {
  id: string;
  complaintId: string | null;
  lotId: string;
  lotNo: string;
  version: number; // per (complaintId|lotId) — each re-run increments
  context: AnalysisContext;
  comparisonLotIds: string[];
  result: AnalysisResult;
  inputHash: string;
  outputHash: string;
  llm: LlmMeta;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  chain: OnChainRef;
}

export interface AnalysisCandidate {
  lot: LotListItem;
  defaultSelected: boolean;
  reason: string; // why (not) selected by default
}

/** Engine input — assembled by the API layer from the DB. Pure data, no DB handles. */
export interface LotBundle {
  lot: Lot;
  tests: TestResult[];
  events: ProductionEvent[];
  bales: (Bale & { kgUsed: number })[];
}

export interface AnalysisDataset {
  target: LotBundle;
  comparison: LotBundle[];
  standards: Standard[]; // active standards for the target count
  machines: Machine[];
  dispatches: Dispatch[]; // all dispatches (for recall scope)
  /** Machine usage of ALL lots (for recall scope: which other lots ran on the suspected machine/window). */
  machineUsage: { lotId: string; lotNo: string; department: Department; machineId: string; dates: string[] }[];
  complaint: Complaint | null;
  context: AnalysisContext;
  warnFraction: number;
  generatedAt: string;
}
