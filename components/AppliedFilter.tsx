'use client';
import { useState } from 'react';
import { APPLIED_OPTIONS } from '@/lib/pipeline';
export { APPLIED_OPTIONS };

/** The "when did they apply" dropdown on Candidates; "between…" shows two date boxes (Pacific dates). */
export default function AppliedFilter({ value, from, to }: { value?: string; from?: string; to?: string }) {
  const [v, setV] = useState(value || '');
  return (
    <>
      <select name="applied" value={v} onChange={(e) => setV(e.target.value)} aria-label="When they applied">
        {APPLIED_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {v === 'custom' && (
        <>
          <input type="date" name="from" defaultValue={from} aria-label="Applied from" />
          <span className="muted">to</span>
          <input type="date" name="to" defaultValue={to} aria-label="Applied to" />
        </>
      )}
    </>
  );
}
