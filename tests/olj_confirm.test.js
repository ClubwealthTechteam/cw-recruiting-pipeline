// Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, reminderText } = require('../routines/olj_confirm.js');

const inv = { first: 'John rey', last: 'Lim', session: '2026-10-28' };
const invite = { mine: true, body: '<div>Please join our virtual pre-interview tomorrow, Wednesday, October 28, 2026, at 2:00 PM PACIFIC DAYLIGHT TIME on our Zoom interview.</div>' };

test('full name after the invite = confirmed; earlier messages are ignored', () => {
  assert.equal(decide(inv, [{ mine: false, body: 'John Rey Lim' }, invite]).result, 'no reply');
  assert.equal(decide(inv, [{ mine: false, body: 'Hi, applying' }, invite, { mine: false, body: 'John Rey Lim' }]).result, 'confirmed');
  assert.equal(decide(inv, [invite, { mine: false, body: '<div>Confirmed - JOHN REY LIM</div>' }]).result, 'confirmed');
});

test('someone else\'s name, questions and cannot-attend are flagged, not confirmed', () => {
  assert.equal(decide(inv, [invite, { mine: false, body: 'Maria Santos' }]).result, 'unclear reply');
  assert.equal(decide(inv, [invite, { mine: false, body: 'Is this full time?' }]).result, 'question');
  assert.equal(decide(inv, [invite, { mine: false, body: "Sorry I can't make it tomorrow" }]).result, 'cannot attend');
  assert.equal(decide(inv, [{ mine: false, body: 'hello' }]).result, 'no invite found');
});

test('an existing reminder is detected so it is never sent twice', () => {
  const rem = { mine: true, body: '<div>This is a friendly reminder about your virtual pre-interview later today</div>' };
  assert.equal(decide(inv, [invite, { mine: false, body: 'John Rey Lim' }, rem]).hasReminder, true);
});

test('reminder wording uses the session date and zone', () => {
  const t = reminderText('2026-10-28');
  assert.match(t, /later today, Wednesday, October 28, 2026, at 2:00 PM Pacific Daylight Time \(PDT\)\./);
  assert.match(t, /\(e\.g\., John Smith_Position\)\n\nThank you, and we look forward/);
  assert.match(reminderText('2026-11-04'), /Pacific Standard Time \(PST\)/);
});
