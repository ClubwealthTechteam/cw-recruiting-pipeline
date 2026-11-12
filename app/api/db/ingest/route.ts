import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';
import { dbConfigured, upsertRows, trimTab, setKv, type SheetRow } from '@/lib/db';
import { PIPELINE_TAG } from '@/lib/sheet';

export const maxDuration = 60;

const TABS = ['Applicants', 'History', 'Needs Attention', 'Zoom Attendance', 'Outbox', 'Replies', 'Scorecards',
  'Views', 'Email Templates', 'Settings', 'OLJ', 'Positions'];
const KEYS = ['team', 'jobAds', 'zoomConfigured', 'lastFullCopy'];

/**
 * Rows from the Apps Script (Code.gs dbFlush_ / dbPushTab_), signed with the same secret the site uses to call it.
 * op upsert: rows of one tab by sheet row number; trim: drop rows past the sheet's last row; kv: one stored value.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { secret?: string; op?: string; tab?: string; rows?: SheetRow[]; lastRow?: number; key?: string; value?: unknown } | null;
  const expected = Buffer.from(process.env.APPS_SCRIPT_SECRET || '');
  const got = Buffer.from(String(body?.secret || ''));
  if (!body || !expected.length || expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (!dbConfigured()) return NextResponse.json({ ok: false, error: 'DATABASE_URL is not set' }, { status: 503 });
  try {
    if (body.op === 'upsert' && body.tab && TABS.includes(body.tab) && Array.isArray(body.rows)) {
      const rows = body.rows.filter((r) => Number.isInteger(r?.row) && r.row > 1 && r.data && typeof r.data === 'object');
      await upsertRows(body.tab, rows);
    } else if (body.op === 'trim' && body.tab && TABS.includes(body.tab) && Number.isInteger(body.lastRow)) {
      await trimTab(body.tab, body.lastRow!);
    } else if (body.op === 'kv' && body.key && KEYS.includes(body.key)) {
      await setKv(body.key, body.value);
    } else {
      return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
  revalidateTag(PIPELINE_TAG);
  return NextResponse.json({ ok: true });
}
