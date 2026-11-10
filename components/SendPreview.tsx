'use client';
import { useEffect, useRef, useState } from 'react';
import type { Preview } from '@/app/api/preview/route';

export type PreviewRequest = { kind: 'invite' | 'reinvite' | 'reply'; id: string; date?: string; text?: string; subject?: string; channel?: 'email' | 'olj' };

/**
 * Shows exactly what the applicant will receive before anything is queued (Miguel, 2026-11-02): who it goes to, the
 * subject, and the email itself with the banner. With count > 1 it is a bulk send: the button names the number.
 * Pass ids to page through every person's own copy (Tara, 2026-11-10); each copy is loaded once and kept.
 */
export default function SendPreview({ req, ids, count = 1, title, onSend, onClose }: { req: PreviewRequest; ids?: string[]; count?: number; title: string; onSend: () => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [cache, setCache] = useState<Record<number, Preview>>({});
  const [err, setErr] = useState('');
  const [sure, setSure] = useState(count <= 1);
  const many = !!ids && ids.length > 1;
  const id = many ? ids![Math.min(i, ids!.length - 1)] : req.id;
  const reqKey = JSON.stringify({ ...req, id });
  const p = cache[many ? i : 0] || null;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (many && e.key === 'ArrowRight') setI((x) => Math.min(x + 1, ids!.length - 1));
      if (many && e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [many, ids]);
  useEffect(() => {
    const at = many ? i : 0;
    if (cache[at]) return;
    let live = true;
    setErr('');
    fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqKey })
      .then((r) => r.json()).then((j) => { if (!live) return; if (j.ok) setCache((c) => ({ ...c, [at]: j.data })); else setErr(j.error || 'Could not load the preview'); })
      .catch(() => live && setErr('Could not load the preview'));
    return () => { live = false; };
  }, [reqKey, i, many, cache]);
  const olj = req.channel === 'olj';
  const plain = p ? p.body.replace(/<img[^>]*>/g, '').replace(/<li>/g, '• ').replace(/<\/(p|li|ul)>/g, '\n').replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim() : '';
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} data-tour="preview">
        <div className="modal-head"><b>{title}</b><div className="muted small">Check it before it goes out. Nothing is sent until you click Send.</div></div>
        <div className="modal-body">
          {many && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
              <button className="btn small-btn" disabled={i === 0} onClick={() => setI(i - 1)}>← Previous</button>
              <select value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Pick whose copy to see">
                {ids!.map((x, n) => <option key={x} value={n}>{n + 1}. {cache[n]?.name || x}</option>)}
              </select>
              <button className="btn small-btn" disabled={i === ids!.length - 1} onClick={() => setI(i + 1)}>Next →</button>
            </div>
              )}
          {err && <p className="error">{err}</p>}
          {!p && !err && <p className="muted">Loading the preview…</p>}
          {p && (
            <>
              {p.doNotInvite && <p className="error"><b>Do not contact:</b> {p.doNotInvite}.</p>}
              {count > 1 && <div className="bulk-warn">This goes to {count} people. Each gets their own copy {req.kind === 'reply' ? 'with their own name' : 'with their own session date'}. {many ? <> Showing <b>{i + 1} of {ids!.length}</b>: {p.name}.</> : <> Below is the copy for {p.name}.</>}</div>}
              <div className="mail-meta">
                <span>To</span><span>{p.to || '(no email address)'}</span>
                {!olj && <><span>Subject</span><span>{p.subject}</span></>}
                {p.session && <><span>Session</span><span>Wednesday {p.session} · 2:00 PM PT</span></>}
              </div>
              {olj
                ? <><div className="mail-text">{plain}</div><p className="hint">On OnlineJobs.ph it is sent as plain text, without the banner.</p></>
                : <iframe className="mail-frame" sandbox="" title="Email preview" srcDoc={`<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 Arial,sans-serif;color:#222;margin:16px">${p.body}</body>`} />}
            </>
          )}
        </div>
        <div className="modal-foot">
          {count > 1 && p && <label className="check-label grow"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> Yes, send to all {count} people</label>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!p || !sure || !!p.doNotInvite && count <= 1} onClick={onSend}>{count > 1 ? `Send to ${count} people` : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}
