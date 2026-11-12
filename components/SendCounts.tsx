'use client';
import Link from 'next/link';
import { useState } from 'react';

export type SendStats = { emailWaiting: number; oljWaiting: number; queued: number; sent: number; oljSent: number; failed: number };
/** One email or OLJ message in the lists under the tiles. */
export type SentItem = { at: string; id: string; name: string; to: string; what: string; by: string; status: string };
export type SendLists = { waiting: SentItem[]; sent: SentItem[]; olj: SentItem[] };

/**
 * Emails queued, emails sent and OLJ messages sent (Miguel, 2026-11-10), today by default or the last 7 days.
 * "Waiting" is what is still in the queue right now, whatever the period. Click a tile to see which emails, to whom
 * (Miguel, 2026-11-12).
 */
export default function SendCounts({ today, week, todayLists, weekLists }: { today: SendStats; week: SendStats; todayLists: SendLists; weekLists: SendLists }) {
  const [range, setRange] = useState<'today' | 'week'>('today');
  const [open, setOpen] = useState<'' | keyof SendLists>('');
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
                <thead><tr><th>When (PT)</th><th>Applicant</th><th>Sent to</th><th>Email</th><th>By</th>{open === 'waiting' && <th>Status</th>}</tr></thead>
                <tbody>
                  {shown.map((e, i) => (
                    <tr key={e.at + e.to + i}>
                      <td className="small">{e.at.slice(5, 16).replace(' ', ' · ')}</td>
                      <td>{e.id ? <Link href={`/candidates/${encodeURIComponent(e.id)}`}>{e.name || e.id}</Link> : <span className="muted">{e.name || '—'}</span>}</td>
                      <td className="small">{e.to}</td>
                      <td className="small">{e.what}</td>
                      <td className="small">{e.by || 'System'}</td>
                      {open === 'waiting' && <td className="small">{e.status}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
