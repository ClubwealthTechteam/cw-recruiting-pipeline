// End-to-end run of apps-script/Code.gs against an in-memory spreadsheet. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, ctxCalls } = require('./harness');

const pdt = (s) => new Date(s + '-07:00');
const formRow = (ts, first, last, email, pos, invited = '') =>
  [ts, first, last, '', email, '', 'Philippines', pos, 'Yes', '2', '', '', '', '', '60', '', '', '', '', invited];

// Zapier stand-in: marks queued rows as sent.
function zapierSends(env) {
  const s = env.sheets.Outbox;
  const h = s.data[0];
  for (let i = 1; i < s.data.length; i++) {
    if (s.data[i][h.indexOf('Status')] === 'Queued') {
      s.data[i][h.indexOf('Status')] = 'Sent';
      s.data[i][h.indexOf('Sent At')] = '2026-10-27 12:01:00';
    }
  }
}

test('TEST mode: new form row -> Applied -> invite to test address -> Invited', () => {
  const env = load({ now: pdt('2026-10-27T12:00:00'), formRows: [formRow(pdt('2026-10-27T11:58:00'), 'Test', 'Person', 'fake@example.com', 'Collections VA')] });
  env.ctx.startTestIntake();
  // startTestIntake marks the current end; add the row after it to simulate a new response
  env.sheets['Test Form'].appendRow(formRow(pdt('2026-10-27T11:59:00'), 'Ana', 'Reyes', 'ana@example.com', 'Real State Appointment Setter'));
  env.ctx.tick();
  const apps = env.rows('Applicants');
  assert.equal(apps.length, 1);
  assert.equal(apps[0]['Applicant ID'], 'T-3');
  assert.equal(apps[0].Stage, 'Applied');
  assert.equal(apps[0].Position, 'Inside Sales Agent (ISA)');
  assert.equal(apps[0]['Interview Date'], '2026-10-28');
  const out = env.rows('Outbox');
  assert.equal(out.length, 1);
  assert.equal(out[0].To, 'techteam@clubwealth.com');
  assert.equal(out[0].Subject, '[TEST] ClubWealth | Pre-Interview invite');
  assert.match(out[0].Body, /tomorrow, Wednesday, October 28, 2026, at 2:00 PM PACIFIC DAYLIGHT TIME/);
  zapierSends(env);
  env.ctx.tick();
  assert.equal(env.rows('Applicants')[0].Stage, 'Invited');
  assert.equal(env.rows('Applicants')[0]['Invite Count'], 1);
  env.ctx.tick(); // idempotent
  assert.equal(env.rows('Applicants')[0]['Invite Count'], 1);
  assert.equal(env.rows('Outbox').length, 1);
});

test('LIVE import of history: invited rows plus upcoming not-yet-invited, no emails; then new rows invite the applicant', () => {
  const env = load({
    mode: 'LIVE', now: pdt('2026-10-27T12:00:00'),
    formRows: [
      formRow(pdt('2026-09-01T10:00:00'), 'Old', 'Invitee', 'old@example.com', 'ISA', 'Yes'),
      formRow(pdt('2026-10-23T10:00:00'), 'Due', 'Tomorrow', 'due@example.com', 'Collections VA', 'Yes'),
      formRow(pdt('2026-10-24T10:00:00'), 'Never', 'Invited', 'never@example.com', 'Collections VA', '')
    ]
  });
  env.ctx.importHistory();
  let apps = env.rows('Applicants');
  assert.deepEqual(apps.map((a) => [a['Applicant ID'], a.Stage]), [['F-2', 'Invited'], ['F-3', 'Invited'], ['F-4', 'Applied']]);
  assert.equal(apps[0].Historical, 'Y');
  assert.equal(apps[1].Historical, '');
  assert.equal(apps[1]['Interview Date'], '2026-10-28');
  assert.equal(env.rows('Outbox').length, 0);
  assert.throws(() => env.ctx.importHistory(), /already imported/);
  env.ctx.tick();
  assert.equal(env.rows('Outbox').length, 0);
  env.ctx.SpreadsheetApp.openById().getSheetByName().appendRow(formRow(pdt('2026-10-27T12:00:00'), 'New', 'Applicant', 'NEW@Example.com', 'Transaction Coordinator'));
  env.ctx.tick();
  const out = env.rows('Outbox');
  assert.equal(out.length, 1);
  assert.equal(out[0].To, 'new@example.com');
  assert.equal(out[0].Subject, 'ClubWealth | Pre-Interview invite');
});

function invitedEnv(extraSettings = {}, rejected = []) {
  const env = load({ mode: 'LIVE', now: pdt('2026-10-27T12:00:00'), settings: extraSettings, rejected, formRows: [
    formRow(pdt('2026-10-23T10:00:00'), 'Maria Clara', 'Santos', 'maria@example.com', 'Collections VA', 'Yes'),
    formRow(pdt('2026-10-24T10:00:00'), 'Jose', 'Dela Cruz', 'jose@example.com', 'ISA', 'Yes'),
    formRow(pdt('2026-10-25T10:00:00'), 'Ana', 'Reyes', 'ana@example.com', 'Appointment Setter', 'Yes')
  ] });
  env.ctx.importHistory();
  return env;
}

function addRow(env, tab, obj) {
  const h = env.sheets[tab].data[0];
  env.sheets[tab].appendRow(h.map((k) => (obj[k] === undefined ? '' : obj[k])));
}

