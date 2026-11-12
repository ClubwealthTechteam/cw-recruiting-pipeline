'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAction } from './useAction';
import { toast } from './Toaster';

/** "Copy everything now" and the read-from-database switch (Database page). */
export default function DatabaseControls({ readFromDb, ready }: { readFromDb: boolean; ready: boolean }) {
  const { run, busy } = useAction();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function copyAll() {
    const r = await run({ action: 'dbPushAll' }, { success: 'Copy started ✓ It takes 1–3 minutes; this page updates as rows arrive.' });
    if (r) router.refresh();
  }
  async function setRead(on: boolean) {
    if (on && !confirm('Read the CRM from the database? You can switch back here at any time.')) return;
    setSaving(true);
    const res = await fetch('/api/db/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readFromDb: on }) });
    const j = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!j.ok) { toast(j.error || 'Could not save', 'error'); return; }
    toast(on ? 'The CRM now reads from the database ✓' : 'The CRM reads from the Google Sheet again ✓');
    router.refresh();
  }
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <button className="btn" disabled={busy} onClick={copyAll}>{busy ? 'Starting…' : 'Copy everything now'}</button>
      {readFromDb
        ? <button className="btn" disabled={saving} onClick={() => setRead(false)}>Switch back to reading the Google Sheet</button>
        : <button className="btn primary" disabled={saving || !ready} onClick={() => setRead(true)} title={ready ? '' : 'Copy everything first, and check the counts match'}>Read the CRM from the database</button>}
    </div>
  );
}
