import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { isSeeded, openConfiguredDb, setDb, wipeDb } from './db';
import { initClock } from './lib/clock';
import { SimulatedLedger } from './ledger/simulated';
import { seedDatabase } from './seed/loader';
import { createApp } from './app';
import { attachWebSocket } from './api/ws';

if (config.isProd && config.ledger.validatorSecret === 'textrace-demo-validators') {
  console.warn('WARNING: LEDGER_VALIDATOR_SECRET is the public demo default. Set a private value before real data is anchored.');
}
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

// Listen first: seeding a remote Postgres on the very first start takes a while and hosting platforms expect the port to open.
let api: express.Express | null = null;
const app = express();
const dist = config.isProd && fs.existsSync(config.distDir);
if (dist) app.use(express.static(config.distDir));
app.use((req, res, next) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) return next();
  if (!api) return res.status(503).json({ ok: false, seeding: true, error: { code: 'INTERNAL', message: 'The demo data is being prepared (first start only) — retry in a few seconds.' } });
  return api(req, res, next);
});
if (dist) app.get('*', (_req, res) => res.sendFile(path.join(config.distDir, 'index.html')));
const server = app.listen(config.port, () => console.log(`TexTrace API listening on http://localhost:${config.port}`));

const db = await openConfiguredDb();
setDb(db);
const ledger = new SimulatedLedger(db);
await ledger.init();
await initClock(db);
if (!(await isSeeded(db))) {
  const started = Date.now();
  await seedDatabase(db, ledger);
  console.log(`TexTrace seeded deterministic demo data in ${Date.now() - started} ms`);
}
api = createApp(db, ledger, undefined, {
  reset: async () => {
    await wipeDb(db);
    await ledger.init();
    await seedDatabase(db, ledger);
    console.log('Demo data reset to the pristine seed');
  },
});
const ws = attachWebSocket(server, ledger);
console.log('TexTrace is ready');

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received; stopping TexTrace API.`);
  ws.close();
  server.close(() => { void db.close(); });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
