'use client';
import { useEffect, useState } from 'react';

/** "Camille is viewing this now": checks every 20 seconds while the profile is open. */
export default function Presence({ id }: { id: string }) {
  const [others, setOthers] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    const ping = () => {
      if (document.hidden) return;
      fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
        .then((r) => r.json()).then((j) => { if (live && j.ok) setOthers(j.data.others || []); }).catch(() => {});
    };
    ping();
    const t = setInterval(ping, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [id]);
  if (!others.length) return null;
  const names = others.map((u) => (u === 'Am' ? 'Am' : u));
  return <span className="presence" data-tour="presence">{names.join(' and ')} {names.length > 1 ? 'are' : 'is'} viewing this now</span>;
}
