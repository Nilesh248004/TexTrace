// Hashing primitives for the ledger and record anchoring. Node-only (uses node:crypto).
import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted recursively, `undefined` dropped, arrays keep order.
 * Numbers use JSON.stringify formatting (so 10.5 -> "10.5"). Non-finite numbers become null.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : canonicalize(v)));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] = canonicalize(v);
  }
  return out;
}

export function sha256Hex(data: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** SHA-256 of the canonical JSON of a value. */
export function hashObject(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function hmacHex(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

export const ZERO_HASH = '0'.repeat(64);
