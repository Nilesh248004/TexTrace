import fs from 'node:fs';
import { openPostgresDatabase, postgresSchema } from '../../server/db/driver';
import type { DB } from '../../server/db';
import { defineSuite } from './suite';

// Opt-in: runs the API suite against a real, disposable Postgres, e.g.
//   docker run -d --name pgtest -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16-alpine
//   TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/postgres npm test
// WARNING: every table in the target's public schema is dropped. Never point this at a real database.
const url = process.env.TEST_DATABASE_URL ?? '';
if (url && !/localhost|127\.0\.0\.1/.test(url)) throw new Error('TEST_DATABASE_URL must be a local disposable Postgres');
const SCHEMA = fs.readFileSync('server/db/schema.sql', 'utf8');

defineSuite('TexTrace v2 API (Postgres)', async (): Promise<DB> => {
  const d = await openPostgresDatabase(url, SCHEMA);
  const tables = await d.prepare(`SELECT tablename AS name FROM pg_tables WHERE schemaname='public'`).all<{ name: string }>();
  for (const t of tables) await d.exec(`DROP TABLE IF EXISTS "${t.name}" CASCADE`);
  await d.exec(postgresSchema(SCHEMA));
  return d;
}, !url);
