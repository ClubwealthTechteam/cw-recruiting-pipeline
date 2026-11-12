import Link from 'next/link';
import StageSelect from '@/components/StageSelect';
import { Suspense } from 'react';
import { getData, getDataWithHistory } from '@/lib/sheet';
import { STAGES, s, fullName, ymd, formatDate, formatDateTime, positionCounts, weekOf, scoreSummary, splitTags, isTest, counted, isRepeat, SOURCES, SOURCE_LABEL, zoomLive, appliedRange, APPLIED_OPTIONS } from '@/lib/pipeline';
import SavedViews from '@/components/SavedViews';
import CandidatesTable, { type CandidateRow } from '@/components/CandidatesTable';
import AddApplicant from '@/components/AddApplicant';
import DataError from '@/components/DataError';

const PAGE = 200;
const CLOSED = ['Passed Interview', 'Benched', 'Hired', 'Onboarding', 'Offboarded', 'Not Fit', 'Banned'];

type Q = { stage?: string; fit?: string; source?: string; position?: string; session?: string; q?: string; history?: string; page?: string; tag?: string; week?: string; score?: string; applied?: string; from?: string; to?: string };

export default async function Candidates({ searchParams }: { searchParams: Promise<Q> }) {
  const p = await searchParams;
  const showHistory = p.history === '1';
  let d;
  try { d = await (showHistory ? getDataWithHistory() : getData()); } catch (e) { return <DataError error={e} />; }
  const base = d.applicants.filter((a) => showHistory || s(a.Historical) !== 'Y');
  const stage = p.stage || 'Active';
  const real = base.filter(counted); // test applicants and second applications are listed but not counted
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
  const range = appliedRange(p.applied, p.from, p.to);
  // Every filter except position, so the per-position counts show the split of what the other filters match.
  const matchOthers = base.filter((a) =>
    (stage === 'All' || (stage === 'Active' ? !CLOSED.includes(s(a.Stage)) : s(a.Stage) === stage)) &&
    (!p.source || s(a.Source) === p.source) &&
    (!p.fit || (p.fit === 'Not screened' ? !s(a['Screen Tag']) && !s(a['Invite Hold']) : p.fit === 'Held back' ? !s(a['Screen Tag']) && !!s(a['Invite Hold']) : s(a['Screen Tag']) === p.fit)) &&
    (!p.session || ymd(a['Interview Date']) === p.session) &&
    (!tag || splitTags(a.Tags).some((t) => t.toLowerCase() === tag)) &&
    (!p.week || weekOf(s(a['Applied At (PT)'])) === p.week) &&
    (!range || (ymd(a['Applied At (PT)']) >= range[0] && ymd(a['Applied At (PT)']) <= range[1])) &&
    (!p.score || (p.score === 'rated' ? score(a).count > 0 : p.score === 'unrated' ? score(a).count === 0 : score(a).suggestion === p.score)) &&
    (!q || `${fullName(a)} ${s(a.Email)} ${s(a['Position (as typed)'])}`.toLowerCase().includes(q))
  );
  const byPosition = positionCounts(matchOthers.filter(counted));
  let rows = matchOthers.filter((a) => !p.position || s(a.Position) === p.position);
  rows = rows.sort((x, y) => s(y['Applied At (PT)']).localeCompare(s(x['Applied At (PT)'])));
  const page = Math.max(1, Number(p.page) || 1);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const allTags = [...new Set(base.flatMap((a) => splitTags(a.Tags)))].sort((x, y) => x.localeCompare(y));
  const positions = [...new Set(d.applicants.map((a) => s(a.Position)).filter(Boolean))].sort();
  const sessions = [...new Set(base.map((a) => ymd(a['Interview Date'])).filter(Boolean))].sort().reverse().slice(0, 12);

  const live = zoomLive(d.zoom);
  const tableRows: CandidateRow[] = shown.map((a) => ({
    id: s(a['Applicant ID']), name: fullName(a), email: s(a.Email), stage: s(a.Stage), source: s(a.Source),
    changed: [s(a['Applied At (PT)']), s(a['Stage Updated At']), s(a['Confirmed At'])],
    position: s(a.Position), applied: formatDateTime(s(a['Applied At (PT)'])), interview: formatDate(ymd(a['Interview Date'])),
    confirmed: a['Confirmed At'] ? formatDate(ymd(a['Confirmed At'])) : '', minutes: s(a['Zoom Minutes']),
    invites: s(a['Invite Count']), historical: s(a.Historical) === 'Y', test: isTest(a), repeat: isRepeat(a), otherPositions: s(a['Other Positions']), formerVA: s(a['Former VA']),
    fit: s(a['Screen Tag']), fitTrack: s(a['Screen Track']), fitSummary: s(a['Screen Summary']), hold: s(a['Invite Hold']),
    score: score(a).count ? score(a).average.toFixed(1) : '', scoreSuggestion: score(a).suggestion, tags: splitTags(a.Tags),
    zoom: live.get(s(a['Applicant ID']))
  }));

  const link = (over: Partial<Q>) => {
    const u = new URLSearchParams();
    const merged = { ...p, page: undefined, ...over } as Q;
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, String(v));
    return `/candidates?${u.toString()}`;
  };

  return (
    <>
      <header className="page-head"><h1>Candidates</h1><p className="sub">A blue dot marks applicants who are new or changed since your last visit.</p></header>
      <Suspense fallback={null}><div data-tour="views"><SavedViews views={(d.views || []).map((v) => ({ name: s(v.Name), query: s(v.Query), by: s(v['Created By']) }))} /></div></Suspense>
      <StageSelect value={stage} options={['Active', ...STAGES, 'All'].map((t) => ({
        value: t, href: link({ stage: t }),
        label: `${t === 'Active' ? 'Active (not closed)' : t === 'All' ? 'All stages' : t} (${counts[t] ?? 0})`
      }))} />
      <form className="filters" action="/candidates">
        <input type="hidden" name="stage" value={stage} />
        <input name="q" defaultValue={p.q} placeholder="Search name, email or position" />
        {['fit', 'source', 'position', 'score', 'session', 'applied', 'from', 'to'].map((k) => p[k as keyof Q] ? <input key={k} type="hidden" name={k} value={p[k as keyof Q]} /> : null)}
        {allTags.length > 0 && <select name="tag" defaultValue={p.tag || ''}><option value="">All tags</option>{allTags.map((t) => <option key={t}>{t}</option>)}</select>}
        {p.week && <input type="hidden" name="week" value={p.week} />}
        <label className="check-label"><input type="checkbox" name="history" value="1" defaultChecked={showHistory} /> Include applicants from before the system</label>
        <button className="btn">Filter</button>
        <Link href="/candidates" className="btn ghost">Clear all filters</Link>
        <span className="hint">Filter by Fit, Score, Stage, Position, Source, Applied or Session with the ▾ on each column header.</span>
      </form>
      <div className="result-count">
        <p><strong>{rows.filter(counted).length}</strong> applicant{rows.filter(counted).length === 1 ? '' : 's'}{p.position ? <> for <strong>{p.position}</strong></> : ''}{p.tag ? <> tagged <strong>{p.tag}</strong></> : ''}{p.week ? <> who applied the week of <strong>{formatDate(p.week)}</strong></> : ''}{range ? <> who applied <strong>{p.applied === 'custom' ? `${range[0].startsWith('0000') ? 'up to' : `${formatDate(range[0])} –`} ${range[1].startsWith('9999') ? 'now' : formatDate(range[1])}` : (APPLIED_OPTIONS.find(([k]) => k === p.applied)?.[1] || '').replace(/^Applied /, '')}</strong></> : ''} match these filters{rows.some((a) => !counted(a)) ? <span className="muted"> (plus {rows.filter((a) => !counted(a)).length} test or repeat application{rows.filter((a) => !counted(a)).length === 1 ? '' : 's'}, not counted)</span> : ''}</p>
        <StageSelect label="Position" value={p.position || ''} options={[
          { value: '', label: `All positions (${matchOthers.filter(counted).length})`, href: link({ position: undefined }) },
          ...byPosition.map((x) => ({ value: x.position, label: `${x.position} (${x.count})`, href: link({ position: x.position }) })),
          ...(p.position && !byPosition.some((x) => x.position === p.position) ? [{ value: p.position, label: `${p.position} (0)`, href: link({ position: p.position }) }] : [])
        ]} />
      </div>
      <AddApplicant />
      <div data-tour="cand-table"><CandidatesTable rows={tableRows} filters={{
        fit: { param: 'fit', options: [['Great', 'Great'], ['Good', 'Good'], ['Not Fit', 'Not Fit'], ['Held back', 'Held back'], ['Not screened', 'Not rated yet']].map(([value, label]) => ({ value, label })) },
        score: { param: 'score', options: [['rated', 'Rated'], ['unrated', 'Not rated (0)'], ['Passed', 'Suggested Passed'], ['Not Fit', 'Suggested Not Fit']].map(([value, label]) => ({ value, label })) },
        stage: { param: 'stage', noAll: true, defaultValue: 'Active', options: ['Active', 'All', ...STAGES].map((x) => ({ value: x, label: x === 'Active' ? 'Active (not closed)' : x === 'All' ? 'All stages' : x })) },
        position: { param: 'position', options: positions.map((x) => ({ value: x, label: x })) },
        source: { param: 'source', options: SOURCES.map((x) => ({ value: x, label: SOURCE_LABEL[x] })) },
        applied: { param: 'applied', dates: true, options: APPLIED_OPTIONS.filter(([k]) => k).map(([value, label]) => ({ value, label: value === 'custom' ? 'Between dates:' : label.replace(/^Applied /, '') })) },
        session: { param: 'session', options: sessions.map((x) => ({ value: x, label: formatDate(x) })) }
      }} /></div>
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
