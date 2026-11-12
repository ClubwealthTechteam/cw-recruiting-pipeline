'use client';
import { useState } from 'react';

export type FailedSave = { id: number; label: string; error: string; at: string };

/** "This save did not go through" (database stage 2): the sheet refused a save that was already shown. */
export default function FailedSaves({ items }: { items: FailedSave[] }) {
  const [gone, setGone] = useState<number[]>([]);
  const left = items.filter((i) => !gone.includes(i.id));
  if (!left.length) return null;
  async function close(id: number) {
    setGone((g) => [...g, id]);
    await fetch('/api/db/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: id }) }).catch(() => undefined);
  }
  return (
    <div className="panel warn" role="alert" style={{ marginBottom: 14 }}>
      <strong>{left.length === 1 ? 'A save did not go through' : `${left.length} saves did not go through`}</strong>
      <span className="muted small"> · it was put back as it was; please check and redo it</span>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {left.map((i) => (
          <li key={i.id}>
            <b>{i.label}</b> ({i.at}): {i.error}{' '}
            <button type="button" className="link-btn" onClick={() => close(i.id)}>Close</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
