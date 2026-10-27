'use client';
import { useState } from 'react';
import { STAGES, REASON_REQUIRED } from '@/lib/pipeline';
import { useAction } from './useAction';

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
      {stage && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={needReason ? 'Reason (required)' : 'Reason (optional)'} />
      )}
      <button className="btn primary" disabled={!stage || busy || (needReason && !reason.trim())}>{busy ? 'Saving…' : 'Apply'}</button>
      {stage === 'Open for re-invite' && <span className="hint">A new invite is emailed for the following Wednesday.</span>}
      {error && <span className="error">{error}</span>}
    </form>
  );
}
