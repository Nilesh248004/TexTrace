import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { getDb, isSeeded } from './db';
import { SimulatedLedger } from './ledger/simulated';
import { seedDatabase } from './seed/loader';
import { createApp } from './app';
import { attachWebSocket } from './api/ws';

const db = getDb();
const ledger = new SimulatedLedger(db);
ledger.init();
if (!isSeeded(db)) {
  const started = Date.now();
  seedDatabase(db, ledger);
  console.log(`TexTrace seeded deterministic demo data in ${Date.now() - started} ms`);
}

const app = createApp(db, ledger);

if (config.isProd && fs.existsSync(config.distDir)) {
  app.use(express.static(config.distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(config.distDir, 'index.html')));
}

const server = app.listen(config.port, () => {
  console.log(`TexTrace API listening on http://localhost:${config.port}`);
});
const ws = attachWebSocket(server, ledger);

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received; stopping TexTrace API.`);
  ws.close();
  server.close(() => db.close());
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
