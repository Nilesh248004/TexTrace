// HTTP API contract. Every endpoint is listed in `ApiRoutes` with its request and response types.
// Envelope: success -> { ok: true, data, trace? }  failure -> { ok: false, error, trace? }
// Write endpoints ALWAYS include `trace` (DevTrace), including on rejection (403/409/422).
import type {
  ActivityItem,
  AnalysisCandidate,
  AnalysisContext,
  AnalysisRun,
  Bale,
  BaleForwardTrace,
  ChainValidationReport,
  Complaint,
  ComplaintEvent,
  ComplaintStatus,
  ComplaintType,
  Conclusion,
  ContractFunction,
  Count,
  Customer,
  DashboardSummary,
  Department,
  DevTrace,
  Dispatch,
  DocumentMeta,
  GateResult,
  HeatmapData,
  LedgerBlock,
  LedgerStats,
  LedgerTx,
  Lot,
  LotListItem,
  LotProductionView,
  LotQualityView,
  LotStatus,
  LotTraceView,
  Machine,
  MerkleProofStep,
  Notification,
  PackingRecord,
  PassportView,
  ProductionEvent,
  QaOverride,
  QualityTrend,
  Role,
  SampleType,
  Settings,
  Shift,
  Standard,
  StandardVersion,
  TestResult,
  User,
  ContractName,
} from './types';
import type { ParamDef } from './params';

export interface ApiError {
  code:
    | 'UNAUTHENTICATED'
    | 'PERMISSION_DENIED'
    | 'VALIDATION_FAILED'
    | 'CONTRACT_REJECTED'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'INTERNAL';
  message: string;
  details?: unknown;
}

export type ApiOk<T> = { ok: true; data: T; trace?: DevTrace };
export type ApiErr = { ok: false; error: ApiError; trace?: DevTrace };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ------------------------------------------------------------------ request bodies
export interface LoginBody { username: string }
export interface LoginResult { token: string; user: User }

export interface ComplaintListQuery {
  status?: ComplaintStatus | 'ALL';
  q?: string; // matches complaint no, customer, lot no, complainant
  sort?: 'complaintNo' | 'customerName' | 'lotNo' | 'type' | 'receivedDate' | 'status';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ComplaintListItem extends Complaint {
  hasDocument: boolean;
  latestAnalysisId: string | null;
}

export interface RegisterComplaintBody {
  complainantName: string;
  type: ComplaintType;
  customerId: string;
  lotId: string;
  description: string;
  documentId?: string | null;
  receivedDate?: string; // YYYY-MM-DD, defaults to businessDate/today
}

export interface TransitionComplaintBody { to: ComplaintStatus; note: string }

export interface ConclusionBody {
  conclusionHtml: string;
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  analysisId?: string | null;
}

export interface ComplaintDetail {
  complaint: Complaint;
  lot: Lot;
  customer: Customer;
  dispatch: Dispatch | null;
  document: DocumentMeta | null;
  events: ComplaintEvent[];
  analyses: AnalysisRun[]; // newest first
  conclusion: Conclusion | null;
}

export interface RegisterLotBody {
  countId: string;
  line: 'A' | 'B';
  plannedKg: number;
  startDate: string;
  bales: { baleId: string; kgUsed: number }[];
}

export interface RegisterBaleBody {
  baleNo: string;
  supplier: string;
  station: string;
  variety: string;
  ginLot: string;
  weightKg: number;
  arrivalDate: string;
  fibre: Record<string, number>;
}

export interface ProductionEventBody {
  lotId: string;
  department: Department;
  machineId?: string | null;
  eventDate: string;
  shift?: Shift | null;
  inputKg: number;
  outputKg: number;
  wasteKg: number;
  params: Record<string, number>;
  notes?: string;
}

export interface TestResultBody {
  lotId: string;
  department: Department;
  machineId?: string | null;
  sampleType: SampleType;
  testDate: string;
  shift?: Shift | null;
  values: Record<string, number>;
  instrument?: string;
  remarks?: string;
}

export interface StandardBody {
  countId: string;
  department: Department;
  parameter: string;
  category: 'FIBRE' | 'PROCESS' | 'QUALITY';
  std: number;
  lower: number | null;
  upper: number | null;
  unit?: string;
  reason?: string;
}

export interface StandardUpdateBody {
  std: number;
  lower: number | null;
  upper: number | null;
  reason: string;
}

export interface PackingBody {
  lotId: string;
  packDate: string;
  packWeightKg: number;
  packsCount: number;
  conesPerPack: number;
}

export interface DispatchBody {
  customerId: string;
  countId: string;
  dispatchDate: string; // YYYY-MM-DD
  lots: { lotId: string; quantityKg: number }[];
  packWeightKg: number; // e.g. 50 -> packs auto = ceil(qty / packWeight)
  conesCount?: number; // default: packs * conesPerPack of the lot packing
  vehicleNo: string;
  lrNo: string;
  invoiceNo?: string;
}

export interface QaOverrideBody { lotId: string; reason: string }

export interface AnalysisRunBody {
  lotId: string;
  complaintId?: string | null;
  comparisonLotIds: string[]; // up to 15
  context: Partial<AnalysisContext>;
}

export interface TamperBody {
  mode: 'preset' | 'record' | 'block';
  preset?: 'hide-bad-result' | 'edit-ledger-payload' | 'change-dispatch-qty';
  entityType?: string;
  entityId?: string;
  field?: string;
  value?: unknown;
  blockNumber?: number;
  txIndex?: number;
}

export interface TamperResult {
  tamperId: string;
  description: string;
  target: { kind: 'record' | 'block'; entityType?: string; entityId?: string; blockNumber?: number; txHash?: string; field: string };
  before: unknown;
  after: unknown;
}

export interface AuditQuery {
  action?: string;
  userId?: string;
  accepted?: 'true' | 'false';
  contract?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ApiRouteInfo {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  auth: 'public' | 'user' | Role[];
  contract: ContractFunction | null;
  sampleBody: unknown;
}

export interface ContractInfo {
  name: ContractName;
  description: string;
  functions: { name: string; key: ContractFunction; description: string; roles: Role[]; rules: string[]; invocations: number }[];
}

export interface MetaResponse {
  millName: string;
  counts: Count[];
  parameters: ParamDef[];
  settings: Settings;
  roles: { role: Role; label: string }[];
  permissions: Record<ContractFunction, Role[]>;
  ai: { llmEnabled: boolean; provider: string | null; model: string | null };
  ledger: { adapter: string; validators: { id: string; org: string }[]; policy: string };
  serverTime: string;
}

export interface DocumentUploadResult { document: DocumentMeta; serverSha256: string; clientSha256: string; match: boolean }

// ------------------------------------------------------------------ route table
// `query` = URL query params; `body` = JSON body; `params` = path params. Multipart endpoints noted.
export interface ApiRoutes {
  // auth / meta
  'POST /api/auth/login': { body: LoginBody; response: LoginResult };
  'GET /api/auth/me': { response: User };
  'GET /api/users': { response: User[] };
  'GET /api/meta': { response: MetaResponse };
  'PUT /api/settings': { body: Partial<Settings>; response: Settings };
  'GET /api/notifications': { response: Notification[] };
  'POST /api/notifications/:id/read': { response: { id: string } };

