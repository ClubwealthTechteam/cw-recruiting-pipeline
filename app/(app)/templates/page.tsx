import { getData } from '@/lib/sheet';
import { s, fullName, ymd, isTest, STAGES, todayPT } from '@/lib/pipeline';
import SendCounts, { type SendStats } from '@/components/SendCounts';
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
  return (
    <>
      <header className="page-head"><h1>Email Templates</h1><p className="sub">Saved answers, and one message to many applicants. On a profile, pick a template from &quot;Insert a template…&quot; above the reply box.</p></header>
      <SendCounts today={stats(today)} week={stats(since)} />
      <MassSend people={people} templates={templates} stages={STAGES.filter((x) => x !== 'Banned')} />
      <TemplatesManager templates={templates} />
    </>
  );
}
