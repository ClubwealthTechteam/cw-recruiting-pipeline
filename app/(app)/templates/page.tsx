import { getData } from '@/lib/sheet';
import { s, fullName, ymd, isTest, STAGES, todayPT } from '@/lib/pipeline';
import SendCounts, { type SendStats, type SendLists, type SentItem } from '@/components/SendCounts';
import DataError from '@/components/DataError';
import TemplatesManager from '@/components/TemplatesManager';
import MassSend, { type Recipient } from '@/components/MassSend';

/** Email templates (macros), and sending one message to many applicants by email or OLJ. */
export default async function Templates() {
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const templates = (d.emailTemplates || []).map((x) => ({ name: s(x.Name), subject: s(x.Subject), body: s(x.Body) }));
  const people: Recipient[] = d.applicants.filter((a) => s(a.Historical) !== 'Y' && !isTest(a) && s(a.Stage) !== 'Banned').map((a) => ({
    id: s(a['Applicant ID']), name: fullName(a) || s(a['Applicant ID']), email: s(a.Email), olj: s(a.Source) === 'OLJ' && !!s(a['Source Ref']) || s(a.Source) === 'OLJ',
    stage: s(a.Stage), position: s(a.Position), session: ymd(a['Interview Date']), applied: s(a['Applied At (PT)'])
  }));
  // Sending counts (Miguel, 2026-11-10): test emails are left out; dates are Pacific
  const today = todayPT();
  const weekAgo = new Date(`${today}T12:00:00Z`); weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
  const since = weekAgo.toISOString().slice(0, 10);
  const out = d.outbox.filter((e) => s(e.Test) !== 'Y');
  const isOlj = (e: Record<string, unknown>) => s(e.Type).startsWith('OLJ');
  const stats = (from: string): SendStats => ({
    emailWaiting: out.filter((e) => !isOlj(e) && s(e.Status) === 'Queued').length,
    oljWaiting: out.filter((e) => isOlj(e) && s(e.Status) === 'Queued').length,
    queued: out.filter((e) => !isOlj(e) && ymd(e['Queued At']) >= from).length,
    sent: out.filter((e) => !isOlj(e) && s(e.Status) === 'Sent' && ymd(e['Sent At']) >= from).length,
    oljSent: out.filter((e) => isOlj(e) && s(e.Status) === 'Sent' && ymd(e['Sent At'] || e['Queued At']) >= from).length,
    failed: out.filter((e) => !isOlj(e) && s(e.Status) === 'Failed' && ymd(e['Queued At']) >= from).length
  });
  // the emails behind each tile: when, who, where to, what (Miguel, 2026-11-12)
  const nameOf = new Map(d.applicants.map((a) => [s(a['Applicant ID']), fullName(a)]));
  const LABEL: Record<string, string> = { Invite: 'Pre-interview invite', 'Re-invite': 'Re-invite', Reminder: 'Wednesday reminder', Confirmation: 'Confirmation', Reply: 'Reply', 'OLJ Invite': 'OLJ invite', 'OLJ Message': 'OLJ message' };
  const item = (e: Record<string, unknown>, at: unknown): SentItem => ({
    emailId: s(e['Email ID']), at: s(at), id: s(e['Applicant ID']), name: nameOf.get(s(e['Applicant ID'])) || '',
    to: s(e.To).replace(/^OLJ:/, 'OnlineJobs.ph '), what: `${LABEL[s(e.Type)] || s(e.Type)}${s(e.Subject) && !isOlj(e) ? ': ' + s(e.Subject) : ''}`,
    by: s(e['Queued By']) || s(e['Decided By']), status: s(e.Status)
  });
  const newest = (a: SentItem, b: SentItem) => b.at.localeCompare(a.at);
  const lists = (from: string): SendLists => ({
    waiting: out.filter((e) => !isOlj(e) && s(e.Status) === 'Queued').map((e) => item(e, e['Queued At'])).sort(newest).slice(0, 300),
    sent: out.filter((e) => !isOlj(e) && s(e.Status) === 'Sent' && ymd(e['Sent At']) >= from).map((e) => item(e, e['Sent At'])).sort(newest).slice(0, 300),
    olj: out.filter((e) => isOlj(e) && s(e.Status) === 'Sent' && ymd(e['Sent At'] || e['Queued At']) >= from).map((e) => item(e, e['Sent At'] || e['Queued At'])).sort(newest).slice(0, 300)
  });
  return (
    <>
      <header className="page-head"><h1>Email Templates</h1><p className="sub">Saved answers, and one message to many applicants. On a profile, pick a template from &quot;Insert a template…&quot; above the reply box.</p></header>
      <SendCounts today={stats(today)} week={stats(since)} todayLists={lists(today)} weekLists={lists(since)} />
      <MassSend people={people} templates={templates} stages={STAGES.filter((x) => x !== 'Banned')} />
      <TemplatesManager templates={templates} />
    </>
  );
}
