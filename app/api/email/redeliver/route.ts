import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { currentUser } from '@/lib/auth';
import { dbConfigured, rowsByKey, applyPatches } from '@/lib/db';
import { ensureColumn, writeCells } from '@/lib/sheets';
import { ptNow } from '@/lib/fastsave';
import { DELIVERY_COL } from '@/lib/delivery';
import { PIPELINE_TAG } from '@/lib/sheet';

export const maxDuration = 60;

/**
 * The "not delivered" banner's buttons. resend: back to Queued, so it goes out again on the next send.
 * dismiss: "it did go out" / "leave it", recorded in Delivered At so the banner stops showing it.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const { ids, action } = (await req.json().catch(() => ({}))) as { ids?: string[]; action?: string };
  if (!Array.isArray(ids) || !ids.length || (action !== 'resend' && action !== 'dismiss')) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
  if (!dbConfigured()) return NextResponse.json({ ok: false, error: 'The database is not connected.' }, { status: 503 });
  try {
    await ensureColumn('Outbox', DELIVERY_COL);
    const rows = await rowsByKey('Outbox', 'Email ID', ids.map(String).slice(0, 50));
    for (const r of rows) {
      const st = String(r.data.Status || '');
      if (st !== 'Sent' && st !== 'Failed') continue; // changed meanwhile
      const set: Record<string, string> = action === 'resend'
        ? { Status: 'Queued', Error: '', 'Sent At': '', [DELIVERY_COL]: '' }
        : { [DELIVERY_COL]: `Checked by ${user} ${ptNow().slice(0, 16)}` };
      await writeCells('Outbox', r.row, set);
      await applyPatches([{ tab: 'Outbox', row: r.row, set }]);
    }
    revalidateTag(PIPELINE_TAG);
    return NextResponse.json({ ok: true, count: rows.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not save' }, { status: 500 });
  }
}
