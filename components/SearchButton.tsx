'use client';
import { OPEN_COMMAND_EVENT } from './CommandBar';

/** The "Find anyone" box at the top of the sidebar: opens the Ctrl+K search. */
export default function SearchButton() {
  return (
    <button type="button" className="side-search" data-tour="search" onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT))} title="Find anyone (Ctrl+K)">
      <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm10 3-5-5" /></svg>
      <span>Find anyone</span><kbd>Ctrl K</kbd>
    </button>
  );
}
