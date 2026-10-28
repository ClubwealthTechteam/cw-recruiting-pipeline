'use client';
import { useState } from 'react';
import { STAGES, REASON_REQUIRED } from '@/lib/pipeline';
import { useAction } from './useAction';

/** Stage picker right in the list row. Stages that need a reason ask for it first. */
export function InlineStage({ id, stage }: { id: string; stage: string }) {
  const { run, busy } = useAction();
  return (
    <select className="inline-stage" value="" disabled={busy} aria-label="Move to stage"
      onChange={async (e) => {
        const to = e.target.value;
        if (!to) return;
        let reason = '';
        if (REASON_REQUIRED.includes(to)) {
          reason = prompt(`Reason for ${to}:`)?.trim() || '';
          if (!reason) return;
        }
        await run({ action: 'setStage', ids: [id], stage: to, reason });
      }}>
      <option value="">{busy ? 'Saving…' : 'Move…'}</option>
      {STAGES.filter((x) => x !== stage).map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  );
}

/** "+ note" in the list row: a one-line note without opening the profile. */
export function QuickNote({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  if (!open) return <button type="button" className="link-btn small" onClick={() => setOpen(true)}>+ note</button>;
  return (
    <form className="quick-note" onSubmit={async (e) => { e.preventDefault(); if (note.trim() && await run({ action: 'addNote', id, note })) { setNote(''); setOpen(false); } }}>
      <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the team" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <button className="btn small-btn" disabled={busy || !note.trim()}>{busy ? '…' : 'Add'}</button>
    </form>
  );
}
