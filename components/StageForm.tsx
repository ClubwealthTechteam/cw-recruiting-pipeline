'use client';
import { useState } from 'react';
import { STAGES, REASON_REQUIRED } from '@/lib/pipeline';
import { useAction } from './useAction';

/** Follow-up reasons Recruitment picks most often; free text is still allowed. */
const PRESETS: Record<string, string[]> = {
  'Did Not Complete': ['Left early – told to reapply', 'Connection or equipment problem – told to reapply', 'Left early – not qualified', 'Joined late – not entertained'],
  'Not Fit': ['Internet below 50 Mbps', 'Equipment not suitable', 'Communication skills', 'Experience does not match the role', 'No-show history'],
  'Open for re-invite': ['Schedule conflict', 'Asked to reschedule', 'Emergency', 'Technical problem on the day'],
  'Uninterested | Left Zoom': ['Said the role is not for them and left Zoom', 'Left after the work rules were explained'],
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
  const { run, busy, error } = useAction();
  const needReason = REASON_REQUIRED.includes(stage);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stage || (needReason && !reason.trim())) return;
    const ok = await run({ action: 'setStage', ids, stage, reason });
    if (ok) { setStage(''); setReason(''); onDone?.(); }
  }
  return (
    <form onSubmit={submit} className="inline-form">
      <select value={stage} onChange={(e) => setStage(e.target.value)} disabled={!ids.length || busy}>
        <option value="">Move {ids.length > 1 ? `${ids.length} selected` : ''} to…</option>
        {STAGES.filter((x) => x !== current).map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      {stage && PRESETS[stage] && (
        <select value={PRESETS[stage].includes(reason) ? reason : ''} onChange={(e) => setReason(e.target.value)} aria-label="Common reasons">
          <option value="">Common reasons…</option>
          {PRESETS[stage].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
      {stage && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needReason ? 'Reason (required)' : 'Reason (optional)'} />
      )}
      <button className="btn primary" disabled={!stage || busy || (needReason && !reason.trim())}>{busy ? 'Saving…' : 'Apply'}</button>
      {stage === 'Open for re-invite' && <span className="hint">A new invite is emailed for the following Wednesday.</span>}
      {error && <span className="error">{error}</span>}
    </form>
  );
}
