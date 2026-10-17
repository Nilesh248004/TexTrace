// Roles, smart-contract function registry and the permission matrix enforced by the Access contract.
// The client uses the same matrix to build role-based menus and to disable buttons
// (in Developer Mode buttons stay enabled so a denial can be demonstrated — the server still rejects it).

export const ROLES = ['ADMIN', 'DEVELOPER', 'PRODUCTION', 'QA', 'DISPATCH', 'CUSTOMER_SERVICE', 'AUDITOR', 'BUYER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  DEVELOPER: 'Developer',
  PRODUCTION: 'Production / Mill Operator',
  QA: 'Quality (QA)',
  DISPATCH: 'Dispatch / Packing',
  CUSTOMER_SERVICE: 'Customer Service',
  AUDITOR: 'Auditor',
  BUYER: 'Buyer (read-only)',
};

/** Ledger organisation (MSP-like) each role belongs to. */
export const ROLE_ORG: Record<Role, string> = {
  ADMIN: 'MillOrg',
  DEVELOPER: 'MillOrg',
  PRODUCTION: 'MillOrg',
  QA: 'QualityOrg',
  DISPATCH: 'MillOrg',
  CUSTOMER_SERVICE: 'MillOrg',
  AUDITOR: 'AuditOrg',
  BUYER: 'BuyerOrg',
};

export const CONTRACTS = ['AssetID', 'ProcessEvent', 'Quality', 'Transfer', 'Access'] as const;
export type ContractName = (typeof CONTRACTS)[number];

/** Every invocable contract function. Key format: `${Contract}.${function}`. */
export const CONTRACT_FUNCTIONS = {
  'AssetID.registerBale': 'Register a raw-material bale (HVI fibre properties) as a digital asset',
  'AssetID.registerLot': 'Register a yarn lot (mixing) and link consumed bales',
  'AssetID.registerCustomer': 'Register a customer (buyer organisation)',
  'AssetID.registerMachine': 'Register a machine in a department',
  'AssetID.anchorDocument': 'Anchor an off-chain document (PDF) by its SHA-256 hash',
  'AssetID.issuePassport': 'Issue a QR Product Passport for a dispatch',
  'ProcessEvent.logStageEvent': 'Log a production event for a lot at a stage (stage order + mass balance enforced)',
  'ProcessEvent.recordPacking': 'Record packing of a lot into packs/cartons (mass balance enforced)',
  'Quality.recordTestResult': 'Record a test result (tolerance-checked against the Quality Standards Master)',
  'Quality.upsertStandard': 'Create or update a standard in the Count-wise Quality Master (versioned)',
  'Quality.deleteStandard': 'Retire a standard in the Count-wise Quality Master (versioned)',
  'Quality.evaluateGate': 'Evaluate the dispatch quality gate for lots',
  'Quality.recordOverride': 'Record a QA override (with reason) for a lot with red results',
  'Quality.registerComplaint': 'Register a customer complaint',
  'Quality.transitionComplaint': 'Change complaint status',
  'Quality.anchorAnalysis': 'Anchor an AI analysis run (hash of input + output)',
  'Quality.recordConclusion': 'Record the manual QA conclusion and resolve the complaint',
  'Transfer.createDispatch': 'Create a dispatch (custody transfer to a customer); quality gate enforced',
  'Access.login': 'Record a user sign-in',
  'Access.updateSettings': 'Update system settings (lot formats, tolerance warning fraction, ...)',
} as const;
export type ContractFunction = keyof typeof CONTRACT_FUNCTIONS;

const ALL: Role[] = [...ROLES];

