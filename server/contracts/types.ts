// Contract runtime interfaces. See docs/SPEC.md §6 for the execution flow.
//
//   route handler
//     -> runtime.run({ action, label, actor, request }, (x) => x.call('Quality.registerComplaint', args))
//          1. opens ONE SQLite transaction for the whole action
//          2. for each x.call(): Access check (PERMISSIONS matrix) -> contract handler (business rules via ctx.check)
//             -> tracked writes (ctx.insert/update) produce DbChange[] + EntityRef[] (record hashes)
//          3. success: ledger.commit(all VALID pending txs) -> ONE block; anchor columns + entity_anchors backfilled
//             rejection: rollback all writes, then commit ONE block containing only the rejected tx (status INVALID)
//          4. builds DevTrace, writes audit_log, publishes WS events (trace, block, invalidate, notifications)
import type { DB } from '../db';
import type { ApiError } from '@shared/api';
import type {
  ContractFunction,
  ContractName,
  DevTrace,
  Role,
  Settings,
  ValidationCheck,
} from '@shared/types';
import type { LedgerService } from '../ledger/types';

export interface Actor {
  id: string;
  username: string;
  name: string;
  role: Role | 'SYSTEM';
  org: string;
}

export type RejectionCode = 'PERMISSION_DENIED' | 'CONTRACT_REJECTED' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT';

/** Thrown by ctx.check() (or directly by handlers) to reject a transaction with a reason. */
export class ContractRejection extends Error {
  constructor(
    public readonly rule: string,
    message: string,
    public readonly code: RejectionCode = 'CONTRACT_REJECTED',
  ) {
    super(message);
    this.name = 'ContractRejection';
  }
}

export interface NotificationDraft {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link?: string | null;
}

/** Execution context handed to a contract handler for ONE contract call. */
export interface ExecContext {
  readonly db: DB;
  readonly actor: Actor;
  /** ISO timestamp of this action (ledger time). Seeder passes historical timestamps. */
  readonly timestamp: string;
  readonly settings: Settings;
  readonly contract: ContractName;
  readonly fn: string;

  /** Record a business-rule check. Throws ContractRejection(rule, detail) when !passed. */
  check(rule: string, passed: boolean, detail: string, code?: RejectionCode): void;
  /** Record an informational (passed) check, e.g. 'tolerance:RF:U' -> 'U% 12.60 > upper 10.80 (RED) — flagged'. */
  note(rule: string, detail: string): void;

  /** Tracked insert into an ENTITY table (see server/db/entities.ts). Sets version=1, computes record hash, adds EntityRef + DbChange. Returns the stored row. */
  insert(entityType: string, row: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Tracked update of an ENTITY row by id: bumps version, re-hashes, adds EntityRef + DbChange (before/after). Returns the new row. */
  update(entityType: string, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Tracked insert into a NON-entity table (e.g. standards_history, notifications). Adds DbChange only. */
  insertRaw(table: string, row: Record<string, unknown>): Promise<void>;
  /** Tracked update of a NON-entity table row. */
  updateRaw(table: string, keyColumn: string, key: string | number, patch: Record<string, unknown>): Promise<void>;

  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;

  /** Next value of a named sequence (complaint:2026, lot:2026, dispatch:2026 ...). Rolled back with the action on rejection. */
  nextSeq(name: string): Promise<number>;
  /** New padded id, e.g. newId('TR') -> 'TR-000124'. */
  newId(prefix: string, pad?: number): Promise<string>;

  /** Queue a notification (inserted + broadcast only if the action commits). */
  notify(n: NotificationDraft): void;

  /**
   * Replace the payload recorded ON-CHAIN for this tx (default: the call args). Use when args carry large blobs
   * (AI result JSON): put the blob's sha256 in the compact payload so the chain still commits to it.
   */
  setPayload(payload: Record<string, unknown>): void;
}

export interface ContractFunctionDef<A = any, R = any> {
  key: ContractFunction; // 'Quality.registerComplaint'
  description: string;
  /** Human-readable rule list shown in the Developer Console contract registry. */
  rules: string[];
  handler: ContractHandler<A, R>;
}

export interface ContractModule {
  name: ContractName;
  description: string;
  functions: Record<string, ContractFunctionDef>; // keyed by bare function name, e.g. 'registerComplaint'
}

export interface ActionRequest {
  action: string; // 'complaint.register'
  label: string; // 'Register complaint 22/2026' (may be refined by the body via setLabel)
  actor: Actor;
  request: { method: string; path: string; query: Record<string, unknown>; body: unknown };
  /** Seeder: historical ledger time for this action. */
  timestamp?: string;
  /** Seeder: skip audit_log + WS broadcast (ledger is still written). */
  silent?: boolean;
  /** Merged into DevTrace.extra (e.g. AI prompt/model/latency). */
  extra?: Record<string, unknown>;
}

export interface ActionExecutor {
  /** Invoke a contract function inside the action (permission check + rules + tracked writes). */
  call<R = any>(fn: ContractFunction, args: unknown): Promise<R>;
  /** Refine the trace label once ids are known (e.g. after complaint no is allocated). */
  setLabel(label: string): void;
  /** Attach extra developer info to the trace. */
  addExtra(extra: Record<string, unknown>): void;
}

export interface ActionResult<R> {
  ok: boolean;
  status: number; // HTTP status to send (200, 201, 403, 404, 409, 422, 500)
  result?: R;
  error?: ApiError;
  trace: DevTrace;
}

export interface NonLedgerAction {
  action: string;
  label: string;
  actor: Actor | null;
  request: ActionRequest['request'];
  accepted: boolean;
  reason?: string | null;
  status: number;
  responseBody: unknown;
  checks?: ValidationCheck[];
  dbDiff?: DevTrace['dbDiff'];
  extra?: Record<string, unknown>;
  durationMs?: number;
}

export interface ContractRuntime {
  readonly ledger: LedgerService;
  readonly contracts: ContractModule[];
  /** Run an action atomically (see header comment). Never throws for business rejections. */
  run<R>(req: ActionRequest, body: (x: ActionExecutor) => Promise<R> | R): Promise<ActionResult<R>>;
  /** Record an action that does not write the ledger (tamper simulation, validate chain, demo reset, failed upload). */
  recordNonLedger(a: NonLedgerAction): Promise<DevTrace>;
}

export type ContractHandler<A = any, R = any> = (ctx: ExecContext, args: A) => Promise<R> | R;
