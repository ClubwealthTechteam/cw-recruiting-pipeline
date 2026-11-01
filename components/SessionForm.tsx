'use client';
import { useState } from 'react';
import { upcomingSessions, formatDate } from '@/lib/pipeline';
import { useAction } from './useAction';
import SendPreview from './SendPreview';

/**
 * Moves one or more applicants to another Wednesday session. Emails still queued for the old date are cancelled.
 * A new invite for the new date goes out only when the box is ticked.
 */
export default function SessionForm({ ids, current, onDone, compact = false }: { ids: string[]; current?: string; onDone?: () => void; compact?: boolean }) {
  const [date, setDate] = useState('');
  const [invite, setInvite] = useState(false);
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  const [preview, setPreview] = useState(false);
  const options = upcomingSessions(8).filter((d) => d !== current);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    if (invite) { setPreview(true); return; } // see the invite (and the count) before it goes out
    await move();
  }
  async function move() {
    setPreview(false);
    const r = await run({ action: 'moveSession', ids, date, sendInvite: invite, reason });
    if (r) { setDate(''); setInvite(false); setReason(''); onDone?.(); }
  }
  return (
    <form onSubmit={submit} className="inline-form">
      {preview && ids[0] && <SendPreview req={{ kind: 'reinvite', id: ids[0], date }} count={ids.length} title={`Move to Wednesday, ${formatDate(date)} and send a new invite`} onClose={() => setPreview(false)} onSend={move} />}
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
