import { AsyncLocalStorage } from 'node:async_hooks';
import Database from 'better-sqlite3';
import { Pool, type PoolClient } from 'pg';

export interface RunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface DbStatement {
  get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

export interface DB {
  readonly dialect: 'sqlite' | 'postgres';
  readonly inTransaction: boolean;
  prepare(sql: string): DbStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T> | T): () => Promise<T>;
  close(): Promise<void>;
}

function postgresSql(sql: string): string {
  let output = '';
  let parameter = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (quote) {
      output += char;
      if (char === quote && sql[i + 1] === quote) output += sql[++i];
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      output += char;
    } else if (char === '?') output += `$${++parameter}`;
    else output += char;
  }
  return output;
}

class PgDatabase implements DB {
  readonly dialect = 'postgres' as const;
  private readonly pool: Pool;
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  }

  get inTransaction(): boolean { return this.transactionClient.getStore() !== undefined; }

  prepare(sql: string): DbStatement {
    const text = postgresSql(sql);
    return {
      get: async <T>(...params: unknown[]) => {
        const result = await this.query(text, params);
        return result.rows[0] as T | undefined;
      },
      all: async <T>(...params: unknown[]) => {
        const result = await this.query(text, params);
        return result.rows as T[];
      },
      run: async (...params: unknown[]) => {
        const result = await this.query(text, params);
        return { changes: result.rowCount ?? 0 };
      },
    };
  }

  async exec(sql: string): Promise<void> {
    const client = this.transactionClient.getStore();
    if (client) await client.query(sql);
    else await this.pool.query(sql);
  }

  transaction<T>(fn: () => Promise<T> | T): () => Promise<T> {
    return async () => {
      const existing = this.transactionClient.getStore();
      if (existing) return await fn();
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await this.transactionClient.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
  }

  async close(): Promise<void> { await this.pool.end(); }

  private query(sql: string, params: unknown[]) {
    const client = this.transactionClient.getStore();
    return client ? client.query(sql, params) : this.pool.query(sql, params);
  }
}

export class SqliteDatabase implements DB {
  readonly dialect = 'sqlite' as const;
  private transactionDepth = 0;

  constructor(private readonly native: Database.Database) {}

  get inTransaction(): boolean { return this.transactionDepth > 0; }

  prepare(sql: string): DbStatement {
    const statement = this.native.prepare(sql);
    return {
      get: async <T>(...params: unknown[]) => statement.get(...params) as T | undefined,
      all: async <T>(...params: unknown[]) => statement.all(...params) as T[],
      run: async (...params: unknown[]) => {
        const result = statement.run(...params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      },
    };
  }

  async exec(sql: string): Promise<void> { this.native.exec(sql); }

  transaction<T>(fn: () => Promise<T> | T): () => Promise<T> {
    return async () => {
      const outer = this.transactionDepth === 0;
      if (outer) this.native.exec('BEGIN IMMEDIATE');
      this.transactionDepth++;
      try {
        const result = await fn();
        this.transactionDepth--;
        if (outer) this.native.exec('COMMIT');
        return result;
      } catch (error) {
        this.transactionDepth--;
        if (outer) this.native.exec('ROLLBACK');
        throw error;
      }
    };
  }

  async close(): Promise<void> { this.native.close(); }
}

export function postgresSchema(schema: string): string {
  return schema.replace(/^\s*PRAGMA[^;]*;\s*/gim, '').replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY').replace(/\bREAL\b/gi, 'DOUBLE PRECISION');
}

export async function openPostgresDatabase(connectionString: string, schema: string): Promise<DB> {
  const db = new PgDatabase(connectionString);
  try {
    await db.prepare('SELECT 1').get();
    await db.exec(postgresSchema(schema));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}