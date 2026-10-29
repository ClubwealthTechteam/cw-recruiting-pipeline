import Link from 'next/link';
import { getData } from '@/lib/sheet';
import { s, fullName } from '@/lib/pipeline';
import { ResolveButton } from '@/components/SmallForms';
import DataError from '@/components/DataError';
import EmailConversation from '@/components/EmailConversation';

const fromEmail = (detail: string) => (/From: ([^\s|]+@[^\s|]+)/.exec(detail) || [])[1] || '';

export default async function Attention() {
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const byId = new Map(d.applicants.map((a) => [s(a['Applicant ID']), a]));
  const open = d.flags.filter((f) => s(f.Status) === 'Open').sort((x, y) => s(y['Created At']).localeCompare(s(x['Created At'])));
  return (
    <>
      <header className="page-head">
        <h1>Needs Attention</h1>
        <p className="sub">Applicant questions, replies the system could not sort or match, failed emails and Zoom names that match more than one applicant.</p>
      </header>
      <section className="panel">
        <table className="table">
          <thead><tr><th>Received</th><th>Type</th><th>Applicant</th><th style={{ width: '40%' }}>Detail</th><th>Action</th></tr></thead>
          <tbody>
            {open.map((f) => {
              const a = byId.get(s(f['Applicant ID']));
              return (
                <tr key={s(f['Flag ID'])}>
                  <td>{s(f['Created At']).slice(0, 16)}</td>
                  <td>{s(f.Type)}</td>
                  <td>{a ? <Link href={`/candidates/${encodeURIComponent(s(a['Applicant ID']))}`}>{fullName(a)}</Link> : <span className="muted">Not matched</span>}</td>
                  <td><div className="prewrap">{s(f.Detail)}</div>{fromEmail(s(f.Detail)) && <EmailConversation email={fromEmail(s(f.Detail)).toLowerCase()} flagId={s(f['Flag ID'])} emailReady={d.emailSending === 'ON'} />}</td>
                  <td><ResolveButton flagId={s(f['Flag ID'])} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {open.length === 0 && <p className="empty">Nothing needs attention right now.</p>}
      </section>
    </>
  );
}
