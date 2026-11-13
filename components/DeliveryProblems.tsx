'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { DeliveryProblem } from '@/lib/delivery';

/**
 * Red banner on every page (Miguel, 2026-11-13): emails Zapier failed to send, or never confirmed sending.
 * Resend puts them back in the queue; "It went out" hides one after someone checked CareersCW's Sent Items.
 */
export default function DeliveryProblems({ items }: { items: DeliveryProblem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [gone, setGone] = useState<string[]>([]);
  const left = items.filter((i) => !gone.includes(i.id));
  if (!left.length) return null;
  async function act(ids: string[], action: 'resend' | 'dismiss') {
    setBusy(ids.join() + action); setErr('');
    try {
      const r = await fetch('/api/email/redeliver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, action }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save');
      setGone((g) => [...g, ...ids]);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); }
    setBusy('');
  }
  const all = left.map((i) => i.id);
  return (
    <div className="panel delivery-alert" role="alert" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong>⚠ {left.length === 1 ? '1 email did not go through' : `${left.length} emails did not go through`}</strong>
        <span className="small">The applicant did not get it. Resend, or check CareersCW Sent Items and Zapier's Zap History.</span>
        <span style={{ flex: 1 }} />
        {left.length > 1 && <button className="btn small-btn" disabled={!!busy} onClick={() => act(all, 'resend')}>Resend all {left.length}</button>}
      </div>
      {err && <p className="error" style={{ margin: '6px 0 0' }}>{err}</p>}
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {left.map((i) => (
          <li key={i.id}>
            <b>{i.applicantId ? <Link href={`/candidates/${encodeURIComponent(i.applicantId)}`}>{i.name}</Link> : i.name}</b>
            {' '}· {i.type} · {i.at} — {i.error}{' '}
            <button type="button" className="link-btn" disabled={!!busy} onClick={() => act([i.id], 'resend')}>Resend</button>
            {' · '}
            <button type="button" className="link-btn" disabled={!!busy} onClick={() => act([i.id], 'dismiss')} title="Hide this after checking it really went out">It went out</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
