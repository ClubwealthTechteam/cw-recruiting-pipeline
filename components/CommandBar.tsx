'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

export type CommandItem = { id: string; name: string; position: string; stage: string };
const PAGES = [
  { label: 'Dashboard', href: '/' }, { label: 'Candidates', href: '/candidates' }, { label: 'Pipeline board', href: '/board' },
  { label: "This Week's Session", href: '/session' }, { label: 'Talent pool', href: '/talent' }, { label: 'Reports', href: '/reports' },
  { label: 'Needs Attention', href: '/attention' }
];

/** Ctrl+K (or ⌘K): type a name or a page and press Enter to jump there. */
export default function CommandBar({ people }: { people: CommandItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); setQ(''); setSel(0); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pages = PAGES.filter((p) => !t || p.label.toLowerCase().includes(t)).map((p) => ({ key: p.href, label: p.label, note: 'Page', href: p.href }));
    const ppl = t ? people.filter((p) => `${p.name} ${p.position}`.toLowerCase().includes(t)).slice(0, 8)
      .map((p) => ({ key: p.id, label: p.name || '(no name)', note: `${p.position} · ${p.stage}`, href: `/candidates/${encodeURIComponent(p.id)}` })) : [];
    return [...ppl, ...pages].slice(0, 12);
  }, [q, people]);

  if (!open) return null;
  const go = (href: string) => { setOpen(false); router.push(href); };
  return (
    <div className="cmd-wrap" onClick={() => setOpen(false)}>
      <div className="cmd" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Jump to">
        <input ref={input} value={q} placeholder="Type a name or a page…" onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(x + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
            if (e.key === 'Enter' && results[sel]) go(results[sel].href);
          }} />
        <ul>
          {results.map((r, i) => (
            <li key={r.key} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => go(r.href)}>
              <span>{r.label}</span><span className="muted small">{r.note}</span>
            </li>
          ))}
          {results.length === 0 && <li className="muted">No matches</li>}
        </ul>
        <div className="hint">↑ ↓ to choose · Enter to open · Esc to close</div>
      </div>
    </div>
  );
}