  // dashboard
  'GET /api/dashboard/summary': { response: DashboardSummary };
  'GET /api/dashboard/activity': { query: { limit?: number }; response: ActivityItem[] };
  'GET /api/dashboard/quality-trend': { query: { countId?: string; department?: Department; parameter?: string; days?: number }; response: QualityTrend };

  // master data
  'GET /api/counts': { response: Count[] };
  'GET /api/customers': { response: Customer[] };
  'GET /api/machines': { query: { department?: Department }; response: Machine[] };
  'GET /api/bales': { query: { q?: string; available?: 'true' }; response: Bale[] };
  'GET /api/bales/:id/forward-trace': { response: BaleForwardTrace };
  'POST /api/bales': { body: RegisterBaleBody; response: Bale };

  // complaints
  'GET /api/complaints': { query: ComplaintListQuery; response: Paged<ComplaintListItem> };
  'GET /api/complaints/next-number': { response: { complaintNo: string; seq: number; year: number } };
  'POST /api/complaints': { body: RegisterComplaintBody; response: Complaint };
  'GET /api/complaints/:id': { response: ComplaintDetail };
  'POST /api/complaints/:id/transition': { body: TransitionComplaintBody; response: Complaint };
  'POST /api/complaints/:id/conclusion': { body: ConclusionBody; response: { complaint: Complaint; conclusion: Conclusion } };

  // documents (multipart/form-data: file, clientSha256, entityType?, entityId?)
  'POST /api/documents': { body: FormData; response: DocumentUploadResult };
  'GET /api/documents/:id': { response: DocumentMeta };
  // 'GET /api/documents/:id/file' streams application/pdf

