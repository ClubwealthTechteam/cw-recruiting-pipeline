'use client';
import { useAction } from './useAction';
import { notFitFields } from './hirePrompt';

const CHOICES: { stage: string; label: string; tone: string; reason?: boolean }[] = [
  { stage: 'Passed Pre-Interview', label: 'Pass', tone: 'pass' },
  { stage: 'Not Fit', label: 'Not Fit', tone: 'fail' },
  { stage: 'Uninterested | Left Zoom', label: 'Left Zoom', tone: '' },
  { stage: 'Did Not Complete', label: 'Did not finish', tone: '', reason: true }
];

/** Session day mode: one-click decisions per person during the 2 PM call (with Undo in the toast). */
export default function QuickDecide({ id, name, stage }: { id: string; name: string; stage: string }) {
  const { run, busy } = useAction();
  async function pick(c: (typeof CHOICES)[number]) {
    if (c.stage === 'Not Fit') {
      const nf = notFitFields(name);
      if (nf) await run({ action: 'setStage', ids: [id], stage: 'Not Fit', ...nf }, { success: `${name}: Not Fit ✓` });
      return;
    }
    let reason = '';
    if (c.reason) {
      reason = prompt(`Reason for ${name} (${c.stage}):`)?.trim() || '';
      if (!reason) return;
    }
    await run({ action: 'setStage', ids: [id], stage: c.stage, reason }, { success: `${name}: ${c.stage} ✓` });
  }
  return (
    <div className="decide">
      {CHOICES.map((c) => <button key={c.stage} type="button" className={`btn ${c.tone}`} disabled={busy || stage === c.stage} onClick={() => pick(c)}>{c.label}</button>)}
    </div>
  );
}
