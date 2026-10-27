// Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const src = fs.readFileSync(path.join(__dirname, '../apps-script/Logic.gs'), 'utf8');
const m = new Module('Logic.gs');
m._compile(src, 'Logic.gs');
const L = m.exports;

// Pacific instants built from UTC (PDT = UTC-7, PST = UTC-8)
const pdt = (s) => new Date(s + '-07:00');
const pst = (s) => new Date(s + '-08:00');

test('interview date: Sun-Tue go to that week, Wed-Sat to the following week', () => {
  assert.equal(L.interviewDateFor(pdt('2026-10-25T10:00:00')), '2026-10-28'); // Sun
  assert.equal(L.interviewDateFor(pdt('2026-10-27T23:59:00')), '2026-10-28'); // Tue night
  assert.equal(L.interviewDateFor(pdt('2026-10-28T08:00:00')), '2026-11-04'); // Wed morning
  assert.equal(L.interviewDateFor(pdt('2026-10-28T13:59:00')), '2026-11-04'); // Wed before 2 PM
  assert.equal(L.interviewDateFor(pdt('2026-10-29T09:00:00')), '2026-11-04'); // Thu
  assert.equal(L.interviewDateFor(pdt('2026-10-31T22:00:00')), '2026-11-04'); // Sat
});

test('interview date uses the Pacific calendar day, not UTC', () => {
  // Tue 11 PM PDT is already Wednesday in UTC
  assert.equal(L.interviewDateFor(new Date('2026-10-28T06:00:00Z')), '2026-10-28');
});

test('daylight vs standard time', () => {
  assert.equal(L.isDaylight('2026-10-28'), true);
  assert.equal(L.isDaylight('2026-11-04'), false); // DST ends Sun Nov 1 2026
  assert.equal(L.isDaylight('2026-03-11'), true);  // DST starts Sun Mar 8 2026
  assert.equal(L.isDaylight('2026-03-04'), false);
  assert.equal(L.isDaylight('2026-01-28'), false);
});

test('invite wording: tomorrow vs on, and all three zone mentions switch', () => {
  const winter = L.inviteEmail('2026-01-28', pst('2026-01-27T15:00:00'));
  assert.equal(winter.subject, 'ClubWealth | Pre-Interview invite');
  assert.match(winter.body, /pre-interview tomorrow, Wednesday, January 28, 2026, at 2:00 PM PACIFIC STANDARD TIME on our Zoom interview\./);
  assert.match(winter.body, /calculate your time zone to Pacific Standard Time\./);
  assert.match(winter.body, /Pacific Standard Time is what we follow here/);

  const summer = L.inviteEmail('2026-06-10', pdt('2026-06-05T10:00:00'));
  assert.match(summer.body, /pre-interview on Wednesday, June 10, 2026, at 2:00 PM PACIFIC DAYLIGHT TIME/);
  assert.match(summer.body, /calculate your time zone to Pacific Daylight Time\./);
  assert.match(summer.body, /Pacific Daylight Time is what we follow here/);
  assert.doesNotMatch(summer.body, /Standard/i);
});

test('reminder wording', () => {
  const r = L.reminderEmail('2026-06-10');
  assert.equal(r.subject, 'ClubWealth | Pre-reminder invite');
  assert.match(r.body, /later today, Wednesday, June 10, 2026, at 2:00 PM Pacific Daylight Time \(PDT\)\./);
  assert.match(L.reminderEmail('2026-12-02').body, /Pacific Standard Time \(PST\)/);
});

test('re-invite is the Wednesday after the original date, rolled forward if past', () => {
  assert.equal(L.reinviteDateFor('2026-10-28', pdt('2026-10-26T09:00:00')), '2026-11-04');
  assert.equal(L.reinviteDateFor('2026-10-28', pdt('2026-11-06T09:00:00')), '2026-11-11');
});

