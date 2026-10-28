import NavLinks from '@/components/NavLinks';
import ChatBubble from '@/components/ChatBubble';
import Freshness from '@/components/Freshness';
import AutoRefresh from '@/components/AutoRefresh';
import NewVersionNotice from '@/components/NewVersionNotice';
import TopProgress from '@/components/TopProgress';
import Toaster from '@/components/Toaster';
import CommandBar, { type CommandItem } from '@/components/CommandBar';
import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { getData } from '@/lib/sheet';
import { s, fullName } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children, panel }: { children: React.ReactNode; panel?: React.ReactNode }) {
  const user = await requireUser();
  let open = 0;
  let mode = '';
  let fetchedAt: number | undefined;
  let people: CommandItem[] = [];
  try {
    const d = await getData();
    open = d.flags.filter((f) => s(f.Status) === 'Open').length;
    mode = d.mode;
    fetchedAt = d.fetchedAt;
    people = d.applicants.filter((a) => s(a.Historical) !== 'Y')
      .map((a) => ({ id: s(a['Applicant ID']), name: fullName(a), position: s(a.Position), stage: s(a.Stage) }));
  } catch {
    // pages show the error themselves
  }
  return (
    <div className="shell">
      <Suspense fallback={null}><TopProgress /></Suspense>
      <aside className="sidebar">
        <div className="brand">Club Wealth</div>
        <div className="product">Recruiting Pipeline</div>
        <NavLinks open={open} />
        <div className="kbd-hint">Press <kbd>Ctrl</kbd> + <kbd>K</kbd> to find anyone</div>
        <div className="sidebar-foot">
          {mode !== 'LIVE' && <div className="test-mode">TEST MODE</div>}
          <div>Signed in as {user === 'Am' ? 'Am Marbella' : user}</div>
          <form action="/api/logout" method="post"><button className="link">Sign out</button></form>
        </div>
      </aside>
      <main className="content"><Freshness at={fetchedAt} />{children}</main>
      {panel}
      <ChatBubble />
      <Toaster />
      <CommandBar people={people} />
      <AutoRefresh />
      <NewVersionNotice />
    </div>
  );
}
