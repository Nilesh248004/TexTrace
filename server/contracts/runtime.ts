import { randomUUID } from 'node:crypto';
import type { ApiError } from '@shared/api';
import { CONTRACT_FUNCTIONS, PERMISSIONS, type ContractFunction } from '@shared/permissions';
import type { ContractInvocation, DevTrace, Role, ValidationCheck } from '@shared/types';
import { domainsFor, entityDef } from '../db/entities';
import { getDb, toJson } from '../db';
import type { DB } from '../db';
import { bus } from '../lib/events';
import { hashObject } from '../lib/hash';
import { extractRefs } from '../lib/refs';
import { nowIso, noteLedgerTime } from '../lib/clock';
import { invalidateMasters } from '../domain/masters';
import type { CommitResult, LedgerService, PendingTx } from '../ledger/types';
import { SimulatedLedger } from '../ledger/simulated';
import { createContext, type ContextState } from './context';
import { CONTRACT_MODULES } from './index';
import { ContractRejection, type ActionRequest, type ActionResult, type Actor, type ContractRuntime, type NonLedgerAction } from './types';

const STATUS: Record<string, number> = { PERMISSION_DENIED: 403, NOT_FOUND: 404, VALIDATION_FAILED: 422, CONTRACT_REJECTED: 422, CONFLICT: 409 };
const moduleByName = new Map(CONTRACT_MODULES.map((item) => [item.name, item]));

