import 'server-only';
import { readTabs, getKvs, opStats, tabStats } from '@/lib/db';
import { ptNow } from '@/lib/fastsave';
import { deliveryProblems } from '@/lib/delivery';

/**
 * The CRM watchdog (Miguel, 2026-11-13: "check EVERYTHING and report it to me"). Every check reads the database copy
 * and says ok / warn / bad with the people or emails involved. /api/health serves it to the watchdog agent, which posts
 * the problems to Miguel on Slack (CW Assistant). Each check is one past failure or one way the pipeline can go wrong
 * silently: emails dropped by Zapier (Nov 10-12), reminders to on-hold applicants (Nov 11), a stopped clock, ...
 */
export type Level = 'ok' | 'warn' | 'bad';
export type Check = { id: string; level: Level; title: string; detail: string; items?: string[] };

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const MAIL = ['Invite', 'Re-invite', 'Reminder', 'Confirmation', 'Reply', 'Hired', 'Rejected', 'Benched', 'Onboarding'];
const INVITE_TYPES = ['Invite', 'Re-invite', 'OLJ Invite', 'Reminder'];
const ACTIVE = ['Applied', 'Invited', 'Confirmed', 'Open for re-invite', 'Interview Completed', 'Passed Pre-Interview', 'Passed Interview'];
const hasTag = (a: Row | undefined, t: string) => s(a?.Tags).split(',').some((x) => x.trim() === t);
const name = (a: Row | undefined, fallback = '') => (a ? `${s(a['First Name'])} ${s(a['Last Name'])}`.trim() || s(a['Applicant ID']) : fallback);
/** Minutes between two Pacific "yyyy-MM-dd HH:mm:ss" strings (b later). */
const minutes = (a: string, b: string) => {
  const t = (x: string) => Date.parse(x.slice(0, 19).replace(' ', 'T') + 'Z');
  const r = (t(b) - t(a)) / 60000;
  return Number.isFinite(r) ? r : NaN;
};
const ago = (m: number) => (m < 90 ? `${Math.round(m)} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`);
const list = (xs: string[], max = 15) => (xs.length > max ? [...xs.slice(0, max), `…and ${xs.length - max} more`] : xs);
const check = (id: string, title: string, bad: string[], level: Level, okText: string, badText: (n: number) => string): Check =>
  bad.length ? { id, level, title, detail: badText(bad.length), items: list(bad) } : { id, level: 'ok', title, detail: okText };

