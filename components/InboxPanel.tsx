'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Inbox from './Inbox';
import { useAction } from './useAction';
import { formatDate } from '@/lib/pipeline';
import type { InboxConversation, ThreadItem, Row } from '@/lib/sheet';

export type InboxChannel = 'olj' | 'email';
const EVENT = 'cw-open-inbox';
/** Fired with the open channel (or null when closed), so the sidebar can show which inbox is open. */
export const INBOX_STATE_EVENT = 'cw-inbox-state';

/** Opens the floating inbox from anywhere (the Dashboard menu in the sidebar). */
export function openInbox(channel: InboxChannel) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: channel }));
}

const TITLE: Record<InboxChannel, string> = { olj: 'OLJ Inbox', email: 'Email Inbox' };
const STATUS_TEMPLATES = ['Hired', 'Onboarding', 'Benched', 'Rejected'];
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));

type Filter = 'all' | 'unread' | 'messages' | 'sent';
const FILTERS: { key: Filter; label: string; title: string }[] = [
  { key: 'all', label: 'All', title: 'Every conversation' },
  { key: 'unread', label: 'Unread', title: 'OLJ: not opened on OnlineJobs.ph yet. Email: new since you last opened it here.' },
  { key: 'messages', label: 'Messages', title: 'The applicant wrote last and nobody has answered' },
  { key: 'sent', label: 'Sent', title: 'Club Wealth wrote last (an answer, invite or reminder)' }
];

// Which email conversations this browser has opened, and at which message (per viewer, so it lives in the browser).
const SEEN_KEY = 'cw-inbox-seen';
function readSeen(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}
function markSeen(c: InboxConversation) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ ...readSeen(), [c.key]: c.at })); } catch { /* private window */ }
}
/** OLJ "Unread" is OLJ's own state (the CRM never opens those). Email has none, so it is "not opened here yet". */
function isUnread(c: InboxConversation, channel: InboxChannel, seen: Record<string, string>) {
  if (channel === 'olj') return c.last === 'Unread on OLJ';
  return c.needsReply && seen[c.key] !== c.at;
}
function matches(f: Filter, c: InboxConversation, channel: InboxChannel, seen: Record<string, string>) {
  if (f === 'unread') return isUnread(c, channel, seen);
  if (f === 'messages') return c.needsReply && !(channel === 'olj' && c.last === 'Unread on OLJ');
  if (f === 'sent') return !c.needsReply;
  return true;
}

/**
 * Floating inbox over the current page (no page change): every OnlineJobs.ph or CareersCW conversation on the left,
 * the selected one on the right with a reply box and one-click templates. Status templates (Hired, Onboarding,
 * Benched, Rejected) are never sent from here: they are prepared and wait in Needs Approval.
 */
