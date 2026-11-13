'use client';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';

export type SendStats = { emailWaiting: number; oljWaiting: number; queued: number; sent: number; oljSent: number; failed: number };
/** One email or OLJ message in the lists under the tiles. */
export type SentItem = { emailId: string; at: string; id: string; name: string; to: string; what: string; by: string; status: string };
export type SendLists = { waiting: SentItem[]; sent: SentItem[]; olj: SentItem[] };

/**
 * Emails queued, emails sent and OLJ messages sent (Miguel, 2026-11-10), today by default or the last 7 days.
 * "Waiting" is what is still in the queue right now, whatever the period. Click a tile to see which emails, to whom
 * (Miguel, 2026-11-12).
 */
export default function SendCounts({ today, week, todayLists, weekLists }: { today: SendStats; week: SendStats; todayLists: SendLists; weekLists: SendLists }) {
  const [range, setRange] = useState<'today' | 'week'>('today');
  const [open, setOpen] = useState<'' | keyof SendLists>('');
  // click a row: the email as it was sent, under the row (Miguel, 2026-11-12)
  const [shownEmail, setShownEmail] = useState('');
  const [mail, setMail] = useState<Record<string, { subject: string; body: string } | { error: string }>>({});
  useEffect(() => {
    if (!shownEmail) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShownEmail(''); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [shownEmail]);
  async function toggleEmail(emailId: string) {
    if (shownEmail === emailId) { setShownEmail(''); return; }
    setShownEmail(emailId);
    if (mail[emailId]) return;
    const j = await fetch(`/api/email/${encodeURIComponent(emailId)}`).then((r) => r.json()).catch(() => ({ ok: false }));
    setMail((m) => ({ ...m, [emailId]: j.ok ? j.data : { error: j.error || 'Could not load the email' } }));
  }
  const c = range === 'today' ? today : week;
  const lists = range === 'today' ? todayLists : weekLists;
  const when = range === 'today' ? 'today' : 'in the last 7 days';
  const tile = (key: keyof SendLists, label: string, value: number, note: string) => (
    <button type="button" className={`tile tile-btn${open === key ? ' on' : ''}`} onClick={() => setOpen((o) => (o === key ? '' : key))} aria-expanded={open === key}>
      <div className="tile-label">{label} <span className="muted small">{open === key ? '▴ hide' : '▾ see list'}</span></div>
      <div className="tile-value">{value}</div>
      <div className="tile-note">{note}</div>
    </button>
  );
  const shown = open ? lists[open] : [];
  const title = open === 'waiting' ? 'Emails waiting to go out now' : open === 'sent' ? `Emails sent ${when}` : `OLJ messages sent ${when}`;
  return (
    <section className="panel" data-tour="send-counts">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Sending</h2>
        <div className="seg" style={{ margin: 0 }}>
          <button type="button" className={range === 'today' ? 'on' : ''} onClick={() => setRange('today')}>Today</button>
          <button type="button" className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>Last 7 days</button>
        </div>
      </div>
      <div className="tiles" style={{ marginTop: 12, marginBottom: 0 }}>
        {tile('waiting', 'Emails queued', c.emailWaiting, `waiting now · about 6 go out every 5 min · ${c.queued} queued ${when}`)}
        {tile('sent', 'Emails sent', c.sent, `${when}${c.failed ? ` · ${c.failed} failed` : ''}`)}
        {tile('olj', 'OLJ messages sent', c.oljSent, `${when} · ${c.oljWaiting} waiting for the next OLJ run`)}
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>{title} ({shown.length})</h3>
          {shown.length === 0 ? <p className="muted">None.</p> : (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>When (PT)</th><th>Applicant</th><th>Sent to</th><th>Email</th><th>By</th>{open === 'waiting' && <th>Status</th>}<th></th></tr></thead>
                <tbody>
                  {shown.map((e, i) => (
                    <Fragment key={e.emailId || e.at + e.to + i}>
                    <tr className={shownEmail === e.emailId ? 'row-open' : ''}>
                      <td className="small">{e.at.slice(5, 16).replace(' ', ' · ')}</td>
                      <td>{e.id ? <Link href={`/candidates/${encodeURIComponent(e.id)}`}>{e.name || e.id}</Link> : <span className="muted">{e.name || '—'}</span>}</td>
                      <td className="small">{e.to}</td>
                      <td className="small">{e.what}</td>
                      <td className="small">{e.by || 'System'}</td>
                      {open === 'waiting' && <td className="small">{e.status}</td>}
                      <td>{e.emailId && !e.to.startsWith('OnlineJobs') && <button type="button" className="btn small-btn" onClick={() => toggleEmail(e.emailId)}>View email</button>}</td>
                    </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {shownEmail && (() => {
        const row = Object.values(lists).flat().find((x) => x.emailId === shownEmail);
        const m = mail[shownEmail];
        return (
          <div className="modal-wrap blur" onClick={() => setShownEmail('')}>
            <div className="modal" role="dialog" aria-label="Email as sent" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <b>{m && 'subject' in m ? m.subject : 'Email'}</b>
                  <div className="muted small">To {row?.to}{row?.name ? ` (${row.name})` : ''} · {row?.at.slice(0, 16)} PT{row?.by ? ` · by ${row.by}` : ''}</div>
                </div>
                <button type="button" className="btn small-btn" onClick={() => setShownEmail('')} aria-label="Close">✕</button>
              </div>
              <div className="modal-body">
                {!m ? <p className="muted">Loading the email…</p>
                  : 'error' in m ? <p className="error">{m.error}</p>
                  : <iframe className="mail-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Email as sent" srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><body style="font:14px/1.5 Arial,sans-serif;color:#222;margin:16px">${m.body}</body>`} />}
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
