'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { REASON_REQUIRED, HIRED_COLUMNS, parseStageChoice, type ZoomLive } from '@/lib/pipeline';
import ZoomBadge from './ZoomBadge';
import { useAction } from './useAction';
import { InlineStage } from './InlineActions';
import { useSince, isNew } from './useSince';
import { hireFields, notFitFields } from './hirePrompt';
import { initials, avatarColor } from './CandidatesTable';

export type BoardCard = { id: string; name: string; email?: string; phone?: string; stage: string; position: string; source: string; fit: string; session: string; score: string; arrival: string; changed?: string[]; company?: string; test?: boolean; zoom?: ZoomLive };
const PER_COLUMN = 60;
const FIT_TONE: Record<string, string> = { Great: 'green', Good: 'blue', 'Not Fit': 'grey' };

export default function Board({ stages, cards }: { stages: string[]; cards: BoardCard[] }) {
  const { run, busy } = useAction();
  const since = useSince();
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [over, setOver] = useState('');
  const [moved, setMoved] = useState<Record<string, string>>({}); // shows the move at once, before the sheet confirms
  const stageOf = (c: BoardCard) => moved[c.id] || c.stage;

  // Find on the board (Miguel, 2026-11-12): name, email or phone. Nothing is hidden: the board scrolls to the card
  // and it is outlined in blue. Enter (or ↓) goes to the next match, Shift+Enter (or ↑) to the one before.
  const [find, setFind] = useState('');
  const [hit, setHit] = useState(0);
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
  const digits = (v: string) => v.replace(/\D/g, '');
  const q = norm(find);
  const qd = digits(find);
  const matches = q.length < 2 ? [] : cards.filter((c) => norm(c.name).includes(q) || norm(c.email || '').includes(q) || (qd.length >= 4 && digits(c.phone || '').includes(qd)));
  const focusId = matches.length ? matches[Math.min(hit, matches.length - 1)].id : '';
  useEffect(() => { setHit(0); }, [find]);
  useEffect(() => {
    if (!focusId) return;
    const el = boardRef.current?.querySelector(`[data-card="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [focusId]);
  function step(dir: 1 | -1) {
    if (!matches.length) return;
    setHit((h) => (h + dir + matches.length) % matches.length);
  }
  // fresh data from the sheet (after a move, an undo or the auto refresh) replaces the shown-at-once moves
  useEffect(() => { setMoved({}); }, [cards]);

  // While a card is dragged near the left or right edge, scroll the board sideways (browsers don't do it for us).
  const boardRef = useRef<HTMLDivElement>(null);
  const speed = useRef(0);
  useEffect(() => {
    if (!dragging) { speed.current = 0; return; }
    let frame = 0;
    const tick = () => {
      if (speed.current && boardRef.current) boardRef.current.scrollLeft += speed.current;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  function edgeScroll(e: React.DragEvent) {
    const el = boardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const EDGE = 120;
    if (e.clientX > r.right - EDGE) speed.current = Math.ceil(((e.clientX - (r.right - EDGE)) / EDGE) * 22);
    else if (e.clientX < r.left + EDGE) speed.current = -Math.ceil((((r.left + EDGE) - e.clientX) / EDGE) * 22);
    else speed.current = 0;
  }

  async function drop(column: string) {
    const c = dragging;
    setDragging(null); setOver('');
    if (!c || stageOf(c) === column) return;
    if (column === 'Hired | company not set') { alert('Drop on Hired | Homexa or Hired | Clubwealth to pick the company.'); return; }
    // the split Hired columns: "Hired | Homexa" → stage Hired for Homexa (asks the start date)
    if (HIRED_COLUMNS.includes(column)) {
      const hire = hireFields(column, c.name);
      if (!hire) return;
      setMoved((m) => ({ ...m, [c.id]: column }));
      const ok = await run({ action: 'setStage', ids: [c.id], ...hire }, { success: `${c.name} moved to ${column} ✓ Onboarding email waiting in Needs Approval` });
      if (!ok) setMoved((m) => { const n = { ...m }; delete n[c.id]; return n; });
      return;
    }
    const stage = column;
    let reason = '';
    if (REASON_REQUIRED.includes(stage)) {
      reason = prompt(`Reason for moving ${c.name} to ${stage}:`)?.trim() || '';
      if (!reason) return;
    }
    // Hired / Onboarding: which company, and the start date for the onboarding email
    let hire: Record<string, string> | null = { stage };
    if (stage === 'Not Fit') { hire = notFitFields(c.name); if (!hire) return; hire = { stage, ...hire }; }
    if (stage === 'Hired' || stage === 'Onboarding') {
      const which = prompt(`${c.name}: ${stage} for which company?\nType H for Homexa or C for Clubwealth.`)?.trim().toUpperCase() || '';
      if (which !== 'H' && which !== 'C') return;
      hire = hireFields(`${stage} | ${which === 'H' ? 'Homexa' : 'Clubwealth'}`, c.name);
      if (!hire) return;
    }
    setMoved((m) => ({ ...m, [c.id]: stage }));
    const ok = await run({ action: 'setStage', ids: [c.id], reason, ...hire }, { success: `${c.name} moved to ${stage} ✓` });
    if (!ok) setMoved((m) => { const n = { ...m }; delete n[c.id]; return n; });
  }

  return (
    <>
    <div className="board-find">
      <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find on the board: name, email or phone"
        aria-label="Find on the board"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
          if (e.key === 'Escape') setFind('');
        }} />
      {q.length >= 2 && <span className="muted small">{matches.length ? `${Math.min(hit, matches.length - 1) + 1} of ${matches.length}` : 'Not on the board'}</span>}
      {matches.length > 1 && <><button type="button" className="btn small-btn" onClick={() => step(-1)} aria-label="Previous match">↑</button><button type="button" className="btn small-btn" onClick={() => step(1)} aria-label="Next match">↓</button></>}
    </div>
    <div className="board-wrap">
      {dragging && <div className="board-edge left" aria-hidden="true">‹</div>}
      {dragging && <div className="board-edge right" aria-hidden="true">›</div>}
    <div className="board" ref={boardRef} onDragOver={edgeScroll} onDrop={() => { speed.current = 0; }}>
      {stages.map((st) => {
        const col = cards.filter((c) => stageOf(c) === st);
        return (
          <section key={st} className={`board-col ${over === st ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(st); }} onDragLeave={() => setOver('')} onDrop={(e) => { e.preventDefault(); drop(st); }}>
            <h2>{st} <span className="count">{col.filter((c) => !c.test).length}</span></h2>
            {[...col.slice(0, PER_COLUMN), ...col.slice(PER_COLUMN).filter((c) => c.id === focusId)].map((c) => (
              <article key={c.id} data-card={c.id} className={`card ${busy && dragging?.id === c.id ? 'busy' : ''} ${c.id === focusId ? 'found' : ''}`} draggable
                onDragStart={() => setDragging(c)} onDragEnd={() => { setDragging(null); setOver(''); }}>
                <div className="card-top">
                  <span className="av" style={{ background: avatarColor(c.id) }}>{initials(c.name)}</span>
                  <Link href={`/candidates/${encodeURIComponent(c.id)}`} className="card-name" draggable={false}>{c.name}</Link>
                  {isNew(since, ...(c.changed || [])) && <span className="new-dot" title="New or changed since your last visit" style={{ marginLeft: 'auto' }} />}
                </div>
                <div className="muted small">{c.position} · {c.source}{c.session ? ` · ${c.session}` : ''}</div>
                <div className="card-move" onMouseDown={(e) => e.stopPropagation()}><InlineStage id={c.id} stage={parseStageChoice(stageOf(c)).stage} /></div>
                <div className="card-badges">
                  <ZoomBadge z={c.zoom} />
                  {c.test && <span className="badge grey">Test</span>}
                  {c.fit && <span className={`badge ${FIT_TONE[c.fit] || 'grey'}`}>{c.fit}</span>}
                  {c.company && !stageOf(c).startsWith('Hired') && <span className="mini-tag">{c.company === 'Club Wealth' ? 'Clubwealth' : c.company}</span>}
                  {c.score && <span className="badge blue" title="Scorecard average">{c.score}/5</span>}
                  {c.arrival && <span className="muted small">{c.arrival.replace(/ \(on time\)/, '')}</span>}
                </div>
              </article>
            ))}
            {col.length > PER_COLUMN && <Link className="small" href={`/candidates?stage=${encodeURIComponent(parseStageChoice(st).stage.replace(/ \| company not set$/, ""))}`}>+{col.length - PER_COLUMN} more in Candidates</Link>}
            {col.length === 0 && <p className="empty small">Drop here</p>}
          </section>
        );
      })}
    </div>
    </div>
    </>
  );
}
