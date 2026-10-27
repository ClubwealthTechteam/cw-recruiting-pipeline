'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-reads the page data every 20 seconds while the tab is visible, so new applicants appear without clicking. */
export default function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      // skip while someone is typing in a form, so their input is never disturbed
      const el = document.activeElement;
      if (document.visibilityState === 'visible' && !(el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
