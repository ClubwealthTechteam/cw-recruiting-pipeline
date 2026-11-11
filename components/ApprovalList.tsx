'use client';
import Link from 'next/link';
import { useState } from 'react';
import { PendingStatusEmail, type StatusEmail } from './StatusEmails';
import { useAction } from './useAction';
import { toast } from './Toaster';

export type ApprovalItem = { e: StatusEmail; name: string; position: string; stage: string };

/**
 * Needs Approval with bulk send (Miguel, 2026-11-11): tick the emails, then "Send to N". Each is checked like a
 * single Approve & send; the ones that cannot go are listed.
 */
export default function ApprovalList({ items }: { items: ApprovalItem[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const { run, busy } = useAction();
  const all = items.length > 0 && sel.length === items.length;
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  async function sendSelected() {
    const n = sel.length;
    if (!confirm(`Send ${n} email${n === 1 ? '' : 's'} from CareersCW now? About 6 go out every 5 minutes.`)) return;
    const r = await run({ action: 'approveEmails', emailIds: sel }, { success: `${n} approved ✓ (about 6 go out every 5 minutes)` });
    if (r && typeof r === 'object') {
      const d = r as { queued?: number; failed?: string[] };
      if (d.failed?.length) toast(`${d.queued || 0} approved · ${d.failed.length} not sent: ${d.failed.slice(0, 2).join('; ')}`, 'error');
      setSel([]);
    }
  }
  return (
    <>
      {items.length > 0 && (
        <div className="panel bulk-approve" style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="check-label"><input type="checkbox" checked={all} onChange={() => setSel(all ? [] : items.map((i) => i.e.id))} /> Select all ({items.length})</label>
          <span className="muted small">{sel.length ? `${sel.length} selected` : 'Tick the emails to send, or approve them one by one below.'}</span>
          <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={!sel.length || busy} onClick={sendSelected}>
            {busy ? 'Sending…' : `Send to ${sel.length} recipient${sel.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {items.map(({ e, name, position, stage }) => (
        <section key={e.id} className="panel">
          <p className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={sel.includes(e.id)} onChange={() => toggle(e.id)} aria-label={`Select the email to ${name}`} />
            <Link href={`/candidates/${encodeURIComponent(e.applicantId || '')}`}>{name}</Link> · {position} · now {stage}
          </p>
          <PendingStatusEmail e={e} />
        </section>
      ))}
    </>
  );
}
