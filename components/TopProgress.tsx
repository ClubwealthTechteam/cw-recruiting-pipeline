'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * A thin bar across the top that starts the moment a link or filter is clicked and stays until the new page is
 * on screen, so a slow load never looks like a dead click.
 */
export default function TopProgress() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const [busy, setBusy] = useState(false);

  useEffect(() => { setBusy(false); }, [path, search]);

  useEffect(() => {
    const here = () => location.pathname + location.search;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname + url.search === here()) return;
      setBusy(true);
    };
    // filter forms (GET) load a new page; forms that save something keep their own "Saving…" button text
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      if ((f.getAttribute('method') || 'get').toLowerCase() === 'get' && f.getAttribute('action')) setBusy(true);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('submit', onSubmit); };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), 20000); // never stuck if a load fails
    return () => clearTimeout(t);
  }, [busy]);

  return busy ? <div className="top-progress" role="progressbar" aria-label="Loading"><span /></div> : null;
}