test('name matching tolerates case, spacing and middle names but not a different person', () => {
  assert.ok(L.nameMatches('MARIA  santos', 'Maria', 'Santos'));
  assert.ok(L.nameMatches('Maria Clara Santos', 'Maria', 'Santos'));
  assert.ok(L.nameMatches('Maria Santos', 'Maria Clara', 'Santos'));
  assert.ok(L.nameMatches('José Dela Cruz', 'Jose', 'Dela Cruz'));
  assert.ok(!L.nameMatches('Maria Reyes', 'Maria', 'Santos'));
  assert.ok(!L.nameMatches('Ana Santos', 'Maria', 'Santos'));
  assert.ok(!L.nameMatches('', 'Maria', 'Santos'));
});

test('Zoom names: underscore only, one underscore, never _Training', () => {
  assert.deepEqual(L.parseZoomName('Miguel Ababon_AI Tech'), { name: 'Miguel Ababon', position: 'AI Tech' });
  for (const bad of ['Miguel Ababon,AI Tech', 'Miguel Ababon.AI Tech', 'Miguel Ababon - AI Tech',
    'Miguel Ababon/AI Tech', 'Miguel Ababon', 'Hazel Bonayon_Training', 'Jeff_Training (2)', '_AI Tech', 'A_B_C']) {
    assert.equal(L.parseZoomName(bad), null, bad);
  }
});

test('positions map free text to standard names', () => {
  assert.equal(L.standardPosition('Real State Appointment Setter'), 'Appointment Setter');
  assert.equal(L.standardPosition('Collections VA'), 'Collections VA');
  assert.equal(L.standardPosition('Real Estate Inside Sales Agent (ISA) – Work from Home (40hrs)'), 'Inside Sales Agent (ISA)');
  assert.equal(L.standardPosition('Real Estate Admin VA (Transaction/Listing Coordinator)'), 'Real Estate Admin VA (TC/LC)');
  assert.equal(L.standardPosition('AI-SAVVY MARKETING & ADS SPECIALIST'), 'Marketing & Ads Specialist');
  assert.equal(L.standardPosition('Case Manager'), 'Customer Service');
  assert.equal(L.standardPosition('x', { x: 'Custom' }), 'Custom');
});

test('zoom result threshold', () => {
  assert.equal(L.zoomResult(30, 30), 'Interview Completed');
  assert.equal(L.zoomResult(29.9, 30), 'Did Not Complete');
});

test('reply sorting rules (free, no Claude)', () => {
  const quoted = 'Maria Clara Santos\n\nOn Tue, Oct 27, 2026 at 9:00 AM Club Wealth <careerscw@clubwealth.com> wrote:\n> Please join our virtual pre-interview tomorrow?';
  assert.equal(L.classifyReply('Re: ClubWealth | Pre-Interview invite', quoted), 'Confirmed');
  assert.equal(L.typedFullName(quoted), 'Maria Clara Santos');
  assert.equal(L.classifyReply('Re: invite', 'Confirmed - Juan Dela Cruz'), 'Confirmed');
  assert.equal(L.typedFullName('Confirmed - Juan Dela Cruz'), 'Juan Dela Cruz');
  assert.equal(L.classifyReply('Re: invite', 'Hi, I cannot attend on Wednesday because of my shift. Can I join next week?'), 'Cannot Attend');
  assert.equal(L.classifyReply('Re: invite', "Sorry I can't make it, I have an emergency"), 'Cannot Attend');
  assert.equal(L.classifyReply('Re: invite', 'Is this a full time position?'), 'Question');
  assert.equal(L.classifyReply('Automatic reply: Re: invite', 'I am out of the office'), 'Ignored');
  assert.equal(L.classifyReply('Undeliverable: ClubWealth', 'Delivery has failed'), 'Ignored');
  assert.equal(L.classifyReply('Re: invite', 'Yes'), 'Other');
  assert.equal(L.classifyReply('Re: invite', 'ok'), 'Other');
});

test('bot confirmation reply is signed by Club Wealth, not a person', () => {
  const c = L.confirmationEmail('Maria', '2026-11-04');
  assert.match(c.body, /- Club Wealth<\/p>$/);
  assert.doesNotMatch(c.body, /Am Marbella/);
  assert.match(c.body, /Wednesday, November 4, 2026, at 2:00 PM Pacific Standard Time \(PST\)/);
});
