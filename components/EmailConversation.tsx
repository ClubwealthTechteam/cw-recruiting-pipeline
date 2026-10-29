'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAction } from './useAction';
import type { ThreadItem } from '@/lib/sheet';

/**
 * Needs Attention: read the emails from someone who wrote to CareersCW but matched no applicant (for example a
 * reschedule request from a different email address), answer them from CareersCW, or link them to the applicant.
 */
export default function EmailConversation({ email, flagId, emailReady }: { email: string; flagId: string; emailReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ThreadItem[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [linkId, setLinkId] = useState('');
  const [saveEmail, setSaveEmail] = useState(true);
  const reply = useAction();
  const link = useAction();

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const r = await fetch(`/api/thread?email=${encodeURIComponent(email)}`).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || 'Could not load the emails');
      setThread(r.thread);
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load the emails'); }
  }, [email]);
  useEffect(() => { if (open && thread === null) load(); }, [open, thread, load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !confirm(`Send this email to ${email} from CareersCW?`)) return;
    if (await reply.run({ action: 'replyToEmail', email, text })) { setText(''); load(); }
  }
  async function doLink(e: React.FormEvent) {
    e.preventDefault();
    await link.run({ action: 'linkReply', email, flagId, applicantId: linkId.trim(), saveEmail }, { success: `Linked to ${linkId.trim()} ✓` });
  }

  if (!open) return <button type="button" className="btn small-btn" onClick={() => setOpen(true)}>Open emails &amp; reply</button>;
  return (
    <div className="inbox attention-inbox">
      <div className="msg-head"><strong>{email}</strong> <button type="button" className="btn ghost small-btn" onClick={() => setOpen(false)}>Close</button></div>
      <div className="thread">
        {loadError && <p className="error">{loadError}</p>}
        {thread === null && !loadError && <p className="muted">Loading emails…</p>}
        {thread?.length === 0 && <p className="muted">No emails found from this address.</p>}
        {thread?.map((m, i) => (
          <div key={i} className={`msg ${m.dir}`}>
            <div className="msg-head">
              {m.dir === 'in' ? 'Them' : m.by && !m.by.startsWith('System') ? m.by : 'Club Wealth'}
              <span className="muted"> · {String(m.at).slice(0, 16)}{m.status === 'Queued' ? ' · sending…' : ''}{m.subject ? ` · ${m.subject}` : ''}</span>
            </div>
            {m.text ? <div className="prewrap">{m.text}</div> : null}
          </div>
        ))}
      </div>
      <form className="stack-form" onSubmit={send}>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write an email reply… (the Club Wealth sign-off and banner are added for you)" />
        <button className="btn primary" disabled={reply.busy || !text.trim() || !emailReady}>{reply.busy ? 'Sending…' : 'Send email'}</button>
        {!emailReady && <span className="hint">Email sending is off.</span>}
        {reply.error && <span className="error">{reply.error}</span>}
      </form>
      <form className="inline-form" onSubmit={doLink}>
        <input value={linkId} onChange={(e) => setLinkId(e.target.value)} placeholder="Applicant ID, e.g. F-2512" aria-label="Applicant ID" />
        <label className="check-line"><input type="checkbox" checked={saveEmail} onChange={(e) => setSaveEmail(e.target.checked)} /> Save this email on them</label>
        <button className="btn" disabled={link.busy || !linkId.trim()}>{link.busy ? 'Linking…' : 'Link to applicant'}</button>
        {link.error && <span className="error">{link.error}</span>}
      </form>
      <p className="hint">Linking files these emails under the applicant, so you can re-invite them from their profile (Open for re-invite).</p>
    </div>
  );
}
