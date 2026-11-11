'use client';
import { useRef, useState } from 'react';
import { useAction } from './useAction';
import { toast } from './Toaster';

export type StatusEmail = {
  id: string; applicantId?: string; type: string; to: string; subject: string; body?: string; status: string;
  queuedAt: string; queuedBy: string; decidedBy?: string; decidedAt?: string; sentAt?: string; error?: string;
};

const NAME: Record<string, string> = { Hired: 'Hired email', Rejected: 'Rejected email', Benched: 'Benched email', Onboarding: 'Onboarding email', Reply: 'Email', 'Re-invite': 'Re-invite (asked to reschedule)' };

/** One status email waiting for approval: who it goes to, the exact email, and Approve & send / Don't send. */
export function PendingStatusEmail({ e, name }: { e: StatusEmail; name?: string }) {
  const { run, busy, error } = useAction();
  const [editing, setEditing] = useState(false);
  if (editing) return <EditStatusEmail e={e} onDone={() => setEditing(false)} />;
  return (
    <div className="approval">
      <div className="approval-head">
        <strong>{NAME[e.type] || e.type} ready to send — waiting for approval</strong>
        <AttachButton emailId={e.id} />
        <button type="button" className="btn small-btn edit-btn" onClick={() => setEditing(true)} title="Edit this email before it is sent">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          Edit
        </button>
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
          onClick={async () => {
            if (!confirm("Don't send this email? It is cancelled and the applicant goes back to the stage they had before (e.g. Hired → Passed Interview).")) return;
            const r = await run({ action: 'skipEmail', emailId: e.id }, { success: 'Email cancelled' });
            if (r && typeof r === 'object' && (r as { backTo?: string }).backTo) toast(`Moved back to ${(r as { backTo: string }).backTo} ✓`);
          }}>
          Don&apos;t send
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}

/** The log of status emails on a profile: queued, approved, cancelled and sent, with who and when. */
export function StatusEmailLog({ emails }: { emails: StatusEmail[] }) {
  if (!emails.length) return <p className="muted">No Hired, Rejected or Benched emails yet. Moving to Hired, Onboarding, Not Fit or Benched prepares one for approval.</p>;
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

/**
 * Edit a waiting email in place (Miguel, 2026-11-05): change the subject, and click into the email to change any
 * text, like a document. The banner stays; the edited email still needs Approve & send.
 */
function EditStatusEmail({ e, onDone }: { e: StatusEmail; onDone: () => void }) {
  const { run, busy, error } = useAction();
  const [subject, setSubject] = useState(e.subject.replace(/^\[TEST\] /, ''));
  const frame = useRef<HTMLIFrameElement>(null);
  // the email is shown in an isolated frame with no scripts; its document is made editable
  const onLoad = () => { const doc = frame.current?.contentDocument; if (doc) { doc.designMode = 'on'; doc.body.style.cssText = 'font:14px/1.5 Arial,sans-serif;margin:14px'; } };
  const cmd = (c: string, v?: string) => { frame.current?.contentDocument?.execCommand(c, false, v); frame.current?.contentWindow?.focus(); };
  async function save() {
    const body = frame.current?.contentDocument?.body.innerHTML || '';
    const ok = await run({ action: 'editPendingEmail', emailId: e.id, subject, body }, { success: 'Email changes saved ✓ (still waiting for approval)' });
    if (ok) onDone();
  }
  return (
    <div className="approval editing">
      <div className="approval-head"><strong>Editing the {NAME[e.type] || e.type}</strong> <span className="muted">· click into the email and type. Nothing is sent until Approve &amp; send.</span></div>
      <label className="edit-subject">Subject <input value={subject} onChange={(x) => setSubject(x.target.value)} /></label>
      <div className="edit-tools">
        <button type="button" className="btn small-btn" onClick={() => cmd('bold')}><b>B</b></button>
        <button type="button" className="btn small-btn" onClick={() => cmd('italic')}><i>I</i></button>
        <button type="button" className="btn small-btn" onClick={() => cmd('insertUnorderedList')}>• List</button>
        <button type="button" className="btn small-btn" onClick={() => { const u = prompt('Link address (https://…):')?.trim(); if (u && /^https?:\/\//.test(u)) cmd('createLink', u); }}>Link</button>
        <button type="button" className="btn small-btn" onClick={() => cmd('undo')}>Undo</button>
      </div>
      <iframe ref={frame} className="approval-preview edit-frame" title="Edit email" sandbox="allow-same-origin" srcDoc={e.body || ''} onLoad={onLoad} />
      <div className="add-actions">
        <button className="btn primary" disabled={busy || !subject.trim()} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button className="btn ghost" disabled={busy} onClick={onDone}>Cancel</button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}

/** Attach a file (PDF, Word, Excel, image or text, 3 MB max): saved in Drive, and a download link goes into the email. */
function AttachButton({ emailId }: { emailId: string }) {
  const { run, busy } = useAction();
  const input = useRef<HTMLInputElement>(null);
  async function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { toast('The file is larger than 3 MB.', 'error'); return; }
    const data = await new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => fail(new Error('Could not read the file.')); r.readAsDataURL(f); });
    const r = await run({ action: 'attachToEmail', emailId, file: { name: f.name, type: f.type, data } }, { success: `${f.name} attached ✓ (a download link is in the email)` });
    if (r && typeof r === 'object' && (r as { shared?: string }).shared === 'private') toast('Attached, but Drive did not allow sharing by link: the applicant may not be able to open it.', 'error');
    if (input.current) input.current.value = '';
  }
  return (
    <>
      <input ref={input} type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt" onChange={(x) => pick(x.target.files?.[0])} />
      <button type="button" className="btn small-btn edit-btn" disabled={busy} onClick={() => input.current?.click()} title="Attach a file to this email" data-tour="attach">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5" /></svg>
        {busy ? 'Attaching…' : 'Attach file'}
      </button>
    </>
  );
}
