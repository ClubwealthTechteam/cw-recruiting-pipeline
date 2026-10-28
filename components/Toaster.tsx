'use client';
import { useEffect, useState } from 'react';

type Toast = { id: number; text: string; tone: 'ok' | 'error' };
const EVENT = 'cw-toast';

/** Shows a short message in the corner, e.g. "Moved to Passed ✓". Call from any client component. */
export function toast(text: string, tone: 'ok' | 'error' = 'ok') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, tone } }));
}

export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const { text, tone } = (e as CustomEvent).detail as Omit<Toast, 'id'>;
      const id = ++n;
      setItems((xs) => [...xs.slice(-3), { id, text, tone }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
    </div>
  );
}
