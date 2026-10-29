import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { Loader2, Package, Search, X } from 'lucide-react';
import { useGet } from '../../lib/api';
import { fmtD } from '../../lib/fmt';
import type { LotSearchHit } from './types';

function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Big friendly lot-number search for the customer's own lots (also matches invoice and vehicle numbers). */
export function LotSearch({ value, onChange, onPick, onSubmit, testId, placeholder = 'Type your lot number, e.g. 101', autoFocus, ariaLabel = 'Lot number' }: {
  value: string; onChange: (text: string) => void; onPick: (hit: LotSearchHit) => void; onSubmit?: (text: string) => void; testId?: string; placeholder?: string; autoFocus?: boolean; ariaLabel?: string;
}): JSX.Element {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = useDebounced(value.trim().replace(/^lot[\s-]*/i, ''));
  const search = useGet<LotSearchHit[]>(q ? `/api/portal/lot-search?q=${encodeURIComponent(q)}` : null, { placeholderData: keepPreviousData });
  const hits = q ? search.data ?? [] : [];
  useEffect(() => { setActive(-1); }, [q]);

  const pick = (h: LotSearchHit) => { setOpen(false); setActive(-1); onPick(h); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && hits[active]) pick(hits[active]); else if (value.trim()) { setOpen(false); onSubmit?.(value.trim()); } }
  };
  const showList = open && value.trim().length > 0;

  return <div className="pt-search">
    <Search className="ico" size={20} aria-hidden />
    <input className="input" data-testid={testId} value={value} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" spellCheck={false} aria-label={ariaLabel}
      role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
      onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 140)} onKeyDown={onKey} />
    {value ? <button type="button" className="btn ghost icon clear" aria-label="Clear" onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false); }}>{search.isFetching ? <Loader2 size={18} className="spin" /> : <X size={18} />}</button> : null}
    {showList ? <div className="pt-suggest" id={listId} role="listbox" data-testid={testId ? `${testId}-results` : undefined}>
      {hits.map((h, i) => <button type="button" key={h.lotId} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setActive(i)}>
        <Package size={20} style={{ color: 'hsl(var(--primary))', flex: 'none' }} />
        <span className="grow"><span className="lotno">Lot {h.lotNo}</span> <span className="meta">· {h.countDisplay}</span><span className="meta" style={{ display: 'block' }}>Sent {fmtD(h.dispatchedAt)} · dispatch {h.dispatchNo}</span></span>
      </button>)}
      {!hits.length && !search.isFetching ? <div className="none">We could not find a lot that matches “{value.trim()}” among your deliveries. Please check the lot number on your carton label or invoice.</div> : null}
      {!hits.length && search.isFetching ? <div className="none">Searching…</div> : null}
    </div> : null}
  </div>;
}
