import Link from 'next/link';
import { getData } from '@/lib/sheet';
import { s, fullName, statusEmails } from '@/lib/pipeline';
import { PendingStatusEmail } from '@/components/StatusEmails';
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
        <p className="sub">Hired, Rejected and Benched emails are never sent automatically. Moving an applicant prepares the email here; it goes out from CareersCW only after you approve it.</p>
      </header>
      {waiting.length === 0 && <section className="panel"><p className="empty">No emails are waiting for approval.</p></section>}
      {waiting.map((e) => {
        const a = byId.get(e.applicantId);
        return (
          <section key={e.id} className="panel">
            <p className="small"><Link href={`/candidates/${encodeURIComponent(e.applicantId)}`}>{a ? fullName(a) : e.applicantId}</Link> · {a ? s(a.Position) : ''} · now {a ? s(a.Stage) : ''}</p>
            <PendingStatusEmail e={e} />
          </section>
        );
      })}
    </>
  );
}
