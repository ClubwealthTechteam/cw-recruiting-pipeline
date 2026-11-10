'use client';
import { useState } from 'react';

export type SendStats = { emailWaiting: number; oljWaiting: number; queued: number; sent: number; oljSent: number; failed: number };

/**
 * Emails queued, emails sent and OLJ messages sent (Miguel, 2026-11-10), today by default or the last 7 days.
 * "Waiting" is what is still in the queue right now, whatever the period.
 */
export default function SendCounts({ today, week }: { today: SendStats; week: SendStats }) {
  const [range, setRange] = useState<'today' | 'week'>('today');
  const c = range === 'today' ? today : week;
  const when = range === 'today' ? 'today' : 'in the last 7 days';
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
        <div className="tile"><div className="tile-label">Emails queued</div><div className="tile-value">{c.emailWaiting}</div><div className="tile-note">waiting now · about 6 go out every 5 min · {c.queued} queued {when}</div></div>
        <div className="tile"><div className="tile-label">Emails sent</div><div className="tile-value">{c.sent}</div><div className="tile-note">{when}{c.failed ? ` · ${c.failed} failed` : ''}</div></div>
        <div className="tile"><div className="tile-label">OLJ messages sent</div><div className="tile-value">{c.oljSent}</div><div className="tile-note">{when} · {c.oljWaiting} waiting for the next OLJ run</div></div>
      </div>
    </section>
  );
}