test('replies: email match confirms, full-name match confirms, cannot-attend re-invites, unknown is flagged', () => {
  const env = invitedEnv();
  addRow(env, 'Replies', { 'Message ID': 'm1', 'From Email': 'Maria@example.com', 'Reply Text': 'Maria Clara Santos', Category: 'Confirmed' });
  addRow(env, 'Replies', { 'Message ID': 'm2', 'From Email': 'other@gmail.com', 'Reply Text': 'JOSE dela cruz', Category: 'Confirmed' });
  addRow(env, 'Replies', { 'Message ID': 'm3', 'From Email': 'ana@example.com', 'Reply Text': 'Sorry I have a class on Wednesday', Category: 'Cannot Attend' });
  addRow(env, 'Replies', { 'Message ID': 'm4', 'From Email': 'x@y.com', 'Reply Text': 'Pedro Penduko', Category: 'Confirmed' });
  addRow(env, 'Replies', { 'Message ID': 'm5', 'From Email': 'maria@example.com', 'Reply Text': 'Is this paid training?', Category: 'Question' });
  env.ctx.tick();
  const a = Object.fromEntries(env.rows('Applicants').map((x) => [x['First Name'], x]));
  assert.equal(a['Maria Clara'].Stage, 'Confirmed');
  assert.equal(a.Jose.Stage, 'Confirmed');
  assert.equal(a.Ana.Stage, 'Open for re-invite');
  assert.match(a.Ana['Re-invite Reason'], /class/);
  const out = env.rows('Outbox');
  assert.equal(out.length, 1, 'only the re-invite; confirmation replies are off by default');
  assert.equal(out[0].Type, 'Re-invite');
  assert.equal(out[0]['Interview Date'], '2026-11-04');
  assert.match(out[0].Body, /PACIFIC STANDARD TIME/);
  const flags = env.rows('Needs Attention');
  assert.deepEqual(flags.map((f) => f.Type).sort(), ['Applicant question', 'Unmatched reply']);
  const reps = env.rows('Replies');
  assert.ok(reps.every((r) => r['Processed At']));
  assert.equal(reps[1]['Match Method'], 'Full name');
  zapierSends(env);
  env.ctx.tick();
  const ana = env.rows('Applicants').find((x) => x['First Name'] === 'Ana');
  assert.equal(ana.Stage, 'Invited');
  assert.equal(ana['Interview Date'], '2026-11-04');
});

test('confirmation reply is queued only when SEND_CONFIRMATION_REPLY = YES', () => {
  const env = invitedEnv({ SEND_CONFIRMATION_REPLY: 'YES' });
  addRow(env, 'Replies', { 'Message ID': 'm1', 'From Email': 'maria@example.com', 'Reply Text': 'Maria Santos', Category: 'Confirmed' });
  env.ctx.tick();
  const out = env.rows('Outbox');
  assert.equal(out.length, 1);
  assert.equal(out[0].Type, 'Confirmation');
});

test('Wednesday 6 AM reminders go to confirmed applicants for that day only, once', () => {
  const env = invitedEnv();
  addRow(env, 'Replies', { 'Message ID': 'm1', 'From Email': 'maria@example.com', 'Reply Text': 'Maria Santos', Category: 'Confirmed' });
  env.ctx.tick();
  env.setNow(pdt('2026-10-28T05:55:00'));
  env.ctx.tick();
  assert.equal(env.rows('Outbox').filter((e) => e.Type === 'Reminder').length, 0);
  env.setNow(pdt('2026-10-28T06:00:00'));
  env.ctx.tick();
  env.setNow(pdt('2026-10-28T06:05:00'));
  env.ctx.tick();
  const rem = env.rows('Outbox').filter((e) => e.Type === 'Reminder');
  assert.equal(rem.length, 1);
  assert.equal(rem[0].To, 'maria@example.com');
  assert.match(rem[0].Body, /later today, Wednesday, October 28, 2026, at 2:00 PM Pacific Daylight Time \(PDT\)/);
});

