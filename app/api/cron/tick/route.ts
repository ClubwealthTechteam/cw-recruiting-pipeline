import { NextResponse, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';
import { sendDue } from '@/lib/engine/send';
import { drainOps } from '@/lib/savequeue';
import { setKv } from '@/lib/db';
import { PIPELINE_TAG } from '@/lib/sheet';

export const maxDuration = 60;

/**
 * The clock (stage 3): the Apps Script pings this every minute (crmClock). Answers at once, then runs the CRM's
 * background jobs: waiting fast saves, then sending emails (once switched on, Database page).
 */
export async function POST(req: Request) {
  const { secret } = await req.json().catch(() => ({ secret: '' }));
  const expected = Buffer.from(process.env.APPS_SCRIPT_SECRET || '');
  const got = Buffer.from(String(secret || ''));
  if (!expected.length || expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  after(async () => {
    const at = new Date().toISOString();
    let sending: unknown = null;
    try { await drainOps(15_000); } catch { /* next minute */ }
    try { sending = await sendDue(); } catch (e) { sending = { error: e instanceof Error ? e.message : String(e) }; }
    try { await setKv('lastClock', { at, sending }); } catch { /* not critical */ }
    revalidateTag(PIPELINE_TAG);
  });
  return NextResponse.json({ ok: true });
}
