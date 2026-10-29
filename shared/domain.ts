// Domain read-models exchanged between server and client (camelCase). Server builds them in server/domain/*.
import type { QualityColor } from './quality';
import type { ComplaintStatus, ComplaintType, LensItem, MasterStatus, MasterType, Scope, Stage } from './params';
import type { OnChainRef } from './types';

export type { QualityColor, Stage, MasterType, MasterStatus, ComplaintStatus, ComplaintType, Scope };

// ------------------------------------------------------------------ judgement against masters
export interface Judged {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  value: number | null;
  std: number | null;
  lower: number | null;
  upper: number | null;
  color: QualityColor;
  /** 'Within limits' | 'Warning' | 'Out of limits' | 'No standard' */
  text: string;
  side: 'low' | 'high' | null;
  deviation: number | null;
  deviationPct: number | null;
  versionNo: number | null;
  versionId: string | null;
  masterType: MasterType;
  plain: string;
}

// ------------------------------------------------------------------ master meta
export interface RecipeComponent {
  key: string;
  label: string;
  source: 'BALE' | 'WASTE';
  /** bale variety (source BALE) */
  variety?: string;
  pct: number;
  minPct: number;
  maxPct: number;
}
export interface CountMixMeta {
  route: Stage[];
  usesComber: boolean;
  recipe: RecipeComponent[];
  targetWastePct: number;
  targetRealizationPct: number;
  notes?: string;
}
export interface AccessoriesMeta {
  packageType: 'CONE' | 'CHEESE';
  coneType: string;
  cartonType: string;
  polybag: string;
  strapping: string;
  labelTemplate: string;
  qrLabel: boolean;
  palletWrap: string;
  travellerType: string;
  travellerNo: string;
  clearerClass: string;
}
export interface ColorMeta {
  colorName: string;
  hex: string;
  tip: string;
  code: string;
}

export interface MasterVersionDTO {
  id: string;
  masterType: MasterType;
  countId: string;
  versionNo: number;
  status: MasterStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  meta: Record<string, unknown>;
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  itemCount: number;
  chain: OnChainRef;
}

export interface MasterItemDTO {
  id: string;
  versionId: string;
  scope: Scope;
  parameter: string;
  label: string;
  unit: string;
  std: number;
  lower: number | null;
  upper: number | null;
  frequency: string;
  instrument: string;
  note: string;
  required: boolean;
}

export interface Completeness {
  countId: string;
  overall: number;
  byType: Record<MasterType, { pct: number; present: number; required: number; missing: { scope: Scope; key: string }[] }>;
}

export type { LensItem };

// ------------------------------------------------------------------ dispatch quality gate
export interface GateItem {
  stage: Stage;
  parameter: string;
  label?: string;
  value: number;
  std: number | null;
  lower: number | null;
  upper: number | null;
  color: QualityColor;
  testResultId: string;
  machineId: string | null;
}
export interface GateLotResult {
  lotId: string;
  lotNo: string;
  worst: QualityColor;
  redItems: GateItem[];
  yellowItems: GateItem[];
  machineLevelRed: GateItem[];
  overrideId: string | null;
  blocked: boolean;
  released?: boolean;
}
export interface GateResult {
  passed: boolean;
  overridden: boolean;
  checkedAt: string;
  lots: GateLotResult[];
  message: string;
}

// ------------------------------------------------------------------ lots, journey, location
export interface LotLocation {
  stage: Stage | null;
  state: 'PLANNED' | 'RUNNING' | 'WAITING' | 'IN_TRANSIT' | 'DELIVERED' | 'HOLD';
  /** 'In ring frame' / 'In finished-goods store' / 'Dispatched' … */
  label: string;
  detail: string;
  machines: { id: string; label: string }[];
  since: string | null;
  inStageMs: number | null;
  nextStage: Stage | null;
}

export interface LotSummary {
  id: string;
  lotNo: string;
  lotCode: string;
  countId: string;
  countDisplay: string;
  mixId: string;
  mixNo: string;
  status: string;
  plannedKg: number;
  packedKg: number | null;
  realizationPct: number | null;
  location: LotLocation;
  customerId: string | null;
  customerName: string | null;
  dispatchNo: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  worstColor: QualityColor;
  red: number;
  yellow: number;
  qaReleased: boolean;
  complaints: number;
  startedAt: string | null;
  chain: OnChainRef;
}

