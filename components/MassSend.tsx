'use client';
import { useMemo, useState } from 'react';
import { useAction } from './useAction';
import { toast } from './Toaster';
import SendPreview, { type SendEdits } from './SendPreview';
import type { Template } from './Inbox';

export type Recipient = { id: string; name: string; email: string; olj: boolean; stage: string; position: string; session: string; applied: string };
const SESSION_LABEL = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Email Templates → Mass email / mass OLJ message (Miguel, 2026-11-10): pick who (stage, position, session, applied
 * after), untick anyone to leave out, write or insert a template ({first_name} becomes each name), preview one copy
 * with the count, tick, send. People who cannot get it (do-not-contact, Banned) are skipped by the server and listed.
 */
export default function MassSend({ people, templates, stages }: { people: Recipient[]; templates: Template[]; stages: string[] }) {
  const [channel, setChannel] = useState<'email' | 'olj'>('email');
  const [f, setF] = useState({ stage: '', position: '', session: '', after: '' });
  const [left, setLeft] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  // "Put them on hold" (Miguel, 2026-11-11): ticked by itself when the Position on hold template is inserted
  const [hold, setHold] = useState(false);
  const [showList, setShowList] = useState(false);
  const { run, busy } = useAction();
  const positions = [...new Set(people.map((p) => p.position).filter(Boolean))].sort();
  const sessions = [...new Set(people.map((p) => p.session).filter(Boolean))].sort().reverse().slice(0, 12);
  const match = useMemo(() => people.filter((p) => (channel === 'olj' ? p.olj : !!p.email) &&
    (!f.stage || p.stage === f.stage) && (!f.position || p.position === f.position) && (!f.session || p.session === f.session) &&
    (!f.after || p.applied.slice(0, 10) >= f.after))
    // one message per person, even when they applied twice (Tara, 2026-11-10)
    .filter((p, i, all) => !p.email || all.findIndex((x) => x.email.toLowerCase() === p.email.toLowerCase()) === i), [people, channel, f]);
  const ids = match.filter((p) => !left.includes(p.id)).map((p) => p.id);
  const filtered = !!(f.stage || f.position || f.session || f.after);
  async function send(edits?: SendEdits) {
    setPreview(false);
    const r = await run({ action: 'bulkMessage', channel, ids, subject: edits?.subject ?? subject, text: edits?.text ?? text, hold }, { success: channel === 'olj' ? 'OLJ messages queued ✓ (sent on the next OLJ run)' : 'Emails queued ✓ (about 6 go out every 5 minutes)' });
    if (r && typeof r === 'object') {
      const d = r as { queued?: number; skipped?: string[] };
      toast(`${d.queued || 0} queued${d.skipped?.length ? ` · ${d.skipped.length} skipped: ${d.skipped.slice(0, 3).join(', ')}${d.skipped.length > 3 ? '…' : ''}` : ''}`);
      setText(''); setSubject(''); setLeft([]); setHold(false);
    }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setLeft([]); };
  return (
    <section className="panel" data-tour="mass-send" id="mass">
      <h2>Mass email / OLJ message</h2>
      <div className="seg">
        <button type="button" className={channel === 'email' ? 'on' : ''} onClick={() => { setChannel('email'); setLeft([]); }}>Email</button>
        <button type="button" className={channel === 'olj' ? 'on' : ''} onClick={() => { setChannel('olj'); setLeft([]); }}>OLJ message</button>
      </div>
      <div className="filters">
        <select value={f.stage} onChange={set('stage')} aria-label="Stage"><option value="">Any stage</option>{stages.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={f.position} onChange={set('position')} aria-label="Position"><option value="">Any position</option>{positions.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={f.session} onChange={set('session')} aria-label="Session"><option value="">Any session</option>{sessions.map((x) => <option key={x} value={x}>{SESSION_LABEL(x)}</option>)}</select>
        <label className="check-label">Applied on or after <input type="date" value={f.after} onChange={set('after')} /></label>
      </div>
      <p style={{ margin: '4px 0 8px' }}>
        <b>{ids.length}</b> {channel === 'olj' ? 'OLJ applicant' : 'applicant'}{ids.length === 1 ? '' : 's'} will get it{left.length ? ` (${left.length} left out)` : ''}.{' '}
        {!filtered && <span className="error">No filter picked: this is everyone{channel === 'olj' ? ' from OLJ' : ' with an email'}. Pick a stage, position or session first.</span>}{' '}
        <button type="button" className="link-btn" onClick={() => setShowList((v) => !v)}>{showList ? 'Hide the list' : 'See who'}</button>
      </p>
      {showList && (
        <div className="mass-list">
          {match.map((p) => (
            <label key={p.id} className="check-label"><input type="checkbox" checked={!left.includes(p.id)} onChange={() => setLeft((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))} />
              {p.name} <span className="muted small">· {p.stage} · {p.position}{p.session ? ` · ${SESSION_LABEL(p.session)}` : ''}</span></label>
          ))}
          {match.length === 0 && <p className="muted">Nobody matches.</p>}
        </div>
      )}
      <div className="stack-form" style={{ alignItems: 'stretch', marginTop: 8 }}>
        {templates.length > 0 && (
          <select value="" onChange={(e) => { const tp = templates.find((x) => x.name === e.target.value); if (tp) { setText(tp.body); if (tp.subject && channel === 'email') setSubject(tp.subject); setHold(/on hold/i.test(tp.name)); } }} aria-label="Insert a template">
            <option value="">Insert a template…</option>
            {templates.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
          </select>
        )}
        {channel === 'email' && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (blank = RE: ClubWealth | Pre-Interview invite)" />}
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Hi {first_name},\n\n…'} />
        <p className="hint" style={{ margin: 0 }}>{channel === 'olj' ? 'Plain text on OnlineJobs.ph, sent at the next OLJ run (4 times a day).' : 'Club Wealth sign-off and banner are added. Sent from CareersCW, about 6 every 5 minutes.'} [First Name], [Name] and [Position] are filled in for each person.</p>
        <label className="check-label"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Put them on hold: no Wednesday reminder or invites after this, and not marked No Show (tag &quot;Position on hold&quot;)</label>
        <div><button className="btn primary" disabled={!ids.length || !text.trim() || busy} onClick={() => setPreview(true)}>Preview and send to {ids.length}</button></div>
      </div>
      {preview && ids[0] && (
        <SendPreview req={{ kind: 'reply', id: ids[0], text, subject, channel }} ids={ids} count={ids.length}
          title={channel === 'olj' ? 'Mass OLJ message' : 'Mass email'} onClose={() => setPreview(false)} onSend={(e) => send(e)} />
      )}
    </section>
  );
}
