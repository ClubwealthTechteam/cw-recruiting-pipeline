'use client';
import { useEffect, useRef, useState } from 'react';
import type { Preview } from '@/app/api/preview/route';

export type PreviewRequest = { kind: 'invite' | 'reinvite' | 'reply'; id: string; date?: string; text?: string; subject?: string; channel?: 'email' | 'olj' };
/**
 * What the pencil changed. Replies and mass messages: the message text (fill-ins kept) and subject. Invites: the
 * finished subject and email, the same for everyone it goes to.
 */
export type SendEdits = { text?: string; subject?: string; edited?: { subject: string; body: string } };

/**
 * Shows exactly what the applicant will receive before anything is queued (Miguel, 2026-11-02): who it goes to, the
 * subject, and the email itself with the banner. With count > 1 it is a bulk send: the button names the number.
 * Pass ids to page through every person's own copy (Tara, 2026-11-10); each copy is loaded once and kept.
 * The pencil (Tara, 2026-11-10) edits the email before it goes out; onSend gets the changes.
 */
export default function SendPreview({ req, ids, count = 1, title, onSend, onClose }: { req: PreviewRequest; ids?: string[]; count?: number; title: string; onSend: (edits?: SendEdits) => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [cache, setCache] = useState<Record<string, Preview>>({});
  const [err, setErr] = useState('');
  const [sure, setSure] = useState(count <= 1);
  // pencil state
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(req.text || '');
  const [subject, setSubject] = useState(req.subject || '');
  const [draftSubject, setDraftSubject] = useState('');
  const [inviteEdit, setInviteEdit] = useState<{ subject: string; body: string } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const reply = req.kind === 'reply';
  const olj = req.channel === 'olj';
  const canEdit = reply || !olj; // OLJ invites use the OLJ sender's own message
  const many = !!ids && ids.length > 1;
  const id = many ? ids![Math.min(i, ids!.length - 1)] : req.id;
  const reqKey = JSON.stringify({ ...req, id, ...(reply ? { text, subject } : {}) });
  const loaded = cache[reqKey] || null;
  const p = loaded && inviteEdit ? { ...loaded, subject: inviteEdit.subject, body: inviteEdit.body } : loaded;

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!many || typing) return;
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, ids!.length - 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [many, ids]);
  useEffect(() => {
    if (cache[reqKey]) return;
    let live = true;
    setErr('');
    fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqKey })
      .then((r) => r.json()).then((j) => { if (!live) return; if (j.ok) setCache((c) => ({ ...c, [reqKey]: j.data })); else setErr(j.error || 'Could not load the preview'); })
      .catch(() => live && setErr('Could not load the preview. Please try again.'));
    return () => { live = false; };
  }, [reqKey, cache]);

  function startEdit() {
    if (!p) return;
    setDraftSubject(reply ? (subject || p.subject) : p.subject);
    setEditing(true);
  }
  // the invite is shown in an isolated frame with no scripts; its document is made editable
  const onFrameLoad = () => { const doc = frame.current?.contentDocument; if (doc) { doc.designMode = 'on'; doc.body.style.cssText = 'font:14px/1.5 Arial,sans-serif;color:#222;margin:16px'; } };
  const cmd = (c: string, v?: string) => { frame.current?.contentDocument?.execCommand(c, false, v); frame.current?.contentWindow?.focus(); };
  function doneEditing() {
    if (reply) {
      setSubject(olj ? '' : draftSubject.trim());
    } else {
      const body = frame.current?.contentDocument?.body.innerHTML || '';
      if (!draftSubject.trim() || !body.replace(/<[^>]*>/g, '').trim()) { setErr('The subject and the email cannot be empty.'); return; }
      setErr('');
      setInviteEdit({ subject: draftSubject.trim(), body });
    }
    setEditing(false);
  }
  function send() {
    if (reply) {
      const changed = text !== (req.text || '') || subject !== (req.subject || '');
      onSend(changed ? { text, subject } : undefined);
    } else onSend(inviteEdit ? { edited: inviteEdit } : undefined);
  }

  const plain = p ? p.body.replace(/<img[^>]*>/g, '').replace(/<li>/g, '• ').replace(/<\/(p|li|ul)>/g, '\n').replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim() : '';
  const edited = reply ? text !== (req.text || '') || subject !== (req.subject || '') : !!inviteEdit;
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} data-tour="preview">
        <div className="modal-head" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}><b>{title}</b><div className="muted small">Check it before it goes out. Nothing is sent until you click Send.</div></div>
          {canEdit && !editing && <button type="button" className="btn small-btn" disabled={!p} onClick={startEdit} title="Edit this email before it goes out">✎ Edit</button>}
        </div>
        <div className="modal-body">
          {many && !editing && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
              <button className="btn small-btn" disabled={i === 0} onClick={() => setI(i - 1)}>← Previous</button>
              <select value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Pick whose copy to see">
                {ids!.map((x, n) => <option key={x} value={n}>{n + 1}. {cache[JSON.stringify({ ...req, id: x, ...(reply ? { text, subject } : {}) })]?.name || x}</option>)}
              </select>
              <button className="btn small-btn" disabled={i === ids!.length - 1} onClick={() => setI(i + 1)}>Next →</button>
            </div>
          )}
          {err && <p className="error">{err}</p>}
          {editing && reply && (
            <div className="edit-box">
              {!olj && <label className="edit-subject">Subject <input value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} /></label>}
              <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} aria-label="Message" />
              <p className="hint" style={{ margin: '4px 0 0' }}>[First Name], [Name] and [Position] are filled in for each person.{olj ? '' : ' The Club Wealth sign-off and banner are added.'}</p>
            </div>
          )}
          {editing && !reply && p && (
            <div className="edit-box">
              <label className="edit-subject">Subject <input value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} /></label>
              <div className="edit-tools">
                <button type="button" className="btn small-btn" onClick={() => cmd('bold')}><b>B</b></button>
                <button type="button" className="btn small-btn" onClick={() => cmd('italic')}><i>I</i></button>
                <button type="button" className="btn small-btn" onClick={() => cmd('insertUnorderedList')}>• List</button>
                <button type="button" className="btn small-btn" onClick={() => { const u = prompt('Link address (https://…):')?.trim(); if (u && /^https?:\/\//.test(u)) cmd('createLink', u); }}>Link</button>
                <button type="button" className="btn small-btn" onClick={() => cmd('undo')}>Undo</button>
              </div>
              <iframe ref={frame} className="mail-frame edit-frame" title="Edit email" sandbox="allow-same-origin" srcDoc={p.body} onLoad={onFrameLoad} />
              <p className="hint" style={{ margin: '4px 0 0' }}>Click into the email and type.{count > 1 ? ` The edited email goes to all ${count} people.` : ''}</p>
            </div>
          )}
          {!editing && !p && !err && <p className="muted">Loading the preview…</p>}
          {!editing && p && (
            <>
              {p.doNotInvite && <p className="error"><b>Do not contact:</b> {p.doNotInvite}.</p>}
              {edited && <div className="panel info" style={{ margin: '0 0 8px' }}>Edited. This is the version that will go out.</div>}
              {count > 1 && <div className="bulk-warn">This goes to {count} people. Each gets their own copy {reply ? 'with their own name' : 'with their own session date'}. {many ? <> Showing <b>{i + 1} of {ids!.length}</b>: {p.name}.</> : <> Below is the copy for {p.name}.</>}</div>}
              <div className="mail-meta">
                <span>To</span><span>{p.to || '(no email address)'}</span>
                {!olj && <><span>Subject</span><span>{p.subject}</span></>}
                {p.session && <><span>Session</span><span>Wednesday {p.session} · 2:00 PM PT</span></>}
              </div>
              {olj
                ? <><div className="mail-text">{plain}</div><p className="hint">On OnlineJobs.ph it is sent as plain text, without the banner.{!canEdit ? ' The OLJ invite wording is set by the OLJ sender and cannot be edited here.' : ''}</p></>
                : <iframe className="mail-frame" sandbox="" title="Email preview" srcDoc={`<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 Arial,sans-serif;color:#222;margin:16px">${p.body}</body>`} />}
            </>
          )}
        </div>
        <div className="modal-foot">
          {editing ? (
            <>
              <span className="grow" />
              {!reply && <button className="btn" onClick={() => setEditing(false)}>Cancel edit</button>}
              <button className="btn primary" onClick={doneEditing}>Done editing</button>
            </>
          ) : (
            <>
              {count > 1 && p && <label className="check-label grow"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> Yes, send to all {count} people</label>}
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!p || !sure || !!p.doNotInvite && count <= 1} onClick={send}>{count > 1 ? `Send to ${count} people` : 'Send'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
