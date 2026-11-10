'use client';
import { useState } from 'react';
import { useAction } from './useAction';
import SendPreview, { type SendEdits } from './SendPreview';
import type { ThreadItem } from '@/lib/sheet';

const LABEL: Record<string, string> = {
  Application: 'Application', Invite: 'Pre-interview invite', 'Re-invite': 'Re-invite', Reminder: 'Wednesday reminder', Confirmation: 'Confirmation', Reply: 'Reply'
};

/**
 * The applicant's conversation (email from CareersCW, and OnlineJobs.ph for OLJ applicants) with a box to answer.
 * Email answers go out from CareersCW with the Club Wealth sign-off and banner; OLJ answers go out on the next OLJ run.
 */
export type Template = { name: string; subject: string; body: string };

export default function Inbox({ id, thread, hasEmail, isOlj, emailReady, only, onSent, firstName = '', templates = [] }: { id: string; thread: ThreadItem[]; hasEmail: boolean; isOlj: boolean; emailReady: boolean; only?: 'OLJ' | 'Email'; onSent?: () => void; firstName?: string; templates?: Template[] }) {
  const channels = ([...(isOlj ? ['OLJ'] : []), ...(hasEmail ? ['Email'] : [])] as ('OLJ' | 'Email')[]).filter((c) => !only || c === only);
  const [channel, setChannel] = useState<'OLJ' | 'Email'>(only || channels[0] || 'Email');
  const [text, setText] = useState('');
  const { run, busy, error } = useAction();
  const [preview, setPreview] = useState(false);
  const shown = thread.filter((m) => (channel === 'OLJ' ? m.channel === 'OLJ' : m.channel !== 'OLJ'));

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (channel === 'OLJ') { if (!confirm(`Send this on OnlineJobs.ph?\n\n${text.trim()}`)) return; }
    else { setPreview(true); return; }
    await deliver();
  }

  async function deliver(edits?: SendEdits) {
    setPreview(false);
    const body = edits?.text ?? text;
    const ok = await run(channel === 'OLJ' ? { action: 'sendOljMessage', id, text: body } : { action: 'sendReply', id, text: body, ...(edits?.subject ? { subject: edits.subject } : {}) });
    if (ok) { setText(''); onSent?.(); }
  }

  return (
    <div className="inbox" data-tour="reply">
      {preview && <SendPreview req={{ kind: 'reply', id, text }} title="Email reply" onClose={() => setPreview(false)} onSend={(e) => deliver(e)} />}
      {channels.length > 1 && (
        <div className="seg">{channels.map((c) => <button key={c} type="button" className={c === channel ? 'on' : ''} onClick={() => setChannel(c)}>{c}</button>)}</div>
      )}
      <div className="thread">
        {shown.length === 0 && <p className="muted">No {channel === 'OLJ' ? 'OnlineJobs.ph' : 'email'} messages yet.</p>}
        {shown.map((m, i) => (
          <div key={i} className={`msg ${m.dir}`}>
            <div className="msg-head">
              {m.dir === 'in' ? 'Applicant' : m.by && m.by !== 'System' && !m.by.startsWith('System') ? m.by : 'Club Wealth'}
              {m.type && m.type !== 'Reply' ? ` · ${LABEL[m.type] || m.type}` : ''}
              <span className="muted"> · {String(m.at).slice(0, 16)}{m.status === 'Queued' ? ' · sending…' : ''}</span>
            </div>
            {m.note ? <div className="hint">{m.note}</div> : m.text ? <div className="prewrap">{m.text}</div> : m.subject ? <div className="muted">{m.subject}</div> : null}
          </div>
        ))}
      </div>
      {channels.length === 0 ? <p className="hint">No email address or OLJ conversation to reply to.</p> : (
        <form className="stack-form" onSubmit={send}>
          {templates.length > 0 && (
            <select value="" onChange={(e) => { const tp = templates.find((x) => x.name === e.target.value); if (tp) setText(tp.body.replace(/[{[]\s*first[_ ]?name\s*[}\]]/gi, firstName || 'there')); }} aria-label="Insert a template" data-tour="template-pick">
              <option value="">Insert a template…</option>
              {templates.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
            </select>
          )}
          <textarea id="reply-box" rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={channel === 'OLJ' ? 'Write an OLJ message…' : 'Write an email reply… (the Club Wealth sign-off and banner are added for you)'} />
          <button className="btn primary" disabled={busy || !text.trim() || (channel === 'Email' && !emailReady)}>
            {busy ? 'Sending…' : channel === 'OLJ' ? 'Send on OLJ' : 'Send email'}
          </button>
          {channel === 'Email' && !emailReady && <span className="hint">Email sending is off.</span>}
          {error && <span className="error">{error}</span>}
        </form>
      )}
    </div>
  );
}
