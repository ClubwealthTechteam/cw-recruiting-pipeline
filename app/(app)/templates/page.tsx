import { getData } from '@/lib/sheet';
import { s } from '@/lib/pipeline';
import DataError from '@/components/DataError';
import TemplatesManager from '@/components/TemplatesManager';

/** Email templates (macros): write, edit or let the assistant suggest; insert them in any reply box on a profile. */
export default async function Templates() {
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const templates = (d.emailTemplates || []).map((x) => ({ name: s(x.Name), subject: s(x.Subject), body: s(x.Body) }));
  return (
    <>
      <header className="page-head"><h1>Email Templates</h1><p className="sub">Saved answers for the reply box. On a profile, pick one from &quot;Insert a template…&quot; above the reply, edit if needed, and send (a preview shows first).</p></header>
      <TemplatesManager templates={templates} />
    </>
  );
}
