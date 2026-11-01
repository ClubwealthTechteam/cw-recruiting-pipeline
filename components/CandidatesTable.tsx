'use client';
import Link from 'next/link';
import { useState } from 'react';
import StageBadge from './StageBadge';
import StageForm from './StageForm';
import SessionForm from './SessionForm';
import FitBadge from './FitBadge';
import { InlineStage, QuickNote } from './InlineActions';
import UndoButton from './UndoButton';
import ZoomBadge from './ZoomBadge';
import { useSince, isNew } from './useSince';
import type { ZoomLive } from '@/lib/pipeline';

export type CandidateRow = {
  id: string; name: string; email: string; stage: string; source: string; position: string;
  applied: string; interview: string; confirmed: string; minutes: string; invites: string; historical: boolean;
  fit: string; fitTrack: string; fitSummary: string; hold?: string;
  changed?: string[]; score?: string; scoreSuggestion?: string; tags?: string[]; test?: boolean; zoom?: ZoomLive;
};

const AV = ['#1f5fbf', '#6941c6', '#1d7a43', '#c4320a', '#0e7490', '#9a6200', '#b42318', '#475467'];
export const initials = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
export const avatarColor = (id: string) => AV[(id.charCodeAt(id.length - 1) || 0) % AV.length];

export default function CandidatesTable({ rows }: { rows: CandidateRow[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const since = useSince();
  const [tip, setTip] = useState<{ x: number; y: number; row: CandidateRow } | null>(null);
  const all = rows.length > 0 && sel.length === rows.length;
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <>
      <div className="bulk-bar">
        <span>{sel.length ? `${sel.length} selected` : 'Select applicants to move them in bulk'}</span>
        <div className="bulk-right"><UndoButton /><StageForm ids={sel} onDone={() => setSel([])} />{sel.length > 0 && <SessionForm ids={sel} compact onDone={() => setSel([])} />}</div>
      </div>
      <table className="table candidates">
        <thead>
          <tr>
            <th className="check"><input type="checkbox" checked={all} onChange={() => setSel(all ? [] : rows.map((r) => r.id))} aria-label="Select all" /></th>
            <th>Name</th><th>Fit</th><th title="Interview scorecard average (0 = not rated yet)">Score</th><th>Stage</th><th>Position</th><th>Source</th><th title="Newest first">Applied (PT) ↓</th><th>Session</th><th>Confirmed</th><th>Zoom min</th><th>Invites</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={sel.includes(r.id) ? 'selected' : ''}
              onMouseMove={(e) => (r.fitSummary ? setTip({ x: e.clientX, y: e.clientY, row: r }) : setTip(null))}
              onMouseLeave={() => setTip(null)}>
              <td className="check"><input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
              <td>
                <div className="name-cell"><span className={`new-dot${isNew(since, ...(r.changed || [])) ? '' : ' hidden'}`} title="New or changed since your last visit" />
                  <span className="av" style={{ background: AV[(r.id.charCodeAt(r.id.length - 1) || 0) % AV.length] }}>{initials(r.name)}</span>
                  <div><Link href={`/candidates/${encodeURIComponent(r.id)}`}>{r.name || '(no name)'}</Link><div className="muted small">{r.email}</div></div></div>
                {r.tags && r.tags.length > 0 && <div className="row-tags">{r.tags.map((t) => <Link key={t} href={`/candidates?stage=All&tag=${encodeURIComponent(t)}`} className="mini-tag">{t}</Link>)}</div>}
              </td>
              <td><FitBadge tag={r.fit} track={r.fitTrack} hold={r.hold} summary={r.fitSummary} old={r.historical} /></td>
              <td>{r.score ? <span className={`badge ${r.scoreSuggestion === 'Passed' ? 'green' : 'red'}`} title={`Suggested: ${r.scoreSuggestion}`}>{r.score}</span> : <span className="muted">0</span>}</td>
              <td className="stage-cell" onMouseMove={(e) => e.stopPropagation()}>
                <StageBadge stage={r.stage} /><ZoomBadge z={r.zoom} />{r.historical && <span className="tag">Before system</span>}{r.test && <span className="tag">Test · not counted</span>}
                <div className="row-actions"><InlineStage id={r.id} stage={r.stage} /> <QuickNote id={r.id} /></div>
              </td>
              <td>{r.position}</td><td>{r.source}</td><td>{r.applied}</td><td>{r.interview}</td><td>{r.confirmed}</td><td>{r.minutes}</td><td>{r.invites}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="empty">No applicants match these filters.</p>}
      {tip && (
        <div className="fit-tip" style={{ left: Math.min(tip.x + 16, window.innerWidth - 380), top: tip.y + 16 }}>
          <div className="tip-head">{tip.row.fit} · {tip.row.fitTrack}</div>
          <div>{tip.row.fitSummary}</div>
        </div>
      )}
    </>
  );
}
