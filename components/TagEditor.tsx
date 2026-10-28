'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAction } from './useAction';
import { splitTags } from '@/lib/pipeline';

const SUGGESTED = ['Talent pool', 'Follow up', 'Strong English', 'Has own equipment', 'Bilingual'];

/** Tags on one applicant (shared by the team). Click a tag to see everyone with it. */
export default function TagEditor({ id, tags }: { id: string; tags: string }) {
  const [list, setList] = useState(splitTags(tags));
  const [input, setInput] = useState('');
  const { run, busy } = useAction();
  const save = async (next: string[]) => { setList(next); await run({ action: 'setTags', id, tags: next.join(', ') }); };
  const add = (t: string) => { const v = t.trim(); if (v && !list.some((x) => x.toLowerCase() === v.toLowerCase())) save([...list, v]); setInput(''); };
  return (
    <div className="tags-edit">
      {list.map((t) => (
        <span key={t} className="chip"><Link href={`/candidates?stage=All&tag=${encodeURIComponent(t)}`}>{t}</Link>
          <button type="button" aria-label={`Remove ${t}`} disabled={busy} onClick={() => save(list.filter((x) => x !== t))}>×</button></span>
      ))}
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); add(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Add a tag" list={`tag-sugg-${id}`} disabled={busy} />
        <datalist id={`tag-sugg-${id}`}>{SUGGESTED.map((t) => <option key={t} value={t} />)}</datalist>
      </form>
    </div>
  );
}