export interface JourneyStage {
  stage: Stage;
  label: string;
  plain: string;
  state: 'DONE' | 'CURRENT' | 'NEXT' | 'PENDING';
  inAt: string | null;
  outAt: string | null;
  dwellBeforeMs: number | null;
  durationMs: number | null;
  machines: { id: string; label: string; shift: string | null; operator: string | null; inAt: string; outAt: string | null }[];
  location: string | null;
  kgIn: number;
  kgOut: number;
  wasteKg: number;
  wastePct: number | null;
  worst: QualityColor;
  batchRefs: string[];
}

// ------------------------------------------------------------------ lot passport
export interface PassportSample {
  id: string;
  sampleId: string;
  testedAt: string;
  shift: string | null;
  pos: string | null;
  machineId: string | null;
  machineLabel: string | null;
  type: 'LOT' | 'MACHINE';
  by: string;
  byName: string;
  instrument: string;
  remarks: string;
  values: Judged[];
  worst: QualityColor;
  chain: OnChainRef;
}
export interface PassportQualityStage { stage: Stage; label: string; samples: PassportSample[]; worst: QualityColor; reds: number; yellows: number }

export interface PassportRun {
  id: string;
  stage: Stage;
  machineId: string | null;
  machineLabel: string | null;
  location: string | null;
  shift: string | null;
  operator: string | null;
  operatorName: string | null;
  inAt: string;
  outAt: string | null;
  running: boolean;
  inKg: number;
  outKg: number;
  wasteKg: number;
  wastePct: number | null;
  wasteType: string | null;
  batchRef: string | null;
  inputRefs: string[];
  params: Judged[];
  balance: { diffKg: number; diffPct: number; color: QualityColor } | null;
  worst: QualityColor;
  notes: string;
  chain: OnChainRef;
}
export interface PassportProductionStage {
  stage: Stage;
  label: string;
  runs: PassportRun[];
  totals: { inKg: number; outKg: number; wasteKg: number; wastePct: number | null; waste: Judged | null; yield: Judged | null };
  worst: QualityColor;
}
export interface PassportAccessoryRow {
  runId: string;
  stage: Stage;
  machineId: string;
  machineLabel: string;
  at: string;
  items: (Judged & { spec?: string })[];
  worst: QualityColor;
}
export interface PassportPacking {
  id: string;
  packedAt: string;
  packer: string;
  packerName: string;
  packageType: string;
  conesPacked: number;
  /** cones in the last, part-filled carton (0 = every carton is full) */
  partialCones: number;
  fullCartons: number;
  cartons: number;
  netKg: number;
  tareKg: number;
  grossKg: number;
  avgConeKg: number;
  slipNo: string;
  cartonFrom: string;
  cartonTo: string;
  labelTemplate: string;
  pallets: number;
  fgLocation: string;
  colorActual: string;
  colorMaster: string;
  colorOk: boolean;
  colorHex: string | null;
  tip: string | null;
  checks: Judged[];
  coneType: string | null;
  cartonType: string | null;
  polybag: string | null;
  strapping: string | null;
  chain: OnChainRef;
}
export interface PassportDispatch {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  invoiceNo: string;
  invoiceDate: string;
  vehicleNo: string;
  driverName: string;
  driverPhone: string;
  transporter: string;
  lrNo: string;
  destination: string;
  cartons: number;
  conesCount: number;
  netKg: number;
  grossKg: number;
  lotKg: number;
  deliveredAt: string | null;
  status: string;
  qaReleased: boolean;
  remarks: string;
  passportCode: string;
  customerId: string;
  customerName: string;
  alsoInDispatch: { lotId: string; lotNo: string }[];
  chain: OnChainRef;
}
export interface PassportBale {
  id: string;
  baleNo: string;
  variety: string;
  supplier: string;
  station: string;
  ginLot: string;
  weightKg: number;
  kgUsed: number;
  pct: number;
  receivedAt: string;
  issuedAt: string | null;
  bay: string;
  bin: string;
  status: string;
  hvi: Judged[];
  chain: OnChainRef;
}
export interface PassportComplaint {
  id: string;
  complaintNo: string;
  type: ComplaintType;
  status: ComplaintStatus;
  customerName: string;
  receivedDate: string;
  description: string;
  rootCause: string | null;
}
export interface LotPassport {
  mode: 'asOf' | 'latest';
  generatedAt: string;
  lot: LotSummary & { startDate: string; endDate: string | null; qaReleaseAt: string | null; qaReleaseBy: string | null; mixKg: number };
  masters: { type: MasterType; versionId: string | null; versionNo: number | null; effectiveFrom: string | null; latestVersionNo: number | null }[];
  mix: {
    id: string;
    mixNo: string;
    formedAt: string | null;
    issuedAt: string | null;
    totalKg: number;
    blowRoomLine: string | null;
    recipe: { key: string; label: string; source: string; pct: number; kg: number; minPct: number; maxPct: number; color: QualityColor }[];
    fibre: Judged[];
    otherLots: { lotId: string; lotNo: string; status: string }[];
  };
  bales: PassportBale[];
  journey: JourneyStage[];
  quality: PassportQualityStage[];
  production: PassportProductionStage[];
  accessories: PassportAccessoryRow[];
  packing: PassportPacking | null;
  dispatch: PassportDispatch | null;
  summary: { realization: Judged | null; targetRealizationPct: number | null; targetWastePct: number | null; wastePct: number | null; cottonKg: number; yarnKg: number | null; stageYield: { stage: Stage; label: string; cumulativePct: number | null }[] };
  complaints: PassportComplaint[];
  ledger: { lotTxCount: number; firstBlock: number | null; lastBlock: number | null; verifiedRecords: number; totalRecords: number };
}

