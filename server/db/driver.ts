import { AsyncLocalStorage } from 'node:async_hooks';
import Database from 'better-sqlite3';
import pg, { type PoolClient } from 'pg';

const { Pool } = pg;

type Pool = InstanceType<typeof pg.Pool>;

// COUNT()/SUM() return bigint (int8).
// Row counts here are far below 2^53, so return numbers like SQLite does.
pg.types.setTypeParser(20, (value) => Number(value));

export interface RunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface DbStatement {
  get<T = Record<string, unknown>>(
    ...params: unknown[]
  ): Promise<T | undefined>;

  all<T = Record<string, unknown>>(
    ...params: unknown[]
  ): Promise<T[]>;

  run(...params: unknown[]): Promise<RunResult>;
}

export interface DB {
  readonly dialect: 'sqlite' | 'postgres';
  readonly inTransaction: boolean;

  prepare(sql: string): DbStatement;

  exec(sql: string): Promise<void>;

  transaction<T>(
    fn: () => Promise<T> | T
  ): () => Promise<T>;

  close(): Promise<void>;
}

/**
 * Convert SQLite-style SQL into PostgreSQL-compatible SQL.
 *
 * Supported:
 * - ? parameters -> $1, $2, ...
 * - ? IS NULL / ? IS NOT NULL -> CAST(? AS TEXT) IS NULL
 * - Preserve camelCase aliases
 */
function postgresSql(sql: string): string {
  // PostgreSQL cannot infer the type of a bare ? IS [NOT] NULL parameter.
  sql = sql.replace(
    /\?(\s+IS\s+(?:NOT\s+)?NULL)/gi,
    'CAST(? AS TEXT)$1'
  );

  let output = '';
  let parameter = 0;

  let quote: "'" | '"' | null = null;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    // Inside a quoted string / identifier.
    if (quote) {
      output += char;

      if (char === quote && sql[i + 1] === quote) {
        output += sql[++i];
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    // Start quoted string / identifier.
    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      continue;
    }

    // SQLite ? parameter -> PostgreSQL $1, $2...
    if (char === '?') {
      output += `$${++parameter}`;
      continue;
    }

    // Preserve camelCase aliases.
    if (
      /[A-Za-z_]/.test(char) &&
      !/[\w$]/.test(sql[i - 1] ?? ' ')
    ) {
      let end = i + 1;

      while (
        end < sql.length &&
        /[\w$]/.test(sql[end])
      ) {
        end++;
      }

      const word = sql.slice(i, end);

      // Quote camelCase identifiers so PostgreSQL does not
      // automatically convert them to lowercase.
      if (/^[a-z][a-z0-9_]*[A-Z]/.test(word)) {
        output += `"${word}"`;
      } else {
        output += word;
      }

      i = end - 1;
      continue;
    }

    output += char;
  }

  return output;
}

class PgDatabase implements DB {
  readonly dialect = 'postgres' as const;

  private readonly pool: Pool;

  private readonly transactionClient =
    new AsyncLocalStorage<PoolClient>();

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  get inTransaction(): boolean {
    return this.transactionClient.getStore() !== undefined;
  }

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

