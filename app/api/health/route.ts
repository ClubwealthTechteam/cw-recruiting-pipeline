import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { currentUser, isDbAdmin } from '@/lib/auth';
import { dbConfigured } from '@/lib/db';
import { runChecks } from '@/lib/health';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The watchdog's checks (lib/health.ts). Anyone gets the levels and counts; the names and emails behind them only with
 * the X-Health-Key header (HEALTH_CHECK_KEY in Vercel, optional) or when Miguel is signed in.
 */
export async function GET(req: Request) {
  const expected = Buffer.from((process.env.HEALTH_CHECK_KEY || '').trim());
  const got = Buffer.from((req.headers.get('x-health-key') || '').trim());
  const keyOk = expected.length > 0 && expected.length === got.length && timingSafeEqual(expected, got);
  const full = keyOk || isDbAdmin(await currentUser());
  if (!dbConfigured()) return NextResponse.json({ ok: false, error: 'DATABASE_URL is not set' }, { status: 503 });
  try {
    const r = await runChecks();
    // Without the key or Miguel's sign-in: levels and counts only, never names or email addresses (the watchdog
    // agent reads the details from the sheet through Miguel's Google connection).
    if (!full) return NextResponse.json({ ok: true, at: r.at, summary: r.summary, checks: r.checks.map(({ items, ...c }) => ({ ...c, count: items?.length || 0 })) });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}
