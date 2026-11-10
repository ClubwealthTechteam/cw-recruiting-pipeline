import { getData } from '@/lib/sheet';
import { s, fullName, ymd, isTest, STAGES } from '@/lib/pipeline';
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
  return (
    <>
      <header className="page-head"><h1>Email Templates</h1><p className="sub">Saved answers, and one message to many applicants. On a profile, pick a template from &quot;Insert a template…&quot; above the reply box.</p></header>
      <MassSend people={people} templates={templates} stages={STAGES.filter((x) => x !== 'Banned')} />
      <TemplatesManager templates={templates} />
    </>
  );
}
