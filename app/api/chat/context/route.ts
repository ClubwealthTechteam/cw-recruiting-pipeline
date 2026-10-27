import { NextResponse } from 'next/server';
import { getData, read } from '@/lib/sheet';
import { validChatToken } from '@/lib/chat';
import { metrics, s, fullName, ymd, STAGES } from '@/lib/pipeline';

/**
 * Read-only pipeline context for the chat routine, for one pending question.
 * No emails or phone numbers. Applicants invited by hand before the system are summarized, not listed.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get('id') || '';
  if (!validChatToken(id, u.searchParams.get('t') || '')) return NextResponse.json({ ok: false }, { status: 403 });
  const chat = (await read('chatGet', { id })) as { found: boolean; status: string; question: string };
  if (!chat.found || chat.status !== 'Pending') return NextResponse.json({ ok: false, error: 'not pending' }, { status: 410 });
  const d = await getData();
  const m = metrics(d.applicants, d.history, d.flags);
  const current = d.applicants.filter((a) => s(a.Historical) !== 'Y');
  const historical = d.applicants.filter((a) => s(a.Historical) === 'Y');
  const count = (rows: typeof d.applicants) => Object.fromEntries(STAGES.map((st) => [st, rows.filter((a) => s(a.Stage) === st).length]));
  return NextResponse.json({
    ok: true,
    question: chat.question,
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()),
    definitions: 'Interviews are Wednesdays 2:00 PM Pacific. Stages: Applied, Invited, Confirmed (replied with full name), Open for re-invite, Interview Completed (30+ min in Zoom), Did Not Complete (under 30), No Show, Passed, Hired, Not Fit. Rates exclude applicants invited by hand before the system started.',
    metrics: { ...m, perWeek: m.perWeek },
    stageCounts: count(current),
    beforeSystem: { applicants: historical.length, firstApplied: ymd(historical[0]?.['Applied At (PT)']), stageCounts: count(historical) },
    openFlags: d.flags.filter((f) => s(f.Status) === 'Open').map((f) => ({ type: s(f.Type), created: s(f['Created At']) })),
    applicants: current.map((a) => ({
      id: s(a['Applicant ID']), name: fullName(a), source: s(a.Source), position: s(a.Position), applied: ymd(a['Applied At (PT)']),
      stage: s(a.Stage), session: ymd(a['Interview Date']), confirmed: !!a['Confirmed At'], zoomMinutes: a['Zoom Minutes'] ?? null,
      invites: Number(a['Invite Count']) || 0
    }))
  });
}
