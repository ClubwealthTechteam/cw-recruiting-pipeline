'use client';
import { useState } from 'react';
import { useAction } from './useAction';
import { toast } from './Toaster';
import type { Template } from './Inbox';

const EMPTY: Template = { name: '', subject: '', body: '' };

/**
 * Email templates (macros) for the reply box (Miguel, 2026-11-10). {first_name} is filled in when inserted. "Suggest
 * with AI" asks the pipeline assistant to draft one (about a minute); you can edit it before saving.
 */
export default function TemplatesManager({ templates }: { templates: Template[] }) {
  const [t, setT] = useState<Template>(EMPTY);
  const [purpose, setPurpose] = useState('');
  const [thinking, setThinking] = useState(false);
  const { run, busy } = useAction();
  const set = (k: keyof Template) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setT({ ...t, [k]: e.target.value });

  async function suggest() {
    if (!purpose.trim()) return;
    setThinking(true);
    const q = `Write an email template for Club Wealth Recruitment to send to a job applicant. What it is for: ${purpose.trim()}. ` +
      'Friendly, professional and short, plain text. Use [First Name] for the applicant\'s first name and [Position] for the role they applied for. No signature (the "Cheers, Club Wealth" sign-off and banner are added automatically). ' +
      'Reply ONLY in this format:\nSubject: <subject line>\n---\n<email body>';
    try {
      const r = await fetch('/api/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q.slice(0, 1000) }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || 'The assistant is not available');
      const started = Date.now();
      while (Date.now() - started < 5 * 60_000) {
        await new Promise((ok) => setTimeout(ok, 5000));
        const a = await fetch(`/api/chat/${r.id}`, { cache: 'no-store' }).then((x) => x.json());
        if (a.ok && a.data?.status === 'Answered') {
          const text = String(a.data.answer || '');
          const m = /^\s*Subject:\s*(.+?)\s*\n-{3,}\s*\n([\s\S]+)$/i.exec(text);
          setT((cur) => ({ name: cur.name || purpose.trim().slice(0, 60), subject: m ? m[1] : cur.subject, body: (m ? m[2] : text).trim() }));
          toast('Suggestion ready ✓ Check it, edit, then Save.');
          setThinking(false);
          return;
        }
      }
      throw new Error('No suggestion after 5 minutes. Try again later.');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not get a suggestion', 'error'); }
    setThinking(false);
  }

  return (
    <div className="two-col">
      <section className="panel" data-tour="templates-list">
        <h2>Templates ({templates.length})</h2>
        {templates.length === 0 && <p className="muted">No templates yet. Write one on the right, or let the assistant suggest one.</p>}
        <ul className="todo">
          {templates.map((x) => (
            <li key={x.name}>
              <span className="grow"><b>{x.name}</b><div className="muted small">{x.subject || 'No subject'} · {x.body.slice(0, 80)}{x.body.length > 80 ? '…' : ''}</div></span>
              <button className="btn small-btn" onClick={() => setT(x)}>Edit</button>
              <button className="btn small-btn ghost" disabled={busy} onClick={() => confirm(`Delete the template "${x.name}"?`) && run({ action: 'deleteTemplate', name: x.name }, { success: 'Template deleted' })}>Delete</button>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" data-tour="templates-edit">
        <h2>{templates.some((x) => x.name.toLowerCase() === t.name.trim().toLowerCase()) ? 'Edit template' : 'New template'}</h2>
        <div className="stack-form" style={{ alignItems: 'stretch' }}>
          <div className="ai-suggest">
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder='What is the email for? e.g. "ask them to resend their resume as a Drive link"' style={{ flex: 1 }} />
            <button className="btn" disabled={thinking || !purpose.trim()} onClick={suggest}>{thinking ? 'Writing… (about a minute)' : '✦ Suggest with AI'}</button>
          </div>
          <input value={t.name} onChange={set('name')} placeholder="Template name (e.g. Resume link request)" />
          <input value={t.subject} onChange={set('subject')} placeholder="Subject (optional)" />
          <textarea rows={10} value={t.body} onChange={set('body')} placeholder={'Hi {first_name},\n\n…'} />
          <p className="hint" style={{ margin: 0 }}>[First Name], [Name] and [Position] are filled in when sent. The Club Wealth sign-off and banner are added when sent.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={busy || !t.name.trim() || !t.body.trim()} onClick={async () => { if (await run({ action: 'saveTemplate', ...t }, { success: `Template "${t.name}" saved ✓` })) setT(EMPTY); }}>Save template</button>
            <button className="btn ghost" onClick={() => setT(EMPTY)}>Clear</button>
          </div>
        </div>
      </section>
    </div>
  );
}
