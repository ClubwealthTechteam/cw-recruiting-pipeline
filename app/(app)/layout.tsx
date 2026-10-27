import NavLinks from '@/components/NavLinks';
import ChatBubble from '@/components/ChatBubble';
import { requireUser } from '@/lib/auth';
import { getData } from '@/lib/sheet';
import { s } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  let open = 0;
  let mode = '';
  try {
    const d = await getData();
    open = d.flags.filter((f) => s(f.Status) === 'Open').length;
    mode = d.mode;
  } catch {
    // pages show the error themselves
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Club Wealth</div>
        <div className="product">Recruiting Pipeline</div>
        <NavLinks open={open} />
        <div className="sidebar-foot">
          {mode !== 'LIVE' && <div className="test-mode">TEST MODE</div>}
          <div>Signed in as {user === 'Am' ? 'Am Marbella' : user}</div>
          <form action="/api/logout" method="post"><button className="link">Sign out</button></form>
        </div>
      </aside>
      <main className="content">{children}</main>
      <ChatBubble />
    </div>
  );
}
