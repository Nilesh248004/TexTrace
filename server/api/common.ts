import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import type { DB } from '../db';
import type { LedgerService } from '../ledger/types';
import type { ActionExecutor, Actor, ContractRuntime } from '../contracts/types';

export interface ApiCtx { db: DB; ledger: LedgerService; runtime: ContractRuntime }
export interface AuthedUser extends Actor { customerId: string | null }
export interface AuthedRequest extends Request { actor?: AuthedUser }

export const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ ok: true, data });
export const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ ok: false, error: { code, message } });
export const notFound = (res: Response, what: string) => fail(res, 404, 'NOT_FOUND', `${what} not found`);

/** Run a contract action atomically and send the envelope (data + DevTrace, also on rejection). */
export async function act<R>(c: ApiCtx, req: AuthedRequest, res: Response, spec: { action: string; label: string; body?: unknown; created?: boolean; run: (x: ActionExecutor) => Promise<R> }): Promise<void> {
  const result = await c.runtime.run({ action: spec.action, label: spec.label, actor: req.actor as AuthedUser, request: { method: req.method, path: req.originalUrl.split('?')[0], query: req.query as Record<string, unknown>, body: spec.body ?? req.body } }, spec.run);
  if (result.ok) res.status(spec.created ? 201 : 200).json({ ok: true, data: result.result, trace: result.trace });
  else res.status(result.status).json({ ok: false, error: result.error, trace: result.trace });
}

/** Express 4 ignores rejected promises from async handlers: forward them to the error handler. */
export function wrapAsync(app: { use: unknown; get: unknown; post: unknown; put: unknown; delete: unknown }): void {
  for (const method of ['use', 'get', 'post', 'put', 'delete'] as const) {
    const original = ((app as Record<string, unknown>)[method] as (...a: unknown[]) => unknown).bind(app);
    (app as Record<string, unknown>)[method] = (...args: unknown[]) => original(...args.map((arg) => {
      if (typeof arg !== 'function' || (arg as { length: number }).length === 4) return arg;
      return (req: Request, res: Response, next: NextFunction) => {
        try { Promise.resolve((arg as (...a: unknown[]) => unknown)(req, res, next)).catch(next); } catch (error) { next(error); }
      };
    }));
  }
}

export const qs = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v === undefined || v === null ? '' : String(v));
export const qn = (v: unknown, d: number): number => { const n = Number(qs(v)); return Number.isFinite(n) && qs(v) !== '' ? n : d; };
export const parseJson = <T,>(v: unknown, d: T): T => { try { return typeof v === 'string' ? (JSON.parse(v) as T) : d; } catch { return d; } };

/** A router whose async handlers forward rejections to the Express error handler (Express 4 would otherwise crash the process). */
export function newRouter(): Router {
  const r = express.Router();
  wrapAsync(r as never);
  return r;
}
