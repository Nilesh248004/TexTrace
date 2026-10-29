// Record-level integrity: re-hash every anchored row, compare to the stored hash, the anchor table and the ledger snapshot,
// and merge with the ledger's own chain validation (hash links, Merkle roots, validator signatures, quorum).
import type { DB } from '../db';
import type { LedgerService } from '../ledger/types';
import type { ChainValidationReport, IntegrityIssue } from '@shared/types';
import { ENTITIES, diffSnapshots, recordHashOf, snapshotOf } from '../db/entities';

type Row = Record<string, unknown>;

export async function validateAll(db: DB, ledger: LedgerService): Promise<ChainValidationReport> {
  const started = Date.now();
  const chain = await ledger.validateLedger();
  const issues: IntegrityIssue[] = [...chain.issues];
  let checkedRecords = 0;
  const anchors = await db.prepare('SELECT a.entity_type, a.entity_id, a.version, a.record_hash, a.tx_hash, a.block_number FROM entity_anchors a JOIN (SELECT entity_type t, entity_id i, MAX(version) v FROM entity_anchors GROUP BY entity_type, entity_id) m ON m.t=a.entity_type AND m.i=a.entity_id AND m.v=a.version').all<Row>();
  const anchorOf = new Map(anchors.map((a) => [`${a.entity_type}|${a.entity_id}`, a]));
  const seen = new Set<string>();
  for (const def of Object.values(ENTITIES)) {
    const rows = await db.prepare(`SELECT * FROM ${def.table}`).all<Row>();
    for (const row of rows) {
      checkedRecords += 1;
      const id = String(row[def.idColumn]);
      seen.add(`${def.type}|${id}`);
      const current = recordHashOf(def.type, row);
      const anchor = anchorOf.get(`${def.type}|${id}`);
      if (row.record_hash !== current) {
        // pinpoint the edited field(s) against the snapshot that was written to the ledger
        let fields: { field: string; expected: unknown; actual: unknown }[] = [];
        const txs = await ledger.getTxsByEntity(def.type, id);
        const ref = txs.length ? txs[txs.length - 1].entityRefs.filter((x) => x.type === def.type && x.id === id).pop() : undefined;
        if (ref) fields = diffSnapshots(ref.snapshot, snapshotOf(def.type, row));
        for (const f of fields.length ? fields : [{ field: '(record)', expected: row.record_hash, actual: current }]) {
          issues.push({ kind: 'RECORD_HASH_MISMATCH', message: `${def.type} ${id}: field "${f.field}" was changed outside the contracts — anchored ${JSON.stringify(f.expected)} but the database now holds ${JSON.stringify(f.actual)}`, blockNumber: (row.block_number as number) ?? null, txHash: (row.tx_hash as string) ?? null, entityType: def.type, entityId: id, field: f.field, expected: f.expected, actual: f.actual });
        }
      } else if (anchor && anchor.record_hash !== current) {
        issues.push({ kind: 'ANCHOR_MISMATCH', message: `${def.type} ${id}: the anchor table disagrees with the current record`, blockNumber: (anchor.block_number as number) ?? null, txHash: (anchor.tx_hash as string) ?? null, entityType: def.type, entityId: id, field: 'record_hash', expected: anchor.record_hash, actual: current });
      }
      if (def.verifyExtra) {
        const extra = def.verifyExtra(row);
        if (!extra.ok) issues.push({ kind: 'RECORD_HASH_MISMATCH', message: `${def.type} ${id}: field "${extra.field}" no longer matches its committed hash`, blockNumber: (row.block_number as number) ?? null, txHash: (row.tx_hash as string) ?? null, entityType: def.type, entityId: id, field: extra.field, expected: extra.expected, actual: extra.actual });
      }
    }
  }
  for (const [key, a] of anchorOf) if (!seen.has(key)) issues.push({ kind: 'RECORD_MISSING', message: `${String(a.entity_type)} ${String(a.entity_id)} is anchored on the ledger (block #${String(a.block_number)}) but the record no longer exists`, blockNumber: (a.block_number as number) ?? null, txHash: (a.tx_hash as string) ?? null, entityType: String(a.entity_type), entityId: String(a.entity_id), field: null, expected: a.record_hash, actual: null });
  return { valid: issues.length === 0, checkedAt: new Date().toISOString(), durationMs: Date.now() - started, checkedBlocks: chain.checkedBlocks, checkedTxs: chain.checkedTxs, checkedRecords, issues };
}
