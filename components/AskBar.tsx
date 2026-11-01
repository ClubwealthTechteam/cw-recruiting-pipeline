'use client';
import { useState } from 'react';
import { ASK_EVENT } from './ChatBubble';

/** Home's "Ask anything" bar: sends the question to the pipeline assistant (the Ask bubble). */
export default function AskBar() {
  const [q, setQ] = useState('');
  return (
    <form className="ask-bar" data-tour="ask-bar" onSubmit={(e) => { e.preventDefault(); if (!q.trim()) return; window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: q })); setQ(''); }}>
      <span className="muted">✦</span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Ask anything about the pipeline… e.g. "Who confirmed for Wednesday but has no resume?"' maxLength={1000} />
      <button className="btn primary" disabled={!q.trim()}>Ask</button>
    </form>
  );
}
