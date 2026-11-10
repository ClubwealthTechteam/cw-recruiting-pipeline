import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { read } from '@/lib/sheet';

/** Google Sheets can take a while (Tara, 2026-11-10): give it up to a minute instead of failing early. */
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json({ ok: true, data: await read('chatGet', { id }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error' }, { status: 502 });
  }
}
