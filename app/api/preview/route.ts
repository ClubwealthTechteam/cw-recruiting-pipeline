import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { read } from '@/lib/sheet';

export type Preview = { to: string; subject: string; body: string; session: string; name: string; doNotInvite: string };

/** What an email will look like before it is sent (nothing is queued). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b || !['invite', 'reinvite', 'reply'].includes(b.kind) || typeof b.id !== 'string') return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  try {
    const data = await read<Preview>('preview', { by: user, kind: b.kind, id: b.id, date: b.date, text: b.text, subject: b.subject, channel: b.channel });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
