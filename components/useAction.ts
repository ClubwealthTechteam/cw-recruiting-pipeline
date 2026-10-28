'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from './Toaster';

/** What the toast says after each action succeeds, unless the caller passes its own message. */
function doneMessage(body: Record<string, unknown>): string {
  switch (body.action) {
    case 'setStage': {
      const n = Array.isArray(body.ids) ? body.ids.length : 1;
      return `${n > 1 ? `${n} applicants moved` : 'Moved'} to ${body.stage} ✓`;
    }
    case 'addNote': return 'Note added ✓';
    case 'setEmail': return 'Email saved ✓';
    case 'resolveFlag': return 'Marked resolved ✓';
    case 'sendInvite': return 'Invite queued ✓';
    case 'saveScore': return 'Scorecard saved ✓';
    case 'setTags': return 'Tags saved ✓';
    case 'saveView': return 'View saved ✓';
    case 'deleteView': return 'View removed';
    case 'sendReply': return 'Email reply queued ✓ (sends within 5 minutes)';
    case 'sendOljMessage': return 'OLJ message queued ✓ (sends on the next OLJ run)';
    default: return 'Saved ✓';
  }
}

/** Posts one action to /api/action, shows a toast, then refreshes the page data. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(body: Record<string, unknown>, opts: { success?: string } = {}) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Something went wrong');
      toast(opts.success || doneMessage(body));
      router.refresh();
      return json.data ?? true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      setError(msg);
      toast(msg, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}
