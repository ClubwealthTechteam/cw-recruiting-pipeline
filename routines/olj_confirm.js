#!/usr/bin/env node
/**
 * OnlineJobs.ph confirmations and Wednesday reminders for the Recruiting Pipeline (approved by Miguel, 2026-10-27).
 *
 * For each OLJ invitee (Invited or Confirmed, session = the coming Wednesday):
 *  - opens their conversation and reads the applicant's messages AFTER our pre-interview invite,
 *  - sorts them with the same free rules as email replies (apps-script/Logic.gs):
 *    full name matching the applicant -> confirmed; "can't attend" -> cannot; question/other -> flagged,
 *  - with --send-reminders (only on the interview day, 6:00 AM–1:59 PM PT): sends the approved reminder once
 *    to each confirmed invitee whose conversation does not already contain it.
 * Signs in once per run; stops on any captcha or verification. Sends nothing else, never labels/archives/hires.
 *
 * Usage: node olj_confirm.js --invitees invitees.json --out result.json [--send-reminders]
 *   invitees.json: [{ "id": "O-<key>", "key": "<conversation key>", "first": "...", "last": "...", "session": "YYYY-MM-DD" }]
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { chromium } = require('playwright');

const logicSrc = fs.readFileSync(path.join(__dirname, '../apps-script/Logic.gs'), 'utf8');
const lm = new Module('Logic.gs');
lm._compile(logicSrc, 'Logic.gs');
const L = lm.exports;

const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const OUT = arg('--out');
const INVITEES = arg('--invitees');
const SEND = process.argv.includes('--send-reminders');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * 800));

const INVITE_MARK = 'on our zoom interview';
const REMINDER_MARK = 'friendly reminder about your virtual pre-interview';

function reminderText(session) {
  const zone = L.isDaylight(session) ? 'Pacific Daylight Time (PDT)' : 'Pacific Standard Time (PST)';
  return [
    'Hi!',
    `This is a friendly reminder about your virtual pre-interview later today, Wednesday, ${L.longDate(session)}, at 2:00 PM ${zone}.`,
    'Please join via Zoom using this link: www.clubwealthhelp.com\nYou may use Time Buddy to check the time in your area and ensure you join on time.',
    'Kindly remember to:',
    '• Join 10 minutes early (late attendees will not be entertained)\n• Use your own equipment (working headset, mic, and camera; LAN connection preferred)\n• Rename yourself with your full name and position (e.g., John Smith_Position)',
    'Thank you, and we look forward to seeing you at the interview!'
  ].join('\n\n');
}

function toHtml(text) {
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split(/\n\s*\n/).map((bl) => {
    const lines = bl.split('\n');
    if (lines.every((l) => l.startsWith('• '))) return '<ul>' + lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join('') + '</ul>';
    return `<div>${lines.map(esc).join('<br>')}</div><div><br></div>`;
  }).join('');
}
const norm = (x) => String(x).replace(/•/g, '').replace(/\s+/g, ' ').trim();
const plain = (html) => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

function stop(reason, results) {
  fs.writeFileSync(OUT, JSON.stringify({ status: 'stopped', reason, results: results || [] }, null, 1));
  console.log('STOPPED:', reason);
  process.exit(3);
}

/** Pure: decide what an invitee's messages mean. messages = [{mine: bool, body: string}] in order. */
function decide(inv, messages) {
  const inviteAt = messages.findIndex((m) => m.mine && plain(m.body).toLowerCase().includes(INVITE_MARK));
  const hasReminder = messages.some((m) => m.mine && plain(m.body).toLowerCase().includes(REMINDER_MARK));
  if (inviteAt === -1) return { result: 'no invite found', hasReminder };
  const replies = messages.slice(inviteAt + 1).filter((m) => !m.mine).map((m) => plain(m.body)).filter(Boolean);
  if (!replies.length) return { result: 'no reply', hasReminder };
  let flagged = null;
  for (const text of replies) {
    const cat = L.classifyReply('', text);
    if (cat === 'Confirmed' && L.nameMatches(L.typedFullName(text), inv.first, inv.last)) return { result: 'confirmed', hasReminder };
    if (cat === 'Cannot Attend') flagged = { result: 'cannot attend', reply: text.slice(0, 300) };
    else if (!flagged && cat !== 'Ignored') flagged = { result: cat === 'Question' ? 'question' : 'unclear reply', reply: text.slice(0, 300) };
  }
  return { ...(flagged || { result: 'unclear reply', reply: replies[replies.length - 1].slice(0, 300) }), hasReminder };
}

