'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { openInbox } from './InboxPanel';

// Simple line icons (24×24 paths) so the sidebar can shrink to icons only.
const ICON: Record<string, string> = {
  '/': 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z',
  '/candidates': 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0',
  '/board': 'M4 4h4v16H4zm6 0h4v10h-4zm6 0h4v6h-4z',
  '/session': 'M4 6h16v14H4zM4 10h16M8 3v4m8-4v4',
  '/talent': 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  '/reports': 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  '/attention': 'M12 3l10 18H2zm0 7v5m0 3v.5',
  '/approvals': 'M4 6h16v12H4zm0 0l8 7 8-7',
  '/team': 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6M3 20a6 6 0 0 1 12 0m2-6a6 6 0 0 1 4 6',
  '/help': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-2.5-11a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5'
};
const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/candidates', label: 'Candidates' },
  { href: '/board', label: 'Pipeline Board' },
  { href: '/session', label: "This Week's Session" },
  { href: '/talent', label: 'Talent Pool' },
  { href: '/reports', label: 'Reports' },
  { href: '/attention', label: 'Needs Attention' },
  { href: '/approvals', label: 'Needs Approval' },
  { href: '/team', label: 'Active Team Members' },
  { href: '/help', label: 'Help' }
];
const KEY = 'cw-sidebar';
const INBOX_ICON = 'M3 5h18v14H3zm0 8h5l2 3h4l2-3h5';

export default function NavLinks({ open, approvals = 0 }: { open: number; approvals?: number }) {
  const path = usePathname();
  const [mini, setMini] = useState(false);
  const [inboxes, setInboxes] = useState(true);
  useEffect(() => {
    try { setMini(localStorage.getItem(KEY) === 'mini'); } catch { /* private window: keep it wide */ }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.sidebar = mini ? 'mini' : '';
  }, [mini]);
  const toggle = () => {
    setMini((m) => {
      try { localStorage.setItem(KEY, m ? '' : 'mini'); } catch { /* ignore */ }
      return !m;
    });
  };
  return (
    <>
      <nav>
        {LINKS.map((l) => {
          const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
          const link = (
            <Link key={l.href} href={l.href} prefetch className={active ? 'active' : ''} title={l.label}>
              <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[l.href]} /></svg>
              <span className="nav-label">{l.label}</span>
              {l.href === '/attention' && open > 0 && <span className="count">{open}</span>}
              {l.href === '/approvals' && approvals > 0 && <span className="count">{approvals}</span>}
            </Link>
          );
          if (l.href !== '/') return link;
          // Dashboard drops down to the two inboxes; they open as a floating panel, not a new page.
          return (
            <div key={l.href} className="nav-group">
              <div className="nav-row">
                {link}
                <button type="button" className="nav-caret" onClick={() => setInboxes((v) => !v)} aria-expanded={inboxes} title={inboxes ? 'Hide inboxes' : 'Show inboxes'}>{inboxes ? '▾' : '▸'}</button>
              </div>
              {inboxes && (['olj', 'email'] as const).map((c) => (
                <button key={c} type="button" className="nav-sub" onClick={() => openInbox(c)} title={c === 'olj' ? 'OLJ Inbox' : 'Email Inbox'}>
                  <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={INBOX_ICON} /></svg>
                  <span className="nav-label">{c === 'olj' ? 'OLJ Inbox' : 'Email Inbox'}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>
      <button type="button" className="sidebar-toggle" onClick={toggle} title={mini ? 'Show labels' : 'Shrink to icons'} aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'}>
        {mini ? '»' : '«'}
      </button>
    </>
  );
}
