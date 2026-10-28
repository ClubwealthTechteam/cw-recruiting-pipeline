'use client';
/**
 * The last changes made in this browser tab that can be undone (newest last, at most 10), shared by the toast's
 * Undo button, the Undo buttons on Candidates and the Pipeline Board, and Ctrl+Z. Kept in sessionStorage so it
 * survives page changes within the tab.
 */
export type UndoEntry = { label: string; body: Record<string, unknown>; at: number };
const KEY = 'cw-undo';
const EVENT = 'cw-undo-change';
const MAX = 10;

export function undoList(): UndoEntry[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(list: UndoEntry[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* private window: undo lasts until reload */ }
  window.dispatchEvent(new Event(EVENT));
}
export function pushUndo(entry: UndoEntry) { save([...undoList(), entry]); }
/** Removes one entry (the one being undone). */
export function dropUndo(at: number) { save(undoList().filter((e) => e.at !== at)); }
export function onUndoChange(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
