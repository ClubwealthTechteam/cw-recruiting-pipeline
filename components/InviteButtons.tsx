'use client';
import { useState } from 'react';
import { useAction } from './useAction';

/** "Send invite via OLJ" / "Send invite via Email" for the applicant's next Wednesday session. */
export default function InviteButtons({ id, isOlj, hasEmail, emailReady }: { id: string; isOlj: boolean; hasEmail: boolean; emailReady: boolean }) {
  const { run, busy, error } = useAction();
  const [done, setDone] = useState('');
  async function send(channel: 'olj' | 'email') {
    const label = channel === 'olj' ? 'OnlineJobs.ph' : 'email';
    if (!confirm(`Send the pre-interview invite via ${label}?`)) return;
    const r = await run({ action: 'sendInvite', id, channel });
    if (r) {
      const day = new Date(`${r.session}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' });
      setDone(channel === 'olj'
        ? `Invite for Wednesday, ${day} queued on OLJ${r.started ? '. Sending now (about a minute).' : '. It goes out at the next OLJ run.'}`
        : `Invite for Wednesday, ${day} queued by email.`);
    }
  }
  return (
    <div className="invite-actions">
      <button className="btn primary" disabled={busy || !isOlj} onClick={() => send('olj')} title={isOlj ? '' : 'Only for applicants who came from OnlineJobs.ph'}>Send invite via OLJ</button>
      <button className="btn" disabled={busy || !hasEmail || !emailReady} onClick={() => send('email')}
        title={!emailReady ? 'Email is not connected yet (CareersCW in Zapier)' : !hasEmail ? 'No email address' : ''}>Send invite via Email</button>
      {!emailReady && <span className="hint">Email not connected yet.</span>}
      {done && <span className="hint">{done}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
