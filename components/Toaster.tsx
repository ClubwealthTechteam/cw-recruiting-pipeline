'use client';
import { useEffect, useState } from 'react';

type Action = { label: string; run: () => void };
type Tone = 'ok' | 'error' | 'wait';
type Toast = { id: number; text: string; tone: Tone; action?: Action; key?: string };
const EVENT = 'cw-toast';
const DROP = 'cw-toast-drop';

/** Shows a short message in the corner, e.g. "Moved to Passed ✓", optionally with a button such as Undo. */
export function toast(text: string, tone: 'ok' | 'error' = 'ok', action?: Action) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, tone, action } }));
}

/**
 * A "please wait" message that stays until waitDone(key) (Tara, 2026-11-10). Calling it again with the same key
 * replaces the text.
 */
export function waitToast(key: string, text: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, tone: 'wait', key } }));
}
export function waitDone(key: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DROP, { detail: { key } }));
}

export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const { text, tone, action, key } = (e as CustomEvent).detail as Omit<Toast, 'id'>;
      const id = ++n;
      setItems((xs) => [...xs.filter((x) => !key || x.key !== key).slice(-3), { id, text, tone, action, key }]);
      if (tone === 'wait') return; // stays until waitDone
      // toasts with Undo stay 10 seconds, so there is time to click it
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), action ? 10000 : tone === 'error' ? 6000 : 3000);
    };
    const drop = (e: Event) => { const { key } = (e as CustomEvent).detail as { key: string }; setItems((xs) => xs.filter((x) => x.key !== key)); };
    window.addEventListener(EVENT, on);
    window.addEventListener(DROP, drop);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener(DROP, drop); };
  }, []);
  const close = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.tone === 'wait' && <span className="spinner" aria-hidden="true" />}
          {t.text}
          {t.action && <button type="button" className="toast-action" onClick={() => { close(t.id); t.action!.run(); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
