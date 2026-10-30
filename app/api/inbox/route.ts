import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getInbox, getConversation } from '@/lib/sheet';

/** GET /api/inbox?channel=email|olj : the inbox panel's list. GET /api/inbox?id=… : one applicant's conversation. */
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    const id = q.get('id');
    if (id) {
      if (!/^[A-Za-z]-[\w-]{1,40}$/.test(id)) return NextResponse.json({ ok: false, error: 'Bad id' }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await getConversation(id)) });
    }
    const channel = q.get('channel') === 'olj' ? 'olj' : 'email';
    return NextResponse.json({ ok: true, conversations: await getInbox(channel) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 502 });
  }
}
