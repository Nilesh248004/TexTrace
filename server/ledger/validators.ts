// Validator set of the simulated permissioned network: one validator (endorsing peer) per organisation.
//
// Each validator holds a signing key derived from the network secret: key = HMAC(LEDGER_VALIDATOR_SECRET, validatorId).
// When the orderer proposes a block, every validator independently re-verifies it (see SimulatedLedger.endorse) and,
// if it agrees, signs the block hash: signature = HMAC-SHA256(key, blockHash). HMAC stands in for the ECDSA/X.509
// signatures a Fabric peer would produce; verification therefore needs the same secret (kept server-side).
// Endorsement policy: 3-of-4 signatures (tolerates one faulty or offline organisation).
import { timingSafeEqual } from 'node:crypto';
import type { ValidatorApproval } from '@shared/types';
import { config } from '../config';
import { hmacHex, sha256Hex } from '../lib/hash';

export interface ValidatorInfo {
  id: string;
  org: string;
}

export const VALIDATORS: { id: string; org: string }[] = [
  { id: 'validator-1', org: 'MillOrg' },
  { id: 'validator-2', org: 'QualityOrg' },
  { id: 'validator-3', org: 'BuyerOrg' },
  { id: 'validator-4', org: 'AuditOrg' },
];

/** Minimum number of valid validator signatures for a block to be committed / considered valid. */
export const QUORUM = 3;
export const POLICY = '3-of-4 validator signatures';

const HEX64 = /^[0-9a-f]{64}$/;
const keyCache = new Map<string, string>();

export function findValidator(id: string): ValidatorInfo | undefined {
  return VALIDATORS.find((v) => v.id === id);
}

/** Signing key of a validator (derived, never stored). */
export function validatorKey(id: string): string {
  const secret = config.ledger.validatorSecret;
  const cacheKey = `${secret}\u0000${id}`;
  let key = keyCache.get(cacheKey);
  if (key === undefined) {
    key = hmacHex(secret, id);
    keyCache.set(cacheKey, key);
  }
  return key;
}

/** The signature validator `id` puts on `blockHash`. */
export function signBlockHash(id: string, blockHash: string): string {
  return hmacHex(validatorKey(id), blockHash);
}

/**
 * Deterministic pseudo network latency (3–18 ms) of a validator's endorsement for a block: one byte of the block
 * hash per validator slot. No randomness, so the same block always shows the same latencies.
 */
export function validatorLatencyMs(id: string, blockHash: string): number {
  const hex = HEX64.test(blockHash) ? blockHash : sha256Hex(blockHash);
  const slot = VALIDATORS.findIndex((v) => v.id === id);
  const offset = slot >= 0 ? (slot * 7) % 31 : parseInt(sha256Hex(id).slice(0, 2), 16) % 31;
  const byte = parseInt(hex.slice(offset * 2, offset * 2 + 2), 16);
  return 3 + (byte % 16);
}

/**
 * Ask every validator to endorse `blockHash`. `verify(validatorId)` performs that validator's independent checks
 * and returns null when it agrees, or the reason it refuses. Approving validators sign the block hash.
 */
export function collectApprovals(blockHash: string, verify: (validatorId: string) => string | null): ValidatorApproval[] {
  return VALIDATORS.map((v) => {
    let reason: string | null;
    try {
      reason = verify(v.id);
    } catch (err) {
      reason = `verification error: ${err instanceof Error ? err.message : String(err)}`;
    }
    const approved = reason === null;
    return {
      validator: v.id,
      org: v.org,
      approved,
      signature: approved ? signBlockHash(v.id, blockHash) : '',
      reason,
      latencyMs: validatorLatencyMs(v.id, blockHash),
    };
  });
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Why an approval does NOT count as a valid signature over `blockHash` (null = valid).
 * A recorded refusal (approved=false) is reported as 'not approved' — it is legitimate but does not count to quorum.
 */
export function explainApproval(a: ValidatorApproval | null | undefined, blockHash: string): string | null {
  if (!a || typeof a !== 'object') return 'approval entry is missing or malformed';
  const v = typeof a.validator === 'string' ? findValidator(a.validator) : undefined;
  if (!v) return `unknown validator "${String(a.validator)}" — not a member of the validator set`;
  if (a.org !== v.org) return `${v.id} belongs to ${v.org}, approval claims org "${String(a.org)}"`;
  if (a.approved !== true) return 'not approved';
  if (typeof a.signature !== 'string' || !HEX64.test(a.signature)) return `${v.id} (${v.org}) signature is not a 64-hex HMAC-SHA256 value`;
  if (!safeEqualHex(a.signature, signBlockHash(v.id, blockHash))) {
    return `${v.id} (${v.org}) signature does not verify against block hash`;
  }
  return null;
}

/** true iff `a` is an approval by a known validator whose signature verifies against `blockHash`. */
export function verifyApproval(a: ValidatorApproval, blockHash: string): boolean {
  return explainApproval(a, blockHash) === null;
}

/** Number of DISTINCT validators with a valid signature over `blockHash`. */
export function countValidApprovals(approvals: ValidatorApproval[], blockHash: string): number {
  const ok = new Set<string>();
  for (const a of approvals) if (verifyApproval(a, blockHash)) ok.add(a.validator);
  return ok.size;
}
