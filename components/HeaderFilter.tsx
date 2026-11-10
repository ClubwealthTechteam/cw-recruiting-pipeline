'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type FilterOption = { value: string; label: string };
export type ColumnFilter = { param: string; options: FilterOption[]; dates?: boolean; defaultValue?: string; noAll?: boolean };

/**
 * A spreadsheet-style filter on a column header (Miguel, 2026-11-10): click ▾, pick a value. The choice is kept in the
 * address bar like the other filters, so saved views and links keep it. Applied also takes a date range.
 */
export default function HeaderFilter({ label, filter, title }: { label: string; filter: ColumnFilter; title?: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = params.get(filter.param) || filter.defaultValue || '';
  const [from, setFrom] = useState(params.get('from') || '');
  const [to, setTo] = useState(params.get('to') || '');
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  function go(value: string, extra: Record<string, string> = {}) {
    const u = new URLSearchParams(params.toString());
    u.delete('page');
    if (value) u.set(filter.param, value); else u.delete(filter.param);
    if (filter.dates) { u.delete('from'); u.delete('to'); }
    for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v);
    setOpen(false);
    router.push(`${path}?${u.toString()}`);
  }
  const active = !!current && current !== filter.defaultValue;
  const shown = filter.options.find((o) => o.value === current)?.label;
  return (
    <div className="hf" ref={box}>
      <button type="button" className={`hf-btn${active ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} title={active ? `Filtered: ${shown || current}` : title || `Filter by ${label}`} aria-expanded={open}>
        {label}<span className="hf-caret" aria-hidden="true">{active ? '●' : '▾'}</span>
      </button>
      {open && (
        <div className="hf-menu" role="menu">
          {!filter.noAll && <button type="button" className={!current ? 'on' : ''} onClick={() => go('')}>All</button>}
          {filter.options.map((o) => (
            <button type="button" key={o.value} className={current === o.value ? 'on' : ''} onClick={() => (o.value === 'custom' ? null : go(o.value))}
              style={o.value === 'custom' ? { cursor: 'default', fontWeight: 600 } : undefined}>{o.label}</button>
          ))}
          {filter.dates && (
            <div className="hf-dates">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              <span className="muted small">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              <button type="button" className="btn small-btn primary" disabled={!from && !to} onClick={() => go('custom', { from, to })}>Apply</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
