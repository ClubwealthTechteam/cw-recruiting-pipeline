import Link from 'next/link';
import { getData } from '@/lib/sheet';
import { metrics, pct, formatDate, STAGES, s as str, ymd, positionCounts, daysAgoPT, upcomingWednesday, isTest } from '@/lib/pipeline';
import { WeeklyBars, RateTrend, HBars } from '@/components/Charts';
import DataError from '@/components/DataError';

type Q = { session?: string; days?: string };
const PERIODS = [['30', 'Last 30 days'], ['60', 'Last 60 days'], ['90', 'Last 90 days'], ['all', 'All time']];

export default async function Dashboard({ searchParams }: { searchParams: Promise<Q> }) {
  const p = await searchParams;
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const session = /^\d{4}-\d{2}-\d{2}$/.test(p.session || '') ? p.session! : '';
  const period = PERIODS.some(([k]) => k === p.days) ? p.days! : '30';
  const m = metrics(d.applicants, d.history, d.flags, new Date(), { session });
  const everyone = d.applicants.filter((a) => str(a.Historical) !== 'Y' && !isTest(a));
  // Filtered to one session: the pipeline, positions and tiles are about that session's invitees only
  const active = session ? everyone.filter((a) => ymd(a['Interview Date']) === session) : everyone;
  const maxSession = Math.max(1, ...m.sessions.map((x) => x.invited));
  const since = period === 'all' ? '' : daysAgoPT(Number(period));
  const recent = session ? active : active.filter((a) => ymd(a['Applied At (PT)']) >= since);
  const periodLabel = session ? `invited to the ${formatDate(session)} session` : period === 'all' ? 'applied in total' : `applied in the last ${period} days`;
  const nextSession = upcomingWednesday();
  const forNext = active.filter((a) => ymd(a['Interview Date']) === nextSession);
  const nextByPosition = new Map(positionCounts(forNext).map((x) => [x.position, x.count]));

  return (
    <>
      <header className="page-head">
        <h1>Dashboard</h1>
        <p className="sub">{session ? `Showing the ${formatDate(session)} session only.` : `Rates use the last ${m.sessionCount || 0} interview session${m.sessionCount === 1 ? '' : 's'} tracked by the system.`} Applicants invited by hand before the system started are not included in rates.</p>
      </header>

      <form className="filters" action="/">
        <select name="session" defaultValue={session}>
          <option value="">Last 8 sessions</option>
          {[...m.sessionDates].reverse().map((x) => <option key={x} value={x}>{formatDate(x)} session</option>)}
        </select>
        <select name="days" defaultValue={period} disabled={!!session} title={session ? 'A session is picked: positions show that session\'s invitees' : ''}>
          {PERIODS.map(([k, label]) => <option key={k} value={k}>Applied: {label}</option>)}
        </select>
        <button className="btn">Filter</button>
        {(session || period !== '30') && <Link href="/" className="btn ghost">Clear</Link>}
      </form>

      <section className="tiles">
        <Tile label="Confirmation rate" value={pct(m.confirmationRate)} note="Confirmed ÷ invited" />
        <Tile label="Show-up rate" value={pct(m.showUpRate)} note="Joined Zoom ÷ confirmed" />
        <Tile label="Completion rate" value={pct(m.completionRate)} note="1h+ in Zoom ÷ joined" />
        <Tile label="No-show rate" value={pct(m.noShowRate)} note="No Show ÷ confirmed" />
        <Tile label="Days to interview" value={m.medianDaysToInterview === null ? '—' : String(m.medianDaysToInterview)} note="Median, application to session" />
        <Tile label="Awaiting review" value={String(m.awaitingReview)} note="Interview Completed" href="/candidates?stage=Interview+Completed" />
        <Tile label="Needs attention" value={String(m.openFlags)} note="Open items" href="/attention" />
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>Applicants per week</h2>
          <p className="sub">Week starting Monday.</p>
          <WeeklyBars data={m.perWeek.map((w) => ({ label: short(w.week), form: w.form, olj: w.olj, email: w.email, referral: w.referral, href: `/candidates?stage=All&week=${w.week}` }))} />
        </section>
        <section className="panel">
          <h2>Session rates</h2>
          <p className="sub">Per Wednesday session. Confirmed ÷ invited, joined ÷ confirmed, 1h+ in Zoom ÷ joined.</p>
          <RateTrend data={m.sessions.map((x) => ({
            label: short(x.date),
            confirmation: x.invited ? x.confirmed / x.invited : null,
            showUp: x.confirmed ? x.attended / x.confirmed : null,
            completion: x.attended ? x.completed / x.attended : null
          }))} />
        </section>
      </div>

      <div className="two-col">
        <section className="panel">
          <h2>Current pipeline</h2>
          <p className="sub">{session ? `Where the ${formatDate(session)} invitees are now.` : 'Applicants in each stage now, excluding those invited by hand before the system.'}</p>
          <HBars format="count" ariaLabel="Applicants by stage" data={STAGES.map((st) => ({ label: st, value: active.filter((a) => str(a.Stage) === st).length, href: `/candidates?stage=${encodeURIComponent(st)}${session ? `&session=${session}` : ''}` }))} />
        </section>
        <section className="panel">
          <h2>Pass rate by position</h2>
          <p className="sub">Of applicants who completed an interview and have a decision, the share that passed (pre-interview or interview) or was hired.</p>
          <HBars format="pct" ariaLabel="Pass rate by position" data={m.byPosition.map((p) => ({ label: p.position, value: p.rate ?? 0, note: `of ${p.decided}`, href: `/candidates?stage=All&position=${encodeURIComponent(p.position)}` }))} />
        </section>
      </div>

      <section className="panel">
        <h2>Applicants by position</h2>
        <p className="sub">{recent.length} {periodLabel}, all sources. The note shows how many are on the {formatDate(nextSession)} session. Click a bar to see the people.</p>
        <HBars format="count" ariaLabel="Applicants by position, last 30 days" data={positionCounts(recent).map((x) => ({
          label: x.position, value: x.count, note: `${nextByPosition.get(x.position) || 0} for ${formatDate(nextSession).replace(/, \d{4}$/, '')}`,
          href: `/candidates?stage=All&position=${encodeURIComponent(x.position)}`
        }))} />
      </section>

      <section className="panel">
        <h2>Interview sessions</h2>
        <p className="sub">The numbers behind the session chart.</p>
        {m.sessions.length === 0 ? <p className="empty">No sessions tracked yet. Numbers appear after the first Wednesday run by the system.</p> : (
          <table className="table">
            <thead><tr><th>Wednesday</th><th>Invited</th><th>Confirmed</th><th>Joined</th><th>Completed</th><th>No Show</th><th>No Confirmation</th><th style={{ width: '30%' }}>Invited vs completed</th></tr></thead>
            <tbody>
              {m.sessions.map((x) => (
                <tr key={x.date}>
                  <td><Link href={`/session?date=${x.date}`}>{formatDate(x.date)}</Link></td><td>{x.invited}</td><td>{x.confirmed}</td><td>{x.attended}</td><td>{x.completed}</td><td>{x.noShow}</td><td>{x.noConfirmation}</td>
                  <td><div className="hbar"><div className="hbar-total" style={{ width: `${(x.invited / maxSession) * 100}%` }}><div className="hbar-done" style={{ width: `${x.invited ? (x.completed / x.invited) * 100 : 0}%` }} /></div></div></td>
                </tr>
              ))}
            </tbody>
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

function short(d: string) {
  return formatDate(d).replace(/, \d{4}$/, '');
}
