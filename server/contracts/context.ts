import type { ValidationCheck, EntityRef, DbChange } from '@shared/types';
import { entityDef, loadRow, recordHashOf, snapshotOf } from '../db/entities';
import { newId, nextSeq, getSettings } from '../db';
import type { DB } from '../db';
import { ContractRejection, type Actor, type ExecContext, type NotificationDraft } from './types';

export interface ContextState {
  changes: DbChange[];
  refs: EntityRef[];
  checks: ValidationCheck[];
  notifications: NotificationDraft[];
  payload?: Record<string, unknown>;
}

function refFor(type: string, row: Record<string, unknown>): EntityRef {
  return {
    type,
    id: String(row[entityDef(type).idColumn]),
    version: Number(row.version ?? 1),
    recordHash: recordHashOf(type, row),
    snapshot: snapshotOf(type, row),
  };
}

function addChange(state: ContextState, change: DbChange): void {
  const i = state.changes.findIndex((c) => c.table === change.table && c.key === change.key);
  if (i < 0) state.changes.push(change);
  else state.changes[i] = { ...change, before: state.changes[i].before };
}

function addRef(state: ContextState, ref: EntityRef): void {
  const i = state.refs.findIndex((r) => r.type === ref.type && r.id === ref.id);
  if (i < 0) state.refs.push(ref);
  else state.refs[i] = ref;
}

export async function createContext(
  db: DB,
  actor: Actor,
  timestamp: string,
  contract: ExecContext['contract'],
  fn: string,
  state: ContextState,
): Promise<ExecContext> {
  return {
    db,
    actor,
    timestamp,
    settings: await getSettings(db),
    contract,
    fn,
    check(rule, passed, detail, code) {
      state.checks.push({ rule, passed, detail });
      if (!passed) throw new ContractRejection(rule, detail, code);
    },
    note(rule, detail) {
      state.checks.push({ rule, passed: true, detail });
    },
    async insert(type, input) {
      const def = entityDef(type);
      const row: Record<string, unknown> = { ...input, version: 1 };
      const columns = Object.keys(row);
      await db.prepare(`INSERT INTO ${def.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...columns.map((key) => row[key]));
      const stored = await loadRow(db, type, String(row[def.idColumn]));
      if (!stored) throw new Error(`Tracked insert did not create ${type}:${String(row[def.idColumn])}`);
      addChange(state, { table: def.table, op: 'insert', key: String(row[def.idColumn]), before: null, after: stored });
      addRef(state, refFor(type, stored));
      return stored;
    },
    async update(type, id, patch) {
      const def = entityDef(type);
      const before = await loadRow(db, type, id);
      if (!before) throw new ContractRejection('exists', `${type} ${id} does not exist`, 'NOT_FOUND');
      const next: Record<string, unknown> = { ...patch, version: Number(before.version ?? 1) + 1 };
      const columns = Object.keys(next);
      await db.prepare(`UPDATE ${def.table} SET ${columns.map((key) => `${key} = ?`).join(', ')} WHERE ${def.idColumn} = ?`)
        .run(...columns.map((key) => next[key]), id);
      const after = await loadRow(db, type, id);
      if (!after) throw new Error(`Tracked update lost ${type}:${id}`);
      addChange(state, { table: def.table, op: 'update', key: id, before, after });
      addRef(state, refFor(type, after));
      return after;
    },
    async insertRaw(table, row) {
      const columns = Object.keys(row);
      await db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...columns.map((key) => row[key]));
      addChange(state, { table, op: 'insert', key: String(row.id ?? columns.map((k) => row[k]).join(':')), before: null, after: row });
    },
    async updateRaw(table, keyColumn, key, patch) {
      const before = await db.prepare(`SELECT * FROM ${table} WHERE ${keyColumn} = ?`).get(key) as Record<string, unknown> | undefined;
      if (!before) throw new ContractRejection('exists', `${table} row ${key} does not exist`, 'NOT_FOUND');
      const columns = Object.keys(patch);
      await db.prepare(`UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE ${keyColumn} = ?`)
        .run(...columns.map((column) => patch[column]), key);
      const after = await db.prepare(`SELECT * FROM ${table} WHERE ${keyColumn} = ?`).get(key) as Record<string, unknown>;
      addChange(state, { table, op: 'update', key: String(key), before, after });
    },
    async get<T>(sql: string, ...params: unknown[]) { return await db.prepare(sql).get(...params) as T | undefined; },
    async all<T>(sql: string, ...params: unknown[]) { return await db.prepare(sql).all(...params) as T[]; },
    nextSeq(name) { return nextSeq(db, name); },
    newId(prefix, pad) { return newId(db, prefix, pad); },
    notify(notification) { state.notifications.push(notification); },
    setPayload(payload) { state.payload = payload; },
  };
}