  // lots
  'GET /api/lots': { query: { q?: string; countId?: string; status?: LotStatus | 'ALL' }; response: LotListItem[] };
  'GET /api/lots/search': { query: { q: string }; response: LotListItem[] }; // autocomplete (lot no / lot code / seq)
  'GET /api/lots/:id': { response: LotListItem };
  'POST /api/lots': { body: RegisterLotBody; response: Lot };
  'GET /api/lots/:id/production': { response: LotProductionView };
  'GET /api/lots/:id/events': { query: { department?: Department }; response: ProductionEvent[] };
  'GET /api/lots/:id/quality': { response: LotQualityView };
  'GET /api/lots/:id/heatmap': { query: { department?: Department; parameter?: string; mode?: 'day' | 'shift' }; response: HeatmapData };
  'GET /api/lots/:id/trace': { response: LotTraceView };
  'POST /api/production-events': { body: ProductionEventBody; response: ProductionEvent };
  'POST /api/test-results': { body: TestResultBody; response: TestResult };
  'GET /api/test-results/:id': { response: TestResult };
  'POST /api/packing': { body: PackingBody; response: PackingRecord };

  // standards
  'GET /api/standards': { query: { countId?: string; includeInactive?: 'true' }; response: Standard[] };
  'POST /api/standards': { body: StandardBody; response: Standard };
  'PUT /api/standards/:id': { body: StandardUpdateBody; response: Standard };
  'DELETE /api/standards/:id': { body: { reason: string }; response: Standard };
  'GET /api/standards/:id/history': { response: StandardVersion[] };

  // analysis
  'GET /api/analysis/status': { response: { llmEnabled: boolean; provider: string | null; model: string | null } };
  'GET /api/analysis/candidates': { query: { lotId: string }; response: AnalysisCandidate[] };
  'POST /api/analysis/run': { body: AnalysisRunBody; response: AnalysisRun };
  'GET /api/analysis': { query: { complaintId?: string; lotId?: string }; response: AnalysisRun[] };
  'GET /api/analysis/:id': { response: AnalysisRun };

  // dispatch / passport
  'GET /api/dispatches': { query: { customerId?: string; lotId?: string }; response: Dispatch[] };
  'GET /api/dispatches/:id': { response: Dispatch };
  'POST /api/dispatches/gate-check': { body: { lotIds: string[] }; response: GateResult };
  'POST /api/dispatches': { body: DispatchBody; response: Dispatch };
  'POST /api/qa-overrides': { body: QaOverrideBody; response: QaOverride };
  'GET /api/qa-overrides': { query: { lotId?: string }; response: QaOverride[] };
  'GET /api/passports/:code': { response: PassportView }; // PUBLIC (no auth)

  // ledger
  'GET /api/ledger/stats': { response: LedgerStats };
  'GET /api/ledger/blocks': { query: { page?: number; pageSize?: number }; response: Paged<LedgerBlock> };
  'GET /api/ledger/blocks/:number': { response: { block: LedgerBlock; txs: LedgerTx[] } };
  'GET /api/ledger/tx/:hash': { response: { tx: LedgerTx; block: LedgerBlock; merkleProof: MerkleProofStep[]; trace: DevTrace | null } };
  'GET /api/ledger/entity/:type/:id': { response: LedgerTx[] }; // full on-chain history of a record
  'POST /api/ledger/validate': { response: ChainValidationReport };

  // developer
  'GET /api/dev/audit': { query: AuditQuery; response: Paged<DevTrace> };
  'GET /api/dev/audit/:actionId': { response: DevTrace };
  // 'GET /api/dev/audit/export?format=json|csv' -> file download
  'GET /api/dev/contracts': { response: ContractInfo[] };
  'GET /api/dev/invocations': { query: { contract?: string; fn?: string; page?: number; pageSize?: number }; response: Paged<LedgerTx> };
  'GET /api/dev/routes': { response: ApiRouteInfo[] };
  'POST /api/dev/tamper': { body: TamperBody; response: TamperResult };
  'POST /api/dev/restore': { response: { restored: number } };
  'POST /api/demo/reset': { body: { profile: 'full' | 'pre-demo' }; response: { profile: string; blocks: number; transactions: number; durationMs: number } };
}

export type RouteKey = keyof ApiRoutes;

// ------------------------------------------------------------------ WebSocket (/ws)
export type QueryDomain =
  | 'dashboard'
  | 'complaints'
  | 'lots'
  | 'standards'
  | 'dispatches'
  | 'analysis'
  | 'ledger'
  | 'audit'
  | 'notifications'
  | 'meta'
  | 'documents'
  | 'customers'
  | 'bales';

export type WsEvent =
  | { type: 'hello'; data: { serverTime: string; height: number } }
  | { type: 'trace'; data: DevTrace }
  | { type: 'block'; data: LedgerBlock }
  | { type: 'invalidate'; data: { domains: QueryDomain[] | ['*'] } }
  | { type: 'notification'; data: Notification }
  | { type: 'integrity'; data: ChainValidationReport };

/** Re-exported so consumers can import everything API-related from one module. */
export type {
  AnalysisRun,
  Complaint,
  Dispatch,
  DevTrace,
  GateResult,
  Lot,
  Standard,
  TestResult,
  ProductionEvent,
  PackingRecord,
  QaOverride,
  Bale,
};
