'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAction } from './useAction';

type View = { name: string; query: string; by?: string };

/** Ready-made views everyone gets, plus views the team saved (shared by Am, Camille and Miguel). */
const BUILT_IN: View[] = [
  { name: 'Great & Good fits', query: 'stage=Active&fit=Great' },
  { name: 'Awaiting review', query: 'stage=Interview+Completed' },
  { name: 'Scored: suggested Passed', query: 'stage=Interview+Completed&score=Passed' },
  { name: 'Not rated yet', query: 'stage=Active&fit=Not+screened' }
];

const same = (a: string, b: string) => {
  const norm = (q: string) => [...new URLSearchParams(q).entries()].filter(([k, v]) => v && k !== 'page').sort().map(([k, v]) => `${k}=${v}`).join('&');
  return norm(a) === norm(b);
};

export default function SavedViews({ views }: { views: View[] }) {
  const path = usePathname();
  const params = useSearchParams();
  const current = params.toString();
  const { run, busy } = useAction();
  async function save() {
    const name = prompt('Name this view (e.g. "Great-fit ISA this week"):')?.trim();
    if (name) await run({ action: 'saveView', name, query: current }, { success: `View "${name}" saved ✓` });
  }
  return (
    <div className="views-bar">
      <span className="muted small">Views:</span>
      {[...BUILT_IN, ...views].map((v) => (
        <span key={v.name} className={`chip ${same(v.query, current) ? 'active' : ''}`}>
          <Link href={`${path}?${v.query}`} title={v.by ? `Saved by ${v.by}` : 'Built in'}>{v.name}</Link>
          {v.by && <button type="button" aria-label={`Remove view ${v.name}`} disabled={busy}
            onClick={() => confirm(`Remove the view "${v.name}" for everyone?`) && run({ action: 'deleteView', name: v.name })}>×</button>}
        </span>
      ))}
      <button type="button" className="btn ghost small-btn" disabled={busy || !current} onClick={save} title={current ? '' : 'Pick some filters first'}>+ Save this view</button>
    </div>
  );
}
