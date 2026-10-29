// Infrastructure DTOs shared by server and client: ledger, contract trace, notifications, settings.
// Domain read-models live in shared/domain.ts.
import type { QualityColor } from './quality';
import type { ContractFunction, ContractName, Role } from './permissions';
import type { Shift, Stage } from './params';

export type { QualityColor, Role, ContractName, ContractFunction, Shift, Stage };

/** Attached to every ledger-anchored record as `chain`. Drives the "On-chain ✔ (block #)" badge. */
export interface OnChainRef {
  txHash: string | null;
  blockNumber: number | null;
  recordHash: string | null;
  version: number;
  /** true when the current DB row re-hashes to the anchored hash (false => tampered off-chain). */
  verified: boolean;
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
  warnFraction: number;
  businessDate: string; // YYYY-MM-DD demo "today"
  nowIso: string; // demo clock at seed time
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