// ------------------------------------------------------------------ alerts, dashboard, trace
export interface Alert {
  id: string;
  kind: 'OUT_OF_MASTER' | 'ACCESSORY_OVERDUE' | 'MASS_BALANCE' | 'COLOR_MISMATCH' | 'NO_QA_RELEASE' | 'QA_HOLD' | 'REPEAT_COMPLAINT' | 'MASTER_PENDING';
  severity: 'red' | 'yellow';
  title: string;
  detail: string;
  link: string;
  at: string | null;
}

export interface HeatCell { machineId: string; date: string; value: number | null; color: QualityColor; n: number; lotIds: string[]; countId: string | null }
export interface Heatmap { stage: Stage; parameter: string; label: string; unit: string; dates: string[]; machines: { id: string; label: string }[]; cells: HeatCell[] }

export interface OwnerDashboard {
  asOf: string;
  businessDate: string;
  kpis: {
    productionTodayKg: number;
    productionTodayByCount: { countId: string; display: string; kg: number }[];
    production7d: { date: string; byCount: Record<string, number> }[];
    wipByStage: { stage: Stage; label: string; kg: number; lots: number }[];
    realization: { actual: number | null; master: number | null; color: QualityColor; byCount: { countId: string; display: string; actual: number | null; master: number; color: QualityColor; lots: number }[] };
    wasteByStage: { stage: Stage; label: string; actual: number | null; master: number | null; color: QualityColor }[];
    efficiency: { stage: Stage; label: string; actual: number | null; master: number | null; color: QualityColor }[];
    qualityAlerts: { red: number; yellow: number; windowDays: number };
    complaints: { open: number; inProgress: number; closed: number };
    finishedStock: { countId: string; display: string; kg: number; lots: number }[];
    dispatches: { today: number; todayKg: number; month: number; monthKg: number };
    masterCompleteness: Completeness[];
  };
  counts: {
    countId: string;
    display: string;
    label: string;
    recipe: { label: string; pct: number }[];
    route: Stage[];
    stages: { stage: Stage; label: string; lots: string[] }[];
    lotsActive: number;
    worstColor: QualityColor;
    realization: number | null;
    realizationMaster: number;
    colorTip: { colorName: string; hex: string } | null;
    production7dKg: number;
  }[];
  alerts: Alert[];
}

export interface TraceBale { baleId: string; baleNo: string; variety: string; supplier: string; station: string; bay: string; bin: string; receivedAt: string; issuedAt: string | null; status: string; kgUsed: number; pct: number }
export interface BackTrace {
  lotId: string;
  lotNo: string;
  customer: { id: string; name: string } | null;
  dispatch: { id: string; dispatchNo: string; dispatchedAt: string; vehicleNo: string; invoiceNo: string } | null;
  packing: { id: string; slipNo: string; cartons: number; cartonFrom: string; cartonTo: string } | null;
  stages: { stage: Stage; label: string; machines: string[]; batchRefs: string[]; inAt: string | null; outAt: string | null }[];
  mix: { id: string; mixNo: string; countId: string; recipe: { label: string; pct: number }[] };
  bales: TraceBale[];
  suppliers: { supplier: string; station: string; bales: number; kg: number }[];
}
export interface ForwardTrace {
  bale: TraceBale & { weightKg: number; gin: string };
  location: { stage: Stage | null; state: string; label: string; detail: string };
  timeline: { label: string; at: string | null; detail: string }[];
  mix: { id: string; mixNo: string; status: string; countId: string } | null;
  lots: { lotId: string; lotNo: string; status: string; location: string; customer: string | null; dispatchNo: string | null; dispatchedAt: string | null; kg: number | null }[];
  customers: { id: string; name: string; lots: string[]; kg: number }[];
}