async function main() {
  const invitees = JSON.parse(fs.readFileSync(INVITEES, 'utf8'));
  const results = [];
  if (!invitees.length) { fs.writeFileSync(OUT, JSON.stringify({ status: 'ok', results }, null, 1)); console.log('ok: no invitees'); return; }
  const p0 = L.ptParts(new Date());
  const sendAllowed = SEND && p0.dow === 3 && p0.hh >= 6 && p0.hh < 14;

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
  const threads = {};
  let lastAdd = null;
  page.on('response', async (r) => {
    const u = r.url();
    if (r.request().method() === 'POST' && /\/add(\?|$)/.test(u)) lastAdd = r.status();
    if (r.request().method() !== 'GET') return;
    const t = u.match(/\/thread\/([A-Za-z0-9]+)(\?|$)/);
    if (t) { try { threads[t[1]] = await r.json(); } catch {} }
  });

  await page.goto('https://www.onlinejobs.ph/login', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await page.fill('input[type=email], input[name=email], #login_username', process.env.OLJ_EMAIL);
  await page.fill('input[type=password]', process.env.OLJ_PASSWORD);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('button[type=submit], input[type=submit]').first().click()]);
  await sleep(4000);
  const body0 = (await page.content()).toLowerCase();
  if (/login|verify|captcha|otp/.test(new URL(page.url()).pathname) || /verification code|i'm not a robot/.test(body0)) {
    await browser.close(); stop('captcha or verification after sign-in');
  }

  for (const inv of invitees) {
    await page.goto(`https://v2.onlinejobs.ph/message/conversation/${inv.key}`, { waitUntil: 'networkidle' }).catch(() => {});
    await sleep(2500);
    if (!new URL(page.url()).pathname.startsWith('/message/conversation/')) { await browser.close(); stop('unexpected page', results); }
    const t = threads[inv.key];
    const data = (t && t.data) || [];
    const partner = data[0] && data[0].partner;
    const messages = data.filter((m) => m.message).map((m) => ({ mine: !(m.owner && m.owner.hash_id === partner), body: m.message.body }));
    const r = { id: inv.id, key: inv.key, ...decide(inv, messages), reminderSent: false };
    if (r.result === 'confirmed' && sendAllowed && !r.hasReminder) {
      const box = page.locator('trix-editor:visible');
      const btn = page.locator('button:visible', { hasText: /^\s*send message\s*$/i });
      if ((await box.count()) !== 1 || (await btn.count()) !== 1) { await browser.close(); stop('message box not found', results); }
      const text = reminderText(inv.session);
      await box.evaluate((e, h) => { e.editor.loadHTML(h); }, toHtml(text));
      await sleep(600);
      if (norm(await box.evaluate((e) => e.innerText)) !== norm(text)) { await browser.close(); stop('reminder text mismatch', results); }
      lastAdd = null;
      await btn.click();
      for (let w = 0; w < 20 && lastAdd === null; w++) await sleep(400);
      if (lastAdd !== 200) { await browser.close(); stop('reminder send not confirmed', results); }
      r.reminderSent = true;
      await sleep(45000); // normal pace between messages
    }
    results.push(r);
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ status: 'ok', sendAllowed, results }, null, 1));
  const c = (k) => results.filter((x) => x.result === k).length;
  console.log(`ok: ${results.length} checked | confirmed ${c('confirmed')} | no reply ${c('no reply')} | cannot attend ${c('cannot attend')} | questions/unclear ${c('question') + c('unclear reply')} | reminders sent ${results.filter((x) => x.reminderSent).length}${sendAllowed ? '' : ' (sending not allowed now)'}`);
}

if (require.main === module) {
  main().catch((e) => { try { fs.writeFileSync(OUT, JSON.stringify({ status: 'error', reason: e.message }, null, 1)); } catch {} console.log('ERROR:', e.message); process.exit(1); });
}
module.exports = { decide, reminderText };
