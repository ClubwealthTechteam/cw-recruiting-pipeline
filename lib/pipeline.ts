import type { Row } from './sheet';

export const STAGES = [
  'Applied', 'Invited', 'Confirmed', 'Open for re-invite', 'Interview Completed',
  'Did Not Complete', 'Uninterested | Left Zoom', 'No Show', 'No Confirmation', 'Passed Pre-Interview', 'Passed Interview', 'Benched', 'Hired', 'Onboarding', 'Not Fit', 'Banned'
] as const;

/** Board column order: the main flow first, then the side outcomes. */
export const BOARD_STAGES = [
  'Applied', 'Invited', 'Confirmed', 'Interview Completed', 'Passed Pre-Interview', 'Passed Interview', 'Benched', 'Hired', 'Onboarding',
  'Open for re-invite', 'Did Not Complete', 'Uninterested | Left Zoom', 'No Show', 'No Confirmation', 'Not Fit', 'Banned'
];

/** Hired or further along (Onboarding counts as hired everywhere). */
export const HIRED = ['Hired', 'Onboarding'];
/** Where applications come from. Referral = added by hand for someone a team member referred (no form, OLJ or email). */
export const SOURCES = ['Form', 'OLJ', 'Email', 'Referral'];
export const SOURCE_LABEL: Record<string, string> = { Form: 'Application form', OLJ: 'OnlineJobs.ph', Email: 'Emailed to CareersCW', Referral: 'Referral' };

/** Passed comes in two steps, Passed Pre-Interview then Passed Interview, and after both the person is Hired. */
export const PASSED = ['Passed Pre-Interview', 'Passed Interview', 'Benched'];
/** Stages whose move queues an email that must be approved before it is sent (Miguel, 2026-10-29). */
export const STATUS_EMAIL_FOR_STAGE: Record<string, string> = { Hired: 'Hired', Onboarding: 'Hired', 'Not Fit': 'Rejected', Benched: 'Benched' };
/** The next Passed step for someone at this stage (the scorecard's "Passed" suggestion applies this). */
export const nextPassed = (stage: string) => (stage === 'Passed Pre-Interview' ? 'Passed Interview' : 'Passed Pre-Interview');
export type Stage = (typeof STAGES)[number];

/** Grey = not engaged yet, blue = in progress, amber = needs action, red = missed, green = success. */
export const STAGE_TONE: Record<string, string> = {
  Applied: 'grey', Invited: 'blue', Confirmed: 'blue', 'Open for re-invite': 'amber',
  'Interview Completed': 'amber', 'Did Not Complete': 'red', 'Uninterested | Left Zoom': 'grey', 'No Show': 'red', 'No Confirmation': 'grey',
  'Passed Pre-Interview': 'green', 'Passed Interview': 'green', Benched: 'blue', Hired: 'green', Onboarding: 'green', 'Not Fit': 'grey', Banned: 'red'
};

/** Screening tags (Claude): Great = clearly meets the rule (1+ year or highly relevant), Good = meets 6 months, Not Fit = does not or not enough info. */
export const FIT_TONE: Record<string, string> = { Great: 'green', Good: 'blue', 'Not Fit': 'grey' };

export const REASON_REQUIRED = ['Did Not Complete', 'Open for re-invite'];

export const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** Test applicants (Source "Test", e.g. T-MIGUEL) show in the CRM but are left out of every count, rate and report. */
export const isTest = (a: Row) => s(a.Source) === 'Test';
export const fullName = (a: Row) => `${s(a['First Name'])} ${s(a['Last Name'])}`.trim();
export const ymd = (v: unknown) => s(v).slice(0, 10);

/**
 * A timestamp as Pacific "YYYY-MM-DD HH:mm:ss", so times sort newest-first as text. OLJ rows can carry UTC ISO
 * text ("2026-10-28T16:47:18.000000Z"), and sheet times can lack the leading zero on the hour ("9:46:32").
 */
export function ptStamp(v: unknown): string {
  const t = s(v).trim();
  if (!/T.*(Z|[+-]\d\d:?\d\d)$/.test(t)) return t.replace(/ (\d):/, ' 0$1:');
  const d = new Date(t.replace(/\.(\d{3})\d*/, '.$1'));
  if (isNaN(d.getTime())) return t;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(d);
}

