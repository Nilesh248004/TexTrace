import type { Judged } from '@shared/domain';
import { J } from '../ui';
import { downloadCsv, devText, fmtN, rangeText, verText, StatusText } from './util';

/** "Actual vs master vs deviation" table for a list of judged values (one machine run, the mix fibre, the packing checks…). */
export function MasterTable({ items, showPlain = false, testId }: { items: Judged[]; showPlain?: boolean; testId?: string }): JSX.Element {
  return <div className="tbl-wrap">
    <table className="tbl dense" data-testid={testId}>
      <thead><tr><th>Parameter</th><th>Unit</th><th className="num">Actual</th><th className="num">Master std</th><th>Lower – upper</th><th className="num">Deviation</th><th>Master</th><th>Status</th></tr></thead>
      <tbody>
        {items.map((j) => <tr key={j.key}>
          <td title={j.plain || undefined}><b>{j.label}</b>{showPlain && j.plain ? <span className="pp-sub">{j.plain}</span> : null}</td>
          <td className="muted">{j.unit || '—'}</td>
          <td className="num"><J j={j} plain /></td>
          <td className="num">{j.std === null ? '—' : fmtN(j.std, j.decimals)}</td>
          <td>{rangeText(j)}</td>
          <td className={`num pp-dev ${j.color}`}>{devText(j)}{j.side && j.color !== 'green' ? <span className="muted tiny"> {j.side}</span> : null}</td>
          <td title={j.versionId ?? undefined}>{verText(j)}</td>
          <td><StatusText j={j} /></td>
        </tr>)}
        {items.length === 0 ? <tr><td colSpan={8} className="center muted" style={{ padding: 16 }}>No parameters recorded.</td></tr> : null}
      </tbody>
    </table>
  </div>;
}

export function masterRows(items: Judged[], lead: (string | number | null)[] = []): (string | number | null)[][] {
  return items.map((j) => [...lead, j.label, j.unit, j.value, j.std, j.lower, j.upper, j.deviation === null ? null : Number(j.deviation.toFixed(4)), j.deviationPct === null ? null : Number(j.deviationPct.toFixed(2)), j.versionNo ? `v${j.versionNo}` : '', j.text]);
}
export const MASTER_HEAD = ['Parameter', 'Unit', 'Actual', 'Master std', 'Lower', 'Upper', 'Deviation', 'Deviation %', 'Master version', 'Status'];
export const exportMaster = (filename: string, items: Judged[], leadHead: string[] = [], lead: (string | number | null)[] = []): void => downloadCsv(filename, [[...leadHead, ...MASTER_HEAD], ...masterRows(items, lead)]);
