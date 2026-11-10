import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { read } from '@/lib/sheet';

/** Google Sheets can take a while (Tara, 2026-11-10): give it up to a minute instead of failing early. */
export const maxDuration = 60;

/** Marks the signed-in person as viewing an applicant and returns who else is viewing it. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.id !== 'string') return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const data = await read<{ others: string[] }>('presence', { by: user, id: b.id });
    return NextResponse.json({ ok: true, data });
  } catch {
    return NextResponse.json({ ok: true, data: { others: [] } }); // an older Apps Script without presence: show nothing
  }
}
