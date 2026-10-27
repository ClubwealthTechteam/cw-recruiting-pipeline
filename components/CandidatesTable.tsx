'use client';
import Link from 'next/link';
import { useState } from 'react';
import StageBadge from './StageBadge';
import StageForm from './StageForm';

export type CandidateRow = {
  id: string; name: string; email: string; stage: string; source: string; position: string;
  applied: string; interview: string; confirmed: string; minutes: string; invites: string; historical: boolean;
};

export default function CandidatesTable({ rows }: { rows: CandidateRow[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const all = rows.length > 0 && sel.length === rows.length;
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <>
      <div className="bulk-bar">
        <span>{sel.length ? `${sel.length} selected` : 'Select applicants to move them in bulk'}</span>
        <StageForm ids={sel} onDone={() => setSel([])} />
      </div>
      <table className="table candidates">
        <thead>
          <tr>
            <th className="check"><input type="checkbox" checked={all} onChange={() => setSel(all ? [] : rows.map((r) => r.id))} aria-label="Select all" /></th>
            <th>Name</th><th>Stage</th><th>Position</th><th>Source</th><th>Applied</th><th>Session</th><th>Confirmed</th><th>Zoom min</th><th>Invites</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={sel.includes(r.id) ? 'selected' : ''}>
              <td className="check"><input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
              <td><Link href={`/candidates/${encodeURIComponent(r.id)}`}>{r.name || '(no name)'}</Link><div className="muted small">{r.email}</div></td>
              <td><StageBadge stage={r.stage} />{r.historical && <span className="tag">Before system</span>}</td>
              <td>{r.position}</td><td>{r.source}</td><td>{r.applied}</td><td>{r.interview}</td><td>{r.confirmed}</td><td>{r.minutes}</td><td>{r.invites}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="empty">No applicants match these filters.</p>}
    </>
  );
}
