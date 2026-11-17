import 'server-only';
import { readTabs, applyPatches, tryLease, releaseLease, rowsByKey, rowsByStatus } from '@/lib/db';
import { readRow, writeCells, readColumnA } from '@/lib/sheets';
import { ptNow } from '@/lib/fastsave';

/**
 * Stage 3a (Miguel, 2026-11-13): the CRM sends the queued emails, as Code.gs dispatchEmails_ did. Each email goes to
 * the Zapier "recruiting-pipeline-email-sender" hook (ZAPIER_SEND_HOOK in Vercel), which sends it from
 * CareersCW@clubwealth.com. Same rules: only while Settings EMAIL_SENDING = ON; email types only (never OLJ); the
 * approved template (banner, no personal signature) unless it is a Confirmation; invites to someone on the form
 * sheet's Rejected tab are cancelled. Microsoft refuses overlapping logins, so emails go one at a time, 25 s apart:
 * two per clock ping (each minute). The status is read from the sheet right before sending, so an email cancelled a
 * moment ago is never sent. Results go to the sheet and the database.
 */
export const EMAIL_TYPES = ['Invite', 'Re-invite', 'Reminder', 'Confirmation', 'Reply', 'Hired', 'Rejected', 'Benched', 'Onboarding'];
const BANNER_URL = 'https://cwrecruitmentpipeline.vercel.app/email-banner.png';
export const approvedEmailBody = (html: unknown) => { const b = String(html ?? ''); return b.includes(BANNER_URL) && !b.includes('Am Marbella'); };
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = Record<string, unknown>;
export type SendPlan = { row: number; email: Row; action: 'send' | 'fail' | 'cancel'; error?: string }[];

/** Which queued emails to handle now, and what to do with each (no network). */
export function planSends(outbox: { row: number; data: Row }[], applicants: Row[], rejected: Set<string>, max: number): SendPlan {
  const byId = new Map(applicants.map((a) => [s(a['Applicant ID']), a]));
  return outbox.filter((e) => s(e.data.Status) === 'Queued' && EMAIL_TYPES.includes(s(e.data.Type))).slice(0, max).map(({ row, data: e }) => {
    if (s(e.Type) !== 'Confirmation' && !approvedEmailBody(e.Body)) {
      return { row, email: e, action: 'fail' as const, error: 'Not the approved template (Club Wealth sign-off and banner). Update Logic.gs and re-queue.' };
    }
    const a = byId.get(s(e['Applicant ID']));
    // Miguel, 2026-11-13 (board Position on hold column): a hold added after the email was queued still stops it
    const tags = s(a?.Tags).split(',').map((x) => x.trim());
    if (a && ['Invite', 'Re-invite', 'Reminder', 'Confirmation'].includes(s(e.Type)) && (tags.includes('Position on hold') || tags.includes('Invites paused'))) {
      return { row, email: e, action: 'cancel' as const, error: tags.includes('Position on hold') ? 'Position on hold' : 'Invites paused for this applicant' };
    }
    const em = s(a?.Email).trim().toLowerCase();
    if (a && (s(e.Type) === 'Invite' || s(e.Type) === 'Re-invite') && em && rejected.has(em)) {
      return { row, email: e, action: 'cancel' as const, error: 'Do not invite: Email is on the Rejected tab of the form sheet' };
    }
    return { row, email: e, action: 'send' as const };
  });
}

async function result(row: number, set: Record<string, string>) {
  await writeCells('Outbox', row, set);
  await applyPatches([{ tab: 'Outbox', row, set }]);
}

/** One clock ping's worth of sending. Returns how many were sent. */
export async function sendDue(max = 2): Promise<{ sent: number; skipped?: string }> {
  // Cheap first (Turso counts rows read; this runs every minute): only the queued emails, through the Status index.
  const queuedRows = (await rowsByStatus('Outbox', 'Queued')).filter((e) => EMAIL_TYPES.includes(s(e.data.Type)));
  if (!queuedRows.length) return { sent: 0 };
  // Who sends follows the sheet's Settings ENGINE_SEND (the same value the Apps Script reads), so the two never
  // both send and never both wait (Miguel, 2026-11-17, after the database move left them disagreeing).
  const settings = (await readTabs(['Settings'])).Settings;
  const setting = (k: string) => s(settings.find((r) => s(r.Key) === k)?.Value);
  if (setting('ENGINE_SEND') !== 'CRM') return { sent: 0, skipped: 'sending is done by the Apps Script (Settings ENGINE_SEND)' };
  if (setting('EMAIL_SENDING') !== 'ON') return { sent: 0, skipped: 'EMAIL_SENDING is not ON' };
  const hook = process.env.ZAPIER_SEND_HOOK;
  if (!hook) return { sent: 0, skipped: 'ZAPIER_SEND_HOOK is not set in Vercel' };
  if (!(await tryLease('sendLease', 55_000))) return { sent: 0, skipped: 'another ping is sending' };
  try {
    // oldest first (sheet order)
    const withRows = queuedRows.slice(0, max);
    const applicants = (await rowsByKey('Applicants', 'Applicant ID', [...new Set(withRows.map((e) => s(e.data['Applicant ID'])).filter(Boolean))])).map((r) => r.data);
    const sourceId = setting('SOURCE_SHEET_ID');
    const rejected = new Set((sourceId ? await readColumnA(sourceId, 'Rejected').catch(() => []) : []).map((x) => x.trim().toLowerCase()).filter((x) => x.includes('@')));
    const plan = planSends(withRows, applicants, rejected, max);
    let sent = 0, first = true;
    for (const p of plan) {
      if (p.action !== 'send') { await result(p.row, { Status: p.action === 'fail' ? 'Failed' : 'Cancelled', Error: p.error || '' }); continue; }
      if (!first) await sleep(25_000);
      first = false;
      const now = await readRow('Outbox', p.row); // the sheet is still in charge: skip anything changed a moment ago
      if (now['Email ID'] !== s(p.email['Email ID']) || now.Status !== 'Queued') continue;
      let code = 0, err = '';
      try {
        const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ email_id: s(p.email['Email ID']), type: s(p.email.Type), to: s(p.email.To), subject: s(p.email.Subject), html_body: s(p.email.Body), test: s(p.email.Test) === 'Y' }) });
        code = res.status;
      } catch (e) { err = 'Zapier not reached: ' + (e instanceof Error ? e.message : String(e)).slice(0, 200); }
      if (code >= 200 && code < 300) { await result(p.row, { Status: 'Sent', 'Sent At': ptNow() }); sent++; }
      else await result(p.row, { Status: 'Failed', Error: err || 'Zapier returned ' + code });
    }
    return { sent };
  } finally {
    await releaseLease('sendLease');
  }
}
