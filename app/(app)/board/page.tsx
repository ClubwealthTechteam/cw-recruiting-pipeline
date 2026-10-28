import Link from 'next/link';
import { getData } from '@/lib/sheet';
import { STAGES, s, fullName, ymd, formatDate, scoreSummary, upcomingWednesday } from '@/lib/pipeline';
import DataError from '@/components/DataError';
import Board, { type BoardCard } from '@/components/Board';

type Q = { position?: string; session?: string; source?: string };

/** Kanban: one column per stage; drag a card to move the applicant. */
export default async function BoardPage({ searchParams }: { searchParams: Promise<Q> }) {
  const p = await searchParams;
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const cards = new Map<string, Record<string, string | number>[]>();
  for (const c of d.scores || []) cards.set(s(c['Applicant ID']), [...(cards.get(s(c['Applicant ID'])) || []), c]);
  const current = d.applicants.filter((a) => s(a.Historical) !== 'Y');
  const rows = current.filter((a) =>
    (!p.position || s(a.Position) === p.position) && (!p.source || s(a.Source) === p.source) &&
    (!p.session || ymd(a['Interview Date']) === p.session));
  const list: BoardCard[] = rows
    .sort((x, y) => s(y['Stage Updated At']).localeCompare(s(x['Stage Updated At'])))
    .map((a) => {
      const sc = scoreSummary(cards.get(s(a['Applicant ID'])) || []);
      return {
        id: s(a['Applicant ID']), name: fullName(a) || '(no name)', stage: s(a.Stage), position: s(a.Position), source: s(a.Source),
        fit: s(a['Screen Tag']), session: a['Interview Date'] ? formatDate(ymd(a['Interview Date'])).replace(/, \d{4}$/, '') : '',
        score: sc.count ? sc.average.toFixed(1) : '', arrival: s(a.Arrival)
      };
    });
  const positions = [...new Set(current.map((a) => s(a.Position)).filter(Boolean))].sort();
  const sessions = [...new Set(current.map((a) => ymd(a['Interview Date'])).filter(Boolean))].sort().reverse().slice(0, 8);
  return (
    <>
      <header className="page-head">
        <h1>Pipeline Board</h1>
        <p className="sub">Drag a card to another column to move the applicant. Stages that need a reason ask for one. Applicants from before the system are not shown. Scroll sideways for more stages.</p>
      </header>
      <form className="filters" action="/board">
        <select name="position" defaultValue={p.position || ''}><option value="">All positions</option>{positions.map((x) => <option key={x}>{x}</option>)}</select>
        <select name="source" defaultValue={p.source || ''}><option value="">All sources</option><option>Form</option><option>OLJ</option></select>
        <select name="session" defaultValue={p.session || ''}><option value="">All sessions</option>{sessions.map((x) => <option key={x} value={x}>{formatDate(x)}{x === upcomingWednesday() ? ' (this week)' : ''}</option>)}</select>
        <button className="btn">Filter</button>
        <Link href="/board" className="btn ghost">Clear</Link>
      </form>
      <Board stages={[...STAGES]} cards={list} />
    </>
  );
}
