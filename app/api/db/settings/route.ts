import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { currentUser, isDbAdmin } from '@/lib/auth';
import { dbConfigured, setKv } from '@/lib/db';
import { PIPELINE_TAG } from '@/lib/sheet';

/** The Database page's switches: read the CRM from Neon (readFromDb), and fast saves (fastSaves, stage 2). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!isDbAdmin(user)) return NextResponse.json({ ok: false, error: 'Only Miguel can change the database settings.' }, { status: 403 });
  if (!dbConfigured()) return NextResponse.json({ ok: false, error: 'The database is not connected (DATABASE_URL).' }, { status: 503 });
  const body = await req.json().catch(() => null) as { readFromDb?: boolean; fastSaves?: boolean } | null;
  if (typeof body?.readFromDb === 'boolean') {
    await setKv('readFromDb', body.readFromDb);
    await setKv('readFromDbBy', { by: user, at: new Date().toISOString() });
    if (!body.readFromDb) await setKv('fastSaves', false); // fast saves need the database copy
  } else if (typeof body?.fastSaves === 'boolean') {
    await setKv('fastSaves', body.fastSaves);
    await setKv('fastSavesBy', { by: user, at: new Date().toISOString() });
  } else {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }
  revalidateTag(PIPELINE_TAG);
  return NextResponse.json({ ok: true });
}
