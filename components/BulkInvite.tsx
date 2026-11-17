'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SendPreview, { type SendEdits } from './SendPreview';
import type { CandidateRow } from './CandidatesTable';

/**
 * "Send invites" for the applicants selected on Candidates (Miguel, 2026-11-17): the real pre-interview invite for
 * the next Wednesday, one applicant at a time, exactly as the profile's Invite button does it, so each person gets
 * the interview date, turns Invited when it is sent, gets the Wednesday reminder once confirmed, and is matched in
 * Zoom. Email applicants get the email (preview and pencil first); OnlineJobs.ph applicants get the OLJ invite. The
 * CRM refuses anyone already invited for that Wednesday, on the Rejected tab, or with invites paused, and says why.
 */
type Result = { name: string; ok: boolean; why?: string; channel: 'email' | 'olj' };

const skipWhy = (r: CandidateRow) =>
  r.test ? 'test applicant' :
  r.tags?.includes('Position on hold') ? 'position on hold' :
  r.tags?.includes('Invites paused') ? 'invites paused' :
  ['Invited', 'Confirmed'].includes(r.stage) ? `already ${r.stage}` :
  r.hold ? `held back: ${r.hold}` :
  r.source !== 'OLJ' && !r.email ? 'no email address' : '';

export default function BulkInvite({ rows, onDone }: { rows: CandidateRow[]; onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  const ready = rows.filter((r) => !skipWhy(r));
  const skipped = rows.filter((r) => skipWhy(r));
  const emailRows = ready.filter((r) => r.source !== 'OLJ');
  const oljRows = ready.filter((r) => r.source === 'OLJ');

  async function sendAll(edits?: SendEdits) {
    setPreview(false);
    const list = [...emailRows.map((r) => ({ r, channel: 'email' as const })), ...oljRows.map((r) => ({ r, channel: 'olj' as const }))];
    const out: Result[] = skipped.map((r) => ({ name: r.name, ok: false, why: skipWhy(r), channel: r.source === 'OLJ' ? 'olj' : 'email' }));
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      const { r, channel } = list[i];
      try {
        const res = await fetch('/api/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sendInvite', id: r.id, channel, ...(channel === 'email' && edits?.edited ? { edited: edits.edited } : {}) }),
        });
        const j = await res.json().catch(() => ({}));
        out.push(j.ok ? { name: r.name, ok: true, channel } : { name: r.name, ok: false, why: String(j.error || `error ${res.status}`), channel });
      } catch {
        out.push({ name: r.name, ok: false, why: 'could not reach the CRM', channel });
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    setResults(out);
    router.refresh();
  }

  if (!rows.length) return null;
  const sent = results?.filter((x) => x.ok) || [];
  const notSent = results?.filter((x) => !x.ok) || [];
  return (
    <>
      <button type="button" className="btn primary" onClick={() => { setResults(null); setOpen(true); }}>Send invites ({rows.length})</button>
      {open && !preview && (
        <div className="modal-wrap" onClick={() => !progress && setOpen(false)}>
          <div className="modal" role="dialog" aria-label="Send pre-interview invites" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><b>Send pre-interview invites</b><div className="muted small">The real invite for the next Wednesday session, the same as each profile&apos;s Invite button.</div></div>
            <div className="modal-body">
              {progress && <p><b>Sending… {progress.done} of {progress.total}</b><br /><span className="muted small">Keep this tab open until it finishes.</span></p>}
              {!progress && !results && (
                <>
                  <ul>
                    <li><b>{emailRows.length}</b> by email{emailRows.length ? ' (you will see the email first)' : ''}</li>
                    {oljRows.length > 0 && <li><b>{oljRows.length}</b> on OnlineJobs.ph (the OLJ invite)</li>}
                    {skipped.length > 0 && <li><b>{skipped.length}</b> skipped: {skipped.slice(0, 8).map((r) => `${r.name} (${skipWhy(r)})`).join(', ')}{skipped.length > 8 ? `, +${skipped.length - 8} more` : ''}</li>}
                  </ul>
                  <p className="hint">Emails go out about 6 every 5 minutes. Anyone already invited for that Wednesday, on the Rejected tab, or with invites paused is refused by the CRM and listed at the end.</p>
                </>
              )}
              {results && (
                <>
                  <p><b>{sent.length} invite(s) queued</b>{sent.length ? ` (${sent.filter((x) => x.channel === 'email').length} email, ${sent.filter((x) => x.channel === 'olj').length} OLJ)` : ''}.</p>
                  {notSent.length > 0 && <><p><b>{notSent.length} not sent:</b></p><ul className="small">{notSent.map((x, i) => <li key={i}>{x.name}: {x.why}</li>)}</ul></>}
                </>
              )}
            </div>
            <div className="modal-foot">
              {!progress && !results && <>
                <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
                {emailRows.length > 0
                  ? <button className="btn primary" onClick={() => setPreview(true)}>Preview the email</button>
                  : <button className="btn primary" disabled={!oljRows.length} onClick={() => sendAll()}>Send {oljRows.length} OLJ invite(s)</button>}
              </>}
              {results && <button className="btn primary" onClick={() => { setOpen(false); onDone(); }}>Done</button>}
            </div>
          </div>
        </div>
      )}
      {open && preview && (
        <SendPreview req={{ kind: 'invite', id: emailRows[0].id, channel: 'email' }} ids={emailRows.map((r) => r.id)} count={emailRows.length + oljRows.length}
          title={`Pre-interview invite to ${emailRows.length} by email${oljRows.length ? ` and ${oljRows.length} on OLJ` : ''}`}
          onClose={() => setPreview(false)} onSend={(e) => sendAll(e)} />
      )}
    </>
  );
}