test('Zoom: 30+ minutes completed, under 30 did not complete, unseen confirmed no show, unseen unconfirmed no confirmation, non-invitees ignored', () => {
  const env = invitedEnv();
  env.setNow(pdt('2026-10-28T15:35:00'));
  addRow(env, 'Zoom Attendance', { 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Maria Santos_Collections', 'Parsed Name': 'Maria Santos', 'Parsed Position': 'Collections', 'Total Minutes': 45, 'Minutes Early': 12, Arrival: '12 min early (on time)' });
  addRow(env, 'Zoom Attendance', { 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Jose Dela Cruz_ISA', 'Parsed Name': 'Jose Dela Cruz', 'Parsed Position': 'ISA', 'Total Minutes': 12, 'Minutes Early': -7, Arrival: '7 min late' });
  addRow(env, 'Zoom Attendance', { 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Random Guy_VA', 'Parsed Name': 'Random Guy', 'Parsed Position': 'VA', 'Total Minutes': 50 });
  env.ctx.tick();
  // not final yet: stages unchanged
  assert.ok(env.rows('Applicants').every((a) => a.Stage === 'Invited'));
  const A = env.sheets.Applicants.data;
  A.find((r) => r[A[0].indexOf('First Name')] === 'Ana')[A[0].indexOf('Stage')] = 'Confirmed';
  env.sheets.Settings.appendRow(['ZOOM_FINALIZE', '2026-10-28', '']);
  env.ctx.tick();
  const a = Object.fromEntries(env.rows('Applicants').map((x) => [x['First Name'], x]));
  assert.equal(a['Maria Clara'].Stage, 'Interview Completed');
  assert.equal(a['Maria Clara']['Zoom Minutes'], 45);
  assert.equal(a['Maria Clara'].Arrival, '12 min early (on time)');
  assert.equal(a.Jose.Arrival, '7 min late');
  assert.equal(a.Jose.Stage, 'Did Not Complete');
  assert.equal(a.Ana.Stage, 'No Show');
  assert.equal(env.rows('Zoom Attendance')[2].Result, 'Not an invitee');
  env.ctx.tick(); // finalizing twice changes nothing
  assert.equal(env.rows('History').filter((h) => h['To Stage'] === 'No Show').length, 1);
});

test('OLJ: new conversation for an open position is screened and gets one OLJ invite (never an email)', () => {
  const env = invitedEnv();
  addRow(env, 'OLJ', { 'Conversation Key': 'c123', 'Job Post': 'Collections Virtual Assistant', 'Applicant Name': 'Lito Lapid', 'Email Found': 'lito@example.com', Summary: 'Interested; 3 yrs collections.' });
  addRow(env, 'OLJ', { 'Conversation Key': 'c999', 'Job Post': 'AI-SAVVY MARKETING & ADS SPECIALIST', 'Applicant Name': 'Ads Person', Summary: 's' });
  env.ctx.tick();
  env.ctx.tick();
  const lito = env.rows('Applicants').find((x) => x['Applicant ID'] === 'O-c123');
  assert.equal(lito.Stage, 'Applied');
  const out = env.rows('Outbox').filter((e) => e['Applicant ID'] === 'O-c123');
  assert.equal(out.length, 1);
  assert.equal(out[0].Type, 'OLJ Invite');
  assert.equal(out[0].To, 'OLJ:c123');
  const ads = env.rows('Applicants').find((x) => x['Applicant ID'] === 'O-c999');
  assert.equal(ads['Invite Hold'], 'Position not open: Marketing & Ads Specialist');
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'O-c999').length, 0);
});

test('form applicants are screened before the invite: held-back reasons are recorded, nothing is sent to them', () => {
  const env = load({ mode: 'LIVE', now: pdt('2026-10-28T09:00:00'), formRows: [formRow(pdt('2026-10-20T10:00:00'), 'Old', 'One', 'old@example.com', 'ISA', 'Yes')] });
  env.ctx.importHistory();
  const src = env.ctx.SpreadsheetApp.openById().getSheetByName();
  src.appendRow(formRow(pdt('2026-10-28T08:00:00'), 'Good', 'Fit', 'good@example.com', 'Collections VA', ''));
  src.appendRow(formRow(pdt('2026-10-28T08:01:00'), 'Gen', 'Va', 'gen@example.com', 'General Virtual Assistant', ''));
  src.appendRow(formRow(pdt('2026-10-28T08:02:00'), 'Good', 'Again', 'GOOD@example.com', 'Collections VA', ''));
  env.ctx.tick();
  const out = env.rows('Outbox');
  assert.deepEqual(out.map((e) => e.To), ['good@example.com']);
  assert.match(out[0].Body, /today, Wednesday, October 28, 2026/);
  const holds = env.rows('Applicants').filter((a) => a.Stage === 'Applied').map((a) => [a['First Name'] + ' ' + a['Last Name'], a['Invite Hold']]);
  assert.deepEqual(holds, [['Good Fit', ''], ['Gen Va', 'Position not open: General VA'], ['Good Again', 'Already invited as F-3 (same person)']]);
});

test('site API: secret required, bulk stage change logs history, reason required for Not Fit', () => {
  const env = invitedEnv();
  assert.equal(JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ secret: 'nope', action: 'data' }) } }).s).ok, false);
  const d = env.api({ action: 'data' });
  assert.equal(d.ok, true);
  assert.equal(d.data.applicants.length, 3);
  assert.equal(env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Not Fit' }).ok, false);
  const r = env.api({ action: 'setStage', by: 'Am', ids: ['F-2', 'F-3'], stage: 'Passed Pre-Interview' });
  assert.equal(r.data.updated, 2);
  assert.equal(env.rows('History').filter((h) => h['Changed By'] === 'Am').length, 2);
  assert.equal(env.api({ action: 'setStage', by: 'Hacker', ids: ['F-2'], stage: 'Hired' }).ok, false);
  env.api({ action: 'addNote', by: 'Camille', id: 'F-4', note: 'Strong English' });
  assert.match(env.rows('Applicants')[2].Notes, /Camille: Strong English/);
});

test('replies copied in by Zapier with no category are sorted by the rules', () => {
  const env = invitedEnv();
  addRow(env, 'Replies', { 'Message ID': 'z1', 'From Email': 'maria@example.com', Subject: 'Re: ClubWealth | Pre-Interview invite', 'Reply Text': 'Maria Clara Santos\n\nOn Tue wrote:\n> invite' });
  addRow(env, 'Replies', { 'Message ID': 'z2', 'From Email': 'noreply@x.com', Subject: 'Automatic reply: hello', 'Reply Text': 'Out of office' });
  addRow(env, 'Replies', { 'Message ID': 'z3', 'From Email': 'ana@example.com', Subject: 'Re: invite', 'Reply Text': 'ok' });
  env.ctx.tick();
  const reps = env.rows('Replies');
  assert.deepEqual(reps.map((r) => r.Category), ['Confirmed', 'Ignored', 'Other']);
  assert.equal(env.rows('Applicants').find((a) => a['First Name'] === 'Maria Clara').Stage, 'Confirmed');
  assert.deepEqual(env.rows('Needs Attention').map((f) => f.Type), ['Reply needs reading']);
});

test('go-live before Zapier: AUTO_INVITES OFF queues nothing; Am marking Yes moves Applied to Invited', () => {
  const env = load({ mode: 'LIVE', now: pdt('2026-10-27T12:00:00'), settings: { AUTO_INVITES: 'OFF' }, formRows: [
    formRow(pdt('2026-09-01T10:00:00'), 'Old', 'Skip', 'old@example.com', 'ISA', ''),
    formRow(pdt('2026-10-23T10:00:00'), 'Was', 'Invited', 'was@example.com', 'ISA', 'Yes'),
    formRow(pdt('2026-10-27T09:00:00'), 'Not', 'Yet', 'notyet@example.com', 'ISA', '')
  ] });
  env.ctx.importHistory();
  let apps = env.rows('Applicants');
  assert.deepEqual(apps.map((a) => [a['Applicant ID'], a.Stage]), [['F-3', 'Invited'], ['F-4', 'Applied']]);
  const src = env.ctx.SpreadsheetApp.openById().getSheetByName();
  src.appendRow(formRow(pdt('2026-10-27T12:00:00'), 'Brand', 'New', 'new@example.com', 'ISA', ''));
  env.ctx.tick();
  assert.equal(env.rows('Outbox').length, 0, 'no invites queued while AUTO_INVITES is OFF');
  assert.equal(env.rows('Applicants').length, 3);
  src.data[3][19] = 'Yes'; // Am invites "Not Yet" by hand
  env.ctx.tick();
  apps = env.rows('Applicants');
  assert.equal(apps.find((a) => a['Applicant ID'] === 'F-4').Stage, 'Invited');
  assert.equal(apps.find((a) => a['Applicant ID'] === 'F-5').Stage, 'Applied');
  assert.equal(env.rows('History').find((h) => h['Applicant ID'] === 'F-4')['Changed By'], 'Am (by hand)');
});

