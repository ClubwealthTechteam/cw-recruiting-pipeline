import { NextResponse, after } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { drainOps } from '@/lib/savequeue';

export const maxDuration = 60;

/** Nudged by the Apps Script each 5-minute update: answers at once, then hands any waiting saves to the sheet. */
export async function POST(req: Request) {
  const { secret } = await req.json().catch(() => ({ secret: '' }));
  const expected = Buffer.from(process.env.APPS_SCRIPT_SECRET || '');
  const got = Buffer.from(String(secret || ''));
  if (!expected.length || expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  after(() => drainOps().catch(() => undefined));
  return NextResponse.json({ ok: true });
}
