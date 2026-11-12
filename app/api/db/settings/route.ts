import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { currentUser } from '@/lib/auth';
import { dbConfigured, setKv } from '@/lib/db';
import { PIPELINE_TAG } from '@/lib/sheet';

/** The Database page's switch: read the CRM's pages from Neon (true) or from the sheet (false). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!dbConfigured()) return NextResponse.json({ ok: false, error: 'The database is not connected (DATABASE_URL).' }, { status: 503 });
  const body = await req.json().catch(() => null) as { readFromDb?: boolean } | null;
  if (typeof body?.readFromDb !== 'boolean') return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  await setKv('readFromDb', body.readFromDb);
  await setKv('readFromDbBy', { by: user, at: new Date().toISOString() });
  revalidateTag(PIPELINE_TAG);
  return NextResponse.json({ ok: true });
}
