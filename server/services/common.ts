// Small helpers shared by every service module: typed service errors, paging, rounding, sort ranks.
import type { ApiError, Paged } from '@shared/api';
import { PARAMS, SHIFTS, STAGE_ORDER, type Department } from '@shared/params';
import { formatKg } from '@shared/format';

export type Row = Record<string, unknown>;

/**
 * Thrown by read services for "not found" / bad query input. Routes map it to the envelope:
 * `res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, details: err.details } })`.
 */
export class ServiceError extends Error {
  constructor(
    public readonly code: ApiError['code'],
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export const notFound = (message: string): ServiceError => new ServiceError('NOT_FOUND', message, 404);
export const badRequest = (message: string, details?: unknown): ServiceError =>
  new ServiceError('VALIDATION_FAILED', message, 422, details);
export const conflict = (message: string): ServiceError => new ServiceError('CONFLICT', message, 409);

export function isServiceError(e: unknown): e is ServiceError {
  return e instanceof ServiceError;
}

// ------------------------------------------------------------------ paging
export function pageParams(
  page: number | string | undefined,
  pageSize: number | string | undefined,
  defaultSize = 25,
  maxSize = 200,
): { page: number; pageSize: number; offset: number } {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const raw = Math.floor(Number(pageSize) || defaultSize);
  const size = Math.min(Math.max(1, raw), maxSize);
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

export function paginate<T>(items: T[], page?: number | string, pageSize?: number | string, defaultSize = 25, maxSize = 200): Paged<T> {
  const pp = pageParams(page, pageSize, defaultSize, maxSize);
  return { items: items.slice(pp.offset, pp.offset + pp.pageSize), total: items.length, page: pp.page, pageSize: pp.pageSize };
}

// ------------------------------------------------------------------ numbers
/** Round to `d` decimals (strips float noise such as 4400.000000001; never returns -0). */
export function round(n: number, d = 3): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** d;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function mean(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

export function fmtKg(kg: number): string {
  return formatKg(round(kg, 1));
}

export function fmtNum(n: number, decimals = 2): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : String(n);
}

export function placeholders(n: number): string {
  return new Array(n).fill('?').join(',');
}

// ------------------------------------------------------------------ sort ranks
export function deptRank(d: string | null | undefined): number {
  const i = STAGE_ORDER.indexOf(d as Department);
  return i < 0 ? 99 : i;
}

const PARAM_RANK = new Map(PARAMS.map((p, i) => [p.key, i]));
export function paramRank(key: string): number {
  return PARAM_RANK.get(key) ?? 999;
}

export function shiftRank(s: string | null | undefined): number {
  if (!s) return -1;
  const i = (SHIFTS as readonly string[]).indexOf(s);
  return i < 0 ? 9 : i;
}

/** 'RF-3' -> 3 (machine ids are `<DEPT>-<no>`). */
export function machineNoOf(id: string | null | undefined): number {
  if (!id) return 0;
  const n = Number(id.slice(id.lastIndexOf('-') + 1));
  return Number.isFinite(n) ? n : 0;
}

export function cmp(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Normalize a hash given by a user/URL: strip 0x, lowercase. */
export function normalizeHash(h: string): string {
  const s = h.trim().toLowerCase();
  return s.startsWith('0x') ? s.slice(2) : s;
}
