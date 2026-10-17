// Binary Merkle tree over transaction hashes (SPEC §5).
//
//   leaves  = tx hashes (lowercase hex strings), in block order
//   parent  = sha256(left + right)      (the two hex strings concatenated, then hashed as UTF-8 text)
//   odd     = the last node of a level is paired with itself (Bitcoin-style duplication)
//   1 leaf  = root is that leaf
//   empty   = sha256('')
//
// A proof is the list of sibling hashes from the leaf up to the root. `position` is where the SIBLING sits:
// 'left' => parent = sha256(sibling + current), 'right' => parent = sha256(current + sibling).
import type { MerkleProofStep } from '@shared/types';
import { sha256Hex } from '../lib/hash';

export const EMPTY_MERKLE_ROOT = sha256Hex('');

function parentOf(left: string, right: string): string {
  return sha256Hex(left + right);
}

function nextLevel(level: string[]): string[] {
  const out: string[] = new Array(Math.ceil(level.length / 2));
  for (let i = 0, j = 0; i < level.length; i += 2, j++) {
    const left = level[i];
    const right = i + 1 < level.length ? level[i + 1] : left;
    out[j] = parentOf(left, right);
  }
  return out;
}

/** Merkle root of `leaves` (tx hashes in block order). */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return EMPTY_MERKLE_ROOT;
  let level = leaves;
  while (level.length > 1) level = nextLevel(level);
  return level[0];
}

/** Sibling path proving that `leaves[index]` is included under `merkleRoot(leaves)`. */
export function merkleProof(leaves: string[], index: number): MerkleProofStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new RangeError(`Merkle proof: leaf index ${index} is out of range for a block of ${leaves.length} transaction(s)`);
  }
  const proof: MerkleProofStep[] = [];
  let level = leaves;
  let i = index;
  while (level.length > 1) {
    const isRight = i % 2 === 1;
    const siblingIndex = isRight ? i - 1 : i + 1;
    // Odd level: the last node is paired with itself.
    const sibling = siblingIndex < level.length ? level[siblingIndex] : level[i];
    proof.push({ position: isRight ? 'left' : 'right', hash: sibling });
    level = nextLevel(level);
    i = Math.floor(i / 2);
  }
  return proof;
}

/** Recompute the root from `leaf` + `proof` and compare with `root`. Never throws. */
export function verifyMerkleProof(leaf: string, proof: MerkleProofStep[], root: string): boolean {
  if (typeof leaf !== 'string' || typeof root !== 'string' || !Array.isArray(proof)) return false;
  let acc = leaf;
  for (const step of proof) {
    if (!step || typeof step.hash !== 'string') return false;
    if (step.position === 'left') acc = parentOf(step.hash, acc);
    else if (step.position === 'right') acc = parentOf(acc, step.hash);
    else return false;
  }
  return acc === root;
}
