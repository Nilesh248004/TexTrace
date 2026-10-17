import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { isSeeded, openConfiguredDb, setDb } from './db';
import { SimulatedLedger } from './ledger/simulated';
import { seedDatabase } from './seed/loader';
import { createApp } from './app';
import { attachWebSocket } from './api/ws';

if (config.isProd && config.ledger.validatorSecret === 'textrace-demo-validators') {
  console.warn('WARNING: LEDGER_VALIDATOR_SECRET is the public demo default. Set a private value before real data is anchored.');
}
const db = await openConfiguredDb();
setDb(db);
const ledger = new SimulatedLedger(db);
await ledger.init();
if (!(await isSeeded(db))) {
  const started = Date.now();
  await seedDatabase(db, ledger);
  console.log(`TexTrace seeded deterministic demo data in ${Date.now() - started} ms`);
}

const api = createApp(db, ledger);
const app = express();
// Only /api goes through the API app (its auth middleware rejects everything else); the built UI is served around it.
if (config.isProd && fs.existsSync(config.distDir)) app.use(express.static(config.distDir));
app.use((req, res, next) => (req.path.startsWith('/api') ? api(req, res, next) : next()));
if (config.isProd && fs.existsSync(config.distDir)) app.get('*', (_req, res) => res.sendFile(path.join(config.distDir, 'index.html')));
else app.use(api);

const server = app.listen(config.port, () => {
  console.log(`TexTrace API listening on http://localhost:${config.port}`);
});
const ws = attachWebSocket(server, ledger);

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received; stopping TexTrace API.`);
  ws.close();
  server.close(() => { void db.close(); });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
