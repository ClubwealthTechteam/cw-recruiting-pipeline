import Link from 'next/link';
import { getData } from '@/lib/sheet';
import { s, fullName, ymd, formatDate, positionCounts, splitTags, isTest } from '@/lib/pipeline';
import DataError from '@/components/DataError';
import FitBadge from '@/components/FitBadge';
import StageBadge from '@/components/StageBadge';
import InviteButtons from '@/components/InviteButtons';

type Q = { position?: string; q?: string };
// Not in the pool while their process is still running or decided.
const IN_PROGRESS = ['Invited', 'Confirmed', 'Interview Completed', 'Passed Pre-Interview', 'Passed Interview', 'Hired', 'Onboarded'];
const POOL_TAG = 'talent pool';

/**
 * Good people for later: Great or Good fits who were not hired and are not mid-process (held back because the
 * position was closed, did not complete, no show, asked to reschedule), plus anyone tagged "Talent pool".
 */
export default async function Talent({ searchParams }: { searchParams: Promise<Q> }) {
  const p = await searchParams;
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const tagged = (a: Record<string, unknown>) => splitTags(a.Tags).some((t) => t.toLowerCase() === POOL_TAG);
  const pool = d.applicants.filter((a) => s(a.Historical) !== 'Y' && !isTest(a) && (tagged(a) ||
    (['Great', 'Good'].includes(s(a['Screen Tag'])) && !IN_PROGRESS.includes(s(a.Stage)) && s(a.Stage) !== 'Not Fit' && s(a.Stage) !== 'Banned')));
  const q = (p.q || '').trim().toLowerCase();
  const matchQ = pool.filter((a) => !q || `${fullName(a)} ${s(a.Email)} ${s(a['Position (as typed)'])}`.toLowerCase().includes(q));
  const rows = matchQ.filter((a) => !p.position || s(a.Position) === p.position)
    .sort((x, y) => (s(x['Screen Tag']) === 'Great' ? 0 : 1) - (s(y['Screen Tag']) === 'Great' ? 0 : 1) || s(y['Applied At (PT)']).localeCompare(s(x['Applied At (PT)'])));
  const why = (a: Record<string, unknown>) =>
    s(a['Invite Hold']) || s(a['Re-invite Reason']) || s(a['Decision Reason']) || (tagged(a) ? 'Tagged Talent pool' : s(a.Stage));
  const link = (position?: string) => `/talent?${new URLSearchParams({ ...(p.q ? { q: p.q } : {}), ...(position ? { position } : {}) })}`;

  return (
    <>
      <header className="page-head">
        <h1>Talent Pool</h1>
        <p className="sub">Great and Good fits who were not hired and are not in an interview right now, plus anyone tagged “Talent pool”. When a position reopens, invite them from here.</p>
      </header>
      <form className="filters" action="/talent">
        <input name="q" defaultValue={p.q} placeholder="Search name, email or position" />
        {p.position && <input type="hidden" name="position" value={p.position} />}
        <button className="btn">Search</button>
        <Link href="/talent" className="btn ghost">Clear</Link>
      </form>
      <div className="position-chips">
        <Link href={link()} className={!p.position ? 'chip active' : 'chip'}>All positions <span className="count">{matchQ.length}</span></Link>
        {positionCounts(matchQ).map((x) => <Link key={x.position} href={link(x.position)} className={p.position === x.position ? 'chip active' : 'chip'}>{x.position} <span className="count">{x.count}</span></Link>)}
      </div>
      <section className="panel">
        <table className="table">
          <thead><tr><th>Name</th><th>Fit</th><th>Position</th><th>Stage</th><th>Why they are here</th><th>Applied</th><th>Invite to the next session</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={s(a['Applicant ID'])}>
                <td><Link href={`/candidates/${encodeURIComponent(s(a['Applicant ID']))}`}>{fullName(a) || '(no name)'}</Link><div className="muted small">{s(a.Source)}</div></td>
                <td><FitBadge tag={s(a['Screen Tag'])} track={s(a['Screen Track'])} summary={s(a['Screen Summary'])} /></td>
                <td>{s(a.Position)}</td>
                <td><StageBadge stage={s(a.Stage)} /></td>
                <td className="small">{why(a)}</td>
                <td className="small">{formatDate(ymd(a['Applied At (PT)']))}</td>
                <td><InviteButtons id={s(a['Applicant ID'])} isOlj={s(a.Source) === 'OLJ'} hasEmail={!!a.Email} emailReady={d.emailSending === 'ON'} blocked={false} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No one in the talent pool{p.position ? ` for ${p.position}` : ''} yet.</p>}
      </section>
    </>
  );
}