test('Zoom backup path: zoomRows API appends rows and finalizes the day', () => {
  const env = invitedEnv();
  env.setNow(pdt('2026-10-28T15:35:00'));
  const r = env.api({ action: 'zoomRows', finalize: '2026-10-28', rows: [{ 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Maria Santos_Collections', 'Parsed Name': 'Maria Santos', 'Parsed Position': 'Collections', 'Total Minutes': 40 }] });
  assert.equal(r.ok, true);
  env.ctx.tick();
  const a = Object.fromEntries(env.rows('Applicants').map((x) => [x['First Name'], x]));
  assert.equal(a['Maria Clara'].Stage, 'Interview Completed');
  assert.equal(a.Jose.Stage, 'No Confirmation'); // invited, never confirmed, not seen
});

test('site API: data leaves out the before-system applicants\' details and history unless asked', () => {
  const env = load({
    mode: 'LIVE', now: pdt('2026-10-27T12:00:00'),
    formRows: [
      formRow(pdt('2026-09-01T10:00:00'), 'Old', 'Invitee', 'old@example.com', 'ISA', 'Yes'),
      formRow(pdt('2026-10-23T10:00:00'), 'Due', 'Tomorrow', 'due@example.com', 'Collections VA', 'Yes')
    ]
  });
  env.ctx.importHistory();
  const d = env.api({ action: 'data', slim: true }).data;
  const old = d.applicants.find((a) => a['Applicant ID'] === 'F-2');
  assert.equal(old.Historical, 'Y');
  assert.equal(old.Stage, 'Invited');
  assert.equal(old['First Name'], undefined);
  assert.equal(d.applicants.find((a) => a['Applicant ID'] === 'F-3')['First Name'], 'Due');
  assert.equal(d.history.some((h) => h['Applicant ID'] === 'F-2'), false);
  const all = env.api({ action: 'data', slim: true, withHistory: true }).data;
  assert.equal(all.withHistory, true);
  assert.equal(all.applicants.find((a) => a['Applicant ID'] === 'F-2')['First Name'], 'Old');
  assert.equal(all.history.length >= d.history.length, true);
});

test('site API: applicant action returns one full record by ID', () => {
  const env = invitedEnv();
  const r = env.api({ action: 'applicant', id: 'F-3' });
  assert.equal(r.data.applicant['First Name'], 'Jose');
  assert.equal(r.data.applicant.Country, 'Philippines');
  assert.equal(env.api({ action: 'applicant', id: 'F-99' }).data.applicant, null);
  const slim = env.api({ action: 'data', slim: true }).data.applicants[0];
  assert.equal(slim.Country, undefined);
  assert.equal(slim['First Name'], 'Maria Clara');
});

test('chat: ask stores a pending question, answer once, then read it back', () => {
  const env = invitedEnv();
  env.ctx.setup();
  const asked = env.api({ action: 'chatAsk', by: 'Am', question: 'How many confirmed for Wednesday?' });
  assert.equal(asked.ok, true);
  const id = asked.data.id;
  assert.equal(env.api({ action: 'chatGet', id }).data.status, 'Pending');
  assert.equal(env.api({ action: 'chatAnswer', id, answer: 'None yet.' }).ok, true);
  assert.equal(env.api({ action: 'chatAnswer', id, answer: 'again' }).ok, false);
  const got = env.api({ action: 'chatGet', id }).data;
  assert.equal(got.status, 'Answered');
  assert.equal(got.answer, 'None yet.');
});

test('live updates: a tick that changes something notifies the site; a quiet tick does not', () => {
  const { ctxCalls } = require('./harness');
  const env = load({ now: pdt('2026-10-27T12:00:00') });
  env.ctx.startTestIntake();
  ctxCalls.fetches = [];
  env.ctx.tick();
  assert.equal(ctxCalls.fetches.length, 0);
  env.sheets['Test Form'].appendRow(formRow(pdt('2026-10-27T11:59:00'), 'Ana', 'Reyes', 'ana@example.com', 'ISA'));
  env.ctx.tick();
  assert.equal(ctxCalls.fetches.length, 1);
  assert.match(ctxCalls.fetches[0], /\/api\/revalidate$/);
  env.ctx.setup(); // creates the three triggers without error
});

test('settings stored as dates by Sheets still work: reminders queue once, Zoom finalizes', () => {
  const env = invitedEnv();
  addRow(env, 'Replies', { 'Message ID': 'm1', 'From Email': 'maria@example.com', 'Reply Text': 'Maria Santos', Category: 'Confirmed' });
  env.ctx.tick();
  env.setNow(pdt('2026-10-28T06:00:00'));
  env.ctx.tick();
  // Sheets converts the stored text into a Date value
  const st = env.sheets.Settings.data;
  const row = st.find((r) => r[0] === 'REMINDERS_QUEUED_FOR');
  row[1] = new Date('2026-10-28T00:00:00-07:00');
  env.setNow(pdt('2026-10-28T06:05:00'));
  env.ctx.tick();
  assert.equal(env.rows('Outbox').filter((e) => e.Type === 'Reminder').length, 1);
  env.setNow(pdt('2026-10-28T15:35:00'));
  env.sheets.Settings.appendRow(['ZOOM_FINALIZE', new Date('2026-10-28T00:00:00-07:00'), '']);
  env.ctx.tick();
  assert.equal(env.rows('Applicants').find((a) => a['First Name'] === 'Ana').Stage, 'No Confirmation');
});

test('OLJ applicants never get the reminder by email', () => {
  const env = invitedEnv();
  addRow(env, 'OLJ', { 'Conversation Key': 'k1', 'Job Post': 'ISA', 'Applicant Name': 'Lito Lapid', 'Email Found': 'lito@example.com', Summary: 's' });
  env.ctx.tick();
  const apps = env.sheets.Applicants;
  const h = apps.data[0];
  const r = apps.data.find((x) => x[0] === 'O-k1');
  r[h.indexOf('Stage')] = 'Confirmed';
  r[h.indexOf('Interview Date')] = '2026-10-28';
  env.setNow(pdt('2026-10-28T06:00:00'));
  env.ctx.tick();
  assert.equal(env.rows('Outbox').filter((e) => e.Type === 'Reminder' && e['Applicant ID'] === 'O-k1').length, 0);
});

test('screen tracks are set on intake and backfilled; sendInvite queues OLJ or email invites once', () => {
  const env = invitedEnv({ AUTO_INVITES: 'OFF' });
  env.ctx.tick();
  const a = Object.fromEntries(env.rows('Applicants').map((x) => [x['First Name'], x]));
  assert.equal(a['Maria Clara']['Screen Track'], 'Collections');
  assert.equal(a.Jose['Screen Track'], 'ISA (unspecified)');
  addRow(env, 'OLJ', { 'Conversation Key': 'k9', 'Job Post': 'Club Wealth Inside Sales Agent', 'Applicant Name': 'Lito Lapid', 'Email Found': 'lito@example.com', Summary: 's' });
  env.ctx.tick();
  assert.equal(env.rows('Applicants').find((x) => x['Applicant ID'] === 'O-k9')['Screen Track'], 'ISA CW');
  // OLJ invite from the site
  const r = env.api({ action: 'sendInvite', by: 'Am', id: 'O-k9', channel: 'olj' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.session, '2026-10-28');
  const q = env.rows('Outbox').filter((e) => e.Type === 'OLJ Invite');
  assert.equal(q.length, 1);
  assert.equal(q[0].To, 'OLJ:k9');
  assert.equal(env.api({ action: 'sendInvite', by: 'Am', id: 'O-k9', channel: 'olj' }).ok, false, 'no duplicate invite');
  // when the OLJ sender marks it Sent, the applicant becomes Invited, credited to Am
  const ob = env.sheets.Outbox; const h = ob.data[0];
  ob.data.find((x) => x[h.indexOf('Type')] === 'OLJ Invite')[h.indexOf('Status')] = 'Sent';
  env.ctx.tick();
  assert.equal(env.rows('Applicants').find((x) => x['Applicant ID'] === 'O-k9').Stage, 'Invited');
  assert.equal(env.rows('History').filter((x) => x['Applicant ID'] === 'O-k9').pop()['Changed By'], 'Am');
  // email channel refuses until EMAIL_SENDING is ON; OLJ refuses for form applicants
  assert.match(env.api({ action: 'sendInvite', by: 'Am', id: 'F-2', channel: 'email' }).error, /not connected/);
  assert.match(env.api({ action: 'sendInvite', by: 'Am', id: 'F-2', channel: 'olj' }).error, /OnlineJobs/);
  env.sheets.Settings.appendRow(['EMAIL_SENDING', 'ON', '']);
  const re = env.api({ action: 'sendInvite', by: 'Am', id: 'F-2', channel: 'email' });
  assert.equal(re.ok, true, re.error);
  assert.equal(env.rows('Outbox').filter((e) => e.Type === 'Invite' && e['Applicant ID'] === 'F-2').length, 1);
});

test('applicants whose email is on the Rejected tab are never invited, by OLJ or email, and are flagged once', () => {
  const env = invitedEnv({ AUTO_INVITES: 'OFF', EMAIL_SENDING: 'ON' }, [' Lito@Example.com ', 'can reapply beginning july 2026']);
  addRow(env, 'OLJ', { 'Conversation Key': 'k9', 'Job Post': 'Club Wealth Inside Sales Agent', 'Applicant Name': 'Lito Lapid', 'Email Found': 'lito@example.com', Summary: 's' });
  env.ctx.tick();
  assert.match(env.api({ action: 'sendInvite', by: 'Am', id: 'O-k9', channel: 'olj' }).error, /Do not invite/);
  assert.match(env.api({ action: 'sendInvite', by: 'Am', id: 'O-k9', channel: 'email' }).error, /Do not invite/);
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'O-k9').length, 0);
  assert.match(env.api({ action: 'applicant', id: 'O-k9' }).data.applicant['Do Not Invite'], /Rejected tab/);
  assert.equal(env.api({ action: 'applicant', id: 'F-2' }).data.applicant['Do Not Invite'], '');
  // automatic invites skip and flag once, however many runs
  const st = env.sheets.Settings; const sh = st.data[0];
  st.data.find((r) => r[0] === 'AUTO_INVITES')[sh.indexOf('Value')] = 'ON';
  env.ctx.tick(); env.ctx.tick();
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'O-k9').length, 0);
  assert.equal(env.rows('Needs Attention').filter((f) => f['Applicant ID'] === 'O-k9' && f.Type === 'Do not invite').length, 1);
});

test('queued emails go to the Zapier hook only while EMAIL_SENDING is ON, and never OLJ invites', () => {
  const env = invitedEnv({ AUTO_INVITES: 'OFF' });
  env.ctx.tick();
  ctxCalls.posts = []; ctxCalls.code = 200;
  addRow(env, 'Outbox', { 'Email ID': 'E-1', 'Applicant ID': 'F-2', Type: 'Invite', To: 'jose@example.com', Subject: 'ClubWealth | Pre-Interview invite', Body: env.ctx.inviteEmail('2026-10-28', new Date()).body, 'Interview Date': '2026-10-28', Status: 'Queued' });
  addRow(env, 'Outbox', { 'Email ID': 'E-2', 'Applicant ID': 'F-3', Type: 'OLJ Invite', To: 'OLJ:k1', Subject: '(OnlineJobs.ph message)', Status: 'Queued' });
  env.ctx.tick();
  assert.equal(env.rows('Outbox').find((e) => e['Email ID'] === 'E-1').Status, 'Queued', 'nothing sent while EMAIL_SENDING is off');
  env.sheets.Settings.appendRow(['EMAIL_SENDING', 'ON', '']);
  env.ctx.tick();
  const hooked = ctxCalls.posts.filter((p) => /email_id/.test(p.body || ''));
  assert.equal(hooked.length, 1);
  assert.equal(JSON.parse(hooked[0].body).email_id, 'E-1');
  const sent = env.rows('Outbox').find((e) => e['Email ID'] === 'E-1');
  assert.equal(sent.Status, 'Sent');
  assert.equal(env.rows('Outbox').find((e) => e['Email ID'] === 'E-2').Status, 'Queued', 'OLJ invites are left for the OLJ sender');
  assert.equal(env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-2').Stage, 'Invited');
  // a Zapier error marks the row Failed (flagged), and it is not retried
  ctxCalls.code = 500;
  addRow(env, 'Outbox', { 'Email ID': 'E-3', 'Applicant ID': 'F-1', Type: 'Reminder', To: 'maria@example.com', Subject: 'ClubWealth | Pre-reminder invite', Body: env.ctx.reminderEmail('2026-10-28').body, Status: 'Queued' });
  env.ctx.tick(); env.ctx.tick();
  assert.equal(env.rows('Outbox').find((e) => e['Email ID'] === 'E-3').Status, 'Failed');
  assert.equal(ctxCalls.posts.filter((p) => /E-3/.test(p.body || '')).length, 1);
  ctxCalls.code = 200;
});

test('the same person on OLJ with a different email is not invited twice', () => {
  const env = load({ mode: 'LIVE', now: pdt('2026-10-28T09:00:00'), settings: { AUTO_INVITES: 'ON' }, formRows: [formRow(pdt('2026-10-20T10:00:00'), 'Old', 'One', 'old@example.com', 'ISA', 'Yes')] });
  env.ctx.importHistory();
  env.ctx.SpreadsheetApp.openById().getSheetByName().appendRow(formRow(pdt('2026-10-28T08:00:00'), 'Maria', 'Santos', 'ms@example.com', 'Collections VA', ''));
  env.ctx.tick();
  addRow(env, 'OLJ', { 'Conversation Key': 'k77', 'Job Post': 'Collections Virtual Assistant (Remote)', 'Applicant Name': 'Maria A. Santos', 'Email Found': 'other@example.com', Summary: 's' });
  env.ctx.tick();
  const olj = env.rows('Applicants').find((x) => x['Applicant ID'] === 'O-k77');
  assert.equal(olj['Invite Hold'], 'Already invited as F-3 (same person)');
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'O-k77').length, 0);
});

