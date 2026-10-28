#!/usr/bin/env node
/**
 * OnlineJobs.ph inbox reader for the Recruiting Pipeline. READ-ONLY.
 *
 * - Signs in ONCE per run with OLJ_EMAIL / OLJ_PASSWORD, browses at a normal pace.
 * - Stops (exit 3) on any captcha, verification code or unexpected page. Never retries the login.
 * - Reads the job posts and their conversation lists (name, email, job post, subject, date, unread flag).
 * - NEVER opens an unread conversation (opening would mark it read for Recruitment).
 * - Opens already-read conversations only when they are new or changed since the last run, to read the
 *   applicant's messages for the summary. Archived conversations are skipped.
 * - Never replies, sends, archives, labels, pins or changes anything.
 *
 * Usage: node olj_dms.js --out olj.json [--known known.json] [--max-open 15]
 *   known.json: {"<conversation key>": "<Last Message At from the OLJ tab>", ...}
 * Output never goes to stdout except counts.
 */
const fs = require('fs');
const { chromium } = require('playwright');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : process.argv[i + 1];
};
const OUT = arg('--out');
const KNOWN = arg('--known');
const MAX_OPEN = Number(arg('--max-open', 15));
const pause = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * 1000));

function stop(reason, extra = {}) {
  fs.writeFileSync(OUT, JSON.stringify({ status: 'stopped', reason, ...extra }, null, 1));
  console.log('STOPPED:', reason);
  process.exit(3);
}

(async () => {
  if (!OUT) throw new Error('--out is required');
  if (!process.env.OLJ_EMAIL || !process.env.OLJ_PASSWORD) stop('OLJ_EMAIL / OLJ_PASSWORD are not set');
  const known = KNOWN && fs.existsSync(KNOWN) ? JSON.parse(fs.readFileSync(KNOWN, 'utf8')) : {};

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  let jobs = null;
  const threadsByJob = {};
  const messagesByThread = {};
  page.on('response', async (r) => {
    const u = r.url();
    if (!/api\.onlinejobs\.ph\/api\/v1\//.test(u) || r.request().method() !== 'GET') return;
    try {
      if (/\/message\/jobs(\?|$)/.test(u)) jobs = (await r.json()).data;
      const m = u.match(/\/message\/jobs\/([A-Za-z0-9]+)(\?|$)/);
      if (m) threadsByJob[m[1]] = (await r.json()).data;
      const t = u.match(/\/thread\/([A-Za-z0-9]+)(\?|$)/);
      if (t) messagesByThread[t[1]] = (await r.json()).data;
    } catch { /* non-JSON */ }
  });

  // 1. Sign in once.
  await page.goto('https://www.onlinejobs.ph/login', { waitUntil: 'domcontentloaded' });
  await pause(1500);
  await page.fill('input[type=email], input[name=email], #login_username', process.env.OLJ_EMAIL);
  await page.fill('input[type=password]', process.env.OLJ_PASSWORD);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('button[type=submit], input[type=submit]').first().click()]);
  await pause(4000);
  const after = new URL(page.url());
  const body = (await page.content()).toLowerCase();
  if (/login|verify|verification|captcha|otp|2fa/.test(after.pathname) || /enter the code|verification code|i'm not a robot/.test(body)) {
    await browser.close();
    stop('captcha or verification after sign-in');
  }

  // 2. Job posts (first page = most recent activity).
  await page.goto('https://v2.onlinejobs.ph/message/jobs', { waitUntil: 'networkidle' }).catch(() => {});
  await pause(2500);
  if (!jobs) { await browser.close(); stop('job post list did not load'); }
  const live = jobs.filter((j) => !j.is_deleted);

  // 3. Conversation list per job post (no conversation opened here).
  for (const j of live) {
    await page.goto(`https://v2.onlinejobs.ph/message/job/${j.hash_id}`, { waitUntil: 'networkidle' }).catch(() => {});
    await pause(2500);
    if (/login/.test(new URL(page.url()).pathname)) { await browser.close(); stop('signed out unexpectedly'); }
  }

  const rows = [];
  for (const j of live) {
    for (const t of threadsByJob[j.hash_id] || []) {
      if (!t.thread || t.thread.is_archived) continue;
      rows.push({
        key: t.thread.hash_id, jobPost: j.title, name: (t.partner && t.partner.name) || '', email: (t.partner && t.partner.email) || '',
        partnerHash: t.partner && t.partner.hash_id, subject: t.thread.subject || '', messages: t.thread.convo_count || 0,
        lastMessageAt: t.latest_message_date || '', unread: !!t.unread_status, applicantMessages: null, thread: null
      });
    }
  }

  // 4. Open read conversations that are new or changed, to read the applicant's own messages.
  let opened = 0;
  for (const r of rows) {
    if (r.unread || opened >= MAX_OPEN) continue;
    if (known[r.key] && known[r.key] === r.lastMessageAt) continue;
    await page.goto(`https://v2.onlinejobs.ph/message/conversation/${r.key}`, { waitUntil: 'networkidle' }).catch(() => {});
    await pause(3000);
    const msgs = messagesByThread[r.key] || [];
    r.applicantMessages = msgs
      .filter((m) => m.owner && m.owner.hash_id === r.partnerHash && m.message)
      .map((m) => ({ created: m.message.created, body: String(m.message.body || '').replace(/<[^>]+>/g, ' ').slice(0, 3000) }));
    // The last 20 messages from both sides, for the CRM's OLJ inbox (OLJ tab "Thread").
    r.thread = msgs.filter((m) => m.message).slice(-20).map((m) => ({
      from: m.owner && m.owner.hash_id === r.partnerHash ? 'applicant' : 'us',
      at: m.message.created,
      text: String(m.message.body || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1000)
    }));
    opened++;
  }
  await browser.close();

  rows.forEach((r) => delete r.partnerHash);
  fs.writeFileSync(OUT, JSON.stringify({ status: 'ok', jobPosts: live.length, conversations: rows.length, opened, rows }, null, 1));
  console.log(`ok: ${live.length} job posts, ${rows.length} conversations (${rows.filter((r) => r.unread).length} unread, not opened), ${opened} read conversations opened`);
})().catch((e) => {
  try { fs.writeFileSync(OUT, JSON.stringify({ status: 'error', reason: e.message }, null, 1)); } catch {}
  console.log('ERROR:', e.message);
  process.exit(1);
});
