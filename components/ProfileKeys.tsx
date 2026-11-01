'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Keyboard shortcuts on the full profile page: J / K next and previous applicant (Candidates order), E write a reply,
 * S move stage, N add a note, ? show this list. Ignored while typing in a box.
 */
export default function ProfileKeys({ prev, next }: { prev?: string; next?: string }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      const go = (id?: string) => id && router.push(`/candidates/${encodeURIComponent(id)}`);
      const focus = (sel: string) => { const f = document.querySelector<HTMLElement>(sel); if (f) { e.preventDefault(); f.scrollIntoView({ block: 'center' }); f.focus(); } };
      const k = e.key.toLowerCase();
      if (k === 'j') go(next);
      else if (k === 'k') go(prev);
      else if (k === 'e') focus('#reply-box');
      else if (k === 's') focus('#stage-select');
      else if (k === 'n') focus('#note-box');
      else if (e.key === '?') setHelp((h) => !h);
      else if (e.key === 'Escape') setHelp(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [prev, next, router]);
  return (
    <>
      <span className="profile-nav" data-tour="profile-nav">
        <button className="btn small-btn" disabled={!prev} onClick={() => prev && router.push(`/candidates/${encodeURIComponent(prev)}`)} title="Previous applicant (K)">← Prev</button>
        <button className="btn small-btn" disabled={!next} onClick={() => next && router.push(`/candidates/${encodeURIComponent(next)}`)} title="Next applicant (J)">Next →</button>
        <button className="btn small-btn" onClick={() => setHelp((h) => !h)} title="Keyboard shortcuts (?)">⌨</button>
      </span>
      {help && (
        <div className="keys-help" onClick={() => setHelp(false)}>
          <kbd>J</kbd> next applicant · <kbd>K</kbd> previous · <kbd>E</kbd> write a reply · <kbd>S</kbd> move stage · <kbd>N</kbd> add a note · <kbd>Ctrl K</kbd> find anyone · <kbd>?</kbd> close
        </div>
      )}
    </>
  );
}
