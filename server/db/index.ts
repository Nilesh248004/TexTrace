// SQLite access (better-sqlite3, synchronous). One process-wide connection.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config';
import type { Settings } from '@shared/types';
import { DEFAULT_LOT_CODE_FORMAT, DEFAULT_LOT_NO_FORMAT } from '@shared/format';
import { DEFAULT_QUALITY_COLUMNS } from '@shared/params';
import { DEFAULT_WARN_FRACTION } from '@shared/quality';

export type DB = Database.Database;

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');

let current: DB | null = null;

/** Open (or create) a database and apply the schema. Use ':memory:' in tests. */
export function openDb(file: string = config.dbFile): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA_SQL);
  return db;
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
export function wipeDb(db: DB = getDb()): void {
  db.pragma('foreign_keys = OFF');
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  const tx = db.transaction(() => {
    for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  });
  tx();
  db.exec(SCHEMA_SQL);
  db.pragma('foreign_keys = ON');
}

export function isSeeded(db: DB = getDb()): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ledger_blocks`).get() as { n: number };
  return row.n > 1;
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
export function nextSeq(db: DB, name: string, startAt = 1): number {
  const row = db.prepare(`SELECT value FROM sequences WHERE name = ?`).get(name) as { value: number } | undefined;
  const value = row ? row.value + 1 : startAt;
  db.prepare(`INSERT INTO sequences(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value`).run(name, value);
  return value;
}

/** Peek a sequence without incrementing (returns the value the next nextSeq() would return). */
export function peekSeq(db: DB, name: string, startAt = 1): number {
  const row = db.prepare(`SELECT value FROM sequences WHERE name = ?`).get(name) as { value: number } | undefined;
  return row ? row.value + 1 : startAt;
}

/** Ensure a sequence is at least `value` (seeding with historical numbers). */
export function bumpSeqTo(db: DB, name: string, value: number): void {
  db.prepare(
    `INSERT INTO sequences(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = MAX(value, excluded.value)`,
  ).run(name, value);
}

/** Generate a padded id such as 'TR-000123' from the 'id:TR' sequence. */
export function newId(db: DB, prefix: string, pad = 6): string {
  return `${prefix}-${String(nextSeq(db, `id:${prefix}`)).padStart(pad, '0')}`;
}

export const DEFAULT_SETTINGS: Settings = {
  millName: config.millName,
  lotNoFormat: DEFAULT_LOT_NO_FORMAT,
  lotCodeFormat: DEFAULT_LOT_CODE_FORMAT,
  lotMark: 'X',
  warnFraction: DEFAULT_WARN_FRACTION,
  businessDate: config.defaultBusinessDate,
  qualityColumns: DEFAULT_QUALITY_COLUMNS,
};

export function getSettings(db: DB = getDb()): Settings {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) (s as unknown as Record<string, unknown>)[r.key] = parseJson(r.value, null);
  return s;
}

export function writeSettings(db: DB, patch: Partial<Settings>): void {
  const stmt = db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) stmt.run(k, toJson(v));
}
