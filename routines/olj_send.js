#!/usr/bin/env node
/**
 * Sends queued "Send invite via OLJ" requests from the site (Outbox rows Type "OLJ Invite", Status "Queued").
 * One sign-in per run, normal pace, stops on any captcha or verification. Sends only the approved invite text
 * (no signature), once per conversation and session date. Never labels, archives, pins or hires.
 * Sends ONLY when the applicant said they are interested AND sent a summary, resume or cover message, and is
 * not on the do-not-invite list: Apps Script refuses to queue anyone whose email is on the form sheet's Rejected tab,
 * and a queue item with "blocked" set is skipped as well.
 *
 * Usage: node olj_send.js --queue queue.json --out result.json
 *   queue.json: [{ "emailId": "E-…", "key": "<conversation key>", "session": "YYYY-MM-DD" }]
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { chromium } = require('playwright');

const lm = new Module('Logic.gs');
lm._compile(fs.readFileSync(path.join(__dirname, '../apps-script/Logic.gs'), 'utf8'), 'Logic.gs');
const L = lm.exports;

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const OUT = arg('--out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms + Math.random() * 800));

/** The approved OLJ invite (Miguel, 2026-10-27): the email invite's wording, plain text, no signature. */
function oljInviteText(session, now) {
  const zoneWord = L.isDaylight(session) ? 'Daylight' : 'Standard';
  const when = (L.addDays(L.todayPT(now), 1) === session ? 'tomorrow, Wednesday, ' : 'on Wednesday, ') + L.longDate(session);
  return [
    'Greetings from Club Wealth!',
    `Please join our virtual pre-interview ${when}, at 2:00 PM PACIFIC ${zoneWord.toUpperCase()} TIME on our Zoom interview.`,
    `You can refer to Time Buddy to check the time in your area and calculate your time zone to Pacific ${zoneWord} Time. Follow this to ensure you do not miss the interview.\nNote the time zone difference: Pacific ${zoneWord} Time is what we follow here, as the Company is based in Washington State.`,
    'Here is the link to join the interview: www.clubwealthhelp.com',
    'Important Reminders:',
    [
      '• Kindly join 10 minutes before the call. Late attendees will not be entertained.',
      '• Use your own work equipment for the interview (headset, microphone, and camera must be working well. Preferably connected with a LAN cable). Failure to use the proper equipment will not be processed.',
      '• Upon joining Zoom, please change your name with the role you applied for. (Ex. John Smith_Position)',
      '• Effective communication is essential for successfully passing an interview.',
      '• No reschedules'
    ].join('\n'),
    'Note: Setting your expectations that we require a minimum of 50 Mbps for both download and upload speeds while connected to a LAN cable, as you will be working from home and managing multiple applications. This ensures we can work efficiently together once you are hired.',
    'Please confirm your availability by replying with your FULL NAME'
  ].join('\n\n');
}

const plainText = (html) => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').trim();

/**
 * Miguel's rule (2026-10-28): invite only if the applicant said they are interested in the position AND sent a
 * summary, resume or cover message. messages = applicant's own messages [{ body, hasAttachment }].
 * Returns { ok, reason }.
 */
