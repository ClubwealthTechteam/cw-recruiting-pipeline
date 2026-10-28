'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { REASON_REQUIRED } from '@/lib/pipeline';
import { useAction } from './useAction';
import { InlineStage } from './InlineActions';

export type BoardCard = { id: string; name: string; stage: string; position: string; source: string; fit: string; session: string; score: string; arrival: string; test?: boolean };
const PER_COLUMN = 60;
const FIT_TONE: Record<string, string> = { Great: 'green', Good: 'blue', 'Not Fit': 'grey' };

export default function Board({ stages, cards }: { stages: string[]; cards: BoardCard[] }) {
  const { run, busy } = useAction();
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [over, setOver] = useState('');
  const [moved, setMoved] = useState<Record<string, string>>({}); // shows the move at once, before the sheet confirms
  const stageOf = (c: BoardCard) => moved[c.id] || c.stage;

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

  async function drop(stage: string) {
    const c = dragging;
    setDragging(null); setOver('');
    if (!c || stageOf(c) === stage) return;
    let reason = '';
    if (REASON_REQUIRED.includes(stage)) {
      reason = prompt(`Reason for moving ${c.name} to ${stage}:`)?.trim() || '';
      if (!reason) return;
    }
    setMoved((m) => ({ ...m, [c.id]: stage }));
    const ok = await run({ action: 'setStage', ids: [c.id], stage, reason }, { success: `${c.name} moved to ${stage} ✓` });
    if (!ok) setMoved((m) => { const n = { ...m }; delete n[c.id]; return n; });
  }

  return (
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
            {col.slice(0, PER_COLUMN).map((c) => (
              <article key={c.id} className={`card ${busy && dragging?.id === c.id ? 'busy' : ''}`} draggable
                onDragStart={() => setDragging(c)} onDragEnd={() => { setDragging(null); setOver(''); }}>
                <Link href={`/candidates/${encodeURIComponent(c.id)}`} className="card-name" draggable={false}>{c.name}</Link>
                <div className="muted small">{c.position} · {c.source}{c.session ? ` · ${c.session}` : ''}</div>
                <div className="card-move" onMouseDown={(e) => e.stopPropagation()}><InlineStage id={c.id} stage={stageOf(c)} /></div>
                <div className="card-badges">
                  {c.test && <span className="badge grey">Test</span>}
                  {c.fit && <span className={`badge ${FIT_TONE[c.fit] || 'grey'}`}>{c.fit}</span>}
                  {c.score && <span className="badge blue" title="Scorecard average">{c.score}/5</span>}
                  {c.arrival && <span className="muted small">{c.arrival.replace(/ \(on time\)/, '')}</span>}
                </div>
              </article>
            ))}
            {col.length > PER_COLUMN && <Link className="small" href={`/candidates?stage=${encodeURIComponent(st)}`}>+{col.length - PER_COLUMN} more in Candidates</Link>}
            {col.length === 0 && <p className="empty small">Drop here</p>}
          </section>
        );
      })}
    </div>
    </div>
  );
}
