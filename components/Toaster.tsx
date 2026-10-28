'use client';
import { useEffect, useState } from 'react';

type Action = { label: string; run: () => void };
type Toast = { id: number; text: string; tone: 'ok' | 'error'; action?: Action };
const EVENT = 'cw-toast';

/** Shows a short message in the corner, e.g. "Moved to Passed ✓", optionally with a button such as Undo. */
export function toast(text: string, tone: 'ok' | 'error' = 'ok', action?: Action) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, tone, action } }));
}

export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const { text, tone, action } = (e as CustomEvent).detail as Omit<Toast, 'id'>;
      const id = ++n;
      setItems((xs) => [...xs.slice(-3), { id, text, tone, action }]);
      // toasts with Undo stay 10 seconds, so there is time to click it
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), action ? 10000 : tone === 'error' ? 6000 : 3000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const close = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
          {t.action && <button type="button" className="toast-action" onClick={() => { close(t.id); t.action!.run(); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
