'use client';
import { useEffect, useState } from 'react';
import { nowStampPT } from '@/lib/pipeline';

const LAST = 'cw-last-visit';
const SINCE = 'cw-since';

/**
 * "New since your last visit": the Pacific stamp of the person's previous visit on this computer. Fixed for the whole
 * browser session (so the dots don't vanish when moving between pages); the next visit starts from now. '' = first visit.
 */
export function useSince(): string {
  const [since, setSince] = useState('');
  useEffect(() => {
    try {
      let s = sessionStorage.getItem(SINCE);
      if (s === null) { s = localStorage.getItem(LAST) || ''; sessionStorage.setItem(SINCE, s); }
      setSince(s);
      const save = () => localStorage.setItem(LAST, nowStampPT());
      save();
      const t = setInterval(save, 60_000);
      return () => clearInterval(t);
    } catch { /* private window: no dots */ }
  }, []);
  return since;
}

/** True when anything on the row changed after `since`. */
export const isNew = (since: string, ...stamps: string[]) => !!since && stamps.some((t) => t && t > since);
