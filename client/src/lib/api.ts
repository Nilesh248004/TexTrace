import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { ApiEnvelope } from '@shared/api';
import type { DevTrace } from '@shared/types';
import { useSession, useTraces, useUi } from './store';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public trace?: DevTrace) { super(message); }
}

export async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean } = {}): Promise<{ data: T; trace?: DevTrace }> {
  const token = useSession.getState().token;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined });
  if (opts.raw) return { data: (await res.text()) as unknown as T };
  let env: ApiEnvelope<T>;
  try { env = (await res.json()) as ApiEnvelope<T>; } catch { throw new ApiError(`Request failed (${res.status})`, res.status, 'INTERNAL'); }
  if (res.status === 401 && token) { useSession.getState().clear(); }
  if (!env.ok) { if (env.trace) useTraces.getState().push(`Rejected: ${env.trace.label}`, env.trace); throw new ApiError(env.error.message, res.status, env.error.code, env.trace); }
  return { data: env.data, trace: env.trace };
}

/** GET with caching. `null` path disables the query. The global count / master-version choices are appended where asked. */
export function useGet<T>(path: string | null, opts: Partial<Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>> = {}) {
  const token = useSession((s) => s.token);
  return useQuery<T>({ queryKey: ['api', path, token], queryFn: async () => (await request<T>('GET', path as string)).data, enabled: !!path && !!token && opts.enabled !== false, staleTime: 15_000, ...opts });
}

/** Query-string helper that skips empty values. */
export function qstr(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'ALL').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
}

/** Global filters: count selector + master-version judging mode. */
export function useGlobalParams(): { count: string; mode: 'asOf' | 'latest' } {
  const count = useUi((s) => s.count); const mode = useUi((s) => s.judge);
  return { count, mode };
}

/** Write through a smart contract. Shows the ledger block / tx (or the rejection reason) in the trace bar and refreshes data. */
export function useMut<B, R>(method: 'POST' | 'PUT' | 'DELETE', path: string | ((b: B) => string), label?: string | ((b: B, r: R) => string)) {
  const qc = useQueryClient();
  return useMutation<R, ApiError, B>({
    mutationFn: async (body: B) => {
      const p = typeof path === 'function' ? path(body) : path;
      const { data, trace } = await request<R>(method, p, body);
      if (trace) useTraces.getState().push(typeof label === 'function' ? label(body, data) : label ?? trace.label, trace);
      return data;
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['api'] }); },
  });
}

export async function download(path: string, filename: string): Promise<void> {
  const token = useSession.getState().token;
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
