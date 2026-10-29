// Dispatch quality gate: lot-level (composite) red results block dispatch unless QA recorded an override.
// Machine-level reds are reported as warnings. Judged against the master active on each test's date.
import type { DB } from '../db';
import type { GateItem, GateLotResult, GateResult } from '@shared/domain';
import { MasterBook } from './masters';

export async function evaluateGate(db: DB, lotIds: string[], checkedAt: string): Promise<GateResult> {
  const book = await MasterBook.load(db);
  const lots: GateLotResult[] = [];
  for (const lotId of lotIds) {
    const lot = await db.prepare('SELECT id,lot_no,count_id,qa_release_at FROM lots WHERE id=?').get<{ id: string; lot_no: string; count_id: string; qa_release_at: string | null }>(lotId);
    if (!lot) continue;
    const tests = await db.prepare('SELECT * FROM test_results WHERE lot_id=? ORDER BY tested_at DESC,id DESC').all<Record<string, unknown>>(lotId);
    const seen = new Set<string>();
    const red: GateItem[] = []; const yellow: GateItem[] = []; const machineRed: GateItem[] = [];
    for (const t of tests) {
      const stage = String(t.stage);
      const isLot = t.sample_type === 'LOT';
      if (isLot) { if (seen.has(stage)) continue; seen.add(stage); }
      const values = JSON.parse(String(t.values_json)) as Record<string, number>;
      for (const [key, value] of Object.entries(values)) {
        const j = book.judge(lot.count_id, 'QUALITY', stage as never, key, value, String(t.test_date));
        if (j.color !== 'red' && j.color !== 'yellow') continue;
        const item: GateItem = { stage: stage as never, parameter: key, label: j.label, value, std: j.std, lower: j.lower, upper: j.upper, color: j.color, testResultId: String(t.id), machineId: (t.machine_id as string | null) ?? null };
        if (!isLot) { if (j.color === 'red') machineRed.push(item); } else if (j.color === 'red') red.push(item); else yellow.push(item);
      }
    }
    const override = await db.prepare('SELECT id FROM qa_overrides WHERE lot_id=? ORDER BY created_at DESC LIMIT 1').get<{ id: string }>(lotId);
    lots.push({ lotId, lotNo: lot.lot_no, worst: red.length ? 'red' : yellow.length ? 'yellow' : 'green', redItems: red, yellowItems: yellow, machineLevelRed: machineRed, overrideId: override?.id ?? null, blocked: red.length > 0 && !override, released: !!lot.qa_release_at });
  }
  const blocked = lots.filter((l) => l.blocked);
  const warn = lots.reduce((s, l) => s + l.machineLevelRed.length, 0);
  return {
    passed: blocked.length === 0, overridden: lots.some((l) => !!l.overrideId && l.redItems.length > 0), checkedAt, lots,
    message: blocked.length ? `Quality gate blocked: lot ${blocked.map((l) => l.lotNo).join(', ')} has lot-level red results.` : warn ? `Quality gate passed with ${warn} machine-level warning(s).` : 'Quality gate passed.',
  };
}
