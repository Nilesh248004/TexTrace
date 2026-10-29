import type { Heatmap, HeatCell } from '@shared/domain';

/** Compact machine × day heatmap used on the owner dashboard (the full version lives in Analytics). */
export function MiniHeat({ data, onCell }: { data: Heatmap; onCell?: (c: HeatCell) => void }): JSX.Element {
  const cols = data.dates.length;
  const day = (d: string) => String(Number(d.slice(8)));
  return <div className="heat" style={{ gridTemplateColumns: `54px repeat(${cols}, minmax(14px, 1fr))` }} data-testid="mini-heat">
    <div />{data.dates.map((d) => <div key={d} className="hd" title={d}>{day(d)}</div>)}
    {data.machines.map((m) => <FragmentRow key={m.id} m={m} data={data} onCell={onCell} />)}
  </div>;
}
function FragmentRow({ m, data, onCell }: { m: { id: string; label: string }; data: Heatmap; onCell?: (c: HeatCell) => void }): JSX.Element {
  return <>
    <div className="rl">{m.label}</div>
    {data.dates.map((d) => { const c = data.cells.find((x) => x.machineId === m.id && x.date === d) as HeatCell; const title = c.value === null ? `${m.label} · ${d}: no sample` : `${m.label} · ${d}: ${data.label} ${c.value}${data.unit ? ` ${data.unit}` : ''} (${c.n} sample${c.n === 1 ? '' : 's'}) — ${c.color === 'green' ? 'within master' : c.color === 'yellow' ? 'warning' : 'out of limits'}`; return <div key={d} className={`cell ${c.color}`} style={{ height: 22, fontSize: 9 }} title={title} onClick={() => onCell?.(c)} role="button" aria-label={title} data-testid="mini-heat-cell">{c.value !== null && c.color !== 'green' ? (c.color === 'red' ? '✕' : '!') : ''}</div>; })}
  </>;
}