test('OLJ times sent as UTC ISO text are stored as Pacific time, like form rows', () => {
  const env = invitedEnv();
  assert.equal(env.ctx.ptStamp_('2026-10-28T16:47:18.000000Z'), '2026-10-28 09:47:18');
  assert.equal(env.ctx.ptStamp_('2026-10-28T05:25:37.000000Z'), '2026-10-27 22:25:37');
  assert.equal(env.ctx.ptStamp_('2026-10-27 15:21:08'), '2026-10-27 15:21:08');
});

test('Zoom live: minutes so far and arrival show on the applicant during the session; stage set only at finalize', () => {
  const env = invitedEnv();
  env.setNow(pdt('2026-10-28T14:10:00'));
  addRow(env, 'Zoom Attendance', { 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Maria Santos_Collections', 'Parsed Name': 'Maria Santos', 'Parsed Position': 'Collections', 'Total Minutes': 10.4, 'Minutes Early': 12, Arrival: '12 min early (on time)' });
  env.ctx.tick();
  let maria = env.rows('Applicants').find((x) => x['First Name'] === 'Maria Clara');
  assert.equal(maria.Stage, 'Invited');
  assert.equal(maria['Zoom Minutes'], 10);
  assert.equal(maria.Arrival, '12 min early (on time)');
  // the session job rewrites the row's minutes a few minutes later
  const z = env.sheets['Zoom Attendance'].data;
  z[1][z[0].indexOf('Total Minutes')] = 26;
  env.ctx.tick();
  maria = env.rows('Applicants').find((x) => x['First Name'] === 'Maria Clara');
  assert.equal(maria['Zoom Minutes'], 26);
  assert.equal(maria.Stage, 'Invited');
  env.sheets.Settings.appendRow(['ZOOM_FINALIZE', '2026-10-28', '']);
  env.ctx.tick();
  maria = env.rows('Applicants').find((x) => x['First Name'] === 'Maria Clara');
  assert.equal(maria.Stage, 'Did Not Complete');
  assert.equal(maria['Zoom Minutes'], 26);
});

test('scorecards: one card per person per applicant, averaged; data and applicant carry them', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  const r1 = env.api({ action: 'saveScore', by: 'Am', id: 'F-2', scores: { Communication: 4, English: 4, Experience: 3, Internet: 4, 'Work Setup': 4 }, note: 'clear' });
  assert.equal(r1.data.suggestion, 'Passed');
  env.api({ action: 'saveScore', by: 'Am', id: 'F-2', scores: { Communication: 3, English: 3, Experience: 3, Internet: 3, 'Work Setup': 3 } }); // Am edits hers
  const r2 = env.api({ action: 'saveScore', by: 'Camille', id: 'F-2', scores: { Communication: 4, English: 4, Experience: 4, Internet: 4, 'Work Setup': 4 } });
  assert.equal(r2.data.count, 2);
  assert.equal(r2.data.average, 3.5);
  assert.equal(env.rows('Scorecards').length, 2);
  assert.equal(env.api({ action: 'saveScore', by: 'Am', id: 'F-2', scores: { Communication: 9 } }).ok, false);
  assert.equal(env.api({ action: 'data', slim: true }).data.scores.length, 2);
  assert.equal(env.api({ action: 'applicant', id: 'F-2' }).data.scores.length, 2);
});

test('tags and saved views', () => {
  const env = invitedEnv();
  env.ctx.setup();
  assert.equal(env.api({ action: 'setTags', by: 'Am', id: 'F-2', tags: ' talent pool, Bilingual,talent POOL ,, ' }).data.tags, 'talent pool, Bilingual');
  assert.equal(env.api({ action: 'data', slim: true }).data.applicants.find((a) => a['Applicant ID'] === 'F-2').Tags, 'talent pool, Bilingual');
  env.api({ action: 'saveView', by: 'Camille', name: 'Great ISA', query: '?fit=Great&position=ISA' });
  env.api({ action: 'saveView', by: 'Am', name: 'great isa', query: 'fit=Great' }); // same name: replaced
  let views = env.api({ action: 'data', slim: true }).data.views;
  assert.deepEqual(views.map((v) => [v.Name, v.Query]), [['Great ISA', 'fit=Great']]);
  env.api({ action: 'deleteView', by: 'Am', name: 'Great ISA' });
  assert.equal(env.api({ action: 'data', slim: true }).data.views.length, 0);
});

test('email inbox: thread shows replies and our answers; a reply from the CRM is queued with the approved template', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  env.ctx.tick(); // invites queued and sent through the hook
  addRow(env, 'Replies', { 'Message ID': 'm1', 'Received At': '2026-10-27 11:00:00', 'From Email': 'maria@example.com', Subject: 'RE: ClubWealth | Pre-Interview invite', 'Reply Text': 'Can I join at 3 PM?' });
  env.ctx.tick();
  const r = env.api({ action: 'sendReply', by: 'Camille', id: 'F-2', text: 'Hi Maria,\n\nThe session starts at 2 PM PT.' });
  assert.equal(r.data.queued, true);
  const out = env.rows('Outbox').filter((e) => e.Type === 'Reply');
  assert.equal(out.length, 1);
  assert.equal(out[0].To, 'maria@example.com');
  assert.equal(out[0]['Queued By'], 'Camille');
  assert.equal(out[0].Subject, 'RE: ClubWealth | Pre-Interview invite');
  const t = env.api({ action: 'applicant', id: 'F-2' }).data.thread;
  // invited by hand before the system (no invite in Outbox): their reply, then our answer
  assert.deepEqual(t.map((x) => x.dir), ['in', 'out']);
  assert.equal(t[0].text, 'Can I join at 3 PM?');
  assert.equal(t[1].text, 'Hi Maria,\n\nThe session starts at 2 PM PT.');
  assert.equal(t[1].by, 'Camille');
  assert.equal(env.api({ action: 'sendReply', by: 'Am', id: 'F-2', text: '   ' }).ok, false);
});

