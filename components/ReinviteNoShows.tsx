'use client';
import { useState } from 'react';
import { upcomingSessions, formatDate } from '@/lib/pipeline';
import { useAction } from './useAction';
import SendPreview from './SendPreview';

/**
 * After a session: everyone who was No Show or No Confirmation goes to Open for re-invite on the chosen Wednesday
 * and gets the invite for it (email, or OLJ for OLJ applicants). Asks first, with the count.
 */
export default function ReinviteNoShows({ session, count, sampleId }: { session: string; count: number; sampleId?: string }) {
  const options = upcomingSessions(6).filter((d) => d > session);
  const [date, setDate] = useState(options[0] || '');
  const { run, busy, error } = useAction();
  const [done, setDone] = useState('');
  const [preview, setPreview] = useState(false);
  function ask() {
    if (!date) return;
    if (sampleId) { setPreview(true); return; }
    if (confirm(`Re-invite ${count} ${count === 1 ? 'person' : 'people'} (No Show / No Confirmation) to Wednesday, ${formatDate(date)}? Each gets the pre-interview invite.`)) void go();
  }
  async function go() {
    setPreview(false);
    const r = await run({ action: 'reinviteNoShows', session, date });
    if (r) setDone(`${Number(r.reinvited) + Number(r.olj)} re-invited (${r.reinvited} by email, ${r.olj} on OLJ)${Array.isArray(r.skipped) && r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`);
  }
  if (!count) return null;
  return (
    <div className="inline-form" data-tour="reinvite">
      {preview && sampleId && <SendPreview req={{ kind: 'reinvite', id: sampleId, date }} count={count} title={`Re-invite to Wednesday, ${formatDate(date)}`} onClose={() => setPreview(false)} onSend={go} />}
      <strong>{count} No Show / No Confirmation</strong>
      <select value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} aria-label="Re-invite to">
        {options.map((d) => <option key={d} value={d}>Wed, {formatDate(d)}</option>)}
      </select>
      <button className="btn primary" disabled={busy || !date} onClick={ask}>{busy ? 'Re-inviting…' : 'Re-invite no-shows'}</button>
      {done && <span className="hint">{done}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