export async function runChecks(): Promise<{ at: string; summary: Record<Level, number>; checks: Check[] }> {
  const now = ptNow();
  const today = now.slice(0, 10);
  const hour = Number(now.slice(11, 13));
  const isWed = new Date(today + 'T12:00:00Z').getUTCDay() === 3;
  const [t, kv, ops, stats] = await Promise.all([
    readTabs(['Settings', 'Outbox', 'Applicants', 'Needs Attention', 'Zoom Attendance']),
    getKvs(['lastClock', 'lastFullCopy', 'engineSend', 'zapConfirmSince', 'readFromDb']),
    opStats(),
    tabStats(),
  ]);
  const st: Record<string, string> = {};
  for (const r of t.Settings) st[s(r.Key)] = s(r.Value);
  const apps = t.Applicants;
  const byId = new Map(apps.map((a) => [s(a['Applicant ID']), a]));
  const live = apps.filter((a) => s(a.Historical) !== 'Y');
  const out = t.Outbox;
  const checks: Check[] = [];

  // ---- the machinery ----
  const clock = kv.lastClock as { at?: string; sending?: { error?: string; skipped?: string } } | undefined;
  const clockMin = clock?.at ? (Date.now() - Date.parse(clock.at)) / 60000 : Infinity;
  const crmSends = kv.engineSend === true;
  checks.push(clockMin > 5
    ? { id: 'clock', level: crmSends ? 'bad' : 'warn', title: 'CRM clock (every-minute ping from the Apps Script)', detail: `Last ping ${clock?.at ? ago(clockMin) + ' ago' : 'never'}.${crmSends ? ' Emails are sent by the CRM, so NOTHING is being sent until it runs again (Apps Script trigger crmClock).' : ''}` }
    : clock?.sending?.error
      ? { id: 'clock', level: 'bad', title: 'CRM clock (every-minute ping from the Apps Script)', detail: 'Running, but the last send attempt failed: ' + clock.sending.error }
      : { id: 'clock', level: 'ok', title: 'CRM clock (every-minute ping from the Apps Script)', detail: `Last ping ${Math.round(clockMin)} min ago. Sending by ${crmSends ? 'the CRM' : 'the Apps Script'}.` });

  const newest = stats.map((x) => x.updated).sort().pop() || '';
  const copyMin = newest ? minutes(newest, now) : Infinity;
  checks.push(copyMin > 30
    ? { id: 'db-sync', level: 'bad', title: 'Database copy of the sheet', detail: `No row copied from the sheet for ${ago(copyMin)}. The CRM may be showing old data (Apps Script dbFlush_ / tick).` }
    : { id: 'db-sync', level: 'ok', title: 'Database copy of the sheet', detail: `Last change copied ${Math.round(copyMin)} min ago. Full copy: ${s((kv.lastFullCopy as { at?: string })?.at || kv.lastFullCopy).slice(0, 16) || 'never'}.` });

  checks.push(ops.failed || ops.pending > 5
    ? { id: 'saves', level: ops.failed ? 'warn' : 'bad', title: 'Saves from the CRM to the sheet', detail: `${ops.pending} waiting, ${ops.failed} refused in the last 7 days.` }
    : { id: 'saves', level: 'ok', title: 'Saves from the CRM to the sheet', detail: `${ops.pending} waiting, none refused.` });

  const settingsBad = [
    st.EMAIL_SENDING !== 'ON' ? `EMAIL_SENDING is ${st.EMAIL_SENDING || 'empty'} (no email goes out)` : '',
    st.MODE !== 'LIVE' ? `MODE is ${st.MODE || 'empty'} (test mode)` : '',
    st.AUTO_INVITES === 'OFF' ? 'AUTO_INVITES is OFF (no automatic invites)' : '',
  ].filter(Boolean);
  checks.push(check('settings', 'Sending switches', settingsBad, 'warn', 'Email sending ON, mode LIVE.', () => 'A switch is off'));

  // ---- emails ----
  const undelivered = deliveryProblems(out, apps, kv.zapConfirmSince as string | undefined, now);
  checks.push(check('delivery', 'Emails that did not reach the applicant', undelivered.map((p) => `${p.name} · ${p.type} · ${p.at}: ${p.error}`), 'bad',
    kv.zapConfirmSince ? 'Every email Zapier handled was confirmed sent.' : 'No failures. (Zapier confirmations start with the next email sent.)',
    (n) => `${n} email(s) failed or were never confirmed by Zapier. Resend from the red banner in the CRM.`));

  const stuck = out.filter((e) => s(e.Status) === 'Queued' && MAIL.includes(s(e.Type)) && minutes(s(e['Queued At']), now) > 15)
    .map((e) => `${name(byId.get(s(e['Applicant ID'])), s(e.To))} · ${s(e.Type)} · queued ${ago(minutes(s(e['Queued At']), now))} ago`);
  checks.push(check('queue', 'Emails stuck in the queue', stuck, 'bad', 'Nothing waiting more than 15 min.', (n) => `${n} email(s) queued for over 15 min and not sent.`));

  const pending = out.filter((e) => s(e.Status) === 'Pending approval' && minutes(s(e['Queued At']), now) > 240)
    .map((e) => `${name(byId.get(s(e['Applicant ID'])), s(e.To))} · ${s(e.Type)} · waiting ${ago(minutes(s(e['Queued At']), now))}`);
  checks.push(check('approvals', 'Emails waiting for approval', pending, 'warn', 'None waiting more than 4 h.', (n) => `${n} email(s) in Needs Approval for over 4 h.`));

  const holdMail = out.filter((e) => ['Queued', 'Pending approval'].includes(s(e.Status)) && INVITE_TYPES.includes(s(e.Type)))
    .filter((e) => { const a = byId.get(s(e['Applicant ID'])); return hasTag(a, 'Position on hold') || hasTag(a, 'Invites paused'); })
    .map((e) => { const a = byId.get(s(e['Applicant ID'])); return `${name(a)} · ${s(e.Type)} · ${hasTag(a, 'Position on hold') ? 'position on hold' : 'invites paused'}`; });
  checks.push(check('on-hold', 'Invites or reminders to on-hold / paused applicants', holdMail, 'bad', 'None queued.', (n) => `${n} invite/reminder email(s) queued for someone on hold or paused (the Nov 11 mistake). Cancel them.`));

  const seen = new Map<string, number>();
  for (const e of out) {
    if (s(e.Status) !== 'Sent' || !MAIL.includes(s(e.Type)) || minutes(s(e['Sent At']), now) > 1440) continue;
    const k = `${s(e.To).toLowerCase()}|${s(e.Type)}|${s(e.Subject)}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k.split('|')[0]} · ${k.split('|')[1]} · sent ${n}x`);
  checks.push(check('dupes', 'Same email sent twice', dupes, 'warn', 'No duplicates in the last 24 h.', (n) => `${n} applicant(s) got the same email more than once in 24 h.`));

  // ---- sessions (Wednesdays, 2 PM PT) ----
  if (isWed && hour >= 8) {
    const noReminder = live.filter((a) => s(a.Stage) === 'Confirmed' && s(a['Interview Date']).slice(0, 10) === today && !s(a['Reminder Sent At']) && !hasTag(a, 'Position on hold') && s(a.Source) !== 'OLJ')
      .map((a) => `${name(a)} · ${s(a.Position)}`);
    checks.push(check('reminders', "Today's session reminders", noReminder, 'bad', 'Every confirmed applicant got the reminder.', (n) => `${n} confirmed applicant(s) for today have no reminder sent.`));
  }
  if (isWed && (hour > 14 || (hour === 14 && Number(now.slice(14, 16)) >= 30))) {
    const zoomToday = t['Zoom Attendance'].filter((z) => s(z['Interview Date']).slice(0, 10) === today).length;
    checks.push(zoomToday ? { id: 'zoom', level: 'ok', title: 'Zoom attendance tracking', detail: `${zoomToday} participant(s) tracked today.` }
      : { id: 'zoom', level: 'bad', title: 'Zoom attendance tracking', detail: 'Session day, 2:30 PM passed, and no Zoom participant was tracked. Check zoomEveryMinute / the Zoom app.' });
  }

  // ---- applicants ----
  const overdue = live.filter((a) => ['Invited', 'Confirmed'].includes(s(a.Stage)) && s(a['Interview Date']) && s(a['Interview Date']).slice(0, 10) < today)
    .map((a) => `${name(a)} · ${s(a.Stage)} · session ${s(a['Interview Date']).slice(0, 10)}`);
  checks.push(check('overdue', 'Applicants left behind after their session', overdue, 'warn', 'Everyone invited to a past session has an outcome.', (n) => `${n} applicant(s) still Invited/Confirmed for a session that already happened.`));

  const noEmail = live.filter((a) => ACTIVE.includes(s(a.Stage)) && s(a.Source) !== 'OLJ' && !/@/.test(s(a.Email))).map((a) => `${name(a)} · ${s(a.Stage)}`);
  checks.push(check('no-email', 'Active applicants with no email address', noEmail, 'warn', 'Every active email applicant has an address.', (n) => `${n} active applicant(s) cannot be emailed.`));

  const byKey = new Map<string, Row[]>();
  for (const a of live) {
    const em = s(a.Email).trim().toLowerCase();
    if (!em || !ACTIVE.includes(s(a.Stage))) continue;
    const k = em + '|' + s(a.Position);
    byKey.set(k, [...(byKey.get(k) || []), a]);
  }
  const twins = [...byKey.values()].filter((g) => g.length > 1).map((g) => `${name(g[0])} · ${s(g[0].Position)} · ${g.length} active profiles`);
  checks.push(check('duplicates', 'Duplicate applicant profiles', twins, 'warn', 'No duplicates.', (n) => `${n} applicant(s) have more than one active profile for the same position.`));

  // ---- Needs Attention ----
  const open = t['Needs Attention'].filter((f) => s(f.Status) === 'Open');
  const unmatched = open.filter((f) => s(f.Type) === 'Unmatched reply');
  const old = open.filter((f) => minutes(s(f['Created At']), now) > 1440);
  const byType = new Map<string, number>();
  for (const f of open) byType.set(s(f.Type), (byType.get(s(f.Type)) || 0) + 1);
  checks.push(unmatched.length
    ? { id: 'unmatched', level: 'warn', title: 'Replies the CRM could not match to an applicant', detail: `${unmatched.length} open in Needs Attention.`, items: list(unmatched.map((f) => s(f.Detail).slice(0, 140))) }
    : { id: 'unmatched', level: 'ok', title: 'Replies the CRM could not match to an applicant', detail: 'None.' });
  checks.push(open.length
    ? { id: 'flags', level: old.length ? 'warn' : 'ok', title: 'Needs Attention', detail: `${open.length} open${old.length ? `, ${old.length} older than 24 h` : ''}.`, items: [...byType].map(([k, n]) => `${k || 'Other'}: ${n}`) }
    : { id: 'flags', level: 'ok', title: 'Needs Attention', detail: 'Nothing open.' });

  const summary: Record<Level, number> = { ok: 0, warn: 0, bad: 0 };
  for (const c of checks) summary[c.level]++;
  return { at: now, summary, checks };
}
