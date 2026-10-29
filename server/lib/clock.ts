// Demo clock. The business date is 28 Oct 2026 and seed data is generated relative to it, so the server clock starts at the
// seed time and runs forward in real time. It never runs behind the ledger head (ledger time is monotonic), so a restart
// after live actions resumes after the newest block instead of rewinding.
import type { DB } from '../db';
import { config } from '../config';
import { istDate } from '@shared/format';

let anchorMs = Date.parse(config.seedNowIso);
let bootWall = Date.now();
let floorMs = 0;

export async function initClock(db: DB): Promise<void> {
  const settings = await db.prepare(`SELECT value FROM settings WHERE key='nowIso'`).get<{ value: string }>();
  const seeded = settings ? Date.parse(JSON.parse(settings.value) as string) : NaN;
  if (Number.isFinite(seeded)) anchorMs = seeded;
  bootWall = Date.now();
  const head = await db.prepare('SELECT timestamp FROM ledger_blocks ORDER BY number DESC LIMIT 1').get<{ timestamp: string }>();
  floorMs = head ? Date.parse(head.timestamp) : 0;
}

/** Called after a commit so the clock stays ahead of the ledger. */
export function noteLedgerTime(iso: string): void {
  const ms = Date.parse(iso);
  if (Number.isFinite(ms) && ms > floorMs) floorMs = ms;
}

export function nowMs(): number {
  const running = anchorMs + (Date.now() - bootWall);
  return Math.max(running, floorMs + 1000);
}
export function nowIso(): string {
  return new Date(nowMs()).toISOString();
}
/** Business date (IST) of the demo clock. */
export function today(): string {
  return istDate(nowIso());
}
