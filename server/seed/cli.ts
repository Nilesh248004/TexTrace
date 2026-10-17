import { openConfiguredDb, wipeDb } from '../db';
import { SimulatedLedger } from '../ledger/simulated';
import { seedDatabase } from './loader';

const profileArg = process.argv.indexOf('--profile');
const profile = profileArg >= 0 ? process.argv[profileArg + 1] : 'full';
if (profile !== 'full' && profile !== 'pre-demo') throw new Error('Seed profile must be "full" or "pre-demo"');

const started = Date.now();
const db = await openConfiguredDb();
try {
  await wipeDb(db);
  const ledger = new SimulatedLedger(db);
  await ledger.init();
  await seedDatabase(db, ledger, profile);
  console.log(`TexTrace seeded profile "${profile}" in ${Date.now() - started} ms (${(await ledger.stats()).transactions} transactions).`);
} finally {
  await db.close();
}