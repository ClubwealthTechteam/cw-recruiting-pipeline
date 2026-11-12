import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { dismissOp } from '@/lib/db';

/** Closes a "this save did not go through" message. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null) as { dismiss?: number } | null;
  if (!body || !Number.isInteger(body.dismiss)) return NextResponse.json({ ok: false }, { status: 400 });
  await dismissOp(body.dismiss!, user);
  return NextResponse.json({ ok: true });
}