/** "Oct 28, 2026, 9:47 AM" from a Pacific "YYYY-MM-DD HH:mm:ss". */
export function formatDateTime(stamp: string): string {
  const [, hh, mm] = /^\S+ (\d{2}):(\d{2})/.exec(stamp) || [];
  if (!hh) return formatDate(stamp);
  const h = Number(hh);
  return `${formatDate(stamp)}, ${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

export function todayPT(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
}

function addDays(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return t.toISOString().slice(0, 10);
}

/**
 * Cancelled Wednesdays (Settings CANCELLED_SESSIONS in the sheet). The server sets them from each data load and the
 * layout hands them to the browser, so every "next session" and session list skips them.
 */
export function cancelledSessions(): string[] {
  const g = globalThis as { __cwCancelled?: string[] };
  return Array.isArray(g.__cwCancelled) ? g.__cwCancelled : [];
}
export function setCancelledSessions(list: string[] | undefined) {
  (globalThis as { __cwCancelled?: string[] }).__cwCancelled = Array.isArray(list) ? list : [];
}
const skipCancelled = (d: string) => { const c = cancelledSessions(); let x = d; for (let i = 0; i < 52 && c.includes(x); i++) x = addDays(x, 7); return x; };

/** Today if it is Wednesday, otherwise the next Wednesday (Pacific), skipping cancelled sessions. */
export function upcomingWednesday(now = new Date()): string {
  const t = todayPT(now);
  const dow = new Date(`${t}T12:00:00Z`).getUTCDay();
  return skipCancelled(addDays(t, (3 - dow + 7) % 7));
}

/** The next n Wednesday sessions (Pacific) that have not started yet (2:00 PM PT), for "Move to another session". */
export function upcomingSessions(n = 8, now = new Date()): string[] {
  let first = upcomingWednesday(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(now));
  if (first === todayPT(now) && hour >= 14) first = skipCancelled(addDays(first, 7));
  const c = cancelledSessions();
  const out: string[] = [];
  for (let d = first; out.length < n; d = addDays(d, 7)) if (!c.includes(d)) out.push(d);
  return out;
}

export function formatDate(d: string): string {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (!y) return d;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Monday-start week label for a 'YYYY-MM-DD ...' timestamp. */
export function weekOf(ts: string): string {
  const d = ymd(ts);
  if (!d) return '';
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}

const rate = (n: number, d: number) => (d ? n / d : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

function days(a: string, b: string): number {
  return (Date.parse(`${ymd(b)}T00:00:00Z`) - Date.parse(`${ymd(a)}T00:00:00Z`)) / 86_400_000;
}

export type SessionStats = { date: string; invited: number; confirmed: number; attended: number; completed: number; noShow: number; noConfirmation: number };

/**
 * Funnel numbers. Historical applicants (invited by hand before the system, no Zoom data) are left out of
 * every rate; they still count in "applicants per week".
 */
export function metrics(allApplicants: Row[], history: Row[], flags: Row[], now = new Date(), opts: { session?: string } = {}) {
  const applicants = allApplicants.filter((a) => !isTest(a));
  const reached = new Map<string, Set<string>>();
  for (const h of history) {
    const id = s(h['Applicant ID']);
    if (!reached.has(id)) reached.set(id, new Set());
    reached.get(id)!.add(s(h['To Stage']));
  }
  const did = (a: Row, stage: string) => s(a.Stage) === stage || !!reached.get(s(a['Applicant ID']))?.has(stage);
  const attended = (a: Row) => Number(a['Zoom Minutes']) > 0 || did(a, 'Interview Completed') || did(a, 'Did Not Complete') || did(a, 'Uninterested | Left Zoom');

  // Applicants per week, last 8 weeks, by source
  const thisWeek = weekOf(todayPT(now));
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * (7 - i)));
  const perWeek = weeks.map((w) => ({
    week: w,
    form: applicants.filter((a) => weekOf(s(a['Applied At (PT)'])) === w && s(a.Source) === 'Form').length,
    olj: applicants.filter((a) => weekOf(s(a['Applied At (PT)'])) === w && s(a.Source) === 'OLJ').length,
    email: applicants.filter((a) => weekOf(s(a['Applied At (PT)'])) === w && s(a.Source) === 'Email').length,
    referral: applicants.filter((a) => weekOf(s(a['Applied At (PT)'])) === w && s(a.Source) === 'Referral').length
  }));

  // Sessions: past Wednesdays (and today after the interview) with system-tracked invitees
  const today = todayPT(now);
  const tracked = applicants.filter((a) => s(a.Historical) !== 'Y' && ymd(a['Interview Date']));
  const allDates = [...new Set(tracked.map((a) => ymd(a['Interview Date'])))].filter((d) => d <= today).sort();
  // One session when the dashboard is filtered to it, otherwise the last 8
  const sessionDates = opts.session ? allDates.filter((d) => d === opts.session) : allDates.slice(-8);
  const sessions: SessionStats[] = sessionDates.map((date) => {
    const inv = tracked.filter((a) => ymd(a['Interview Date']) === date && s(a.Stage) !== 'Applied');
    return {
      date,
      invited: inv.length,
      confirmed: inv.filter((a) => s(a['Confirmed At']) || did(a, 'Confirmed')).length,
      attended: inv.filter(attended).length,
      completed: inv.filter((a) => did(a, 'Interview Completed')).length,
      noShow: inv.filter((a) => did(a, 'No Show')).length,
      noConfirmation: inv.filter((a) => did(a, 'No Confirmation')).length
    };
  });
  const finished = sessions.filter((x) => x.attended + x.noShow + x.noConfirmation > 0);
  const sum = (k: keyof SessionStats) => finished.reduce((t, x) => t + (x[k] as number), 0);

  // Pass rate by position, among those who completed an interview and have a decision
  const decided = tracked.filter((a) => (!opts.session || ymd(a['Interview Date']) === opts.session) && did(a, 'Interview Completed') && [...PASSED, ...HIRED, 'Not Fit'].includes(s(a.Stage)));
  const positions = [...new Set(decided.map((a) => s(a.Position) || 'Other'))].sort();
  const byPosition = positions.map((p) => {
    const rows = decided.filter((a) => (s(a.Position) || 'Other') === p);
    const passed = rows.filter((a) => [...PASSED, ...HIRED].includes(s(a.Stage))).length;
    return { position: p, decided: rows.length, passed, rate: rate(passed, rows.length) };
  });

  const toInterview = tracked.filter((a) => (!opts.session || ymd(a['Interview Date']) === opts.session) && attended(a)).map((a) => days(s(a['Applied At (PT)']), s(a['Interview Date'])));

  return {
    perWeek,
    sessions: finished,
    confirmationRate: rate(sum('confirmed'), sum('invited')),
    showUpRate: rate(sum('attended'), sum('confirmed')),
    completionRate: rate(sum('completed'), sum('attended')),
    noShowRate: rate(sum('noShow'), sum('confirmed')),
    medianDaysToInterview: median(toInterview),
    byPosition,
    openFlags: flags.filter((f) => s(f.Status) === 'Open').length,
    awaitingReview: applicants.filter((a) => s(a.Stage) === 'Interview Completed').length,
    sessionCount: finished.length,
    sessionDates: allDates
  };
}

export const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

/** How many applicants applied for each position, most first. */
export function positionCounts(rows: Row[]): { position: string; count: number }[] {
  const m = new Map<string, number>();
  for (const a of rows) {
    const k = s(a.Position) || 'Other';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([position, count]) => ({ position, count })).sort((x, y) => y.count - x.count || x.position.localeCompare(y.position));
}

/** Pacific date `days` before today, for "last N days" windows. */
export const daysAgoPT = (days: number, now = new Date()) => addDays(todayPT(now), -days);

// ---------- interview scorecards (same rule as scoreSummary in Logic.gs) ----------

export const CRITERIA = ['Communication', 'English', 'Experience', 'Internet', 'Work Setup'] as const;
/** How each criterion is labelled on the scorecard. */
export const CRITERIA_LABEL: Record<string, string> = { 'Work Setup': 'Work setup (workspace & device)' };

/** 0 until someone rates every criterion; then the average of everyone's cards. Passed at 3.5+ with no 1s, otherwise Not Fit. */
export function scoreSummary(cards: Row[]): { average: number; count: number; suggestion: '' | 'Passed' | 'Not Fit' } {
  const rated = cards.filter((c) => CRITERIA.every((k) => Number(c[k]) >= 1 && Number(c[k]) <= 5));
  if (!rated.length) return { average: 0, count: 0, suggestion: '' };
  const per = CRITERIA.map((k) => rated.reduce((t, c) => t + Number(c[k]), 0) / rated.length);
  const average = Math.round((per.reduce((t, x) => t + x, 0) / per.length) * 10) / 10;
  const anyOne = rated.some((c) => CRITERIA.some((k) => Number(c[k]) === 1));
  return { average, count: rated.length, suggestion: average >= 3.5 && !anyOne ? 'Passed' : 'Not Fit' };
}

/** Comma-separated tags as a list. */
export const splitTags = (v: unknown) => s(v).split(',').map((t) => t.trim()).filter(Boolean);

/**
 * Live Zoom status during today's session, from the Zoom Attendance rows the live sync rewrites every few minutes.
 * Someone is "in Zoom now" when their Last Leave equals the latest Last Leave of any row today (the snapshot time);
 * otherwise they left at their Last Leave. Rows get a Result at the 3:30 wrap-up, and then the status disappears.
 */
export type ZoomLive = { inNow: boolean; lastLeave: string; minutes: string };
export function zoomLive(zoom: Row[], now = new Date()): Map<string, ZoomLive> {
  const today = todayPT(now);
  const hm = (v: unknown) => s(v).replace(/^(\d):/, '0$1:');
  const rows = zoom.filter((z) => ymd(z['Interview Date']) === today && s(z['Matched Applicant ID']) && !s(z.Result));
  const latest = rows.reduce((m, z) => (hm(z['Last Leave']) > m ? hm(z['Last Leave']) : m), '');
  const out = new Map<string, ZoomLive>();
  for (const z of rows) {
    const id = s(z['Matched Applicant ID']);
    const cur = { inNow: hm(z['Last Leave']) === latest, lastLeave: hm(z['Last Leave']), minutes: s(z['Total Minutes']) };
    const prev = out.get(id);
    if (!prev || cur.inNow || (!prev.inNow && cur.lastLeave > prev.lastLeave)) out.set(id, cur);
  }
  return out;
}

/** Hired / Rejected / Benched emails from the Outbox, newest first (Body only on those waiting for approval). */
export function statusEmails(outbox: Row[], applicantId?: string) {
  return outbox
    .filter((e) => ['Hired', 'Rejected', 'Benched', 'Onboarding'].includes(s(e.Type)) && (!applicantId || s(e['Applicant ID']) === applicantId))
    .map((e) => ({
      id: s(e['Email ID']), applicantId: s(e['Applicant ID']), type: s(e.Type), to: s(e.To), subject: s(e.Subject), body: s(e.Body),
      status: s(e.Status), queuedAt: s(e['Queued At']), queuedBy: s(e['Queued By']), decidedBy: s(e['Decided By']),
      decidedAt: s(e['Decided At']), sentAt: s(e['Sent At']), error: s(e.Error)
    }))
    .sort((x, y) => y.queuedAt.localeCompare(x.queuedAt));
}

// ---------- Philippine time next to Pacific time (Miguel, 2026-11-02) ----------

/** The real instant of a Pacific wall-clock time ("YYYY-MM-DD", "HH:mm"), daylight saving included. */
function ptInstant(day: string, hhmm: string): Date | null {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  if (!y || isNaN(h)) return null;
  const guess = Date.UTC(y, m - 1, d, h, mi || 0);
  // how far Pacific is from UTC at that moment (-7 or -8 hours)
  const asPT = new Date(new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(guess)).replace(' ', 'T') + ':00Z').getTime();
  return new Date(guess + (guess - asPT));
}

/** "Thu 6:00 AM PHT" (or "Nov 12, 6:00 AM PHT" with withDate) for a Pacific day and time. */
export function phtOf(day: string, hhmm = '14:00', withDate = false): string {
  const t = ptInstant(day, hhmm);
  if (!t) return '';
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', ...o }).format(t);
  return `${withDate ? f({ month: 'short', day: 'numeric' }) + ',' : f({ weekday: 'short' })} ${f({ hour: 'numeric', minute: '2-digit' })} PHT`;
}

/** "2:00 PM PT · Thu 6:00 AM PHT" for a session day. */
export const sessionTimes = (day: string) => `2:00 PM PT · ${phtOf(day)}`;

/** A Pacific stamp "YYYY-MM-DD HH:mm:ss" shown in Philippine time, e.g. "Oct 31, 8:14 AM PHT". */
export function stampPht(stamp: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2})/.exec(stamp);
  return m ? phtOf(m[1], `${m[2]}:${m[3]}`, true) : '';
}

/** Now as a Pacific stamp "YYYY-MM-DD HH:mm:ss" (compares as text with sheet stamps). */
export const nowStampPT = (now = new Date()) => ptStamp(now.toISOString());

// ---------- Hired | Homexa / Hired | Clubwealth (Miguel, 2026-11-05) ----------

export const HIRE_COMPANIES = [{ company: 'Homexa', label: 'Homexa' }, { company: 'Club Wealth', label: 'Clubwealth' }] as const;
const HIRING = ['Hired', 'Onboarding'];
/** The stage list for pickers: Hired and Onboarding appear once per company ("Hired | Homexa", "Hired | Clubwealth"). */
export const STAGE_CHOICES: string[] = STAGES.flatMap((st) => (HIRING.includes(st) ? HIRE_COMPANIES.map((c) => `${st} | ${c.label}`) : [st]));
/** "Hired | Homexa" → { stage: 'Hired', company: 'Homexa' }; any other stage → { stage, company: '' }. */
export function parseStageChoice(choice: string): { stage: string; company: string } {
  const m = /^(Hired|Onboarding) \| (.+)$/.exec(choice);
  if (!m) return { stage: choice, company: '' };
  return { stage: m[1], company: HIRE_COMPANIES.find((c) => c.label === m[2])?.company || '' };
}
export const needsStartDate = (choice: string) => !!parseStageChoice(choice).company;

/** Why someone is Not Fit (Miguel, 2026-11-05). Only "General not fit" prepares the Rejected email for approval. */
export const NOT_FIT_TYPES = [
  { key: 'internet', label: 'Bad internet', email: false },
  { key: 'device', label: 'Did not meet device requirements', email: false },
  { key: 'general', label: 'General not fit (Tara, Ron or Maggie decided)', email: true }
] as const;

/** "Homexa", "Club Wealth" or '' from an applicant's tags ("Hired | Homexa" / "Hired | Clubwealth"). */
export function hiredCompany(tags: unknown): string {
  const t = s(tags);
  return t.includes('Hired | Homexa') ? 'Homexa' : t.includes('Hired | Clubwealth') ? 'Club Wealth' : '';
}
/** Board: the Hired column split by company, with one for people hired before the company was asked. */
export const HIRED_COLUMNS = ['Hired | Homexa', 'Hired | Clubwealth', 'Hired | company not set'];
export const BOARD_COLUMNS = BOARD_STAGES.flatMap((st) => (st === 'Hired' ? HIRED_COLUMNS : [st]));
export function boardColumnOf(stage: string, tags: unknown): string {
  if (stage !== 'Hired') return stage;
  const c = hiredCompany(tags);
  return c === 'Homexa' ? 'Hired | Homexa' : c === 'Club Wealth' ? 'Hired | Clubwealth' : 'Hired | company not set';
}

/**
 * The Pacific date range [from, to] (inclusive, YYYY-MM-DD) for the Candidates "Applied" filter, or null for any time.
 * Weeks start on Monday, like the dashboard.
 */
export function appliedRange(key: string | undefined, from?: string, to?: string, now = new Date()): [string, string] | null {
  const today = todayPT(now);
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const monday = addDays(today, -dow);
  const ok = (d?: string) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  switch (key) {
    case 'today': return [today, today];
    case 'yesterday': return [addDays(today, -1), addDays(today, -1)];
    case '3d': return [addDays(today, -2), today];
    case '7d': return [addDays(today, -6), today];
    case '14d': return [addDays(today, -13), today];
    case '30d': return [addDays(today, -29), today];
    case 'thisweek': return [monday, today];
    case 'lastweek': return [addDays(monday, -7), addDays(monday, -1)];
    case 'custom': return ok(from) || ok(to) ? [ok(from) ? from! : '0000-01-01', ok(to) ? to! : '9999-12-31'] : null;
    default: return null;
  }
}
