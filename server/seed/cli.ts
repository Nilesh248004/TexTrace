import { openConfiguredDb, wipeDb } from '../db';
import { SimulatedLedger } from '../ledger/simulated';
import { seedDatabase } from './loader';

const started = Date.now();
const db = await openConfiguredDb();
try {
  await wipeDb(db);
  const ledger = new SimulatedLedger(db);
  await ledger.init();
  const plan = await seedDatabase(db, ledger);
  const stats = await ledger.stats();
  console.log(`TexTrace seeded in ${Date.now() - started} ms: ${plan.rows.length} rows → ${stats.transactions} transactions in ${stats.blocks} blocks. Facts: ${JSON.stringify(plan.facts)}`);
} finally {
  await db.close();
}
