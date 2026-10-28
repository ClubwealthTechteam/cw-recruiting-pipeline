'use client';
import { useEffect, useState } from 'react';

const MINE = process.env.NEXT_PUBLIC_BUILD_ID;

/** Checks every minute whether a new version of the site was deployed, and offers a reload. Never reloads by itself. */
export default function NewVersionNotice() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!MINE || MINE === 'dev') return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        const { build } = await r.json();
        if (build && build !== 'dev' && build !== MINE) setStale(true);
      } catch {}
    };
    const t = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!stale) return null;
  return (
    <div className="version-bar" role="status">
      A new version of the site is available.
      <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
