import Link from 'next/link';
import { getData } from '@/lib/sheet';
import { metrics, pct, formatDate } from '@/lib/pipeline';
import DataError from '@/components/DataError';

export default async function Dashboard() {
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const m = metrics(d.applicants, d.history, d.flags);
  const maxWeek = Math.max(1, ...m.perWeek.map((w) => w.form + w.olj));
  const maxSession = Math.max(1, ...m.sessions.map((x) => x.invited));

  return (
    <>
      <header className="page-head">
        <h1>Dashboard</h1>
        <p className="sub">Rates use the last {m.sessionCount || 0} interview session{m.sessionCount === 1 ? '' : 's'} tracked by the system. Applicants invited by hand before the system started are not included in rates.</p>
      </header>

      <section className="tiles">
        <Tile label="Confirmation rate" value={pct(m.confirmationRate)} note="Confirmed ÷ invited" />
        <Tile label="Show-up rate" value={pct(m.showUpRate)} note="Joined Zoom ÷ confirmed" />
        <Tile label="Completion rate" value={pct(m.completionRate)} note="30+ minutes ÷ joined" />
        <Tile label="No-show rate" value={pct(m.noShowRate)} note="No Show ÷ invited" />
        <Tile label="Days to interview" value={m.medianDaysToInterview === null ? '—' : String(m.medianDaysToInterview)} note="Median, application to session" />
        <Tile label="Awaiting review" value={String(m.awaitingReview)} note="Interview Completed" href="/candidates?stage=Interview+Completed" />
        <Tile label="Needs attention" value={String(m.openFlags)} note="Open items" href="/attention" />
      </section>

      <section className="panel">
        <h2>Applicants per week</h2>
        <p className="sub">Week starting Monday. Form and OnlineJobs.ph.</p>
        <div className="bars">
          {m.perWeek.map((w) => (
            <div key={w.week} className="bar-col" title={`${w.form} form, ${w.olj} OLJ`}>
              <div className="bar-stack" style={{ height: `${((w.form + w.olj) / maxWeek) * 140}px` }}>
                <div className="seg olj" style={{ flex: w.olj }} />
                <div className="seg form" style={{ flex: w.form }} />
              </div>
              <div className="bar-val">{w.form + w.olj}</div>
              <div className="bar-label">{formatDate(w.week).replace(/, \d{4}$/, '')}</div>
            </div>
          ))}
        </div>
        <div className="legend"><span className="key form" /> Form <span className="key olj" /> OnlineJobs.ph</div>
      </section>

      <section className="panel">
        <h2>Interview sessions</h2>
        {m.sessions.length === 0 ? <p className="empty">No sessions tracked yet. Numbers appear after the first Wednesday run by the system.</p> : (
          <table className="table">
            <thead><tr><th>Wednesday</th><th>Invited</th><th>Confirmed</th><th>Joined</th><th>Completed</th><th>No Show</th><th style={{ width: '30%' }}>Invited vs completed</th></tr></thead>
            <tbody>
              {m.sessions.map((x) => (
                <tr key={x.date}>
                  <td>{formatDate(x.date)}</td><td>{x.invited}</td><td>{x.confirmed}</td><td>{x.attended}</td><td>{x.completed}</td><td>{x.noShow}</td>
                  <td><div className="hbar"><div className="hbar-total" style={{ width: `${(x.invited / maxSession) * 100}%` }}><div className="hbar-done" style={{ width: `${x.invited ? (x.completed / x.invited) * 100 : 0}%` }} /></div></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Results by position</h2>
        <p className="sub">Of applicants who completed an interview and have a decision, the share Passed or Hired.</p>
        {m.byPosition.length === 0 ? <p className="empty">No decisions recorded yet.</p> : (
          <table className="table">
            <thead><tr><th>Position</th><th>Decided</th><th>Passed or Hired</th><th>Pass rate</th></tr></thead>
            <tbody>{m.byPosition.map((p) => <tr key={p.position}><td>{p.position}</td><td>{p.decided}</td><td>{p.passed}</td><td>{pct(p.rate)}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Tile({ label, value, note, href }: { label: string; value: string; note: string; href?: string }) {
  const body = (<><div className="tile-label">{label}</div><div className="tile-value">{value}</div><div className="tile-note">{note}</div></>);
  return href ? <Link href={href} className="tile link-tile">{body}</Link> : <div className="tile">{body}</div>;
}
