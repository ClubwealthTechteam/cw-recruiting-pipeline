import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';
import { PIPELINE_TAG } from '@/lib/sheet';

/** Called by the Apps Script whenever the sheet changes, so the site's next page load reads fresh data. */
export async function POST(req: Request) {
  const { secret } = await req.json().catch(() => ({ secret: '' }));
  const expected = Buffer.from(process.env.APPS_SCRIPT_SECRET || '');
  const got = Buffer.from(String(secret || ''));
  if (!expected.length || expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  revalidateTag(PIPELINE_TAG);
  return NextResponse.json({ ok: true });
}