function applicationReady(messages) {
  const text = messages.map((m) => plainText(m.body)).join('\n');
  const lower = text.toLowerCase();
  const interested = /\binterest(ed)?\b|\bapply(ing)?\b|\bapplication\b|\bapplied\b|this (position|role|job|opportunity)|the (position|role)|\bopportunity\b|\bconsider (me|my)\b/.test(lower);
  const resumeLink = /\b(resume|cv|curriculum vitae|portfolio)\b/.test(lower) && /(https?:\/\/|drive\.google|docs\.google|\.pdf\b)/.test(lower);
  const attachment = messages.some((m) => m.hasAttachment);
  const words = text.split(/\s+/).filter(Boolean).length;
  const summary = words >= 60 || /\b(\d+\+?\s*(years?|yrs?|months?))\b.*\b(experience|exp)\b|\bexperience (in|as|with)\b/.test(lower) && words >= 25;
  if (!messages.length) return { ok: false, reason: 'No message from the applicant yet' };
  if (!interested) return { ok: false, reason: 'Has not said they are interested in the position' };
  if (!(resumeLink || attachment || summary)) return { ok: false, reason: 'No summary, resume or cover message yet' };
  return { ok: true, reason: resumeLink || attachment ? 'Interested, sent a resume' : 'Interested, sent a summary/cover message' };
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

async function main() {
  const queue = JSON.parse(fs.readFileSync(arg('--queue'), 'utf8'));
  const results = [];
  const finish = (status, reason) => {
    fs.writeFileSync(OUT, JSON.stringify({ status, reason, results }, null, 1));
    console.log(`${status}${reason ? ': ' + reason : ''} | sent ${results.filter((r) => r.status === 'Sent').length} | skipped ${results.filter((r) => r.status === 'Skipped').length} | failed ${results.filter((r) => r.status === 'Failed').length}`);
  };
  if (!queue.length) return finish('ok');

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
  let lastAdd = null;
  const threads = {};
  page.on('response', async (r) => {
    const u = r.url();
    if (r.request().method() === 'POST' && /\/add(\?|$)/.test(u)) lastAdd = r.status();
    const t = r.request().method() === 'GET' && u.match(/\/thread\/([A-Za-z0-9]+)(\?|$)/);
    if (t) { try { threads[t[1]] = await r.json(); } catch {} }
  });

  await page.goto('https://www.onlinejobs.ph/login', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await page.fill('input[type=email], input[name=email], #login_username', process.env.OLJ_EMAIL);
  await page.fill('input[type=password]', process.env.OLJ_PASSWORD);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('button[type=submit], input[type=submit]').first().click()]);
  await sleep(4000);
  if (/login|verify|captcha|otp/.test(new URL(page.url()).pathname) || /verification code|i'm not a robot/.test((await page.content()).toLowerCase())) {
    await browser.close(); return finish('stopped', 'captcha or verification after sign-in');
  }

  for (const q of queue) {
    await page.goto(`https://v2.onlinejobs.ph/message/conversation/${q.key}`, { waitUntil: 'networkidle' }).catch(() => {});
    await sleep(2500);
    if (!new URL(page.url()).pathname.startsWith('/message/conversation/')) { await browser.close(); return finish('stopped', 'unexpected page'); }
    const body = (await page.locator('body').innerText()).toLowerCase();
    if (body.includes(`wednesday, ${L.longDate(q.session).toLowerCase()}, at 2:00 pm pacific`) && body.includes('on our zoom interview')) {
      results.push({ emailId: q.emailId, status: 'Skipped', note: 'invite for this date already in the conversation' });
      continue;
    }
    const data = (threads[q.key] && threads[q.key].data) || [];
    const partner = data[0] && data[0].partner;
    const mine = data.filter((m) => m.message && m.owner && m.owner.hash_id === partner)
      .map((m) => ({ body: m.message.body, hasAttachment: !!(m.attachments && m.attachments.length) || /attachment|\.pdf|\.docx?/i.test(JSON.stringify(m.files || m.attachment || '')) }));
    const ready = applicationReady(mine);
    if (!ready.ok) { results.push({ emailId: q.emailId, status: 'Skipped', note: ready.reason }); continue; }
    if (q.blocked) { results.push({ emailId: q.emailId, status: 'Skipped', note: 'On the do-not-invite list: ' + q.blocked }); continue; }
    const box = page.locator('trix-editor:visible');
    const btn = page.locator('button:visible', { hasText: /^\s*send message\s*$/i });
    if ((await box.count()) !== 1 || (await btn.count()) !== 1) { results.push({ emailId: q.emailId, status: 'Failed', error: 'message box not found' }); continue; }
    const text = oljInviteText(q.session, new Date());
    await box.evaluate((e, h) => { e.editor.loadHTML(h); }, toHtml(text));
    await sleep(600);
    if (norm(await box.evaluate((e) => e.innerText)) !== norm(text)) { results.push({ emailId: q.emailId, status: 'Failed', error: 'text mismatch' }); continue; }
    lastAdd = null;
    await btn.click();
    for (let w = 0; w < 20 && lastAdd === null; w++) await sleep(400);
    if (lastAdd !== 200) { await browser.close(); results.push({ emailId: q.emailId, status: 'Failed', error: `send not confirmed (${lastAdd})` }); return finish('stopped', 'send not confirmed'); }
    results.push({ emailId: q.emailId, status: 'Sent' });
    await sleep(45000);
  }
  await browser.close();
  finish('ok');
}

if (require.main === module) {
  main().catch((e) => { try { fs.writeFileSync(OUT, JSON.stringify({ status: 'error', reason: e.message }, null, 1)); } catch {} console.log('ERROR:', e.message); process.exit(1); });
}
module.exports = { oljInviteText, applicationReady };
