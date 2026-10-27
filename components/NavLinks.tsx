'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/candidates', label: 'Candidates' },
  { href: '/session', label: "This Week's Session" },
  { href: '/attention', label: 'Needs Attention' }
];

export default function NavLinks({ open }: { open: number }) {
  const path = usePathname();
  return (
    <nav>
      {LINKS.map((l) => {
        const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} prefetch className={active ? 'active' : ''}>
            {l.label} {l.href === '/attention' && open > 0 && <span className="count">{open}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
