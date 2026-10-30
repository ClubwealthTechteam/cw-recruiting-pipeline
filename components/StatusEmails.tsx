'use client';
import { useAction } from './useAction';

export type StatusEmail = {
  id: string; type: string; to: string; subject: string; body?: string; status: string;
  queuedAt: string; queuedBy: string; decidedBy?: string; decidedAt?: string; sentAt?: string; error?: string;
};

const NAME: Record<string, string> = { Hired: 'Hired email', Rejected: 'Rejected email', Benched: 'Benched email', Onboarding: 'Onboarding email' };

/** One status email waiting for approval: who it goes to, the exact email, and Approve & send / Don't send. */
export function PendingStatusEmail({ e, name }: { e: StatusEmail; name?: string }) {
  const { run, busy, error } = useAction();
  return (
    <div className="approval">
      <div className="approval-head">
        <strong>{NAME[e.type] || e.type} ready to send — waiting for approval</strong>
        {name && <span className="muted"> · {name}</span>}
        <span className="muted"> · queued by {e.queuedBy} {e.queuedAt.slice(0, 16)}</span>
      </div>
      <dl className="fields approval-meta">
        <dt>From</dt><dd>CareersCW@clubwealth.com</dd>
        <dt>To</dt><dd>{e.to}</dd>
        <dt>Subject</dt><dd>{e.subject}</dd>
      </dl>
      {/* the exact HTML that will be sent, isolated from the page */}
      <iframe className="approval-preview" title={`${e.type} email preview`} sandbox="" srcDoc={e.body || ''} />
      <div className="add-actions">
        <button className="btn primary" disabled={busy}
          onClick={() => confirm(`Send the ${NAME[e.type] || e.type} to ${e.to} from CareersCW now?`) && run({ action: 'approveEmail', emailId: e.id }, { success: `${NAME[e.type] || e.type} approved ✓ (sends within 5 minutes)` })}>
          Approve &amp; send
        </button>
        <button className="btn ghost" disabled={busy}
          onClick={() => confirm("Don't send this email? It will be cancelled.") && run({ action: 'skipEmail', emailId: e.id }, { success: 'Email cancelled' })}>
          Don&apos;t send
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}

/** The log of status emails on a profile: queued, approved, cancelled and sent, with who and when. */
export function StatusEmailLog({ emails }: { emails: StatusEmail[] }) {
  if (!emails.length) return <p className="muted">No Hired, Rejected or Benched emails yet. Moving to Hired, Onboarded, Not Fit or Benched prepares one for approval.</p>;
  return (
    <ul className="timeline">
      {emails.map((e) => (
        <li key={e.id}>
          <span className="when">{e.queuedAt.slice(0, 16)}</span> {NAME[e.type] || e.type} prepared by {e.queuedBy}
          {e.status === 'Pending approval' && <span className="badge amber">Waiting for approval</span>}
          {e.status === 'Cancelled' && <span className="muted"> · cancelled{e.decidedBy ? ` by ${e.decidedBy}` : ''}{e.decidedAt ? ` ${e.decidedAt.slice(0, 16)}` : ''}{e.error ? ` (${e.error})` : ''}</span>}
          {(e.status === 'Queued' || e.status === 'Sent') && e.decidedBy && <span className="muted"> · approved by {e.decidedBy} {String(e.decidedAt || '').slice(0, 16)}</span>}
          {e.status === 'Queued' && <span className="muted"> · sending…</span>}
          {e.status === 'Sent' && <span className="muted"> · sent {String(e.sentAt || '').slice(0, 16)}</span>}
          {e.status === 'Failed' && <span className="error"> · failed: {e.error}</span>}
        </li>
      ))}
    </ul>
  );
}
