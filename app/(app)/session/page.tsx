import Link from 'next/link';
import { getData } from '@/lib/sheet';
import { s, fullName, ymd, formatDate, upcomingWednesday, isTest, zoomLive } from '@/lib/pipeline';
import ZoomBadge from '@/components/ZoomBadge';
import StageBadge from '@/components/StageBadge';
import DataError from '@/components/DataError';

export default async function Session({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const p = await searchParams;
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date! : upcomingWednesday();
  const roster = d.applicants
    .filter((a) => ymd(a['Interview Date']) === date && s(a.Stage) !== 'Applied')
    .sort((x, y) => fullName(x).localeCompare(fullName(y)));
  const counted = roster.filter((a) => !isTest(a)); // test applicants show in the list but not in the numbers
  const confirmed = counted.filter((a) => a['Confirmed At'] || s(a.Stage) === 'Confirmed').length;
  const reminded = counted.filter((a) => a['Reminder Sent At']).length;
  const prev = new Date(`${date}T12:00:00Z`); prev.setUTCDate(prev.getUTCDate() - 7);
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 7);
  const live = zoomLive(d.zoom);
  const unmatchedZoom = d.zoom.filter((z) => ymd(z['Interview Date']) === date && !z['Matched Applicant ID']);

  return (
    <>
      <header className="page-head">
        <h1>Session: Wednesday, {formatDate(date)}, 2:00 PM PT</h1>
        <p className="sub">
          <Link href={`/session?date=${prev.toISOString().slice(0, 10)}`}>← Previous week</Link> · <Link href={`/session?date=${next.toISOString().slice(0, 10)}`}>Next week →</Link>
        </p>
      </header>
      <section className="tiles">
        <div className="tile"><div className="tile-label">Invited</div><div className="tile-value">{counted.length}</div></div>
        <div className="tile"><div className="tile-label">Confirmed</div><div className="tile-value">{confirmed}</div></div>
        <div className="tile"><div className="tile-label">Reminder sent</div><div className="tile-value">{reminded}</div><div className="tile-note">Wednesday 6:00 AM PT</div></div>
      </section>
      <section className="panel">
        <table className="table">
          <thead><tr><th>Name</th><th>Position</th><th>Stage</th><th>Confirmed</th><th>Reminder</th><th>Arrival</th><th>Zoom minutes</th></tr></thead>
          <tbody>
            {roster.map((a) => (
              <tr key={s(a['Applicant ID'])}>
                <td><Link href={`/candidates/${encodeURIComponent(s(a['Applicant ID']))}`}>{fullName(a)}</Link></td>
                <td>{s(a.Position)}</td><td><StageBadge stage={s(a.Stage)} /><ZoomBadge z={live.get(s(a['Applicant ID']))} />{isTest(a) && <span className="tag">Test · not counted</span>}</td>
                <td>{a['Confirmed At'] ? 'Yes' : 'No'}</td><td>{a['Reminder Sent At'] ? 'Sent' : '—'}</td><td><Arrival a={a} /></td><td>{s(a['Zoom Minutes']) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {roster.length === 0 && <p className="empty">No one is invited to this session yet.</p>}
      </section>
      {unmatchedZoom.length > 0 && (
        <section className="panel">
          <h2>Zoom names not matched to an invitee</h2>
          <p className="sub">These people used the Name_Position format but were not invited to this session, or their name matches more than one applicant.</p>
          <ul>{unmatchedZoom.map((z, i) => <li key={i}>{s(z['Zoom Display Name'])} · {s(z['Total Minutes'])} min · {s(z.Result)}</li>)}</ul>
        </section>
      )}
    </>
  );
}

/** Early/late against the 2 PM start; red when they joined after it, amber when under the 10 minutes early the invite asks for. */
function Arrival({ a }: { a: Record<string, unknown> }) {
  const label = s(a.Arrival);
  if (!label) return <>—</>;
  const early = Number(a['Minutes Early']);
  const tone = early < 0 ? 'red' : early < 10 ? 'amber' : 'green';
  return <span className={`badge ${tone}`}>{label}</span>;
}
