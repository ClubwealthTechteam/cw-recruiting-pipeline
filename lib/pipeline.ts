import type { Row } from './sheet';

export const STAGES = [
  'Applied', 'Invited', 'Confirmed', 'Open for re-invite', 'Interview Completed',
  'Did Not Complete', 'No Show', 'Passed', 'Hired', 'Onboarded', 'Not Fit'
] as const;

/** Board column order: the main flow first, then the side outcomes. */
export const BOARD_STAGES = [
  'Applied', 'Invited', 'Confirmed', 'Interview Completed', 'Passed', 'Hired', 'Onboarded',
  'Open for re-invite', 'Did Not Complete', 'No Show', 'Not Fit'
];

/** Hired or further along (Onboarded counts as hired everywhere). */
export const HIRED = ['Hired', 'Onboarded'];
export type Stage = (typeof STAGES)[number];

/** Grey = not engaged yet, blue = in progress, amber = needs action, red = missed, green = success. */
export const STAGE_TONE: Record<string, string> = {
  Applied: 'grey', Invited: 'blue', Confirmed: 'blue', 'Open for re-invite': 'amber',
  'Interview Completed': 'amber', 'Did Not Complete': 'red', 'No Show': 'red',
  Passed: 'green', Hired: 'green', Onboarded: 'green', 'Not Fit': 'grey'
};

/** Screening tags (Claude): Great = clearly meets the rule (1+ year or highly relevant), Good = meets 6 months, Not Fit = does not or not enough info. */
export const FIT_TONE: Record<string, string> = { Great: 'green', Good: 'blue', 'Not Fit': 'grey' };

export const REASON_REQUIRED = ['Not Fit', 'Did Not Complete', 'Open for re-invite'];

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

export type SessionStats = { date: string; invited: number; confirmed: number; attended: number; completed: number; noShow: number };

/**
 * Funnel numbers. Historical applicants (invited by hand before the system, no Zoom data) are left out of
 * every rate; they still count in "applicants per week".
 */
export function metrics(allApplicants: Row[], history: Row[], flags: Row[], now = new Date()) {
  const applicants = allApplicants.filter((a) => !isTest(a));
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
    olj: applicants.filter((a) => weekOf(s(a['Applied At (PT)'])) === w && s(a.Source) === 'OLJ').length,
    email: applicants.filter((a) => weekOf(s(a['Applied At (PT)'])) === w && s(a.Source) === 'Email').length
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
  const decided = tracked.filter((a) => did(a, 'Interview Completed') && ['Passed', 'Hired', 'Onboarded', 'Not Fit'].includes(s(a.Stage)));
  const positions = [...new Set(decided.map((a) => s(a.Position) || 'Other'))].sort();
  const byPosition = positions.map((p) => {
    const rows = decided.filter((a) => (s(a.Position) || 'Other') === p);
    const passed = rows.filter((a) => ['Passed', 'Hired', 'Onboarded'].includes(s(a.Stage))).length;
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
