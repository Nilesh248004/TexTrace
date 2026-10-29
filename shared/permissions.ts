// Roles, smart-contract function registry and the permission matrix enforced by the Access contract.
// The client uses the same matrix to build role-based menus and to disable buttons
// (in Developer Mode buttons stay enabled so a denial can be demonstrated — the server still rejects it).

export const ROLES = ['ADMIN', 'DEVELOPER', 'PRODUCTION', 'QA', 'DISPATCH', 'CUSTOMER_SERVICE', 'AUDITOR', 'BUYER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Mill Owner / Admin',
  DEVELOPER: 'Developer',
  PRODUCTION: 'Production / Mill Operator',
  QA: 'Quality (QA Head)',
  DISPATCH: 'Dispatch / Packing',
  CUSTOMER_SERVICE: 'Customer Service',
  AUDITOR: 'Auditor',
  BUYER: 'Customer (portal)',
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

export const CONTRACTS = ['AssetID', 'ProcessEvent', 'Quality', 'Master', 'Transfer', 'Access'] as const;
export type ContractName = (typeof CONTRACTS)[number];

/** Every invocable contract function. Key format: `${Contract}.${function}`. */
export const CONTRACT_FUNCTIONS = {
  'AssetID.registerBale': 'Register a raw-material bale (HVI fibre properties, storage bay/bin) as a digital asset',
  'AssetID.registerMix': 'Form a cotton mix from bales (recipe percentages checked against the Count & Mix master)',
  'AssetID.registerLot': 'Register a yarn lot against a mix',
  'AssetID.registerCustomer': 'Register a customer (buyer organisation)',
  'AssetID.registerMachine': 'Register a machine in a department',
  'AssetID.anchorDocument': 'Anchor an off-chain document (photo / PDF) by its SHA-256 hash',
  'AssetID.issuePassport': 'Issue a QR Product Passport for a dispatch',
  'ProcessEvent.issueBales': 'Issue bales from the bale store into the blow room',
  'ProcessEvent.logStageRun': 'Log a production stage run (IN/OUT time, quantities, machine parameters; stage order + mass balance enforced)',
  'ProcessEvent.recordAccessoryChange': 'Record a traveller / cot / apron / spacer change on a machine',
  'ProcessEvent.recordPacking': 'Record packing of a lot (cone colour verified against the Color Code master)',
  'Quality.recordTestResult': 'Record a test result (judged against the master active on the production date)',
  'Quality.releaseLot': 'QA release of a lot for dispatch',
  'Quality.recordOverride': 'Record a QA override (with reason) for a lot with red results',
  'Quality.evaluateGate': 'Evaluate the dispatch quality gate for lots',
  'Quality.registerComplaint': 'Register a customer complaint',
  'Quality.transitionComplaint': 'Change complaint status',
  'Quality.anchorAnalysis': 'Anchor an AI analysis run (hash of input + output)',
  'Quality.recordConclusion': 'Record the manual QA conclusion and close the complaint',
  'Quality.upsertLens': 'Edit the Complaint-Type → Relevant-Parameters mapping',
  'Master.createVersion': 'Create a master version (blank, or cloned from another version / count)',
  'Master.upsertItems': 'Add or change master items in a draft version (validated: lower ≤ std ≤ upper)',
  'Master.upsertMeta': 'Edit the recipe / route / packing specification of a draft master version',
  'Master.approve': 'QA approval of a draft master version',
  'Master.reject': 'Reject a draft master version',
  'Master.activate': 'Activate an approved master version from its effective date (supersedes the active version)',
  'Transfer.createDispatch': 'Create a dispatch (custody transfer to a customer); QA release + quality gate enforced',
  'Transfer.markDelivered': 'Confirm delivery of a dispatch at the customer',
  'Access.login': 'Record a user sign-in',
  'Access.updateSettings': 'Update system settings',
} as const;
export type ContractFunction = keyof typeof CONTRACT_FUNCTIONS;

const ALL: Role[] = [...ROLES];

/** Which roles may invoke each contract function (write permission). */
export const PERMISSIONS: Record<ContractFunction, Role[]> = {
  'AssetID.registerBale': ['ADMIN', 'PRODUCTION'],
  'AssetID.registerMix': ['ADMIN', 'PRODUCTION'],
  'AssetID.registerLot': ['ADMIN', 'PRODUCTION'],
  'AssetID.registerCustomer': ['ADMIN', 'DISPATCH', 'CUSTOMER_SERVICE'],
  'AssetID.registerMachine': ['ADMIN'],
  'AssetID.anchorDocument': ['ADMIN', 'CUSTOMER_SERVICE', 'QA', 'DISPATCH', 'BUYER'],
  'AssetID.issuePassport': ['ADMIN', 'DISPATCH'],
  'ProcessEvent.issueBales': ['ADMIN', 'PRODUCTION'],
  'ProcessEvent.logStageRun': ['ADMIN', 'PRODUCTION'],
  'ProcessEvent.recordAccessoryChange': ['ADMIN', 'PRODUCTION'],
  'ProcessEvent.recordPacking': ['ADMIN', 'PRODUCTION', 'DISPATCH'],
  'Quality.recordTestResult': ['ADMIN', 'QA'],
  'Quality.releaseLot': ['ADMIN', 'QA'],
  'Quality.recordOverride': ['ADMIN', 'QA'],
  'Quality.evaluateGate': ['ADMIN', 'QA', 'DISPATCH'],
  'Quality.registerComplaint': ['ADMIN', 'CUSTOMER_SERVICE', 'BUYER'],
  'Quality.transitionComplaint': ['ADMIN', 'CUSTOMER_SERVICE', 'QA'],
  'Quality.anchorAnalysis': ['ADMIN', 'QA'],
  'Quality.recordConclusion': ['ADMIN', 'QA'],
  'Quality.upsertLens': ['ADMIN', 'QA'],
  'Master.createVersion': ['ADMIN', 'QA', 'PRODUCTION'],
  'Master.upsertItems': ['ADMIN', 'QA', 'PRODUCTION'],
  'Master.upsertMeta': ['ADMIN', 'QA', 'PRODUCTION'],
  'Master.approve': ['ADMIN', 'QA'],
  'Master.reject': ['ADMIN', 'QA'],
  'Master.activate': ['ADMIN', 'QA'],
  'Transfer.createDispatch': ['ADMIN', 'DISPATCH'],
  'Transfer.markDelivered': ['ADMIN', 'DISPATCH'],
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

/** Roles that see the mill's internal workspace (everyone except customers). */
export const INTERNAL_ROLES: Role[] = ['ADMIN', 'DEVELOPER', 'PRODUCTION', 'QA', 'DISPATCH', 'CUSTOMER_SERVICE', 'AUDITOR'];
export const MASTER_EDIT_ROLES: Role[] = ['ADMIN', 'QA', 'PRODUCTION'];
export const MASTER_APPROVE_ROLES: Role[] = ['ADMIN', 'QA'];
