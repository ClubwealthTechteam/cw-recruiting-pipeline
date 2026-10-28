import Link from 'next/link';
import { Suspense } from 'react';
import { getData, getDataWithHistory } from '@/lib/sheet';
import { STAGES, s, fullName, ymd, formatDate, formatDateTime, positionCounts, weekOf, scoreSummary, splitTags, isTest } from '@/lib/pipeline';
import SavedViews from '@/components/SavedViews';
import CandidatesTable, { type CandidateRow } from '@/components/CandidatesTable';
import DataError from '@/components/DataError';

const PAGE = 200;
const CLOSED = ['Passed', 'Hired', 'Onboarded', 'Not Fit'];

type Q = { stage?: string; fit?: string; source?: string; position?: string; session?: string; q?: string; history?: string; page?: string; tag?: string; week?: string; score?: string };

export default async function Candidates({ searchParams }: { searchParams: Promise<Q> }) {
  const p = await searchParams;
  const showHistory = p.history === '1';
  let d;
  try { d = await (showHistory ? getDataWithHistory() : getData()); } catch (e) { return <DataError error={e} />; }
  const base = d.applicants.filter((a) => showHistory || s(a.Historical) !== 'Y');
  const stage = p.stage || 'Active';
  const real = base.filter((a) => !isTest(a)); // test applicants are listed but not counted
  const counts: Record<string, number> = { Active: real.filter((a) => !CLOSED.includes(s(a.Stage))).length, All: real.length };
  for (const st of STAGES) counts[st] = real.filter((a) => s(a.Stage) === st).length;

  const q = (p.q || '').trim().toLowerCase();
  const cardsBy = new Map<string, Record<string, string | number>[]>();
  for (const c of d.scores || []) {
    const k = s(c['Applicant ID']);
    cardsBy.set(k, [...(cardsBy.get(k) || []), c]);
  }
  const score = (a: Record<string, unknown>) => scoreSummary(cardsBy.get(s(a['Applicant ID'])) || []);
  const tag = (p.tag || '').toLowerCase();
  // Every filter except position, so the per-position counts show the split of what the other filters match.
  const matchOthers = base.filter((a) =>
    (stage === 'All' || (stage === 'Active' ? !CLOSED.includes(s(a.Stage)) : s(a.Stage) === stage)) &&
    (!p.source || s(a.Source) === p.source) &&
    (!p.fit || (p.fit === 'Not screened' ? !s(a['Screen Tag']) && !s(a['Invite Hold']) : p.fit === 'Held back' ? !s(a['Screen Tag']) && !!s(a['Invite Hold']) : s(a['Screen Tag']) === p.fit)) &&
    (!p.session || ymd(a['Interview Date']) === p.session) &&
    (!tag || splitTags(a.Tags).some((t) => t.toLowerCase() === tag)) &&
    (!p.week || weekOf(s(a['Applied At (PT)'])) === p.week) &&
    (!p.score || (p.score === 'rated' ? score(a).count > 0 : p.score === 'unrated' ? score(a).count === 0 : score(a).suggestion === p.score)) &&
    (!q || `${fullName(a)} ${s(a.Email)} ${s(a['Position (as typed)'])}`.toLowerCase().includes(q))
  );
  const byPosition = positionCounts(matchOthers.filter((a) => !isTest(a)));
  let rows = matchOthers.filter((a) => !p.position || s(a.Position) === p.position);
  rows = rows.sort((x, y) => s(y['Applied At (PT)']).localeCompare(s(x['Applied At (PT)'])));
  const page = Math.max(1, Number(p.page) || 1);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const allTags = [...new Set(base.flatMap((a) => splitTags(a.Tags)))].sort((x, y) => x.localeCompare(y));
  const positions = [...new Set(d.applicants.map((a) => s(a.Position)).filter(Boolean))].sort();
  const sessions = [...new Set(base.map((a) => ymd(a['Interview Date'])).filter(Boolean))].sort().reverse().slice(0, 12);

  const tableRows: CandidateRow[] = shown.map((a) => ({
    id: s(a['Applicant ID']), name: fullName(a), email: s(a.Email), stage: s(a.Stage), source: s(a.Source),
    position: s(a.Position), applied: formatDateTime(s(a['Applied At (PT)'])), interview: formatDate(ymd(a['Interview Date'])),
    confirmed: a['Confirmed At'] ? formatDate(ymd(a['Confirmed At'])) : '', minutes: s(a['Zoom Minutes']),
    invites: s(a['Invite Count']), historical: s(a.Historical) === 'Y', test: isTest(a),
    fit: s(a['Screen Tag']), fitTrack: s(a['Screen Track']), fitSummary: s(a['Screen Summary']), hold: s(a['Invite Hold']),
    score: score(a).count ? score(a).average.toFixed(1) : '', scoreSuggestion: score(a).suggestion, tags: splitTags(a.Tags)
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
      <Suspense fallback={null}><SavedViews views={(d.views || []).map((v) => ({ name: s(v.Name), query: s(v.Query), by: s(v['Created By']) }))} /></Suspense>
      <nav className="tabs">
        {['Active', ...STAGES, 'All'].map((t) => (
          <Link key={t} href={link({ stage: t })} className={t === stage ? 'active' : ''}>{t} <span className="count">{counts[t] ?? 0}</span></Link>
        ))}
      </nav>
      <form className="filters" action="/candidates">
        <input type="hidden" name="stage" value={stage} />
        <input name="q" defaultValue={p.q} placeholder="Search name, email or position" />
        <select name="fit" defaultValue={p.fit || ''}><option value="">All fits</option><option>Great</option><option>Good</option><option>Not Fit</option><option>Held back</option><option value="Not screened">Not rated yet</option></select>
        <select name="source" defaultValue={p.source || ''}><option value="">All sources</option><option>Form</option><option>OLJ</option><option>Email</option></select>
        <select name="position" defaultValue={p.position || ''}><option value="">All positions</option>{positions.map((x) => <option key={x}>{x}</option>)}</select>
        <select name="score" defaultValue={p.score || ''}><option value="">Any score</option><option value="rated">Rated</option><option value="unrated">Not rated (0)</option><option value="Passed">Suggested Passed</option><option value="Not Fit">Suggested Not Fit</option></select>
        {allTags.length > 0 && <select name="tag" defaultValue={p.tag || ''}><option value="">All tags</option>{allTags.map((t) => <option key={t}>{t}</option>)}</select>}
        {p.week && <input type="hidden" name="week" value={p.week} />}
        <select name="session" defaultValue={p.session || ''}><option value="">All sessions</option>{sessions.map((x) => <option key={x} value={x}>{formatDate(x)}</option>)}</select>
        <label className="check-label"><input type="checkbox" name="history" value="1" defaultChecked={showHistory} /> Include applicants from before the system</label>
        <button className="btn">Filter</button>
        <Link href="/candidates" className="btn ghost">Clear</Link>
      </form>
      <div className="result-count">
        <p><strong>{rows.filter((a) => !isTest(a)).length}</strong> applicant{rows.filter((a) => !isTest(a)).length === 1 ? '' : 's'}{p.position ? <> for <strong>{p.position}</strong></> : ''}{p.tag ? <> tagged <strong>{p.tag}</strong></> : ''}{p.week ? <> who applied the week of <strong>{formatDate(p.week)}</strong></> : ''} match these filters{rows.some(isTest) ? <span className="muted"> (plus {rows.filter(isTest).length} test applicant, not counted)</span> : ''}</p>
        <div className="position-chips" aria-label="Applicants by position">
          <Link href={link({ position: undefined })} className={!p.position ? 'chip active' : 'chip'}>All positions <span className="count">{matchOthers.filter((a) => !isTest(a)).length}</span></Link>
          {byPosition.map((x) => (
            <Link key={x.position} href={link({ position: x.position })} className={p.position === x.position ? 'chip active' : 'chip'}>
              {x.position} <span className="count">{x.count}</span>
            </Link>
          ))}
        </div>
      </div>
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