        return {
          changes: result.rowCount ?? 0,
        };
      },
    };
  }

  /**
   * Execute raw SQL.
   *
   * Includes detailed PostgreSQL logging so deployment errors
   * show the exact SQL statement that failed.
   */
  async exec(sql: string): Promise<void> {
    const client = this.transactionClient.getStore();

    try {
      if (client) {
        await client.query(sql);
      } else {
        await this.pool.query(sql);
      }
    } catch (error) {
      console.error('\n========== POSTGRES SQL ERROR ==========');
      console.error('SQLSTATE:', (error as any)?.code);
      console.error('Message:', (error as any)?.message);
      console.error('Detail:', (error as any)?.detail);
      console.error('Hint:', (error as any)?.hint);
      console.error('Position:', (error as any)?.position);

      console.error('\nFailed SQL:');
      console.error(sql);

      console.error('\n========================================\n');

      throw error;
    }
  }

  transaction<T>(
    fn: () => Promise<T> | T
  ): () => Promise<T> {
    return async () => {
      const existing = this.transactionClient.getStore();

      // Reuse existing transaction.
      if (existing) {
        return await fn();
      }

      const client = await this.pool.connect();

      try {
        await client.query('BEGIN');

        const result =
          await this.transactionClient.run(client, fn);

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

  async close(): Promise<void> {
    await this.pool.end();
  }

  private query(sql: string, params: unknown[]) {
    const client = this.transactionClient.getStore();

    return client
      ? client.query(sql, params)
      : this.pool.query(sql, params);
  }
}

export class SqliteDatabase implements DB {
  readonly dialect = 'sqlite' as const;

  private transactionDepth = 0;

  constructor(
    private readonly native: Database.Database
  ) {}

  get inTransaction(): boolean {
    return this.transactionDepth > 0;
  }

  prepare(sql: string): DbStatement {
    const statement = this.native.prepare(sql);

    return {
      get: async <T>(...params: unknown[]) =>
        statement.get(...params) as T | undefined,

      all: async <T>(...params: unknown[]) =>
        statement.all(...params) as T[],

      run: async (...params: unknown[]) => {
        const result = statement.run(...params);

        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
    };
  }

  async exec(sql: string): Promise<void> {
    this.native.exec(sql);
  }

  transaction<T>(
    fn: () => Promise<T> | T
  ): () => Promise<T> {
    return async () => {
      const outer = this.transactionDepth === 0;

      if (outer) {
        this.native.exec('BEGIN IMMEDIATE');
      }

      this.transactionDepth++;

      try {
        const result = await fn();

        this.transactionDepth--;

        if (outer) {
          this.native.exec('COMMIT');
        }

        return result;
      } catch (error) {
        this.transactionDepth--;

        if (outer) {
          this.native.exec('ROLLBACK');
        }

        throw error;
      }
    };
  }

  async close(): Promise<void> {
    this.native.close();
  }
}

/**
 * Convert the SQLite schema into a PostgreSQL-compatible schema.
 *
 * Important:
 * We intentionally do NOT modify CREATE INDEX statements here.
 * If an index references a missing column, PostgreSQL should report
 * the exact SQL so we can fix the actual schema mismatch.
 */
export function postgresSchema(schema: string): string {
  return schema
    // Remove SQLite PRAGMA statements.
    .replace(/^\s*PRAGMA[^;]*;\s*/gim, '')

    // SQLite AUTOINCREMENT primary key -> PostgreSQL SERIAL.
    .replace(
      /INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
      'SERIAL PRIMARY KEY'
    )

    // SQLite REAL -> PostgreSQL DOUBLE PRECISION.
    .replace(
      /\bREAL\b/gi,
      'DOUBLE PRECISION'
    );
}

/**
 * Open PostgreSQL database and initialize schema.
 */
export async function openPostgresDatabase(
  connectionString: string,
  schema: string
): Promise<DB> {
  const db = new PgDatabase(connectionString);

  try {
    console.log('[DB] Connecting to PostgreSQL...');

    await db.prepare('SELECT 1').get();

    console.log('[DB] PostgreSQL connection successful.');

    const convertedSchema = postgresSchema(schema);

    console.log('[DB] Initializing PostgreSQL schema...');

    try {
      await db.exec(convertedSchema);

      // Compatibility migration for existing PostgreSQL databases.
      // Keep this out of schema.sql because SQLite also executes that file.
      await db.exec(
        'ALTER TABLE machines ADD COLUMN IF NOT EXISTS spindles INTEGER NOT NULL DEFAULT 0'
      );
      console.log('[DB] Verified machines.spindles column.');

    } catch (error) {
      console.error(
        '[DB] PostgreSQL schema initialization failed.'
      );

      console.error(
        '[DB] This usually means the schema contains a PostgreSQL-incompatible statement.'
      );

      throw error;
    }

    console.log(
      '[DB] PostgreSQL schema initialized successfully.'
    );

    return db;
  } catch (error) {
    console.error('\n========== DATABASE STARTUP ERROR ==========');

    console.error(
      'Code:',
      (error as any)?.code
    );

    console.error(
      'Message:',
      (error as any)?.message
    );

    console.error(
      'Detail:',
      (error as any)?.detail
    );

    console.error(
      'Hint:',
      (error as any)?.hint
    );

    console.error(
      'Position:',
      (error as any)?.position
    );

    console.error(
      'Routine:',
      (error as any)?.routine
    );

    console.error(
      '============================================\n'
    );

    await db.close();

    throw error;
  }
}