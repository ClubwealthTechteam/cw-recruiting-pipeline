import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getEmailThread } from '@/lib/sheet';

/** GET /api/thread?email=… : the CareersCW emails from one address (Needs Attention, unmatched replies). */
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const email = new URL(req.url).searchParams.get('email') || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: 'Bad email' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, thread: await getEmailThread(email) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 502 });
  }
}