test('Slack: first run only starts the clock; then new good applicants and Needs Attention go out batched', () => {
  const { ctxCalls } = require('./harness');
  const env = invitedEnv();
  env.ctx.setup();
  ctxCalls.posts = [];
  env.ctx.tick(); // starts SLACK_SINCE, sends nothing (no backlog)
  assert.equal(ctxCalls.posts.filter((p) => /good applicant/.test(p.body || '')).length, 0);
  env.setNow(pdt('2026-10-27T12:10:00'));
  const apps = env.sheets.Applicants.data;
  const h = apps[0];
  apps[1][h.indexOf('Screen Tag')] = 'Great';
  apps[1][h.indexOf('Screened At')] = '2026-10-27 12:09:00';
  env.ctx.tick();
  const msgs = ctxCalls.posts.map((p) => p.body || '').filter((b) => /good applicant/.test(b));
  assert.equal(msgs.length, 1);
  assert.match(JSON.parse(msgs[0]).text, /1 new good applicant\*\n• Maria Clara Santos, Collections VA \(Great\)/);
  env.setNow(pdt('2026-10-27T12:20:00'));
  env.ctx.tick(); // nothing new
  assert.equal(ctxCalls.posts.map((p) => p.body || '').filter((b) => /good applicant/.test(b)).length, 1);
});