export interface SearchHit { kind: 'lot' | 'bale' | 'mix' | 'machine' | 'customer' | 'dispatch' | 'invoice' | 'vehicle' | 'lr' | 'complaint' | 'carton'; title: string; subtitle: string; link: string }

// ------------------------------------------------------------------ AI complaint analysis
export interface AnalysisObservation {
  stage: Stage;
  key: string;
  label: string;
  unit: string;
  kind: 'QUALITY' | 'PRODUCTION' | 'ACCESSORY' | 'FIBRE' | 'PACK';
  machineId: string | null;
  machineLabel: string | null;
  runId: string | null;
  date: string | null;
  shift: string | null;
  value: number;
  std: number | null;
  lower: number | null;
  upper: number | null;
  color: QualityColor;
  weight: number;
  why: string;
  refMean: number | null;
  refSd: number | null;
  z: number | null;
  refN: number;
  /** readings averaged into this row */
  n: number;
  min: number;
  max: number;
  nRed: number;
  nYellow: number;
  dates: string[];
  shifts: string[];
  /** the lens says a deviation in this direction can cause the complaint */
  adverse: boolean;
}
export interface AnalysisEvidenceItem { text: string; label: string; unit: string; color: QualityColor; stage: Stage; key: string; machineId: string | null; value: number | null; std: number | null; lower: number | null; upper: number | null; z: number | null; refMean: number | null; sourceId: string | null }
export interface AnalysisCause {
  id: string;
  rank: number;
  title: string;
  category: 'MACHINE_SETTING' | 'ACCESSORY_WEAR' | 'MACHINE_AND_ACCESSORY' | 'MIX_FIBRE' | 'PACKING' | 'ENVIRONMENT' | 'PROCESS' | 'UNEXPLAINED';
  stage: Stage;
  machineId: string | null;
  confidence: number;
  score: number;
  evidence: AnalysisEvidenceItem[];
  contrast: string[];
  affected: { machines: string[]; shifts: string[]; dates: string[]; lots: string[] };
  /** where the symptom shows up (machines whose results are out of limits) */
  symptomAt: string[];
  explanation: string;
}
export interface AnalysisRecallLot { lotId: string; lotNo: string; countDisplay: string; status: string; reason: string; risk: 'HIGH' | 'MEDIUM' | 'LOW'; kg: number | null; customerId: string | null; customerName: string | null; dispatchNo: string | null; openComplaint: string | null; stageHint: string }
export interface AnalysisAction { id: string; text: string; owner: string; priority: 'HIGH' | 'MEDIUM' | 'LOW'; relatedCauseId: string }
export interface AnalysisResult {
  engineVersion: string;
  generatedAt: string;
  lot: { id: string; lotNo: string; lotCode: string; countId: string; countDisplay: string; mixNo: string };
  complaint: { id: string; complaintNo: string; type: ComplaintType } | null;
  mode: 'asOf' | 'latest';
  lens: LensItem[];
  referenceLots: { lotId: string; lotNo: string; mixNo: string; kind: 'GOOD' | 'PREVIOUS_MIX'; leadingScore: number }[];
  summary: { headline: string; overallColor: QualityColor; topSuspect: string | null; deviatingCount: number; dataPoints: number; referenceCount: number };
  parameters: AnalysisObservation[];
  ruledOut: string[];
  rootCauses: AnalysisCause[];
  correlations: { x: string; y: string; r: number; n: number; note: string }[];
  recallScope: { lots: AnalysisRecallLot[]; customers: { customerId: string; name: string; lots: string[]; kg: number }[]; totalKgAtRisk: number; basis: string };
  actions: { corrective: AnalysisAction[]; preventive: AnalysisAction[] };
  narrative: { source: 'template' | 'llm'; headline: string; text: string; cautions: string[] };
}
export interface LlmMeta { enabled: boolean; status: 'disabled' | 'ok' | 'failed' | 'rejected'; provider: string | null; model: string | null; latencyMs: number | null; prompt: string | null; inputJson: unknown; outputJson: unknown; error: string | null; validation: string | null }
