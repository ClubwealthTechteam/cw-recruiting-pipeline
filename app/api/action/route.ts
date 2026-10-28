import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { act } from '@/lib/sheet';
import { fireRoutine } from '@/lib/chat';

const ALLOWED = ['setStage', 'addNote', 'setEmail', 'resolveFlag', 'sendInvite', 'saveScore', 'setTags', 'saveView', 'deleteView', 'sendReply', 'sendOljMessage', 'undoStage', 'undoNote'];

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !ALLOWED.includes(body.action)) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  const { action, ...payload } = body;
  try {
    const data = await act(action, user, payload);
    if ((action === 'sendInvite' && payload.channel === 'olj') || action === 'sendOljMessage') {
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
