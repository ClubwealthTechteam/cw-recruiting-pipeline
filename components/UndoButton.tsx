'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { undoList, onUndoChange, type UndoEntry } from './undo';
import { runUndo } from './useAction';

/** "↶ Undo" for the last change made in this tab (stage moves, notes, tags). Ctrl+Z does the same outside text boxes. */
export default function UndoButton() {
  const router = useRouter();
  const [last, setLast] = useState<UndoEntry | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const read = () => { const l = undoList(); setLast(l[l.length - 1] || null); setCount(l.length); };
    read();
    return onUndoChange(read);
  }, []);
  async function undo() {
    const l = undoList();
    const e = l[l.length - 1];
    if (!e || busy) return;
    setBusy(true);
    await runUndo(e, () => router.refresh());
    setBusy(false);
  }
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <button type="button" className="btn undo-btn" disabled={!last || busy} onClick={undo}
      title={last ? `Undo: ${last.label} (Ctrl+Z)${count > 1 ? ` · ${count} changes can be undone` : ''}` : 'Nothing to undo yet'}>
      ↶ {busy ? 'Undoing…' : last ? `Undo: ${last.label.length > 38 ? last.label.slice(0, 36) + '…' : last.label}` : 'Undo'}
    </button>
  );
}
