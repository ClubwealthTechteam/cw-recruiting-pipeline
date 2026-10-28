'use client';
import { useState } from 'react';
import { useAction } from './useAction';
import { CRITERIA, CRITERIA_LABEL, scoreSummary } from '@/lib/pipeline';

type Card = Record<string, string | number>;

/**
 * Interview scorecard: each person rates 1–5 per criterion (0 = not rated yet). The CRM suggests Passed or Not Fit
 * from everyone's average, and one click applies it.
 */
export default function Scorecard({ id, me, stage, cards }: { id: string; me: string; stage: string; cards: Card[] }) {
  const mine = cards.find((c) => String(c['Scored By']) === me);
  const [scores, setScores] = useState<Record<string, number>>(() => Object.fromEntries(CRITERIA.map((k) => [k, Number(mine?.[k]) || 0])));
  const [note, setNote] = useState(String(mine?.Note || ''));
  const { run, busy, error } = useAction();
  const s = scoreSummary(cards);
  const complete = CRITERIA.every((k) => scores[k] >= 1);
  const decided = ['Passed', 'Hired', 'Onboarded', 'Not Fit'].includes(stage);

  return (
    <div className="scorecard">
      <div className="score-summary">
        <div className={`score-big ${s.count ? (s.suggestion === 'Passed' ? 'green' : 'red') : ''}`}>{s.count ? s.average.toFixed(1) : '0'}<span>/5</span></div>
        <div>
          {s.count ? <div><strong>Suggested: {s.suggestion}</strong> <span className="muted">· {s.count} scorecard{s.count > 1 ? 's' : ''}</span></div>
            : <div className="muted">Not rated yet. Scores start at 0 until someone rates all five.</div>}
          {s.count > 0 && !decided && (
            <button className="btn primary small-btn" disabled={busy}
              onClick={() => run({ action: 'setStage', ids: [id], stage: s.suggestion, reason: `Scorecard ${s.average.toFixed(1)}/5` })}>
              Apply: {s.suggestion}
            </button>
          )}
          {decided && s.count > 0 && <div className="hint">Decision already made: {stage}.</div>}
        </div>
      </div>
      <form className="score-form" onSubmit={async (e) => { e.preventDefault(); await run({ action: 'saveScore', id, scores, note }); }}>
        <div className="hint">Your scorecard ({me}). 1 = poor, 5 = excellent.</div>
        {CRITERIA.map((k) => (
          <div key={k} className="score-row">
            <span>{CRITERIA_LABEL[k] || k}</span>
            <div className="score-dots" role="radiogroup" aria-label={k}>
              {[1, 2, 3, 4, 5].map((v) => (
                <button type="button" key={v} role="radio" aria-checked={scores[k] === v}
                  className={scores[k] >= v ? 'on' : ''} onClick={() => setScores({ ...scores, [k]: scores[k] === v ? 0 : v })}>{v}</button>
              ))}
            </div>
          </div>
        ))}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes from the interview (optional)" />
        <button className="btn" disabled={busy || !complete}>{busy ? 'Saving…' : mine ? 'Update my scorecard' : 'Save my scorecard'}</button>
        {!complete && <span className="hint">Rate all five to save.</span>}
        {error && <span className="error">{error}</span>}
      </form>
      {cards.length > 0 && (
        <table className="table compact">
          <thead><tr><th>By</th>{CRITERIA.map((k) => <th key={k}>{k === 'Work Setup' ? 'Setup' : k}</th>)}<th>Avg</th></tr></thead>
          <tbody>{cards.map((c) => (
            <tr key={String(c['Scored By'])} title={String(c.Note || '')}>
              <td>{String(c['Scored By'])}</td>{CRITERIA.map((k) => <td key={k}>{Number(c[k]) || 0}</td>)}<td>{Number(c.Average || 0).toFixed(1)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
