'use client';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { TOURS, TOUR_KEY, TOUR_SEEN, START_TOUR_EVENT, type TourStep } from './tours';

type State = { id: string; step: number; first?: string };
const load = (): State | null => { try { return JSON.parse(localStorage.getItem(TOUR_KEY) || 'null'); } catch { return null; } };
const save = (s: State | null) => { try { if (s) localStorage.setItem(TOUR_KEY, JSON.stringify(s)); else localStorage.removeItem(TOUR_KEY); } catch { /* ignore */ } };

/** Start a tutorial from anywhere (Help → Tutorials, the welcome card). */
export function startTour(id: string) { window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: id })); }

/**
 * Runs the guided tutorials: opens the right page, dims everything except the highlighted part and shows what to do.
 * Progress is kept in this browser, so moving between pages carries on where it was.
 */
export default function Tour({ user }: { user: string }) {
  const path = usePathname();
  const [st, setSt] = useState<State | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    setSt(load());
    try { if (!localStorage.getItem(TOUR_SEEN) && !load()) setWelcome(true); } catch { /* ignore */ }
    const on = (e: Event) => { const s = { id: String((e as CustomEvent).detail), step: 0 }; save(s); setSt(s); setWelcome(false); try { localStorage.setItem(TOUR_SEEN, '1'); } catch { /* ignore */ } };
    window.addEventListener(START_TOUR_EVENT, on);
    return () => window.removeEventListener(START_TOUR_EVENT, on);
  }, []);

  const tour = st ? TOURS.find((t) => t.id === st.id) : null;
  const step: TourStep | undefined = tour?.steps[st?.step ?? 0];

  const stop = useCallback(() => { save(null); setSt(null); setRect(null); }, []);
  const go = useCallback((delta: number) => {
    if (!st || !tour) return;
    const n = st.step + delta;
    if (n < 0) return;
    if (n >= tour.steps.length) { stop(); return; }
    // the first applicant in the list, remembered so every profile step uses the same person
    let first = st.first;
    if (!first) {
      const a = document.querySelector<HTMLAnchorElement>('[data-tour="cand-table"] a[href^="/candidates/"]');
      if (a) first = a.getAttribute('href') || undefined;
    }
    const s = { ...st, step: n, first };
    save(s); setSt(s); setRect(null);
  }, [st, tour, stop]);

  // Open the step's page (a full load, so the profile opens as a page and not in the side panel)
  const target = step ? (step.path === '@first-candidate' ? st?.first || '/candidates' : step.path) : '';
  useEffect(() => {
    if (!step || !target) return;
    const want = target.split('?')[0];
    const here = step.path === '@first-candidate' && !st?.first ? path.startsWith('/candidates') : path === want;
    if (!here) window.location.assign(target);
  }, [step, target, path, st?.first]);

  // Find and follow the highlighted element; skip optional steps whose part is not on the page
  useLayoutEffect(() => {
    if (!step) return;
    if (!step.target) { setRect(null); return; }
    let tries = 0;
    let el: HTMLElement | null = null;
    const find = () => {
      el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => el && setRect(el.getBoundingClientRect()), 350); return; }
      if (++tries < 15) { timer = setTimeout(find, 200); return; }
      if (step.optional) go(1); else setRect(null);
    };
    let timer = setTimeout(find, 150);
    const follow = () => { if (el) setRect(el.getBoundingClientRect()); };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => { clearTimeout(timer); window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
  }, [step, path, go]);

  useEffect(() => {
    if (!st) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [st, go, stop]);

  if (welcome && !st) {
    return (
      <div className="tour-welcome" role="dialog" aria-label="Welcome">
        <b>Welcome to the new CWCRM, {user === 'Am' ? 'Am' : user}</b>
        <p>Take the 2-minute tour to see where everything is. More tutorials are in Help → Tutorials.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => startTour('basics')}>Start the tour</button>
          <button className="btn" onClick={() => { setWelcome(false); try { localStorage.setItem(TOUR_SEEN, '1'); } catch { /* ignore */ } }}>Later</button>
        </div>
      </div>
    );
  }
  if (!st || !tour || !step) return null;

  const pad = 6;
  const r = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  const W = 360;
  let card: React.CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  if (r) {
    const vh = window.innerHeight; const vw = window.innerWidth;
    const below = r.top + r.height + 14;
    const left = Math.min(Math.max(12, r.left), vw - W - 12);
    if (below + 230 < vh) card = { top: below, left };
    else if (r.top - 14 - 230 > 0) card = { top: r.top - 14, left, transform: 'translateY(-100%)' };
    else card = { top: Math.max(12, Math.min(r.top, vh - 260)), left: r.left + r.width + 14 + W < vw ? r.left + r.width + 14 : Math.max(12, r.left - W - 14) };
  }
  return (
    <div className="tour" aria-live="polite">
      {r ? (
        <>
          <div className="tour-dim" style={{ top: 0, left: 0, right: 0, height: Math.max(0, r.top) }} />
          <div className="tour-dim" style={{ top: r.top + r.height, left: 0, right: 0, bottom: 0 }} />
          <div className="tour-dim" style={{ top: r.top, left: 0, width: Math.max(0, r.left), height: r.height }} />
          <div className="tour-dim" style={{ top: r.top, left: r.left + r.width, right: 0, height: r.height }} />
          <div className="tour-ring" style={r} />
        </>
      ) : <div className="tour-dim" style={{ inset: 0 }} />}
      <div className="tour-card" style={{ ...card, width: W }} role="dialog" aria-label={step.title}>
        <div className="tour-meta">{tour.title} · Step {st.step + 1} of {tour.steps.length}</div>
        <div className="tour-title">{step.title}</div>
        <p className="tour-body">{step.body}</p>
        <div className="tour-bar"><i style={{ width: `${((st.step + 1) / tour.steps.length) * 100}%` }} /></div>
        <div className="tour-foot">
          <button className="link-btn" onClick={stop}>End tutorial</button>
          <span style={{ flex: 1 }} />
          <button className="btn" disabled={st.step === 0} onClick={() => go(-1)}>Back</button>
          <button className="btn primary" onClick={() => go(1)}>{st.step === tour.steps.length - 1 ? 'Finish' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
