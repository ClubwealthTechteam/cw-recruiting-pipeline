'use client';
import { useState } from 'react';
import { STAGE_CHOICES, REASON_REQUIRED, parseStageChoice } from '@/lib/pipeline';
import { useAction } from './useAction';

/** Follow-up reasons Recruitment picks most often; free text is still allowed. */
const PRESETS: Record<string, string[]> = {
  'Did Not Complete': ['Left early – told to reapply', 'Connection or equipment problem – told to reapply', 'Left early – not qualified', 'Joined late – not entertained'],
  'Not Fit': ['Internet below 50 Mbps', 'Equipment not suitable', 'Communication skills', 'Experience does not match the role', 'No-show history'],
  'Open for re-invite': ['Schedule conflict', 'Asked to reschedule', 'Emergency', 'Technical problem on the day'],
  'Uninterested | Left Zoom': ['Said the role is not for them and left Zoom', 'Left after the work rules were explained'],
  Benched: ['Passed the interview, waiting for an open position'],
  Banned: ['Email is on the Rejected list'],
  'No Show': ['Confirmed but did not join Zoom'],
  'No Confirmation': ['Invited, never confirmed, did not join'],
  'Passed Pre-Interview': ['Passed the pre-interview'],
  'Passed Interview': ['Passed the interview'],
  Hired: ['Offer accepted'],
  Onboarded: ['Started onboarding']
};

/** Moves one or more applicants to a stage. A reason is required for Not Fit, Did Not Complete and re-invites. */
export default function StageForm({ ids, current, onDone }: { ids: string[]; current?: string; onDone?: () => void }) {
  const [stage, setStage] = useState('');
  const [reason, setReason] = useState('');
  const [startDate, setStartDate] = useState('');
  const { run, busy, error } = useAction();
  const pick = parseStageChoice(stage); // "Hired | Homexa" → Hired + company
  const needReason = REASON_REQUIRED.includes(pick.stage);
  const needStart = !!pick.company;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stage || (needReason && !reason.trim()) || (needStart && !startDate)) return;
    const ok = await run({ action: 'setStage', ids, stage: pick.stage, reason, ...(needStart ? { company: pick.company, startDate } : {}) },
      needStart ? { success: `Moved to ${stage} ✓ Welcome & Onboarding email waiting in Needs Approval` } : {});
    if (ok) { setStage(''); setReason(''); setStartDate(''); onDone?.(); }
  }
  return (
    <form onSubmit={submit} className="inline-form">
      <select id={ids.length === 1 ? 'stage-select' : undefined} value={stage} onChange={(e) => setStage(e.target.value)} disabled={!ids.length || busy}>
        <option value="">Move {ids.length > 1 ? `${ids.length} selected` : ''} to…</option>
        {STAGE_CHOICES.filter((x) => parseStageChoice(x).stage !== current || parseStageChoice(x).company).map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      {needStart && <label className="check-label">Start date <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required aria-label="Start date" /></label>}
      {stage && PRESETS[pick.stage] && (
        <select value={PRESETS[pick.stage].includes(reason) ? reason : ''} onChange={(e) => setReason(e.target.value)} aria-label="Common reasons">
          <option value="">Common reasons…</option>
          {PRESETS[pick.stage].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
      {stage && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needReason ? 'Reason (required)' : 'Reason (optional)'} />
      )}
      <button className="btn primary" disabled={!stage || busy || (needReason && !reason.trim()) || (needStart && !startDate)}>{busy ? 'Saving…' : 'Apply'}</button>
      {stage === 'Open for re-invite' && <span className="hint">A new invite is emailed for the following Wednesday.</span>}
      {needStart && <span className="hint">Tags them &quot;{pick.stage === 'Hired' ? stage : `Hired | ${stage.split(' | ')[1]}`}&quot; and prepares the {pick.company === 'Homexa' ? 'Homexa' : 'Club Wealth'} Welcome &amp; Onboarding email for that start date. It waits in Needs Approval.</span>}
      {error && <span className="error">{error}</span>}
    </form>
  );
}
