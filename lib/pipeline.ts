import type { Row } from './sheet';

export const STAGES = [
  'Applied', 'Invited', 'Confirmed', 'Open for re-invite', 'Interview Completed',
  'Did Not Complete', 'No Show', 'Passed', 'Hired', 'Not Fit'
] as const;
export type Stage = (typeof STAGES)[number];

/** Grey = not engaged yet, blue = in progress, amber = needs action, red = missed, green = success. */
export const STAGE_TONE: Record<string, string> = {
  Applied: 'grey', Invited: 'blue', Confirmed: 'blue', 'Open for re-invite': 'amber',
  'Interview Completed': 'amber', 'Did Not Complete': 'red', 'No Show': 'red',
  Passed: 'green', Hired: 'green', 'Not Fit': 'grey'
};

/** Screening tags (Claude): Great = clearly meets the rule (1+ year or highly relevant), Good = meets 6 months, Not Fit = does not or not enough info. */
export const FIT_TONE: Record<string, string> = { Great: 'green', Good: 'blue', 'Not Fit': 'grey' };

export const REASON_REQUIRED = ['Not Fit', 'Did Not Complete', 'Open for re-invite'];

export const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
export const fullName = (a: Row) => `${s(a['First Name'])} ${s(a['Last Name'])}`.trim();
export const ymd = (v: unknown) => s(v).slice(0, 10);

export function todayPT(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
}

function addDays(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return t.toISOString().slice(0, 10);
}

/** Today if it is Wednesday, otherwise the next Wednesday (Pacific). */
export function upcomingWednesday(now = new Date()): string {
  const t = todayPT(now);
  const dow = new Date(`${t}T12:00:00Z`).getUTCDay();
  return addDays(t, (3 - dow + 7) % 7);
}

export function formatDate(d: string): string {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (!y) return d;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Monday-start week label for a 'YYYY-MM-DD ...' timestamp. */
function weekOf(ts: string): string {
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

export type SessionStats = { date: string; invited: number; confirmed: number; attended: number; completed: number; noShow: number };

/**
 * Funnel numbers. Historical applicants (invited by hand before the system, no Zoom data) are left out of
 * every rate; they still count in "applicants per week".
 */
export function metrics(applicants: Row[], history: Row[], flags: Row[], now = new Date()) {
  const reached = new Map<string, Set<string>>();
  for (const h of history) {
    const id = s(h['Applicant ID']);
    if (!reached.has(id)) reached.set(id, new Set());
    reached.get(id)!.add(s(h['To Stage']));
  }
  const did = (a: Row, stage: string) => s(a.Stage) === stage || !!reached.get(s(a['Applicant ID']))?.has(stage);
  const attended = (a: Row) => Number(a['Zoom Minutes']) > 0 || did(a, 'Interview Completed') || did(a, 'Did Not Complete');

  // Applicants per week, last 8 weeks, by source
  const thisWeek = weekOf(todayPT(now));
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * (7 - i)));
  const perWeek = weeks.map((w) => ({
    week: w,
    form: applicants.filter((a) => weekOf(s(a['Applied At (PT)'])) === w && s(a.Source) === 'Form').length,
    olj: applicants.filter((a) => weekOf(s(a['Applied At (PT)'])) === w && s(a.Source) === 'OLJ').length
  }));

  // Sessions: past Wednesdays (and today after the interview) with system-tracked invitees
  const today = todayPT(now);
  const tracked = applicants.filter((a) => s(a.Historical) !== 'Y' && ymd(a['Interview Date']));
  const sessionDates = [...new Set(tracked.map((a) => ymd(a['Interview Date'])))].filter((d) => d <= today).sort().slice(-8);
  const sessions: SessionStats[] = sessionDates.map((date) => {
    const inv = tracked.filter((a) => ymd(a['Interview Date']) === date && s(a.Stage) !== 'Applied');
    return {
      date,
      invited: inv.length,
      confirmed: inv.filter((a) => s(a['Confirmed At']) || did(a, 'Confirmed')).length,
      attended: inv.filter(attended).length,
      completed: inv.filter((a) => did(a, 'Interview Completed')).length,
      noShow: inv.filter((a) => did(a, 'No Show')).length
    };
  });
  const finished = sessions.filter((x) => x.attended + x.noShow > 0);
  const sum = (k: keyof SessionStats) => finished.reduce((t, x) => t + (x[k] as number), 0);

  // Pass rate by position, among those who completed an interview and have a decision
  const decided = tracked.filter((a) => did(a, 'Interview Completed') && ['Passed', 'Hired', 'Not Fit'].includes(s(a.Stage)));
  const positions = [...new Set(decided.map((a) => s(a.Position) || 'Other'))].sort();
  const byPosition = positions.map((p) => {
    const rows = decided.filter((a) => (s(a.Position) || 'Other') === p);
    const passed = rows.filter((a) => ['Passed', 'Hired'].includes(s(a.Stage))).length;
    return { position: p, decided: rows.length, passed, rate: rate(passed, rows.length) };
  });

  const toInterview = tracked.filter(attended).map((a) => days(s(a['Applied At (PT)']), s(a['Interview Date'])));

  return {
    perWeek,
    sessions: finished,
    confirmationRate: rate(sum('confirmed'), sum('invited')),
    showUpRate: rate(sum('attended'), sum('confirmed')),
    completionRate: rate(sum('completed'), sum('attended')),
    noShowRate: rate(sum('noShow'), sum('invited')),
    medianDaysToInterview: median(toInterview),
    byPosition,
    openFlags: flags.filter((f) => s(f.Status) === 'Open').length,
    awaitingReview: applicants.filter((a) => s(a.Stage) === 'Interview Completed').length,
    sessionCount: finished.length
  };
}

export const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
