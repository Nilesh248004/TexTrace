// What the public sign-in screen says about the mill. Nothing here is written into the UI: the mill name and date come from
// the settings table, and the featured lot's trace chain is worked out from that lot's real runs, tests, packing and dispatches.
import type { DB } from '../db';
import { getSettings } from '../db';
import { LotData, judgeTestValues, type LotBundle } from './lots';
import { MasterBook } from './masters';

type Row = Record<string, unknown>;
export type ChainState = 'done' | 'warn' | 'todo';
export interface ChainStep { key: string; label: string; state: ChainState }
export interface DemoContext {
  millName: string;
  businessDate: string;
  lot: null | { id: string; lotNo: string; countDisplay: string; quote: string; steps: ChainStep[]; deviation: string | null };
}

/** Six links of the traceability chain, each judged from the lot's own records (red = outside the master it was judged against). */
function assess(b: LotBundle, book: MasterBook): { steps: ChainStep[]; reds: number } {
  const countId = String(b.lot.count_id);
  const redIn = (tests: Row[]) => tests.flatMap((t) => judgeTestValues(book, countId, t, 'asOf')).filter((j) => j.color === 'red').length;
  const machineTests = b.tests.filter((t) => t.sample_type === 'MACHINE');
  const lotTests = b.tests.filter((t) => t.sample_type === 'LOT');
  const mRed = redIn(machineTests); const lRed = redIn(lotTests);
  const steps: ChainStep[] = [
    { key: 'BALE', label: 'Bale', state: b.runs.some((r) => r.stage === 'BALE') ? 'done' : 'todo' },
    { key: 'MIX', label: 'Mix', state: b.mix ? 'done' : 'todo' },
    { key: 'MACHINE', label: 'Machine', state: !machineTests.length ? 'todo' : mRed ? 'warn' : 'done' },
    { key: 'TEST', label: 'Test', state: !lotTests.length ? 'todo' : lRed ? 'warn' : 'done' },
    { key: 'PACK', label: 'Packing', state: !b.packing ? 'todo' : Number(b.packing.color_ok) ? 'done' : 'warn' },
    { key: 'DISPATCH', label: 'Dispatch', state: b.dispatches.length ? 'done' : 'todo' },
  ];
  return { steps, reds: mRed + lRed };
}

// The sign-in screen is public and loaded on every visit, so the lot assessment is cached briefly per database. The key includes the
// settings it depends on, so editing the mill name, featured lot or quote shows up straight away.
const TTL_MS = 30_000;
const cache = new WeakMap<DB, { key: string; at: number; value: DemoContext }>();

export async function demoContext(db: DB): Promise<DemoContext> {
  const settings = await getSettings(db);
  const key = [settings.millName, settings.businessDate, settings.demoLot ?? '', settings.loginQuote ?? ''].join('|');
  const hit = cache.get(db);
  if (hit && hit.key === key && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await build(db, settings);
  cache.set(db, { key, at: Date.now(), value });
  return value;
}

async function build(db: DB, settings: Awaited<ReturnType<typeof getSettings>>): Promise<DemoContext> {
  const base = { millName: settings.millName, businessDate: settings.businessDate };
  const book = await MasterBook.load(db);
  // the featured lot is a setting; without one, fall back to the dispatched lot with the most out-of-master readings
  let data = settings.demoLot ? await LotData.load(db, [settings.demoLot]) : null;
  if (!data || !data.lots.size) data = await LotData.load(db);
  let pick: { b: LotBundle; steps: ChainStep[] } | null = null;
  if (settings.demoLot && data.lots.has(settings.demoLot)) {
    const b = data.lots.get(settings.demoLot) as LotBundle; pick = { b, steps: assess(b, book).steps };
  } else {
    let best = -1;
    for (const b of data.lots.values()) {
      const a = assess(b, book); const score = (b.dispatches.length ? 1000 : 0) + a.reds;
      if (score > best) { best = score; pick = { b, steps: a.steps }; }
    }
  }
  if (!pick) return { ...base, lot: null };
  const { b, steps } = pick;
  const lotNo = String(b.lot.lot_no);
  const broken = steps.find((s) => s.state === 'warn');
  return {
    ...base,
    lot: {
      id: String(b.lot.id), lotNo, countDisplay: String(b.count?.display ?? ''), steps, deviation: broken ? broken.label : null,
      quote: settings.loginQuote || `lot ${lotNo} doesn’t look right`,
    },
  };
}