/** Which roles may invoke each contract function (write permission). */
export const PERMISSIONS: Record<ContractFunction, Role[]> = {
  'AssetID.registerBale': ['ADMIN', 'PRODUCTION'],
  'AssetID.registerLot': ['ADMIN', 'PRODUCTION'],
  'AssetID.registerCustomer': ['ADMIN', 'DISPATCH', 'CUSTOMER_SERVICE'],
  'AssetID.registerMachine': ['ADMIN'],
  'AssetID.anchorDocument': ['ADMIN', 'CUSTOMER_SERVICE', 'QA', 'DISPATCH'],
  'AssetID.issuePassport': ['ADMIN', 'DISPATCH'],
  'ProcessEvent.logStageEvent': ['ADMIN', 'PRODUCTION'],
  'ProcessEvent.recordPacking': ['ADMIN', 'PRODUCTION', 'DISPATCH'],
  'Quality.recordTestResult': ['ADMIN', 'QA'],
  'Quality.upsertStandard': ['ADMIN', 'QA'],
  'Quality.deleteStandard': ['ADMIN', 'QA'],
  'Quality.evaluateGate': ['ADMIN', 'QA', 'DISPATCH'],
  'Quality.recordOverride': ['ADMIN', 'QA'],
  'Quality.registerComplaint': ['ADMIN', 'CUSTOMER_SERVICE'],
  'Quality.transitionComplaint': ['ADMIN', 'CUSTOMER_SERVICE', 'QA'],
  'Quality.anchorAnalysis': ['ADMIN', 'QA'],
  'Quality.recordConclusion': ['ADMIN', 'QA'],
  'Transfer.createDispatch': ['ADMIN', 'DISPATCH'],
  'Access.login': ALL,
  'Access.updateSettings': ['ADMIN'],
};

export function canInvoke(role: Role | null | undefined, fn: ContractFunction): boolean {
  return !!role && PERMISSIONS[fn].includes(role);
}

/** Non-contract privileged operations (developer tooling). */
export const DEV_TOOL_ROLES: Record<'validateChain' | 'tamper' | 'exportAudit' | 'resetDemo' | 'apiExplorer', Role[]> = {
  validateChain: ['ADMIN', 'DEVELOPER', 'AUDITOR'],
  tamper: ['ADMIN', 'DEVELOPER'],
  exportAudit: ['ADMIN', 'DEVELOPER', 'AUDITOR'],
  resetDemo: ['ADMIN', 'DEVELOPER'],
  apiExplorer: ['ADMIN', 'DEVELOPER'],
};

/** Sidebar / route access (read). */
export type MenuKey =
  | 'dashboard'
  | 'complaints'
  | 'lots'
  | 'standards'
  | 'heatmap'
  | 'analysis'
  | 'dispatch'
  | 'developer'
  | 'verify'
  | 'showcase'
  | 'settings';

const INTERNAL: Role[] = ['ADMIN', 'DEVELOPER', 'PRODUCTION', 'QA', 'DISPATCH', 'CUSTOMER_SERVICE', 'AUDITOR'];

export const MENU_ACCESS: Record<MenuKey, Role[]> = {
  dashboard: INTERNAL,
  complaints: ['ADMIN', 'DEVELOPER', 'QA', 'CUSTOMER_SERVICE', 'AUDITOR', 'DISPATCH', 'PRODUCTION'],
  lots: ALL,
  standards: INTERNAL,
  heatmap: ['ADMIN', 'DEVELOPER', 'QA', 'PRODUCTION', 'AUDITOR', 'CUSTOMER_SERVICE'],
  analysis: ['ADMIN', 'DEVELOPER', 'QA', 'AUDITOR', 'CUSTOMER_SERVICE'],
  dispatch: ['ADMIN', 'DEVELOPER', 'DISPATCH', 'QA', 'AUDITOR', 'CUSTOMER_SERVICE'],
  developer: ['ADMIN', 'DEVELOPER', 'AUDITOR'],
  verify: ALL,
  showcase: ALL,
  settings: ['ADMIN', 'DEVELOPER'],
};

export function canSee(role: Role | null | undefined, menu: MenuKey): boolean {
  return !!role && MENU_ACCESS[menu].includes(role);
}
