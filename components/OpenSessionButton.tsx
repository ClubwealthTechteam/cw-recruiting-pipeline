'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from './Toaster';

const ptNow = () => {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  return { day: f.slice(0, 10), hm: f.slice(11, 16) };
};
/** Session day, from 30 minutes before the 2:00 PM start to the 3:30 PM end: the click also starts Zoom tracking. */
export const inTrackingWindow = (date: string) => { const n = ptNow(); return n.day === date && n.hm >= '13:30' && n.hm < '15:30'; };

/**
 * "Open session" (Miguel, 2026-11-06): opens the session page and, on the session day within the window, starts the
 * live Zoom attendance tracking for it (once; later clicks just open the page).
 */
export default function OpenSessionButton({ date, label = 'Open session', className = 'btn primary', navigate = true }: { date: string; label?: string; className?: string; navigate?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    if (inTrackingWindow(date)) {
      setBusy(true);
      try {
        const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'startZoomTracking', date }) }).then((x) => x.json());
        if (!r.ok) toast(r.error || 'Could not start attendance tracking', 'error');
        else if (r.data?.started) toast('Zoom attendance tracking is on for this session ✓');
      } catch { toast('Could not start attendance tracking', 'error'); }
      setBusy(false);
    }
    if (navigate) router.push(`/session?date=${date}`); else router.refresh();
  }
  return <button type="button" className={className} disabled={busy} onClick={go} data-tour="open-session">{busy ? 'Starting…' : label}</button>;
}
