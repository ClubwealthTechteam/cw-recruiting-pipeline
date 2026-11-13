'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAction } from './useAction';
import { toast } from './Toaster';

/** "Copy everything now" and the read-from-database switch (Database page). */
export default function DatabaseControls({ readFromDb, ready, fastSaves, engineSend = false, canSend = false }: { readFromDb: boolean; ready: boolean; fastSaves: boolean; engineSend?: boolean; canSend?: boolean }) {
  const { run, busy } = useAction();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function copyAll() {
    const r = await run({ action: 'dbPushAll' }, { success: 'Copy started ✓ It takes 1–3 minutes; this page updates as rows arrive.' });
    if (r) router.refresh();
  }
  async function setFast(on: boolean) {
    if (on && !confirm('Turn on fast saves? Moving stages, notes, tags, Mark resolved, Approve and Don\'t send will show at once, and the sheet does the work a few seconds later.')) return;
    setSaving(true);
    const res = await fetch('/api/db/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fastSaves: on }) });
    const j = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!j.ok) { toast(j.error || 'Could not save', 'error'); return; }
    toast(on ? 'Fast saves are on ✓' : 'Fast saves are off: saves go straight to the sheet again ✓');
    router.refresh();
  }
  async function setSend(on: boolean) {
    if (!confirm(on ? 'Let the CRM send the queued emails? The Apps Script stops sending first, so nothing goes out twice.' : 'Give email sending back to the Apps Script?')) return;
    setSaving(true);
    const res = await fetch('/api/db/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engineSend: on }) });
    const j = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!j.ok) { toast(j.error || 'Could not save', 'error'); return; }
    toast(on ? 'The CRM now sends the emails ✓' : 'The Apps Script sends the emails again ✓');
    router.refresh();
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
      {readFromDb && (fastSaves
        ? <button className="btn" disabled={saving} onClick={() => setFast(false)}>Turn off fast saves</button>
        : <button className="btn primary" disabled={saving} onClick={() => setFast(true)}>Turn on fast saves</button>)}
      {readFromDb && (engineSend
        ? <button className="btn" disabled={saving} onClick={() => setSend(false)}>Email sending: CRM · switch back to Apps Script</button>
        : <button className="btn primary" disabled={saving || !canSend} title={canSend ? '' : 'Needs ZAPIER_SEND_HOOK and Google access'} onClick={() => setSend(true)}>Email sending: Apps Script · move to the CRM</button>)}
    </div>
  );
}
