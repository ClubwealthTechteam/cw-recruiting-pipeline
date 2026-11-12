import { NextResponse, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { currentUser } from '@/lib/auth';
import { act, PIPELINE_TAG } from '@/lib/sheet';
import { fastSave } from '@/lib/fastsave';
import { fastSavesOn, drainOps } from '@/lib/savequeue';
import { applyPatches, enqueueOp } from '@/lib/db';
import { fireRoutine } from '@/lib/chat';

/** Google Sheets can take a while (Tara, 2026-11-10): give it up to a minute instead of failing early. */
export const maxDuration = 60;

const ALLOWED = ['setStage', 'addNote', 'setEmail', 'resolveFlag', 'sendInvite', 'saveScore', 'setTags', 'saveView', 'deleteView', 'sendReply', 'sendOljMessage', 'undoStage', 'undoNote', 'addApplicant', 'replyToEmail', 'linkReply', 'updateApplicant', 'approveEmail', 'approveEmails', 'dbPushAll', 'skipEmail', 'updateTeam', 'moveSession', 'sendTemplate', 'reinviteNoShows', 'editPendingEmail', 'startZoomTracking', 'setAutoInvites', 'setActivePositions', 'pauseInvites', 'attachToEmail', 'saveTemplate', 'deleteTemplate', 'bulkMessage'];

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !ALLOWED.includes(body.action)) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  const { action, ...payload } = body;
  try {
    // Database stage 2: the common saves are shown at once and done on the sheet right after, in order.
    const fastOn = await fastSavesOn();
    if (fastOn) {
      const fast = await fastSave(action, user, payload);
      if (fast) {
        await applyPatches(fast.patches);
        await enqueueOp(user, fast.body, fast.revert, fast.label);
        revalidateTag(PIPELINE_TAG);
        after(() => drainOps().catch(() => undefined));
        return NextResponse.json({ ok: true, data: fast.data });
      }
    }
    // a save that goes straight to the sheet waits for the fast saves made before it, so they happen in order
    if (fastOn) await drainOps(25000).catch(() => undefined);
    const data = await act(action, user, payload);
    if ((action === 'sendInvite' && payload.channel === 'olj') || action === 'sendOljMessage' || (action === 'sendTemplate' && payload.channel === 'olj')) {
      // Start the OLJ sender now if it is connected; otherwise the next scheduled OLJ run sends it.
      const started = await fireRoutine(process.env.OLJ_SEND_ROUTINE_ID, process.env.OLJ_SEND_ROUTINE_TOKEN, 'Send queued OLJ invites')
        .then(() => true).catch(() => false);
      return NextResponse.json({ ok: true, data: { ...data, started } });
    }
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
