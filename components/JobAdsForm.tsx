'use client';
import { useState } from 'react';
import { useAction } from './useAction';
import { toast } from './Toaster';
import type { JobAd } from '@/lib/sheet';
import { formatDate } from '@/lib/pipeline';
import SendPreview, { type SendEdits } from './SendPreview';

type Stats = Record<string, { week: number; held: number; waiting: number; ids: string[] }>;

/** Same wording as the Apps Script fallback, used when no "Position on hold" template is saved. */
const FALLBACK = {
  subject: 'ClubWealth | Update on Your Application',
  body: "Dear [First Name],\n\nThank you for your interest in the [Position] role at Club Wealth and for the time and effort you put into your application. We truly appreciate it.\n\nWe'd like to let you know that this position is currently on hold. This is simply a matter of timing on our end, and we'll keep your application on file and reach out to you directly once it reopens, so there's no need to reapply.\n\nThank you for your patience, and we wish you all the best."
};

/**
 * Job Ads checklist: tick the ads that are running. Positions with an OnlineJobs.ph post that had applicants in the
 * last 14 days are listed too (Tara, 2026-11-10). Pausing an ad emails its Applied / Invited / Confirmed applicants
 * the saved "Position on hold" template, after asking with the count.
 */
export default function JobAdsForm({ ads, stats, template }: { ads: JobAd[]; stats: Stats; template?: { subject: string; body: string } }) {
  const tpl = template && template.body.trim() ? template : FALLBACK;
  const [preview, setPreview] = useState(false);
  const [active, setActive] = useState(ads.filter((a) => a.active).map((a) => a.position));
  const { run, busy } = useAction();
  const changed = ads.some((a) => a.active !== active.includes(a.position));
  const pausing = ads.filter((a) => a.active && !active.includes(a.position));
  const ids = pausing.flatMap((a) => stats[a.position]?.ids || []);
  // Pausing someone's position: see the "Position on hold" email for each of them first (Miguel, 2026-11-10)
  function save() {
    if (ids.length) { setPreview(true); return; }
    void commit();
  }
  async function commit(edits?: SendEdits) {
    setPreview(false);
    const wording = { text: edits?.text ?? tpl.body, subject: edits?.subject || tpl.subject };
    const r = await run({ action: 'setActivePositions', active, shown: ads.map((a) => a.position), ...(ids.length ? wording : {}) }, { success: 'Job ads saved ✓' });
    if (r && typeof r === 'object') {
      const d = r as { emailed?: number; olj?: number; skipped?: string[] };
      const sent = (d.emailed || 0) + (d.olj || 0);
      if (sent || d.skipped?.length) toast(`"Position on hold" queued for ${sent} (${d.emailed || 0} email, ${d.olj || 0} OLJ)${d.skipped?.length ? ` · ${d.skipped.length} skipped` : ''}`);
    }
  }
  return (
    <section className="panel" data-tour="job-ads">
      {preview && ids[0] && (
        <SendPreview req={{ kind: 'reply', id: ids[0], text: tpl.body, subject: tpl.subject, channel: 'email' }} ids={ids} count={ids.length}
          title={`Pause ${pausing.map((a) => a.position).join(', ')}: "Position on hold" email`} onClose={() => setPreview(false)} onSend={(e) => commit(e)} />
      )}
      <table className="table">
        <thead><tr><th style={{ width: 90 }}>Active</th><th>Job ad (position)</th><th>On OnlineJobs.ph</th><th>Applied, last 7 days</th><th>Waiting (ad paused)</th></tr></thead>
        <tbody>
          {ads.map((a) => {
            const on = active.includes(a.position);
            return (
              <tr key={a.position}>
                <td><label className="check-label"><input type="checkbox" checked={on} onChange={() => setActive((x) => (on ? x.filter((p) => p !== a.position) : [...x, a.position]))} /> {on ? 'Active' : 'Paused'}</label></td>
                <td><b>{a.position}</b>{a.open === false && <div className="muted small">Not invited automatically (not one of the open positions)</div>}</td>
                <td>{a.oljPosts?.length ? <>{a.oljPosts.map((t) => <div key={t} className="small">{t}</div>)}<div className="muted small">Last applicant {formatDate(a.oljLast || '')}</div></> : <span className="muted">—</span>}</td>
                <td>{stats[a.position]?.week ?? 0}</td>
                <td>{stats[a.position]?.held ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button className="btn primary" disabled={!changed || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <span className="hint">Paused: new applicants for that position still come in and are screened, but are not invited. Applied, Invited and Confirmed applicants get the saved &quot;Position on hold&quot; email once. Ticking it again does not email anyone.</span>
      </p>
    </section>
  );
}
