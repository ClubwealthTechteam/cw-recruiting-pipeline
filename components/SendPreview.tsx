'use client';
import { useEffect, useState } from 'react';
import type { Preview } from '@/app/api/preview/route';

export type PreviewRequest = { kind: 'invite' | 'reinvite' | 'reply'; id: string; date?: string; text?: string; channel?: 'email' | 'olj' };

/**
 * Shows exactly what the applicant will receive before anything is queued (Miguel, 2026-11-02): who it goes to, the
 * subject, and the email itself with the banner. With count > 1 it is a bulk send: the button names the number.
 */
export default function SendPreview({ req, count = 1, title, onSend, onClose }: { req: PreviewRequest; count?: number; title: string; onSend: () => void; onClose: () => void }) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState('');
  const [sure, setSure] = useState(count <= 1);
  useEffect(() => {
    let live = true;
    fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
      .then((r) => r.json()).then((j) => { if (!live) return; if (j.ok) setP(j.data); else setErr(j.error || 'Could not load the preview'); })
      .catch(() => live && setErr('Could not load the preview'));
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { live = false; window.removeEventListener('keydown', esc); };
  }, [req, onClose]);
  const olj = req.channel === 'olj';
  const plain = p ? p.body.replace(/<img[^>]*>/g, '').replace(/<li>/g, '• ').replace(/<\/(p|li|ul)>/g, '\n').replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim() : '';
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} data-tour="preview">
        <div className="modal-head"><b>{title}</b><div className="muted small">Check it before it goes out. Nothing is sent until you click Send.</div></div>
        <div className="modal-body">
          {err && <p className="error">{err}</p>}
          {!p && !err && <p className="muted">Loading the preview…</p>}
          {p && (
            <>
              {p.doNotInvite && <p className="error"><b>Do not contact:</b> {p.doNotInvite}.</p>}
              {count > 1 && <div className="bulk-warn">This goes to {count} people. Each gets their own copy with their own session date. Below is the copy for {p.name}.</div>}
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
