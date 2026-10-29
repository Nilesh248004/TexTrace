// HTTP envelope + live-update types. Success -> { ok: true, data, trace? }  failure -> { ok: false, error, trace? }
// Write endpoints ALWAYS include `trace` (DevTrace), including on rejection (403/409/422).
import type { ChainValidationReport, DevTrace, LedgerBlock, Notification } from './types';

export interface ApiError {
  code: 'UNAUTHENTICATED' | 'PERMISSION_DENIED' | 'VALIDATION_FAILED' | 'CONTRACT_REJECTED' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';
  message: string;
  details?: unknown;
}

export type ApiOk<T> = { ok: true; data: T; trace?: DevTrace };
export type ApiErr = { ok: false; error: ApiError; trace?: DevTrace };
export type ApiEnvelope<T> = ApiOk<T> | ApiErr;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ------------------------------------------------------------------ WebSocket (/ws)
export type QueryDomain =
  | 'dashboard'
  | 'complaints'
  | 'lots'
  | 'masters'
  | 'dispatches'
  | 'analysis'
  | 'ledger'
  | 'audit'
  | 'notifications'
  | 'meta'
  | 'documents'
  | 'customers'
  | 'bales'
  | 'production'
  | 'quality'
  | 'accessories';

export type WsEvent =
  | { type: 'hello'; data: { serverTime: string; height: number } }
  | { type: 'trace'; data: DevTrace }
  | { type: 'block'; data: LedgerBlock }
  | { type: 'invalidate'; data: { domains: QueryDomain[] | ['*'] } }
  | { type: 'notification'; data: Notification }
  | { type: 'integrity'; data: ChainValidationReport };
