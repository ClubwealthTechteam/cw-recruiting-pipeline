'use client';
import { useState } from 'react';
import { STAGE_CHOICES, REASON_REQUIRED, parseStageChoice } from '@/lib/pipeline';
import { hireFields, notFitFields } from './hirePrompt';
import { useAction } from './useAction';

/** Stage picker right in the list row. Stages that need a reason ask for it first. */
export function InlineStage({ id, stage }: { id: string; stage: string }) {
  const { run, busy } = useAction();
  return (
    <select className="inline-stage" value="" disabled={busy} aria-label="Move to stage"
      onChange={async (e) => {
        const to = e.target.value;
        if (!to) return;
        let hire = hireFields(to);
        if (!hire) return;
        if (hire.stage === 'Not Fit') { const nf = notFitFields(); if (!nf) return; hire = { ...hire, ...nf }; await run({ action: 'setStage', ids: [id], ...hire }); return; }
        let reason = '';
        if (REASON_REQUIRED.includes(hire.stage)) {
          reason = prompt(`Reason for ${hire.stage}:`)?.trim() || '';
          if (!reason) return;
        }
        await run({ action: 'setStage', ids: [id], reason, ...hire });
      }}>
      <option value="">{busy ? 'Saving…' : 'Move…'}</option>
      {STAGE_CHOICES.filter((x) => x !== stage && !(parseStageChoice(x).stage === stage && !parseStageChoice(x).company)).map((x) => <option key={x} value={x}>{x}</option>)}
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
