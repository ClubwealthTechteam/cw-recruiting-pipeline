import Logo from '@/components/Logo';
import NavLinks from '@/components/NavLinks';
import ChatBubble from '@/components/ChatBubble';
import SearchButton from '@/components/SearchButton';
import Tour from '@/components/Tour';
import Freshness from '@/components/Freshness';
import AutoRefresh from '@/components/AutoRefresh';
import NewVersionNotice from '@/components/NewVersionNotice';
import TopProgress from '@/components/TopProgress';
import Toaster from '@/components/Toaster';
import InboxPanel from '@/components/InboxPanel';
import CommandBar, { type CommandItem } from '@/components/CommandBar';
import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { getData } from '@/lib/sheet';
import { s, fullName } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children, panel }: { children: React.ReactNode; panel?: React.ReactNode }) {
  const user = await requireUser();
  let open = 0;
  let approvals = 0;
  let mode = '';
  let emailReady = false;
  let fetchedAt: number | undefined;
  let people: CommandItem[] = [];
  let cancelled: string[] = [];
  try {
    const d = await getData();
    open = d.flags.filter((f) => s(f.Status) === 'Open').length;
    approvals = d.outbox.filter((e) => s(e.Status) === 'Pending approval').length;
    mode = d.mode;
    emailReady = d.emailSending === 'ON';
    fetchedAt = d.fetchedAt;
    cancelled = d.cancelledSessions || [];
    people = d.applicants.filter((a) => s(a.Historical) !== 'Y')
      .map((a) => ({ id: s(a['Applicant ID']), name: fullName(a), position: s(a.Position), stage: s(a.Stage) }));
  } catch {
    // pages show the error themselves
  }
  return (
    <div className="shell">
      {/* cancelled Wednesdays for the session lists in the browser (lib/pipeline cancelledSessions) */}
      <script dangerouslySetInnerHTML={{ __html: `window.__cwCancelled=${JSON.stringify(cancelled.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))};` }} />
      <Suspense fallback={null}><TopProgress /></Suspense>
      <aside className="sidebar">
        <Logo tone="light" />
        <div className="product">Club Wealth Recruiting Pipeline</div>
        <SearchButton />
        <NavLinks open={open} approvals={approvals} />
        <div className="sidebar-foot" data-tour="me">
          {mode !== 'LIVE' && <div className="test-mode">TEST MODE</div>}
          <div className="side-me"><span className="av" style={{ background: '#1f5fbf' }}>{user.slice(0, 1)}</span><span>{user === 'Am' ? 'Am Marbella' : user}</span></div>
          <form action="/api/logout" method="post"><button className="link">Sign out</button></form>
        </div>
      </aside>
      <main className="content"><Freshness at={fetchedAt} />{children}</main>
      {panel}
      <InboxPanel emailReady={emailReady} />
      <ChatBubble />
      <Toaster />
      <CommandBar people={people} />
      <AutoRefresh />
      <NewVersionNotice />
      <Tour user={user} />
    </div>
  );
}
