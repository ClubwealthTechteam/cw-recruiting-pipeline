import Link from 'next/link';
import { getData, type Row } from '@/lib/sheet';
import { s, ymd, pct, daysAgoPT, isTest, SOURCE_LABEL } from '@/lib/pipeline';
import DataError from '@/components/DataError';
import { HBars } from '@/components/Charts';

type Q = { period?: string };
const PERIODS: Record<string, { label: string; days: number | null }> = {
  '30': { label: 'Last 30 days', days: 30 }, '90': { label: 'Last 90 days', days: 90 }, all: { label: 'Since the system started', days: null }
};

const daysBetween = (a: string, b: string) => (Date.parse(`${ymd(b)}T00:00:00Z`) - Date.parse(`${ymd(a)}T00:00:00Z`)) / 86_400_000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

type Group = { label: string; href: string; applied: number; invited: number; confirmed: number; joined: number; completed: number; passed: number; hired: number; toHire: number | null; toInterview: number | null };

/** Which source and which position bring people who actually complete interviews and get hired. */
export default async function Reports({ searchParams }: { searchParams: Promise<Q> }) {
  const p = await searchParams;
  const period = PERIODS[p.period || ''] ? p.period! : 'all';
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const since = PERIODS[period].days ? daysAgoPT(PERIODS[period].days!) : '';
  const apps = d.applicants.filter((a) => s(a.Historical) !== 'Y' && !isTest(a) && (!since || ymd(a['Applied At (PT)']) >= since));

  const reached = new Map<string, Map<string, string>>(); // applicant -> stage -> first time
  for (const h of d.history) {
    const id = s(h['Applicant ID']);
    if (!reached.has(id)) reached.set(id, new Map());
    const m = reached.get(id)!;
    if (!m.has(s(h['To Stage']))) m.set(s(h['To Stage']), s(h['Timestamp (PT)']));
  }
  const did = (a: Row, st: string) => s(a.Stage) === st || !!reached.get(s(a['Applicant ID']))?.has(st);
  const when = (a: Row, st: string) => reached.get(s(a['Applicant ID']))?.get(st) || (s(a.Stage) === st ? s(a['Stage Updated At']) : '');

  function group(label: string, href: string, rows: Row[]): Group {
    const invited = rows.filter((a) => Number(a['Invite Count']) > 0 || s(a.Stage) !== 'Applied');
    const completed = rows.filter((a) => did(a, 'Interview Completed') || did(a, 'Passed Pre-Interview') || did(a, 'Passed Interview') || did(a, 'Hired') || did(a, 'Onboarded'));
    const hired = rows.filter((a) => did(a, 'Hired') || did(a, 'Onboarded'));
    return {
      label, href, applied: rows.length, invited: invited.length,
      confirmed: rows.filter((a) => a['Confirmed At'] || did(a, 'Confirmed')).length,
      // everyone who completed also joined, even when their Zoom minutes were not recorded (e.g. moved to Passed by hand)
      joined: rows.filter((a) => Number(a['Zoom Minutes']) > 0 || did(a, 'Did Not Complete') || did(a, 'Uninterested | Left Zoom') || completed.includes(a)).length,
      completed: completed.length, passed: rows.filter((a) => did(a, 'Passed Pre-Interview') || did(a, 'Passed Interview') || did(a, 'Hired') || did(a, 'Onboarded')).length, hired: hired.length,
      toHire: median(hired.map((a) => daysBetween(s(a['Applied At (PT)']), (when(a, 'Hired') || when(a, 'Onboarded')))).filter((x) => x >= 0)),
      toInterview: median(completed.map((a) => daysBetween(s(a['Applied At (PT)']), s(a['Interview Date']))).filter((x) => x >= 0))
    };
  }
  const by = (key: string, fmt: (v: string) => string, param: string) => {
    const keys = [...new Set(apps.map((a) => s(a[key]) || 'Other'))];
    return keys.map((k) => group(fmt(k), `/candidates?stage=All&${param}=${encodeURIComponent(k)}`, apps.filter((a) => (s(a[key]) || 'Other') === k)))
      .sort((x, y) => y.applied - x.applied);
  };
  const sources = by('Source', (v) => SOURCE_LABEL[v] || v, 'source');
  const positions = by('Position', (v) => v, 'position');
  const total = group('All', '/candidates?stage=All', apps);
  const rate = (a: number, b: number) => (b ? a / b : null);

  const table = (rows: Group[], title: string) => (
    <table className="table">
      <thead><tr><th>{title}</th><th>Applied</th><th>Invited</th><th>Confirmed</th><th>Joined Zoom</th><th>Completed</th><th>Passed</th><th>Hired</th><th title="Completed ÷ joined">Completion</th><th title="Passed or Hired ÷ completed">Pass rate</th><th title="Median days from applying to Hired">Days to hire</th></tr></thead>
      <tbody>
        {[...rows, ...(rows.length > 1 ? [total] : [])].map((g) => (
          <tr key={g.label} className={g.label === 'All' ? 'total' : ''}>
            <td><Link href={g.href}>{g.label}</Link></td><td>{g.applied}</td><td>{g.invited}</td><td>{g.confirmed}</td><td>{g.joined}</td><td>{g.completed}</td><td>{g.passed}</td><td>{g.hired}</td>
            <td>{pct(rate(g.completed, g.joined))}</td><td>{pct(rate(g.passed, g.completed))}</td><td>{g.toHire === null ? '—' : Math.round(g.toHire)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <header className="page-head">
        <h1>Reports</h1>
        <p className="sub">By source and by position, for applicants who applied in the period. Applicants invited by hand before the system started, and test applicants, are not included. Click a row or a bar to see the people.</p>
      </header>
      <nav className="tabs">
        {Object.entries(PERIODS).map(([k, v]) => <Link key={k} href={`/reports?period=${k}`} className={k === period ? 'active' : ''}>{v.label}</Link>)}
      </nav>
      <div className="two-col">
        <section className="panel">
          <h2>Who completes the interview, by source</h2>
          <p className="sub">Completed (stayed 1h+ in Zoom) ÷ invited. The note shows how many that is.</p>
          <HBars format="pct" ariaLabel="Completion of invited applicants by source" data={sources.map((g) => ({ label: g.label, value: rate(g.completed, g.invited) ?? 0, note: `${g.completed} of ${g.invited}`, href: g.href }))} />
        </section>
        <section className="panel">
          <h2>Who completes the interview, by position</h2>
          <p className="sub">Completed ÷ invited, per position.</p>
          <HBars format="pct" ariaLabel="Completion of invited applicants by position" data={positions.filter((g) => g.invited > 0).map((g) => ({ label: g.label, value: rate(g.completed, g.invited) ?? 0, note: `${g.completed} of ${g.invited}`, href: g.href }))} />
        </section>
      </div>
      <section className="panel"><h2>By source</h2>{table(sources, 'Source')}</section>
      <section className="panel">
        <h2>By position</h2>
        {table(positions, 'Position')}
        <p className="hint">Days to hire is the median number of days from applying to being moved to Hired. “—” means no one was hired in that group yet.{total.toInterview !== null ? ` Median days from applying to the interview: ${Math.round(total.toInterview)}.` : ''}</p>
      </section>
    </>
  );
}
