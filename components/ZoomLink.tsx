'use client';
import { useState } from 'react';
import { useAction } from './useAction';

/**
 * This Week's Session (Miguel, 2026-11-18): link a Zoom name the CRM could not match to the invitee it is, e.g.
 * someone who joined as "Romeo" or with a nickname. Their Zoom minutes then count for that applicant.
 */
export default function ZoomLink({ day, name, options }: { day: string; name: string; options: { id: string; label: string }[] }) {
  const { run, busy } = useAction();
  const [id, setId] = useState('');
  return (
    <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8, alignItems: 'center' }}>
      <select value={id} onChange={(e) => setId(e.target.value)} aria-label={`Who is ${name}?`} style={{ maxWidth: 260 }}>
        <option value="">Link to applicant…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button type="button" className="btn small-btn" disabled={!id || busy}
        onClick={() => run({ action: 'linkZoom', day, name, id }, { success: `${name} linked ✓ Their Zoom minutes now count` })}>Link</button>
    </span>
  );
}
