import type { PipelineData, Row, TeamMember, JobAd } from '@/lib/sheet';

/**
 * Builds the same data the Apps Script "data" action returns (Code.gs api_), from the copy in Postgres.
 * Kept in step with Code.gs: LIST_FIELDS / OLD_FIELDS, the "mine" filters, Body only on emails waiting for approval.
 */
const LIST_FIELDS = ['Applicant ID', 'Source', 'Applied At (PT)', 'First Name', 'Last Name', 'Email', 'Phone', 'Position (as typed)',
  'Position', 'Stage', 'Stage Updated At', 'Stage Updated By', 'Interview Date', 'Invite Count', 'Confirmed At',
  'Reminder Sent At', 'Zoom Minutes', 'Historical', 'Screen Track', 'Screen Tag', 'Screen Summary', 'Invite Hold',
  'Minutes Early', 'Arrival', 'Tags'];
const OLD_FIELDS = ['Applicant ID', 'Source', 'Applied At (PT)', 'Position', 'Stage', 'Historical'];

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** Sheets turns typed dates into Date values; the copy holds them as "YYYY-MM-DD 00:00:00". Settings.get() gives the date. */
const dateOnly = (v: unknown) => s(v).replace(/^(\d{4}-\d{2}-\d{2}) 00:00:00$/, '$1');

export const DATA_TABS = ['Applicants', 'History', 'Needs Attention', 'Zoom Attendance', 'Outbox', 'Scorecards', 'Views', 'Email Templates', 'Settings'];
type Tabs = Record<string, Record<string, unknown>[]>;

/** The pure part (no database), so it can be checked against the Apps Script output. */
export function buildData(t: Tabs, kv: Record<string, unknown>, withHistory: boolean): PipelineData {
  for (const k of DATA_TABS) t[k] = t[k] || [];
  const st: Record<string, unknown> = {};
  for (const r of t.Settings) st[s(r.Key)] = r.Value;
  const get = (k: string) => dateOnly(st[k]);

  const old = new Set<string>();
  if (!withHistory) for (const a of t.Applicants) if (s(a.Historical) === 'Y') old.add(s(a['Applicant ID']));
  const mine = (r: Record<string, unknown>) => !old.has(s(r['Applicant ID']));
  const pick = (a: Record<string, unknown>, fields: string[]) => {
    const o: Row = {};
    for (const k of fields) if (a[k] !== '' && a[k] !== undefined && a[k] !== null) o[k] = a[k] as string | number;
    return o;
  };
  const applicants = t.Applicants.map((a) => {
    const isOld = old.has(s(a['Applicant ID']));
    const o = pick(a, isOld ? OLD_FIELDS : LIST_FIELDS);
    const warn = s(a['Resume Experience']).split('\n').find((l) => l.indexOf('⚠') === 0);
    if (warn && !isOld) o['Resume Warning'] = warn.replace(/^⚠\s*/, '');
    return o;
  });
  const outbox = t.Outbox.filter(mine).map((e) => {
    const o = { ...e } as Row;
    if (s(e.Status) !== 'Pending approval') delete o.Body;
    return o;
  });
  const day = get('ZOOM_TRACKING_FOR');
  const cancelled = s(st.CANCELLED_SESSIONS).split(/[\s,;]+/).map((d) => d.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return {
    applicants,
    history: t.History.filter(mine) as Row[],
    flags: t['Needs Attention'] as Row[],
    zoom: t['Zoom Attendance'].filter((z) => !old.has(s(z['Matched Applicant ID']))) as Row[],
    outbox,
    team: (kv.team as TeamMember[]) || [],
    scores: t.Scorecards as Row[],
    views: t.Views as Row[],
    mode: get('MODE'),
    emailSending: get('EMAIL_SENDING'),
    cancelledSessions: [...new Set(cancelled)].sort(),
    zoomTracking: {
      day, since: s(st.ZOOM_TRACKING_SINCE), by: get('ZOOM_TRACKING_BY'), lastPoll: s(st.ZOOM_TRACKING_LAST),
      done: !!day && get('ZOOM_TRACKING_DONE') === day, configured: kv.zoomConfigured === true
    },
    autoInvites: get('AUTO_INVITES') === 'OFF' ? 'OFF' : 'ON',
    jobAds: (kv.jobAds as JobAd[]) || [],
    emailTemplates: t['Email Templates'] as Row[]
  };
}
