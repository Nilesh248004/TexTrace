import { getDb, wipeDb } from '../db';
import { SimulatedLedger } from '../ledger/simulated';
import { seedDatabase } from './loader';

const profileArg = process.argv.indexOf('--profile');
const profile = profileArg >= 0 ? process.argv[profileArg + 1] : 'full';
if (profile !== 'full' && profile !== 'pre-demo') throw new Error('Seed profile must be "full" or "pre-demo"');

const started = Date.now();
const db = getDb();
try {
  wipeDb(db);
  const ledger = new SimulatedLedger(db);
  ledger.init();
  seedDatabase(db, ledger, profile);
  console.log(`TexTrace seeded profile "${profile}" in ${Date.now() - started} ms (${ledger.stats().transactions} transactions).`);
} finally {
  db.close();
}