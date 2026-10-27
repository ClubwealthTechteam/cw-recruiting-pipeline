import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { currentUser } from '@/lib/auth';
import { PIPELINE_TAG } from '@/lib/sheet';

/** "Refresh now": drop the cached copy so the next page load reads the sheet. */
export async function POST() {
  if (!(await currentUser())) return NextResponse.json({ ok: false }, { status: 401 });
  revalidateTag(PIPELINE_TAG);
  return NextResponse.json({ ok: true });
}
