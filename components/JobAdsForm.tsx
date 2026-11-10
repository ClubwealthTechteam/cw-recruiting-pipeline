'use client';
import { useState } from 'react';
import { useAction } from './useAction';

/** Job Ads checklist: tick the ads that are running. Applicants for an unticked ad are screened but not invited. */
export default function JobAdsForm({ ads, stats }: { ads: { position: string; active: boolean }[]; stats: Record<string, { week: number; held: number }> }) {
  const [active, setActive] = useState(ads.filter((a) => a.active).map((a) => a.position));
  const { run, busy } = useAction();
  const changed = ads.some((a) => a.active !== active.includes(a.position));
  return (
    <section className="panel" data-tour="job-ads">
      <table className="table">
        <thead><tr><th style={{ width: 90 }}>Active</th><th>Job ad (position)</th><th>Applied, last 7 days</th><th>Waiting (ad paused)</th></tr></thead>
        <tbody>
          {ads.map((a) => {
            const on = active.includes(a.position);
            return (
              <tr key={a.position}>
                <td><label className="check-label"><input type="checkbox" checked={on} onChange={() => setActive((x) => (on ? x.filter((p) => p !== a.position) : [...x, a.position]))} /> {on ? 'Active' : 'Paused'}</label></td>
                <td><b>{a.position}</b></td>
                <td>{stats[a.position]?.week ?? 0}</td>
                <td>{stats[a.position]?.held ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button className="btn primary" disabled={!changed || busy} onClick={() => run({ action: 'setActivePositions', active }, { success: 'Job ads saved ✓' })}>{busy ? 'Saving…' : 'Save'}</button>
        <span className="hint">Paused: new applicants for that position still come in and are screened, but are not invited automatically. They show &quot;Job ad paused&quot; in Candidates.</span>
      </p>
    </section>
  );
}