function apiError(code: ApiError['code'], message: string): ApiError { return { code, message }; }
function rowUser(actor: Actor | null): DevTrace['user'] {
  return actor && actor.role !== 'SYSTEM' ? { id: actor.id, username: actor.username, name: actor.name, role: actor.role } : null;
}
function safeJson(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  return text.length > 20_000 ? `${text.slice(0, 20_000)}…(truncated ${text.length - 20_000} bytes)` : value;
}
async function addAudit(db: DB, trace: DevTrace): Promise<void> {
  await db.prepare(`INSERT INTO audit_log(action_id,timestamp,user_id,username,role,action,label,method,path,accepted,reason,contracts,tx_hashes,block_number,refs,trace)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    trace.actionId, trace.timestamp, trace.user?.id ?? null, trace.user?.username ?? null, trace.user?.role ?? null,
    trace.action, trace.label, trace.request.method, trace.request.path, trace.accepted ? 1 : 0, trace.reason,
    JSON.stringify(trace.invocations.map((i) => `${i.contract}.${i.fn}`)), JSON.stringify(trace.txHashes), trace.blockNumber, extractRefs(trace.label, trace.request.body, trace.dbDiff.map((c) => c.after)), toJson(trace),
  );
}

export function createRuntime(db: DB = getDb(), ledger: LedgerService = new SimulatedLedger(db)): ContractRuntime {
  async function recordNonLedger(input: NonLedgerAction): Promise<DevTrace> {
    const trace: DevTrace = {
      actionId: randomUUID(), action: input.action, label: input.label, timestamp: new Date().toISOString(), user: rowUser(input.actor),
      request: { ...input.request, body: safeJson(input.request.body) },
      response: { status: input.status, body: safeJson(input.responseBody) }, invocations: [], accepted: input.accepted,
      reason: input.reason ?? null, txHashes: [], blockNumber: null, validatorApprovals: [], dbDiff: input.dbDiff ?? [],
      durationMs: input.durationMs ?? 0, extra: input.extra ?? null,
    };
    await addAudit(db, trace);
    bus.publish({ type: 'trace', data: trace });
    return trace;
  }

  return {
    ledger,
    contracts: CONTRACT_MODULES,
    async run<R>(req: ActionRequest, body: (x: import('./types').ActionExecutor) => Promise<R> | R): Promise<ActionResult<R>> {
      const started = Date.now();
      const actionId = randomUUID();
      const stamp = req.timestamp ?? nowIso();
      const invocations: ContractInvocation[] = [];
      const changes: DevTrace['dbDiff'] = [];
      const txs: PendingTx[] = [];
      const touched = new Set<string>();
      const notifications: { id: string; severity: string; title: string; body: string; link: string | null; created_at: string }[] = [];
      let commit: CommitResult | null = null;
      let label = req.label;
      let result: R | undefined;
      let rejection: ContractRejection | null = null;
      let failedFn: ContractFunction | null = null;
      let failedPayload: Record<string, unknown> = {};
      const tx = db.transaction(async () => {
        result = await body({
          setLabel(value) { label = value; },
          addExtra() {},
          async call<T>(key: ContractFunction, args: unknown): Promise<T> {
            const [contractName, fnName] = key.split('.') as [keyof typeof moduleByName extends never ? never : string, string];
            const state: ContextState = { changes: [], refs: [], checks: [], notifications: [] };
            failedFn = key;
            failedPayload = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
            const permitted = req.actor.role === 'SYSTEM' || PERMISSIONS[key].includes(req.actor.role as Role);
            if (!permitted) {
              const message = `Access contract: role ${req.actor.role} is not permitted to invoke ${key}`;
              state.checks.push({ rule: 'permission', passed: false, detail: message });
              invocations.push({ contract: 'Access', fn: 'checkPermission', payload: { requested: key, role: req.actor.role, userId: req.actor.id, argsHash: hashObject(failedPayload) }, accepted: false, reason: message, checks: state.checks, txHash: null, blockNumber: null });
              throw new ContractRejection('access:permission', message, 'PERMISSION_DENIED');
            }
            const mod = moduleByName.get(contractName as never);
            const definition = mod?.functions[fnName];
            if (!definition) throw new ContractRejection('contract-function', `${key} is not implemented`, 'CONTRACT_REJECTED');
            const ctx = await createContext(db, req.actor, stamp, contractName as never, fnName, state);
            try {
              const value = await definition.handler(ctx, args);
              changes.push(...state.changes);
              state.refs.forEach((ref) => touched.add(ref.type));
              txs.push({ contract: contractName as PendingTx['contract'], fn: fnName, payload: state.payload ?? failedPayload, actorId: req.actor.id, actorRole: req.actor.role, status: 'VALID', reason: null, entityRefs: state.refs });
              const invocation: ContractInvocation = { contract: contractName as ContractInvocation['contract'], fn: fnName, payload: state.payload ?? failedPayload, accepted: true, reason: null, checks: state.checks, txHash: null, blockNumber: null };
              invocations.push(invocation);
              notifications.push(...state.notifications.map((n) => ({ id: randomUUID(), severity: n.severity, title: n.title, body: n.body, link: n.link ?? null, created_at: ctx.timestamp })));
              return value as T;
            } catch (error) {
              if (error instanceof ContractRejection) {
                if (error.code !== 'PERMISSION_DENIED') invocations.push({ contract: contractName as ContractInvocation['contract'], fn: fnName, payload: failedPayload, accepted: false, reason: `${error.rule}: ${error.message}`, checks: state.checks, txHash: null, blockNumber: null });
                throw error;
              }
              throw error;
            }
          },
        });
        commit = await ledger.commit(txs, { timestamp: stamp });
        for (const txResult of commit.txs) {
          const invocation = invocations.find((i) => i.contract === txResult.contract && i.fn === txResult.fn && !i.txHash);
          if (invocation) { invocation.txHash = txResult.txHash; invocation.blockNumber = txResult.blockNumber; }
          for (const ref of txResult.entityRefs) {
            const def = entityDef(ref.type);
            await db.prepare(`UPDATE ${def.table} SET tx_hash=?, block_number=?, record_hash=? WHERE ${def.idColumn}=?`).run(txResult.txHash, txResult.blockNumber, ref.recordHash, ref.id);
            await db.prepare(`INSERT INTO entity_anchors(entity_type,entity_id,version,record_hash,tx_hash,block_number,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(entity_type,entity_id,version) DO UPDATE SET record_hash=excluded.record_hash,tx_hash=excluded.tx_hash,block_number=excluded.block_number,created_at=excluded.created_at`)
              .run(ref.type, ref.id, ref.version, ref.recordHash, txResult.txHash, txResult.blockNumber, txResult.timestamp);
          }
        }
        for (const n of notifications) await db.prepare(`INSERT INTO notifications(id,severity,title,body,link,created_at) VALUES(?,?,?,?,?,?)`).run(n.id, n.severity, n.title, n.body, n.link, n.created_at);
      });
      try { await tx(); } catch (error) {
        if (error instanceof ContractRejection) rejection = error;
        else {
          const message = error instanceof Error ? error.message : String(error);
          const trace = await recordNonLedger({ action: req.action, label, actor: req.actor, request: req.request, accepted: false, reason: `Internal error: ${message}`, status: 500, responseBody: { error: message }, durationMs: Date.now() - started, extra: req.extra });
          return { ok: false, status: 500, error: apiError('INTERNAL', message), trace };
        }
      }

      if (rejection) {
        const failed = failedFn ?? 'Access.login';
        const permissionDenied = rejection.code === 'PERMISSION_DENIED';
        const [c, f] = permissionDenied ? ['Access', 'checkPermission'] : failed.split('.');
        const payload = permissionDenied ? { requested: failed, role: req.actor.role, userId: req.actor.id, argsHash: hashObject(failedPayload) } : failedPayload;
        commit = await ledger.commit([{ contract: c as PendingTx['contract'], fn: f, payload, actorId: req.actor.id, actorRole: req.actor.role, status: 'INVALID', reason: `${rejection.rule}: ${rejection.message}`, entityRefs: [] }], { timestamp: stamp });
      }

      const status = rejection ? (STATUS[rejection.code] ?? 422) : 200;
      const reason = rejection ? `${rejection.rule}: ${rejection.message}` : null;
      const trace: DevTrace = {
        actionId, action: req.action, label, timestamp: (commit as NonNullable<typeof commit>).block.timestamp, user: rowUser(req.actor),
        request: { ...req.request, body: safeJson(req.request.body) }, response: { status, body: safeJson(rejection ? { error: rejection.message } : result) },
        invocations, accepted: !rejection, reason, txHashes: (commit as NonNullable<typeof commit>).txs.map((t) => t.txHash), blockNumber: (commit as NonNullable<typeof commit>).block.number,
        validatorApprovals: (commit as NonNullable<typeof commit>).block.approvals, dbDiff: rejection ? [] : changes, durationMs: Date.now() - started, extra: req.extra ?? null,
      };
      noteLedgerTime((commit as NonNullable<typeof commit>).block.timestamp);
      if ([...touched].some((t) => t === 'master_version' || t === 'master_item')) invalidateMasters();
      if (!req.silent) {
        await addAudit(db, trace);
        bus.publish({ type: 'trace', data: trace });
        bus.publish({ type: 'block', data: (commit as NonNullable<typeof commit>).block });
        bus.invalidate(rejection ? ['ledger', 'audit', 'dashboard'] : domainsFor(touched) as never);
        for (const n of notifications) bus.publish({ type: 'notification', data: { id: n.id, severity: n.severity as 'info' | 'warning' | 'critical', title: n.title, body: n.body, link: n.link, createdAt: n.created_at, read: false } });
      }
      return rejection
        ? { ok: false, status, error: apiError(rejection.code as ApiError['code'], rejection.message), trace }
        : { ok: true, status, result, trace };
    },
    recordNonLedger,
  };
}

let singleton: ContractRuntime | null = null;
export async function getRuntime(): Promise<ContractRuntime> {
  if (!singleton) singleton = createRuntime();
  return singleton;
}