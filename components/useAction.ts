'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from './Toaster';
import { pushUndo, dropUndo, type UndoEntry } from './undo';

/** What the toast says after each action succeeds, unless the caller passes its own message. */
function doneMessage(body: Record<string, unknown>): string {
  switch (body.action) {
    case 'setStage': {
      const n = Array.isArray(body.ids) ? body.ids.length : 1;
      return `${n > 1 ? `${n} applicants moved` : 'Moved'} to ${body.stage} ✓`;
    }
    case 'addNote': return 'Note added ✓';
    case 'setEmail': return 'Email saved ✓';
    case 'replyToEmail': return 'Email reply queued ✓ (sends within 5 minutes)';
    case 'linkReply': return 'Linked ✓';
    case 'updateApplicant': return 'Profile saved ✓';
    case 'updateTeam': return 'Team member updated ✓';
    case 'addApplicant': return `${body.firstName} ${body.lastName} added ✓`;
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

type Body = Record<string, unknown>;

/** The request that reverses an action, from what the action returned (null when it cannot be undone). */
function undoFor(body: Body, data: Record<string, unknown> | null): Body | null {
  if (!data) return null;
  if (body.action === 'setStage') {
    const u = data.undo as { moves?: unknown[]; queued?: unknown[] } | undefined;
    return u && u.moves && u.moves.length ? { action: 'undoStage', ...u } : null;
  }
  if (body.action === 'addNote' && data.line) return { action: 'undoNote', id: body.id, line: data.line };
  if (body.action === 'setTags' && typeof data.before === 'string') return { action: 'setTags', id: body.id, tags: data.before };
  return null;
}

/** Runs one undo entry and says how it went. Shared by the toast, the Undo buttons and Ctrl+Z. */
export async function runUndo(entry: UndoEntry, refresh: () => void) {
  dropUndo(entry.at);
  try {
    const r = await post(entry.body);
    const sent = Number(r?.alreadySent) || 0;
    toast(sent ? `Undone: ${entry.label}. ${sent} email had already gone out and could not be stopped.` : `Undone: ${entry.label} ✓`, sent ? 'error' : 'ok');
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Could not undo', 'error');
  }
  refresh();
}

async function post(body: Body) {
  const res = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Something went wrong');
  return json.data;
}

/** Posts one action to /api/action, shows a toast (with Undo where it can be undone), then refreshes the page data. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(body: Body, opts: { success?: string } = {}) {
    setBusy(true);
    setError('');
    try {
      const data = await post(body);
      const undo = undoFor(body, data);
      const message = opts.success || doneMessage(body);
      const entry = undo ? { label: message.replace(/ ✓.*$/, ''), body: undo, at: Date.now() } : null;
      if (entry) pushUndo(entry);
      toast(message, 'ok', entry ? { label: 'Undo', run: () => runUndo(entry, () => router.refresh()) } : undefined);
      router.refresh();
      return data ?? true;
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
