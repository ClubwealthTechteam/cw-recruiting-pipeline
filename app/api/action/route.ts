import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { act } from '@/lib/sheet';

const ALLOWED = ['setStage', 'addNote', 'setEmail', 'resolveFlag'];

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !ALLOWED.includes(body.action)) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  const { action, ...payload } = body;
  try {
    const data = await act(action, user, payload);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 400 });
  }
}
