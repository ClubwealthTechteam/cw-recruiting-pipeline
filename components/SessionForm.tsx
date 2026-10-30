'use client';
import { useState } from 'react';
import { upcomingSessions, formatDate } from '@/lib/pipeline';
import { useAction } from './useAction';

/**
 * Moves one or more applicants to another Wednesday session. Emails still queued for the old date are cancelled.
 * A new invite for the new date goes out only when the box is ticked.
 */
export default function SessionForm({ ids, current, onDone, compact = false }: { ids: string[]; current?: string; onDone?: () => void; compact?: boolean }) {
  const [date, setDate] = useState('');
  const [invite, setInvite] = useState(false);
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  const options = upcomingSessions(8).filter((d) => d !== current);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    const who = ids.length > 1 ? `${ids.length} applicants` : 'this applicant';
    if (invite && !confirm(`Move ${who} to Wednesday, ${formatDate(date)} and send them a new invite?`)) return;
    const r = await run({ action: 'moveSession', ids, date, sendInvite: invite, reason });
    if (r) { setDate(''); setInvite(false); setReason(''); onDone?.(); }
  }
  return (
    <form onSubmit={submit} className="inline-form">
      <select value={date} onChange={(e) => setDate(e.target.value)} disabled={!ids.length || busy} aria-label="Session">
        <option value="">{compact ? 'Session…' : 'Move to session…'}</option>
        {options.map((d) => <option key={d} value={d}>Wed, {formatDate(d)} · 2:00 PM PT</option>)}
      </select>
      {date && !compact && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />}
      {date && <label className="check-label"><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Send new invite</label>}
      <button className="btn" disabled={!date || busy}>{busy ? 'Saving…' : 'Move'}</button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}
