import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { currentUser, isDbAdmin } from '@/lib/auth';
import { dbConfigured } from '@/lib/db';
import { runChecks } from '@/lib/health';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The watchdog's checks (lib/health.ts). The watchdog agent calls it with the X-Health-Key header (HEALTH_CHECK_KEY in
 * Vercel); Miguel can also open it signed in.
 */
export async function GET(req: Request) {
  const expected = Buffer.from((process.env.HEALTH_CHECK_KEY || '').trim());
  const got = Buffer.from((req.headers.get('x-health-key') || '').trim());
  const keyOk = expected.length > 0 && expected.length === got.length && timingSafeEqual(expected, got);
  if (!keyOk && !isDbAdmin(await currentUser())) return NextResponse.json({ ok: false }, { status: 403 });
  if (!dbConfigured()) return NextResponse.json({ ok: false, error: 'DATABASE_URL is not set' }, { status: 503 });
  try {
    return NextResponse.json({ ok: true, ...(await runChecks()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}
