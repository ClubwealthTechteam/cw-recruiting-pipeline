import Link from 'next/link';
import { getData } from '@/lib/sheet';
import { s, fullName, ymd, formatDate, upcomingWednesday, isTest, zoomLive } from '@/lib/pipeline';
import ZoomBadge from '@/components/ZoomBadge';
import StageBadge from '@/components/StageBadge';
import DataError from '@/components/DataError';
import ReinviteNoShows from '@/components/ReinviteNoShows';
import NonNegotiables from '@/components/NonNegotiables';
import { todayPT, sessionTimes, cancelledSessions } from '@/lib/pipeline';
import QuickDecide from '@/components/QuickDecide';
import OpenSessionButton from '@/components/OpenSessionButton';
import HeaderFilter, { type FilterOption } from '@/components/HeaderFilter';

type Q = { date?: string; pos?: string; stage?: string; conf?: string; rem?: string; arr?: string; zoom?: string };

export default async function Session({ searchParams }: { searchParams: Promise<Q> }) {
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
  const isToday = date === todayPT();
  const inNow = roster.filter((a) => live.get(s(a['Applicant ID']))?.inNow);
  const leftZoom = roster.filter((a) => { const z = live.get(s(a['Applicant ID'])); return z && !z.inNow; });
  const notYet = roster.filter((a) => !live.get(s(a['Applicant ID'])) && (a['Confirmed At'] || s(a.Stage) === 'Confirmed'));
  const noShowRows = counted.filter((a) => ['No Show', 'No Confirmation'].includes(s(a.Stage)));
  const noShows = noShowRows.length;
  // spreadsheet-style column filters (Tara, 2026-11-10); the tiles above still count the whole session
  const opts = (vals: string[]): FilterOption[] => [...new Set(vals.filter(Boolean))].sort().map((v) => ({ value: v, label: v }));
  const arrival = (a: Record<string, unknown>) => {
    if (!s(a.Arrival)) return 'Not recorded';
    const early = Number(a['Minutes Early']);
    return early < 0 ? 'Late' : early < 10 ? 'Under 10 min early' : '10+ min early';
  };
  const joined = (a: Record<string, unknown>) => (Number(s(a['Zoom Minutes'])) > 0 || live.get(s(a['Applicant ID'])) ? 'Joined Zoom' : 'No Zoom minutes');
  const rows = roster.filter((a) =>
    (!p.pos || s(a.Position) === p.pos) && (!p.stage || s(a.Stage) === p.stage) &&
    (!p.conf || (a['Confirmed At'] ? 'Yes' : 'No') === p.conf) && (!p.rem || (a['Reminder Sent At'] ? 'Sent' : 'Not sent') === p.rem) &&
    (!p.arr || arrival(a) === p.arr) && (!p.zoom || joined(a) === p.zoom));
  const filtered = rows.length !== roster.length || !!(p.pos || p.stage || p.conf || p.rem || p.arr || p.zoom);
  const clear = `/session?date=${date}`;
  const unmatchedZoom = d.zoom.filter((z) => ymd(z['Interview Date']) === date && !z['Matched Applicant ID']);

  return (
    <>
      <header className="page-head">
        <h1>Session: Wednesday, {formatDate(date)}</h1>
        <p className="sub">{sessionTimes(date)}</p>
        <p className="sub">
          <Link href={`/session?date=${prev.toISOString().slice(0, 10)}`}>← Previous week</Link> · <Link href={`/session?date=${next.toISOString().slice(0, 10)}`}>Next week →</Link>
        </p>
      </header>
      {cancelledSessions().includes(date) && <div className="panel warn"><strong>This session is cancelled.</strong> New invites go to the next session instead. To bring it back, remove {date} from CANCELLED_SESSIONS in the Settings tab.</div>}
      <section className="tiles">
        <div className="tile"><div className="tile-label">Invited</div><div className="tile-value">{counted.length}</div></div>
        <div className="tile"><div className="tile-label">Confirmed</div><div className="tile-value">{confirmed}</div></div>
        <div className="tile"><div className="tile-label">Reminder sent</div><div className="tile-value">{reminded}</div><div className="tile-note">Wednesday 6:00 AM PT</div></div>
      </section>
      {isToday && <TrackingStatus date={date} z={d.zoomTracking} />}
      {isToday && <div className="session-day" data-tour="session-day"><span className="dot-live" /><span><b>Session day mode.</b> Decide right from the list: Pass, Not Fit, Left Zoom or Did not finish. Each one can be undone from the message at the bottom.</span></div>}
      {isToday && live.size > 0 && (
        <section className="panel live-zoom">
          <h2><span className="dot-live" /> Live in Zoom <span className="muted small">Zoom is checked every minute during the session</span></h2>
          <div className="live-cols">
            <div><h3>In Zoom now ({inNow.length})</h3><ul>{inNow.map((a) => <li key={s(a['Applicant ID'])}><Link href={`/candidates/${encodeURIComponent(s(a['Applicant ID']))}`}>{fullName(a)}</Link> <span className="muted small">{live.get(s(a['Applicant ID']))?.minutes} min</span></li>)}</ul></div>
            <div><h3>Left Zoom ({leftZoom.length})</h3><ul>{leftZoom.map((a) => <li key={s(a['Applicant ID'])}><Link href={`/candidates/${encodeURIComponent(s(a['Applicant ID']))}`}>{fullName(a)}</Link> <ZoomBadge z={live.get(s(a['Applicant ID']))} /></li>)}</ul></div>
            <div><h3>Confirmed, not joined yet ({notYet.length})</h3><ul>{notYet.map((a) => <li key={s(a['Applicant ID'])}><Link href={`/candidates/${encodeURIComponent(s(a['Applicant ID']))}`}>{fullName(a)}</Link></li>)}</ul></div>
          </div>
        </section>
      )}
      <div data-tour="nonneg"><NonNegotiables open={isToday} /></div>
      {noShows > 0 && <section className="panel"><h2>After the session</h2><ReinviteNoShows session={date} count={noShows} sampleId={s(noShowRows[0]?.['Applicant ID'])} /></section>}
      <section className="panel" data-tour="roster">
        <table className="table">
          <thead><tr>
            <th>Name</th>
            <th><HeaderFilter label="Position" filter={{ param: 'pos', options: opts(roster.map((a) => s(a.Position))) }} /></th>
            <th><HeaderFilter label="Stage" filter={{ param: 'stage', options: opts(roster.map((a) => s(a.Stage))) }} /></th>
            <th><HeaderFilter label="Confirmed" filter={{ param: 'conf', options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }] }} /></th>
            <th><HeaderFilter label="Reminder" filter={{ param: 'rem', options: [{ value: 'Sent', label: 'Sent' }, { value: 'Not sent', label: 'Not sent' }] }} /></th>
            <th><HeaderFilter label="Arrival" filter={{ param: 'arr', options: ['10+ min early', 'Under 10 min early', 'Late', 'Not recorded'].map((v) => ({ value: v, label: v })) }} /></th>
            <th><HeaderFilter label="Zoom minutes" filter={{ param: 'zoom', options: [{ value: 'Joined Zoom', label: 'Joined Zoom' }, { value: 'No Zoom minutes', label: 'No Zoom minutes' }] }} /></th>
            {isToday && <th>Decide</th>}
          </tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={s(a['Applicant ID'])}>
                <td><Link href={`/candidates/${encodeURIComponent(s(a['Applicant ID']))}`}>{fullName(a)}</Link></td>
                <td>{s(a.Position)}</td><td><StageBadge stage={s(a.Stage)} /><ZoomBadge z={live.get(s(a['Applicant ID']))} />{isTest(a) && <span className="tag">Test · not counted</span>}</td>
                <td>{a['Confirmed At'] ? 'Yes' : 'No'}</td><td>{a['Reminder Sent At'] ? 'Sent' : '—'}</td><td><Arrival a={a} /></td><td>{s(a['Zoom Minutes']) || '—'}</td>{isToday && <td><QuickDecide id={s(a['Applicant ID'])} name={fullName(a)} stage={s(a.Stage)} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered && <p className="muted small" style={{ marginTop: 8 }}>Showing {rows.length} of {roster.length}. <Link href={clear}>Clear filters</Link></p>}
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

