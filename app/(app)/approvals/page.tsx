import { getData } from '@/lib/sheet';
import { s, fullName, statusEmails } from '@/lib/pipeline';
import ApprovalList from '@/components/ApprovalList';
import DataError from '@/components/DataError';

/** Every Hired / Rejected / Benched email waiting for Am or Camille to approve, oldest first. */
export default async function Approvals() {
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const byId = new Map(d.applicants.map((a) => [s(a['Applicant ID']), a]));
  const waiting = statusEmails(d.outbox).filter((e) => e.status === 'Pending approval').reverse();
  return (
    <>
      <header className="page-head">
        <h1>Needs Approval</h1>
        <p className="sub">Hired, Rejected, Benched and other prepared emails are never sent automatically. Tick several and use Send to send them together. Moving an applicant prepares the email here; it goes out from CareersCW only after you approve it.</p>
      </header>
      {waiting.length === 0 && <section className="panel"><p className="empty">No emails are waiting for approval.</p></section>}
      <ApprovalList items={waiting.map((e) => {
        const a = byId.get(e.applicantId);
        return { e, name: a ? fullName(a) : e.applicantId, position: a ? s(a.Position) : '', stage: a ? s(a.Stage) : '' };
      })} />
    </>
  );
}