test('OLJ inbox: saved OLJ messages show as a thread; an answer from the CRM is queued for the OLJ sender', () => {
  const env = invitedEnv();
  env.ctx.setup(); // adds the OLJ "Thread" column
  const thread = JSON.stringify([
    { from: 'applicant', at: '2026-10-27T15:00:00.000000Z', text: 'Hello, I am interested in the Collections role.' },
    { from: 'us', at: '2026-10-27T16:00:00.000000Z', text: 'Greetings from Club Wealth!' }
  ]);
  addRow(env, 'OLJ', { 'Conversation Key': 'c123', 'Job Post': 'Collections Virtual Assistant', 'Applicant Name': 'Lito Lapid', 'Email Found': 'lito@example.com', Summary: 'Interested; 3 yrs collections.', Thread: thread });
  env.ctx.tick();
  assert.equal(env.api({ action: 'sendOljMessage', by: 'Am', id: 'O-c123', text: 'Yes, the session is Wednesday at 2 PM PT.' }).data.queued, true);
  assert.equal(env.api({ action: 'sendOljMessage', by: 'Am', id: 'F-2', text: 'hi' }).ok, false); // form applicant: no OLJ
  const msg = env.rows('Outbox').find((e) => e.Type === 'OLJ Message');
  assert.equal(msg.To, 'OLJ:c123');
  assert.equal(msg.Body, 'Yes, the session is Wednesday at 2 PM PT.');
  const t = env.api({ action: 'applicant', id: 'O-c123' }).data.thread;
  assert.deepEqual(t.map((x) => [x.dir, x.channel]), [['in', 'OLJ'], ['out', 'OLJ'], ['out', 'OLJ'], ['out', 'OLJ']]);
  assert.equal(t[0].at, '2026-10-27 08:00:00');
  assert.ok(t.some((x) => x.status === 'Queued' && x.text === 'Yes, the session is Wednesday at 2 PM PT.' && x.by === 'Am'));
  // never emailed: the email sender ignores OLJ messages
  assert.equal(env.ctx.EMAIL_TYPES.includes('OLJ Message'), false);
});

test('test applicants are never counted: no Slack alert, not in session results', () => {
  const { ctxCalls } = require('./harness');
  const env = invitedEnv();
  env.ctx.setup();
  env.ctx.tick(); // starts the Slack clock
  const A = env.sheets.Applicants.data, h = A[0];
  A[1][h.indexOf('Source')] = 'Test';
  A[1][h.indexOf('Screen Tag')] = 'Great';
  A[1][h.indexOf('Screened At')] = '2026-10-27 12:09:00';
  env.setNow(pdt('2026-10-27T12:10:00'));
  ctxCalls.posts = [];
  env.ctx.tick();
  assert.equal(ctxCalls.posts.filter((p) => /good applicant/.test(p.body || '')).length, 0);
  // session results: the test applicant is not in the counts
  env.setNow(pdt('2026-10-28T15:35:00'));
  env.sheets.Settings.appendRow(['ZOOM_FINALIZE', '2026-10-28', '']);
  ctxCalls.posts = [];
  env.ctx.tick();
  const msg = ctxCalls.posts.map((p) => p.body || '').find((b) => /Session results/.test(b));
  assert.match(JSON.parse(msg).text, /No confirmation: 2/); // 3 unconfirmed invitees, one of them a test applicant
});