/** "Attendance tracking: on since 1:41 PM" / "not started" for today's session (Zoom tracking started by Open session). */
function TrackingStatus({ date, z }: { date: string; z?: { day?: string; since?: string; by?: string; lastPoll?: string; done?: boolean; configured?: boolean } }) {
  const hm = (stamp?: string) => { const m = /(\d{2}):(\d{2})/.exec(String(stamp || '').slice(11)); if (!m) return ''; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };
  const on = z?.day === date;
  let text = 'Attendance tracking: not started. It starts when someone clicks Open session from 1:30 PM PT.';
  if (on && z?.done) text = `Attendance tracking: finished. Started ${hm(z.since)} by ${z.by}; stages were set from the Zoom minutes.`;
  else if (on) text = `Attendance tracking: on since ${hm(z?.since)}${z?.by ? ` (${z.by})` : ''}${z?.lastPoll ? ` · last Zoom check ${hm(z.lastPoll)}` : ''}. Zoom is checked every minute; results are set after 3:30 PM.`;
  else if (z && z.configured === false) text = 'Attendance tracking: Zoom is not connected to Apps Script yet.';
  return (
    <div className={`panel ${on ? 'info' : ''}`} data-tour="tracking" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: 1 }}>{text}</span>
      {!on && <OpenSessionButton date={date} label="Start attendance tracking" className="btn small-btn" navigate={false} />}
    </div>
  );
}
