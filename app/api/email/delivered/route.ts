import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';
import { dbConfigured, rowsByKey, applyPatches, getKv, setKv } from '@/lib/db';
import { ensureColumn, writeCells } from '@/lib/sheets';
import { ptNow } from '@/lib/fastsave';
import { DELIVERY_COL } from '@/lib/delivery';
import { PIPELINE_TAG } from '@/lib/sheet';

/**
 * Zapier's report back (lib/delivery.ts): the last step of the "recruiting-pipeline-email-sender" Zap posts
 * { key, email_id } once Microsoft has sent the email, and its error handler posts { key, email_id, status: "failed",
 * error }. key is ZAPIER_CONFIRM_SECRET from Vercel (also accepted as ?key=).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { key?: string; email_id?: string; status?: string; error?: string };
  const expected = Buffer.from(process.env.ZAPIER_CONFIRM_SECRET || '');
  const got = Buffer.from(String(body.key || new URL(req.url).searchParams.get('key') || ''));
  if (!expected.length || expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const id = String(body.email_id || '').trim();
  if (!id) return NextResponse.json({ ok: false, error: 'email_id is missing' }, { status: 400 });
  if (!dbConfigured()) return NextResponse.json({ ok: false, error: 'DATABASE_URL is not set' }, { status: 503 });
  try {
    const [r] = await rowsByKey('Outbox', 'Email ID', [id]);
    if (!r) return NextResponse.json({ ok: false, error: 'Email not found: ' + id }, { status: 404 });
    const failed = String(body.status || '').toLowerCase() === 'failed';
    const set: Record<string, string> = failed
      ? { Status: 'Failed', Error: ('Zapier: ' + String(body.error || 'the send step failed')).slice(0, 300) }
      : { [DELIVERY_COL]: ptNow() };
    await ensureColumn('Outbox', DELIVERY_COL);
    await writeCells('Outbox', r.row, set);
    await applyPatches([{ tab: 'Outbox', row: r.row, set }]);
    if (!failed && !(await getKv('zapConfirmSince'))) await setKv('zapConfirmSince', ptNow());
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
  revalidateTag(PIPELINE_TAG);
  return NextResponse.json({ ok: true });
}