test('Onboarded is a stage the site can move people to', () => {
  const env = invitedEnv();
  assert.equal(env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Onboarded' }).ok, true);
  assert.equal(env.rows('Applicants')[0].Stage, 'Onboarded');
});

test('undo: a stage move goes back, its queued re-invite is cancelled; a note is removed', () => {
  const env = invitedEnv();
  const mv = env.api({ action: 'setStage', by: 'Am', ids: ['F-2', 'F-3'], stage: 'Open for re-invite', reason: 'Schedule conflict' }).data;
  assert.equal(mv.undo.moves.length, 2);
  assert.equal(mv.undo.queued.length, 2);
  assert.equal(env.rows('Outbox').filter((e) => e.Type === 'Re-invite' && e.Status === 'Queued').length, 2);
  const u = env.api({ action: 'undoStage', by: 'Am', ...mv.undo }).data;
  assert.deepEqual([u.undone, u.cancelledEmails, u.alreadySent], [2, 2, 0]);
  const apps = env.rows('Applicants');
  assert.deepEqual(apps.slice(0, 2).map((a) => [a.Stage, a['Re-invite Reason']]), [['Invited', ''], ['Invited', '']]);
  assert.equal(env.rows('Outbox').filter((e) => e.Type === 'Re-invite' && e.Status === 'Cancelled').length, 2);
  assert.equal(env.rows('History').filter((h) => h.Reason === 'Undo').length, 2);
  // undoing twice does nothing more
  assert.equal(env.api({ action: 'undoStage', by: 'Am', ...mv.undo }).data.undone, 0);
  // notes
  env.api({ action: 'addNote', by: 'Am', id: 'F-2', note: 'first' });
  const n = env.api({ action: 'addNote', by: 'Am', id: 'F-2', note: 'oops' }).data;
  assert.equal(env.api({ action: 'undoNote', by: 'Am', id: 'F-2', line: n.line }).data.removed, true);
  assert.match(env.rows('Applicants')[0].Notes, /first$/);
});

test('email applications: held until EMAIL_INTAKE is ON, then screened and invited; duplicates link; referrals tagged', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  addRow(env, 'Email Applications', { 'Message ID': 'm1', 'Received At': '2026-10-27T16:25:35.000Z', 'From Email': 'Kai@Example.com', 'Applicant Name': 'Kai Dela Paz', Subject: 'Transaction Coordinator - Application (Referred: J. Cruz)', 'Position (as typed)': 'Transaction Coordinator', Summary: '3 years as a transaction coordinator for US realtors.', Referral: 'J. Cruz' });
  addRow(env, 'Email Applications', { 'Message ID': 'm2', 'Received At': '2026-10-27T17:00:00.000Z', 'From Email': 'kai@example.com', 'Applicant Name': 'Kai Dela Paz', Subject: 'Fwd: Transaction Coordinator', 'Position (as typed)': 'Transaction Coordinator', Summary: 'same' });
  addRow(env, 'Email Applications', { 'Message ID': 'm3', 'Received At': '2026-10-27T18:00:00.000Z', 'From Email': 'maria@example.com', 'Applicant Name': 'Maria Clara Santos', Subject: 'Application', 'Position (as typed)': 'Collections VA', Summary: 'x' });
  env.ctx.tick();
  let kai = env.rows('Applicants').find((a) => a.Email === 'kai@example.com');
  assert.equal(kai['Applicant ID'], 'E-2');
  assert.equal(kai.Source, 'Email');
  assert.equal(kai['Applied At (PT)'], '2026-10-27 09:25:35');
  assert.deepEqual([kai['First Name'], kai['Last Name']], ['Kai Dela', 'Paz']);
  assert.equal(kai.Tags, 'Referral');
  assert.match(kai['Invite Hold'], /Email intake invites are off/);
  const ea = env.rows('Email Applications');
  assert.deepEqual(ea.map((r) => r['Applicant ID']), ['E-2', 'E-2', 'F-2']); // the second email and the form applicant are linked, not duplicated
  assert.equal(env.rows('Applicants').filter((a) => a.Email === 'kai@example.com').length, 1);
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'E-2').length, 0);
  // Miguel approves the list
  env.sheets.Settings.appendRow(['EMAIL_INTAKE', 'ON', '']);
  env.ctx.tick();
  kai = env.rows('Applicants').find((a) => a.Email === 'kai@example.com');
  assert.equal(kai['Invite Hold'], '');
  const out = env.rows('Outbox').filter((e) => e['Applicant ID'] === 'E-2');
  assert.equal(out.length, 1);
  assert.equal(out[0].Type, 'Invite');
  // the application shows in their inbox thread
  assert.equal(env.api({ action: 'applicant', id: 'E-2' }).data.thread.filter((t) => t.type === 'Application').length, 2);
});

test('Slack: the same alert is never sent twice, even across many quiet runs (repeat bug 2026-10-28)', () => {
  const { ctxCalls } = require('./harness');
  const env = invitedEnv();
  env.ctx.setup();
  env.ctx.tick(); // starts the clock
  const A = env.sheets.Applicants.data, h = A[0];
  A[1][h.indexOf('Screen Tag')] = 'Great';
  A[1][h.indexOf('Screened At')] = '2026-10-27 12:09:00';
  env.setNow(pdt('2026-10-27T12:10:00'));
  ctxCalls.posts = [];
  for (let i = 0; i < 6; i++) { env.setNow(pdt(`2026-10-27T12:${String(10 + i * 5).padStart(2, '0')}:00`)); env.ctx.tick(); }
  assert.equal(ctxCalls.posts.map((p) => p.body || '').filter((b) => /good applicant/.test(b)).length, 1);
  // Settings never holds the clock any more (Sheets would turn it into a date)
  assert.equal(env.rows('Settings').some((r) => r.Key === 'SLACK_SINCE'), false);
});
