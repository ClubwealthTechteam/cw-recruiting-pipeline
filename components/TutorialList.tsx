'use client';
import { TOURS } from './tours';
import { startTour } from './Tour';

/** Help → Tutorials: each one walks through a real task on the real pages, step by step. */
export default function TutorialList() {
  return (
    <section className="panel" id="tutorials">
      <h2>Tutorials</h2>
      <p className="sub" style={{ marginBottom: 14 }}>Each tutorial opens the real pages and highlights exactly where to click. Use Next / Back (or the arrow keys); Esc stops. Nothing is sent or changed by the tutorial itself.</p>
      <div className="tutorials">
        {TOURS.map((t, i) => (
          <div key={t.id} className="tutorial">
            <span className="muted small">{i + 1} · about {t.minutes} min · {t.steps.length} steps</span>
            <b>{t.title}</b>
            <span className="muted">{t.summary}</span>
            <button className="btn primary" onClick={() => startTour(t.id)}>Start</button>
          </div>
        ))}
      </div>
    </section>
  );
}
