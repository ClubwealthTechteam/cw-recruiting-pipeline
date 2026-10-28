import { NextResponse, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';
import { PIPELINE_TAG, getData } from '@/lib/sheet';

/**
 * Called by the Apps Script whenever the sheet changes. Drops the cached copy and loads the fresh one right away,
 * so Am and Camille's next click is served from the cache instead of waiting for the sheet.
 */
export async function POST(req: Request) {
  const { secret } = await req.json().catch(() => ({ secret: '' }));
  const expected = Buffer.from(process.env.APPS_SCRIPT_SECRET || '');
  const got = Buffer.from(String(secret || ''));
  if (!expected.length || expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  revalidateTag(PIPELINE_TAG);
  after(async () => { try { await getData(); } catch { /* the next page load reads it instead */ } });
  return NextResponse.json({ ok: true });
}
