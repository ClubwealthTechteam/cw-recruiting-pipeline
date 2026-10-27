'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Shows how old the cached data is, with a one-click refresh. */
export default function Freshness({ at }: { at?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const time = at ? new Date(at).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) : '';
  async function refresh() {
    setBusy(true);
    await fetch('/api/refresh', { method: 'POST' }).catch(() => {});
    router.refresh();
    setTimeout(() => setBusy(false), 1500);
  }
  return (
    <div className="freshness">
      {time && <span>Data as of {time} PT</span>}
      <button className="link-btn" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh now'}</button>
    </div>
  );
}
