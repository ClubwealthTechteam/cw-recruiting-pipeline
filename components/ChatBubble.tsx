'use client';
import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'you' | 'assistant' | 'note'; text: string; id?: string };

const KEY = 'cwrp-chat';

/** Read-only assistant. Each question starts a Claude routine; answers take about a minute. */
export default function ChatBubble() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) setMsgs(saved); } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch {}
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs, open]);

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/chat/${waiting}`, { cache: 'no-store' }).then((x) => x.json());
        if (r.ok && r.data?.status === 'Answered') {
          setMsgs((m) => [...m.filter((x) => x.id !== waiting), { role: 'assistant', text: r.data.answer }]);
          setWaiting(null);
        }
      } catch {}
      if (Date.now() - started > 6 * 60_000) {
        setMsgs((m) => [...m.filter((x) => x.id !== waiting), { role: 'note', text: 'No answer after 6 minutes. Please try again later.' }]);
        setWaiting(null);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [waiting]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q || waiting) return;
    setText('');
    setMsgs((m) => [...m, { role: 'you', text: q }]);
    try {
      const r = await fetch('/api/chat/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setMsgs((m) => [...m, { role: 'note', text: 'Working on it… answers take about a minute.', id: r.id }]);
      setWaiting(r.id);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'note', text: err instanceof Error ? err.message : 'Could not send the question.' }]);
    }
  }

  return (
    <div className="chat">
      {open && (
        <div className="chat-panel" role="dialog" aria-label="Pipeline assistant">
          <div className="chat-head">
            <div><b>Pipeline assistant</b><div className="muted small">Answers questions about the pipeline. It cannot change anything.</div></div>
            <button className="link dark" onClick={() => setOpen(false)} aria-label="Close">Close</button>
          </div>
          <div className="chat-body">
            {msgs.length === 0 && <p className="muted small">Examples: “How many are confirmed for Wednesday?” · “Who completed last week’s interview for Collections VA?” · “What is our show-up rate this month?”</p>}
            {msgs.map((m, i) => <div key={i} className={`chat-msg ${m.role}`}>{m.text}</div>)}
            <div ref={end} />
          </div>
          <form className="chat-input" onSubmit={ask}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={waiting ? 'Waiting for the answer…' : 'Ask about the pipeline'} disabled={!!waiting} maxLength={1000} />
            <button className="btn primary" disabled={!!waiting || !text.trim()}>Ask</button>
          </form>
        </div>
      )}
      <button className="chat-button" onClick={() => setOpen((o) => !o)} aria-label="Open pipeline assistant">{open ? '×' : 'Ask'}</button>
    </div>
  );
}
