// SQLite access (better-sqlite3, synchronous). One process-wide connection.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config';
import type { Settings } from '@shared/types';
import { DEFAULT_WARN_FRACTION } from '@shared/quality';
import { today } from '../lib/clock';
import { openPostgresDatabase, postgresSchema, SqliteDatabase, type DB } from './driver';

export type { DB } from './driver';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');

let current: DB | null = null;

/** Open (or create) a database and apply the schema. Use ':memory:' in tests. */
export function openDb(file: string = config.dbFile): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const native = new Database(file);
  native.pragma('journal_mode = WAL');
  native.pragma('foreign_keys = ON');
  native.pragma('synchronous = NORMAL');
  native.exec(SCHEMA_SQL);
  // Upgrade existing SQLite files without dropping historical bale data.
  const baleColumns = native.pragma('table_info(bales)') as Array<{ name: string }>;
  if (!baleColumns.some((column) => column.name === 'arrival_date')) {
    native.exec('ALTER TABLE bales ADD COLUMN arrival_date TEXT');
  }
  native.exec(`UPDATE bales SET arrival_date = COALESCE(NULLIF(arrival_date, ''), NULLIF(substr(received_at, 1, 10), ''), NULLIF(substr(created_at, 1, 10), ''), date('now')) WHERE arrival_date IS NULL OR arrival_date = ''`);
  return new SqliteDatabase(native);
}

export async function openConfiguredDb(): Promise<DB> {
  return config.databaseUrl ? openPostgresDatabase(config.databaseUrl, SCHEMA_SQL) : openDb();
}

/** Process-wide connection (lazily opened). Tests may call setDb() with an in-memory DB. */
export function getDb(): DB {
  if (!current) current = openDb();
  return current;
}

export function setDb(db: DB): void {
  current = db;
}

/** Drop every table and re-apply the schema (used by demo reset). Keeps the same connection object. */
export async function wipeDb(db: DB = getDb()): Promise<void> {
  const tables = db.dialect === 'postgres'
    ? await db.prepare(`SELECT tablename AS name FROM pg_tables WHERE schemaname='public'`).all<{ name: string }>()
    : await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all<{ name: string }>();
  // SQLite enforces foreign keys while dropping tables: switch enforcement off (it is a no-op inside a transaction), drop everything, switch it back on.
  if (db.dialect === 'sqlite') await db.exec('PRAGMA foreign_keys = OFF');
  try {
    await db.transaction(async () => {
      for (const table of tables) await db.exec(`DROP TABLE IF EXISTS "${table.name}"${db.dialect === 'postgres' ? ' CASCADE' : ''}`);
    })();
  } finally {
    if (db.dialect === 'sqlite') await db.exec('PRAGMA foreign_keys = ON');
  }
  await db.exec(db.dialect === 'postgres' ? postgresSchema(SCHEMA_SQL) : SCHEMA_SQL);
}

export async function isSeeded(db: DB = getDb()): Promise<boolean> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ledger_blocks`).get<{ n: number | string }>();
  return Number(row?.n ?? 0) > 1;
}

// ------------------------------------------------------------------ helpers
export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (s === null || s === undefined || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function toJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}

/** Atomic named sequence (e.g. 'complaint:2026', 'lot:2026', 'dispatch:2026', 'id:TR'). Returns the new value. */
export async function nextSeq(db: DB, name: string, startAt = 1): Promise<number> {
  const row = await db.prepare(`INSERT INTO sequences(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=sequences.value+1 RETURNING value`).get<{ value: number | string }>(name, startAt);
  return Number(row?.value ?? startAt);
}

/** Peek a sequence without incrementing (returns the value the next nextSeq() would return). */
export async function peekSeq(db: DB, name: string, startAt = 1): Promise<number> {
  const row = await db.prepare(`SELECT value FROM sequences WHERE name = ?`).get<{ value: number | string }>(name);
  return row ? Number(row.value) + 1 : startAt;
}

/** Ensure a sequence is at least `value` (seeding with historical numbers). */
export async function bumpSeqTo(db: DB, name: string, value: number): Promise<void> {
  await db.prepare(
    `INSERT INTO sequences(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = CASE WHEN sequences.value > excluded.value THEN sequences.value ELSE excluded.value END`,
  ).run(name, value);
}

/** Generate a padded id such as 'TR-000123' from the 'id:TR' sequence. */
export async function newId(db: DB, prefix: string, pad = 6): Promise<string> {
  return `${prefix}-${String(await nextSeq(db, `id:${prefix}`)).padStart(pad, '0')}`;
}

export const DEFAULT_SETTINGS: Settings = {
  millName: config.millName,
  warnFraction: DEFAULT_WARN_FRACTION,
  businessDate: config.defaultBusinessDate,
  nowIso: config.seedNowIso,
};

export async function getSettings(db: DB = getDb()): Promise<Settings> {
  const rows = await db.prepare(`SELECT key, value FROM settings`).all<{ key: string; value: string }>();
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) (s as unknown as Record<string, unknown>)[r.key] = parseJson(r.value, null);
  s.businessDate = today();
  return s;
}

export async function writeSettings(db: DB, patch: Partial<Settings>): Promise<void> {
  const stmt = db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) await stmt.run(key, toJson(value));
}
