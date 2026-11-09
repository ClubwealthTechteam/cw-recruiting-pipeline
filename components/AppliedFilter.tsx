'use client';
import { useState } from 'react';

export const APPLIED_OPTIONS: [string, string][] = [
  ['', 'Applied: any time'], ['today', 'Applied today'], ['yesterday', 'Applied yesterday'], ['3d', 'Applied in the last 3 days'],
  ['7d', 'Applied in the last 7 days'], ['14d', 'Applied in the last 14 days'], ['30d', 'Applied in the last 30 days'],
  ['thisweek', 'Applied this week (Mon–Sun)'], ['lastweek', 'Applied last week'], ['custom', 'Applied between dates…']
];

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
