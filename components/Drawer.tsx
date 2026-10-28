'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Right-hand side panel. Close with ×, Escape, or a click on the dimmed list. */
export default function Drawer({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') router.back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
  return (
    <div className="drawer-wrap">
      <div className="drawer-dim" onClick={() => router.back()} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <button className="drawer-close" aria-label="Close" onClick={() => router.back()}>×</button>
        {children}
      </aside>
    </div>
  );
}
