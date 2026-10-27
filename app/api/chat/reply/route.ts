import { NextResponse } from 'next/server';
import { read } from '@/lib/sheet';
import { validChatToken } from '@/lib/chat';

/** The chat routine posts its answer here, once per question. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!validChatToken(id, String(body.t || ''))) return NextResponse.json({ ok: false }, { status: 403 });
  try {
    await read('chatAnswer', { id, answer: String(body.answer || '').slice(0, 5000) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 409 });
  }
}