export default function InboxPanel({ emailReady }: { emailReady: boolean }) {
  const [channel, setChannel] = useState<InboxChannel | null>(null);
  const [list, setList] = useState<InboxConversation[] | null>(null);
  const [listError, setListError] = useState('');
  const [sel, setSel] = useState<InboxConversation | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');

  const loadList = useCallback(async (c: InboxChannel) => {
    setListError('');
    try {
      const r = await fetch(`/api/inbox?channel=${c}`).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || 'Could not load the inbox');
      setList(r.conversations);
    } catch (e) { setListError(e instanceof Error ? e.message : 'Could not load the inbox'); }
  }, []);

  useEffect(() => {
    const open = (e: Event) => {
      const c = (e as CustomEvent<InboxChannel>).detail;
      setChannel(c); setList(null); setSel(null); setQ(''); setSeen(readSeen());
      loadList(c);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setChannel(null); };
    window.addEventListener(EVENT, open);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener(EVENT, open); window.removeEventListener('keydown', esc); };
  }, [loadList]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(INBOX_STATE_EVENT, { detail: channel }));
  }, [channel]);

  if (!channel) return null;
  const needle = q.trim().toLowerCase();
  const shown = (list || []).filter((c) => matches(filter, c, channel, seen) &&
    (!needle || [c.applicant?.name, c.name, c.email, c.applicant?.id, c.applicant?.position].some((v) => s(v).toLowerCase().includes(needle))));
  const open = (list || []).filter((c) => c.needsReply).length;

  return (
    <>
    {/* dims the page, not the sidebar; clicking it closes the inbox */}
    <div className="inbox-backdrop" onClick={() => setChannel(null)} aria-hidden="true" />
    <div className="inbox-pop" role="dialog" aria-modal="true" aria-label={TITLE[channel]}>
      <header className="inbox-pop-head">
        <div className="seg">
          {(['olj', 'email'] as InboxChannel[]).map((c) => (
            <button key={c} type="button" className={c === channel ? 'on' : ''} onClick={() => openInbox(c)}>{TITLE[c]}</button>
          ))}
        </div>
        <span className="muted small">{list ? `${list.length} conversations · ${open} need a reply` : 'Loading…'}</span>
        <button type="button" className="link" onClick={() => loadList(channel)}>Refresh</button>
        <button type="button" className="inbox-pop-close" onClick={() => setChannel(null)} aria-label="Close">×</button>
      </header>
      <div className="inbox-pop-body">
        <aside className="inbox-list">
          <div className="inbox-list-tools">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, ID…" />
          </div>
          <div className="inbox-filters">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={filter === f.key ? 'on' : ''} title={f.title} onClick={() => setFilter(f.key)}>
                {f.label} <span className="count">{(list || []).filter((c) => matches(f.key, c, channel, seen)).length}</span>
              </button>
            ))}
          </div>
          {listError && <p className="error">{listError}</p>}
          {list && !shown.length && <p className="muted small">No conversations.</p>}
          <ul>
            {shown.map((c) => (
              <li key={c.key}>
                <button type="button" className={`inbox-item${sel?.key === c.key ? ' on' : ''}`} onClick={() => { setSel(c); if (channel === 'email') { markSeen(c); setSeen(readSeen()); } }}>
                  <span className="inbox-item-top">
                    <strong>{c.applicant?.name || c.name || c.email || '(unknown)'}</strong>
                    {isUnread(c, channel, seen) ? <span className="dot" title="Unread" /> : c.needsReply ? <span className="dot hollow" title="Needs a reply" /> : null}
                    <span className="muted small">{s(c.at).slice(5, 16)}</span>
                  </span>
                  <span className="muted small">{c.applicant ? `${c.applicant.position || c.applicant.source} · ${c.applicant.stage}` : 'Not matched to an applicant'}</span>
                  <span className="inbox-item-last">{c.last || '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="inbox-view">
          {!sel ? <p className="muted">Pick a conversation.</p>
            : sel.applicant ? <Conversation key={sel.key} id={sel.applicant.id} channel={channel} emailReady={emailReady} onChanged={() => loadList(channel)} />
              : <Unmatched key={sel.key} email={s(sel.email)} emailReady={emailReady} onChanged={() => loadList(channel)} />}
        </section>
      </div>
    </div>
    </>
  );
}

/** A matched applicant: their thread for this channel, templates and the reply box. */
function Conversation({ id, channel, emailReady, onChanged }: { id: string; channel: InboxChannel; emailReady: boolean; onChanged: () => void }) {
  const [a, setA] = useState<Row | null>(null);
  const [thread, setThread] = useState<ThreadItem[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/inbox?id=${encodeURIComponent(id)}`).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || 'Could not load the conversation');
      setA(r.applicant); setThread(r.thread);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the conversation'); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); onChanged(); };
  if (error) return <p className="error">{error}</p>;
  if (!a || !thread) return <p className="muted">Loading…</p>;
  const isOlj = s(a.Source) === 'OLJ';
  const session = s(a['Interview Date']).slice(0, 10);
  return (
    <>
      <div className="inbox-view-head">
        <div>
          <strong>{`${s(a['First Name'])} ${s(a['Last Name'])}`.trim()}</strong> <span className="muted small">{s(a['Applicant ID'])} · {s(a.Position)} · {s(a.Stage)}</span>
          <div className="muted small">{s(a.Email) || 'No email'}{session ? ` · Session Wed, ${formatDate(session)}, 2:00 PM PT` : ''}</div>
        </div>
        <Link href={`/candidates/${encodeURIComponent(id)}`} className="small">Open profile →</Link>
      </div>
      <Templates id={id} channel={channel} a={a} emailReady={emailReady} onDone={refresh} />
      <Inbox id={id} thread={thread} hasEmail={!!a.Email} isOlj={isOlj} emailReady={emailReady} only={channel === 'olj' ? 'OLJ' : 'Email'} onSent={refresh} />
    </>
  );
}

/** One-click templates. Invites and reminders are queued; status emails wait in Needs Approval. */
function Templates({ id, channel, a, emailReady, onDone }: { id: string; channel: InboxChannel; a: Row; emailReady: boolean; onDone: () => void }) {
  const { run, busy, error } = useAction();
  const olj = channel === 'olj';
  const canOlj = s(a.Source) === 'OLJ';
  const canEmail = !!a.Email && emailReady;
  const blocked = !!s(a['Do Not Invite']);
  const off = busy || blocked || (olj ? !canOlj : !canEmail);
  async function go(body: Record<string, unknown>, ask: string) {
    if (!confirm(ask)) return;
    if (await run(body)) onDone();
  }
  const where = olj ? 'on OnlineJobs.ph' : 'by email from CareersCW';
  return (
    <div className="inbox-templates">
      <span className="muted small">Templates:</span>
      <button type="button" className="btn" disabled={off} onClick={() => go({ action: 'sendInvite', id, channel: olj ? 'olj' : 'email' }, `Send the pre-interview invite for the next Wednesday ${where}?`)}>Send invite</button>
      <button type="button" className="btn" disabled={off} onClick={() => go({ action: 'sendTemplate', id, template: 'Reminder', channel }, `Send the reminder for their session ${where}?`)}>Send reminder</button>
      {!olj && STATUS_TEMPLATES.map((t) => (
        <button key={t} type="button" className="btn" disabled={busy || !a.Email}
          onClick={() => go({ action: 'sendTemplate', id, template: t, channel }, `Prepare the ${t} email? It is not sent yet: it waits in Needs Approval for Approve & send.`)}>{t}</button>
      ))}
      {blocked && <span className="error small">Do not invite: {s(a['Do Not Invite'])}.</span>}
      {!olj && !emailReady && <span className="hint">Email sending is off.</span>}
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

/** An email that matched no applicant: read and answer it (link it to an applicant in Needs Attention). */
function Unmatched({ email, emailReady, onChanged }: { email: string; emailReady: boolean; onChanged: () => void }) {
  const [thread, setThread] = useState<ThreadItem[] | null>(null);
  const [text, setText] = useState('');
  const { run, busy, error } = useAction();
  const load = useCallback(async () => {
    const r = await fetch(`/api/thread?email=${encodeURIComponent(email)}`).then((x) => x.json()).catch(() => null);
    setThread(r?.ok ? r.thread : []);
  }, [email]);
  useEffect(() => { load(); }, [load]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !confirm(`Send this to ${email} by email from CareersCW?`)) return;
    if (await run({ action: 'replyToEmail', email, text })) { setText(''); load(); onChanged(); }
  }
  return (
    <>
      <div className="inbox-view-head">
        <div><strong>{email}</strong><div className="muted small">Not matched to an applicant. Link it in <Link href="/attention">Needs Attention</Link> to use templates.</div></div>
      </div>
      <div className="thread">
        {!thread ? <p className="muted">Loading…</p> : thread.map((m, i) => (
          <div key={i} className={`msg ${m.dir}`}>
            <div className="msg-head">{m.dir === 'in' ? 'Sender' : m.by || 'Club Wealth'}<span className="muted"> · {String(m.at).slice(0, 16)}</span></div>
            {m.text ? <div className="prewrap">{m.text}</div> : <div className="muted">{m.subject}</div>}
          </div>
        ))}
      </div>
      <form className="stack-form" onSubmit={send}>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write an email reply… (the Club Wealth sign-off and banner are added for you)" />
        <button className="btn primary" disabled={busy || !text.trim() || !emailReady}>{busy ? 'Sending…' : 'Send email'}</button>
        {error && <span className="error">{error}</span>}
      </form>
    </>
  );
}
