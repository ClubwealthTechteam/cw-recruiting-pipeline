import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { read } from '@/lib/sheet';
import { chatToken, fireChatRoutine } from '@/lib/chat';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const { question } = await req.json().catch(() => ({ question: '' }));
  const q = String(question || '').trim().slice(0, 1000);
  if (!q) return NextResponse.json({ ok: false, error: 'Type a question.' }, { status: 400 });
  try {
    const { id } = (await read<{ id: string }>('chatAsk', { by: user, question: q }));
    const base = new URL(req.url).origin;
    await fireChatRoutine(
      `Recruiting Pipeline question\nQuestion ID: ${id}\nAsked by: ${user}\nBase URL: ${base}\nReply token: ${chatToken(id)}`
    );
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 502 });
  }
}
