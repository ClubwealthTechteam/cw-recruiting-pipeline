import Link from 'next/link';
import { getData } from '@/lib/sheet';
import { STAGES, s, fullName, ymd, formatDate } from '@/lib/pipeline';
import CandidatesTable, { type CandidateRow } from '@/components/CandidatesTable';
import DataError from '@/components/DataError';

const PAGE = 200;
const CLOSED = ['Passed', 'Hired', 'Not Fit'];

type Q = { stage?: string; source?: string; position?: string; session?: string; q?: string; history?: string; page?: string };

export default async function Candidates({ searchParams }: { searchParams: Promise<Q> }) {
  const p = await searchParams;
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const showHistory = p.history === '1';
  const base = d.applicants.filter((a) => showHistory || s(a.Historical) !== 'Y');
  const stage = p.stage || 'Active';
  const counts: Record<string, number> = { Active: base.filter((a) => !CLOSED.includes(s(a.Stage))).length, All: base.length };
  for (const st of STAGES) counts[st] = base.filter((a) => s(a.Stage) === st).length;

  const q = (p.q || '').trim().toLowerCase();
  let rows = base.filter((a) =>
    (stage === 'All' || (stage === 'Active' ? !CLOSED.includes(s(a.Stage)) : s(a.Stage) === stage)) &&
    (!p.source || s(a.Source) === p.source) &&
    (!p.position || s(a.Position) === p.position) &&
    (!p.session || ymd(a['Interview Date']) === p.session) &&
    (!q || `${fullName(a)} ${s(a.Email)} ${s(a['Position (as typed)'])}`.toLowerCase().includes(q))
  );
  rows = rows.sort((x, y) => s(y['Applied At (PT)']).localeCompare(s(x['Applied At (PT)'])));
  const page = Math.max(1, Number(p.page) || 1);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const positions = [...new Set(d.applicants.map((a) => s(a.Position)).filter(Boolean))].sort();
  const sessions = [...new Set(base.map((a) => ymd(a['Interview Date'])).filter(Boolean))].sort().reverse().slice(0, 12);

  const tableRows: CandidateRow[] = shown.map((a) => ({
    id: s(a['Applicant ID']), name: fullName(a), email: s(a.Email), stage: s(a.Stage), source: s(a.Source),
    position: s(a.Position), applied: formatDate(ymd(a['Applied At (PT)'])), interview: formatDate(ymd(a['Interview Date'])),
    confirmed: a['Confirmed At'] ? formatDate(ymd(a['Confirmed At'])) : '', minutes: s(a['Zoom Minutes']),
    invites: s(a['Invite Count']), historical: s(a.Historical) === 'Y'
  }));

  const link = (over: Partial<Q>) => {
    const u = new URLSearchParams();
    const merged = { ...p, page: undefined, ...over } as Q;
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, String(v));
    return `/candidates?${u.toString()}`;
  };

  return (
    <>
      <header className="page-head"><h1>Candidates</h1></header>
      <nav className="tabs">
        {['Active', ...STAGES, 'All'].map((t) => (
          <Link key={t} href={link({ stage: t })} className={t === stage ? 'active' : ''}>{t} <span className="count">{counts[t] ?? 0}</span></Link>
        ))}
      </nav>
      <form className="filters" action="/candidates">
        <input type="hidden" name="stage" value={stage} />
        <input name="q" defaultValue={p.q} placeholder="Search name, email or position" />
        <select name="source" defaultValue={p.source || ''}><option value="">All sources</option><option>Form</option><option>OLJ</option></select>
        <select name="position" defaultValue={p.position || ''}><option value="">All positions</option>{positions.map((x) => <option key={x}>{x}</option>)}</select>
        <select name="session" defaultValue={p.session || ''}><option value="">All sessions</option>{sessions.map((x) => <option key={x} value={x}>{formatDate(x)}</option>)}</select>
        <label className="check-label"><input type="checkbox" name="history" value="1" defaultChecked={showHistory} /> Include applicants from before the system</label>
        <button className="btn">Filter</button>
        <Link href="/candidates" className="btn ghost">Clear</Link>
      </form>
      <CandidatesTable rows={tableRows} />
      {rows.length > PAGE && (
        <div className="pager">
          {page > 1 && <Link href={link({ page: String(page - 1) })} className="btn ghost">Previous</Link>}
          <span>Page {page} of {Math.ceil(rows.length / PAGE)} · {rows.length} applicants</span>
          {page * PAGE < rows.length && <Link href={link({ page: String(page + 1) })} className="btn ghost">Next</Link>}
        </div>
      )}
    </>
  );
}
