import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { currentUser, isDbAdmin } from '@/lib/auth';
import { dbConfigured, setKv } from '@/lib/db';
import { setSheetSetting } from '@/lib/sheets';
import { PIPELINE_TAG } from '@/lib/sheet';

/** The Database page's switches: read the CRM from Neon (readFromDb), and fast saves (fastSaves, stage 2). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!isDbAdmin(user)) return NextResponse.json({ ok: false, error: 'Only Miguel can change the database settings.' }, { status: 403 });
  if (!dbConfigured()) return NextResponse.json({ ok: false, error: 'The database is not connected (DATABASE_URL).' }, { status: 503 });
  const body = await req.json().catch(() => null) as { readFromDb?: boolean; fastSaves?: boolean; engineSend?: boolean } | null;
  if (typeof body?.readFromDb === 'boolean') {
    await setKv('readFromDb', body.readFromDb);
    await setKv('readFromDbBy', { by: user, at: new Date().toISOString() });
    if (!body.readFromDb) await setKv('fastSaves', false); // fast saves need the database copy
  } else if (typeof body?.fastSaves === 'boolean') {
    await setKv('fastSaves', body.fastSaves);
    await setKv('fastSavesBy', { by: user, at: new Date().toISOString() });
  } else if (typeof body?.engineSend === 'boolean') {
    // stage 3a: who sends the queued emails. The sheet setting first, so the Apps Script stops before the CRM starts
    // (and the CRM stops before the Apps Script starts again): never both.
    try {
      if (body.engineSend) { await setSheetSetting('ENGINE_SEND', 'CRM'); await setKv('engineSend', true); }
      else { await setKv('engineSend', false); await setSheetSetting('ENGINE_SEND', 'APPS_SCRIPT'); }
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not change who sends' }, { status: 500 });
    }
    await setKv('engineSendBy', { by: user, at: new Date().toISOString(), on: body.engineSend });
  } else {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }
  revalidateTag(PIPELINE_TAG);
  return NextResponse.json({ ok: true });
}
