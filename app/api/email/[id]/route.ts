import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { dbConfigured, rowsByKey } from '@/lib/db';
import { read, dataSource } from '@/lib/sheet';

/** One email as it was sent (Sending lists on Email Templates, Miguel 2026-11-12): from the database copy, else the sheet. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const { id } = await ctx.params;
  try {
    if (dbConfigured() && (await dataSource()) === 'database') {
      const [r] = await rowsByKey('Outbox', 'Email ID', [id]);
      if (r) return NextResponse.json({ ok: true, data: { subject: String(r.data.Subject || ''), body: String(r.data.Body || ''), to: String(r.data.To || '') } });
    }
    const d = await read<{ subject: string; body: string; to: string } | null>('emailBody', { id });
    if (!d) return NextResponse.json({ ok: false, error: 'Email not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, data: d });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not load the email' }, { status: 500 });
  }
}
