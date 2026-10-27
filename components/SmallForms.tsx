'use client';
import { useState } from 'react';
import { useAction } from './useAction';

export function NoteForm({ id }: { id: string }) {
  const [note, setNote] = useState('');
  const { run, busy, error } = useAction();
  return (
    <form className="stack-form" onSubmit={async (e) => { e.preventDefault(); if (note.trim() && await run({ action: 'addNote', id, note })) setNote(''); }}>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add a note for the team" />
      <button className="btn" disabled={busy || !note.trim()}>{busy ? 'Saving…' : 'Add note'}</button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

export function EmailForm({ id, current }: { id: string; current: string }) {
  const [email, setEmail] = useState(current);
  const { run, busy, error } = useAction();
  return (
    <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); await run({ action: 'setEmail', id, email }); }}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="applicant@email.com" required />
      <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save email'}</button>
      <span className="hint">Saving an email for a new applicant sends their pre-interview invite.</span>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

export function ResolveButton({ flagId }: { flagId: string }) {
  const [note, setNote] = useState('');
  const { run, busy, error } = useAction();
  return (
    <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); await run({ action: 'resolveFlag', flagId, note }); }}>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done (optional)" />
      <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Mark resolved'}</button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}
