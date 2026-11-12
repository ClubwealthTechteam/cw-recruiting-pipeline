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

test('applicants whose email is on the Rejected tab are never invited, by OLJ or email, and go to Banned once', () => {
  const env = invitedEnv({ AUTO_INVITES: 'OFF', EMAIL_SENDING: 'ON' }, [' Lito@Example.com ', 'can reapply beginning july 2026']);
  addRow(env, 'OLJ', { 'Conversation Key': 'k9', 'Job Post': 'Club Wealth Inside Sales Agent', 'Applicant Name': 'Lito Lapid', 'Email Found': 'lito@example.com', Summary: 's' });
  env.ctx.tick();
  assert.match(env.api({ action: 'sendInvite', by: 'Am', id: 'O-k9', channel: 'olj' }).error, /Do not invite/);
  assert.match(env.api({ action: 'sendInvite', by: 'Am', id: 'O-k9', channel: 'email' }).error, /Do not invite/);
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'O-k9').length, 0);
  assert.match(env.api({ action: 'applicant', id: 'O-k9' }).data.applicant['Do Not Invite'], /Rejected tab/);
  assert.equal(env.api({ action: 'applicant', id: 'F-2' }).data.applicant['Do Not Invite'], '');
  // automatic invites skip; the applicant goes to Banned once, however many runs (Miguel, 2026-10-29)
  const st = env.sheets.Settings; const sh = st.data[0];
  st.data.find((r) => r[0] === 'AUTO_INVITES')[sh.indexOf('Value')] = 'ON';
  env.ctx.tick(); env.ctx.tick();
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'O-k9').length, 0);
  assert.equal(env.rows('Applicants').find((a) => a['Applicant ID'] === 'O-k9').Stage, 'Banned');
  assert.equal(env.rows('History').filter((h) => h['Applicant ID'] === 'O-k9' && h['To Stage'] === 'Banned').length, 1);
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

test('Onboarding is a stage the site can move people to', () => {
  const env = invitedEnv();
  env.ctx.setup();
  assert.match(env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Onboarding' }).error, /Hired \| Homexa or Hired \| Clubwealth/);
  const r = env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Onboarding', company: 'Homexa', startDate: '2026-11-13' });
  assert.equal(r.ok, true, r.error);
  assert.equal(env.rows('Applicants')[0].Stage, 'Onboarding');
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

test('addApplicant: a referral added by hand starts Applied as Source Referral, refuses duplicates, and can be invited', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  assert.equal(env.api({ action: 'addApplicant', by: 'Hacker', firstName: 'Kai', lastName: 'Cruz', position: 'Collections VA' }).ok, false);
  assert.equal(env.api({ action: 'addApplicant', by: 'Camille', firstName: 'Kai', lastName: '', position: 'Collections VA' }).ok, false);
  const r = env.api({ action: 'addApplicant', by: 'Camille', firstName: 'Kai', lastName: 'Cruz', email: 'Kai@Example.com', position: 'Collections VA', referredBy: 'an RM', invite: true });
  assert.equal(r.ok, true);
  assert.equal(r.data.id, 'R-1');
  const kai = env.rows('Applicants').find((a) => a['Applicant ID'] === 'R-1');
  assert.equal(kai.Source, 'Referral');
  assert.equal(kai['Source Ref'], 'Referred by an RM');
  assert.equal(kai.Email, 'kai@example.com');
  assert.equal(kai.Tags, 'Referral');
  assert.match(kai.Notes, /Camille: Added as a referral from an RM/);
  assert.equal(env.rows('History').filter((h) => h['Applicant ID'] === 'R-1' && h['To Stage'] === 'Applied').length, 1);
  assert.equal(r.data.invited, true);
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'R-1' && e.Type === 'Invite').length, 1);
  // same person again (by email or by name) is refused and names the existing record
  const dup = env.api({ action: 'addApplicant', by: 'Am', firstName: 'KAI', lastName: 'cruz', position: 'Collections VA' });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /R-1/);
  // the next one gets R-2; without an email nothing is queued
  const r2 = env.api({ action: 'addApplicant', by: 'Am', firstName: 'Lea', lastName: 'Santos', position: 'Inside Sales Agent (ISA)', invite: true, resumeLink: 'https://drive.google.com/file/d/abc' });
  assert.equal(r2.data.id, 'R-2');
  assert.equal(r2.data.invited, false);
  assert.equal(env.rows('Applicants').find((a) => a['Applicant ID'] === 'R-2')['Resume Link'], 'https://drive.google.com/file/d/abc');
  // a bad link is refused
  assert.equal(env.api({ action: 'addApplicant', by: 'Am', firstName: 'Bo', lastName: 'Reyes', position: 'Collections VA', resumeLink: 'javascript:alert(1)' }).ok, false);
});

test('addApplicant: an uploaded resume is saved to the Resumes folder in Drive and linked on the applicant', () => {
  const { ctxCalls } = require('./harness');
  ctxCalls.drive = null;
  const env = invitedEnv();
  env.ctx.setup();
  const r = env.api({ action: 'addApplicant', by: 'Camille', firstName: 'Ana', lastName: 'Lim', position: 'Collections VA',
    resume: { name: 'cv.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') } });
  assert.equal(r.ok, true, r.error);
  const d = ctxCalls.drive;
  assert.deepEqual(Object.values(d.folders).map((f) => f.name), ['Recruiting Pipeline - Resumes']);
  assert.equal(d.files[0].name, 'R-1 - Ana Lim - resume.pdf');
  assert.deepEqual(d.files[0].parents, ['folder1']);
  assert.equal(d.perms, 1);
  assert.equal(env.rows('Applicants').find((a) => a['Applicant ID'] === 'R-1')['Resume Link'], 'https://drive.google.com/file/d/f1/view');
  // the second upload reuses the folder (found by its saved id)
  env.api({ action: 'addApplicant', by: 'Camille', firstName: 'Bea', lastName: 'Cruz', position: 'Collections VA',
    resume: { name: 'cv.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 two').toString('base64') } });
  assert.equal(Object.keys(d.folders).length, 1);
  assert.equal(d.files[1].name, 'R-2 - Bea Cruz - resume.pdf');
  // a bad file type is refused before anything is created
  assert.equal(env.api({ action: 'addApplicant', by: 'Camille', firstName: 'Ed', lastName: 'Go', position: 'Collections VA', resume: { name: 'x.exe', type: 'application/x-msdownload', data: 'AAAA' } }).ok, false);
  assert.equal(env.rows('Applicants').some((a) => a['First Name'] === 'Ed'), false);
});

test('Needs Attention inbox: read and answer an unmatched email, then link it to the applicant', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  addRow(env, 'Replies', { 'Message ID': 'u1', 'Received At': '2026-10-28 18:09:00', 'From Email': 'Other.Address@gmail.com', Subject: 'RE: ClubWealth | Pre-Interview invite', 'Reply Text': 'I missed the interview, is there another schedule?', Category: 'Other' });
  env.ctx.tick();
  const flag = env.rows('Needs Attention').find((f) => f.Type === 'Unmatched reply');
  assert.ok(flag);
  // the thread shows their email; an address that never wrote to CareersCW shows nothing and cannot be emailed
  const t = env.api({ action: 'emailThread', email: 'other.address@gmail.com' });
  assert.equal(t.data.thread.filter((m) => m.dir === 'in').length, 1);
  assert.deepEqual(env.api({ action: 'emailThread', email: 'stranger@x.com' }).data.thread, []);
  assert.equal(env.api({ action: 'replyToEmail', by: 'Am', email: 'stranger@x.com', text: 'hi' }).ok, false);
  // reply goes out from CareersCW and appears in the thread
  assert.equal(env.api({ action: 'replyToEmail', by: 'Am', email: 'other.address@gmail.com', text: 'Yes, join us next Wednesday at 2 PM PT.' }).ok, true);
  const out = env.rows('Outbox').filter((e) => e.To === 'other.address@gmail.com');
  assert.equal(out.length, 1);
  assert.equal(out[0].Type, 'Reply');
  assert.equal(env.api({ action: 'emailThread', email: 'other.address@gmail.com' }).data.thread.filter((m) => m.dir === 'out').length, 1);
  // link it to the applicant and save the new address on them
  assert.equal(env.api({ action: 'linkReply', by: 'Am', email: 'other.address@gmail.com', flagId: flag['Flag ID'], applicantId: 'F-3', saveEmail: true }).ok, true);
  assert.equal(env.rows('Replies').find((r) => r['Message ID'] === 'u1')['Matched Applicant ID'], 'F-3');
  assert.equal(env.rows('Needs Attention').find((f) => f['Flag ID'] === flag['Flag ID'])['Applicant ID'], 'F-3');
  const f3 = env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-3');
  assert.equal(f3.Email, 'other.address@gmail.com');
  assert.match(f3.Notes, /Email changed to other.address@gmail.com/);
  assert.equal(env.api({ action: 'linkReply', by: 'Am', email: 'other.address@gmail.com', applicantId: 'NOPE' }).ok, false);
});

test('updateApplicant: Edit profile changes allowed fields only, notes each change, and can upload a resume', () => {
  const { ctxCalls } = require('./harness');
  ctxCalls.drive = null;
  const env = invitedEnv();
  env.ctx.setup();
  const r = env.api({ action: 'updateApplicant', by: 'Camille', id: 'F-2', fields: { Email: 'New@Mail.com', Phone: '0917', 'Position (as typed)': 'Inside Sales Agent' },
    resume: { name: 'cv.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 x').toString('base64') } });
  assert.equal(r.ok, true, r.error);
  const a = env.rows('Applicants').find((x) => x['Applicant ID'] === 'F-2');
  assert.equal(a.Email, 'new@mail.com');
  assert.equal(a.Phone, '0917');
  assert.equal(a.Position, 'Inside Sales Agent (ISA)');
  assert.match(a['Resume Link'], /drive\.google\.com/);
  assert.match(a.Notes, /Camille: Profile edited \(Email: maria@example\.com → new@mail\.com; Phone: empty → 0917; .*Resume uploaded\)/);
  assert.equal(a.Stage, 'Invited'); // nothing else changes
  // stage, IDs and other system columns cannot be edited; bad values are refused
  assert.equal(env.api({ action: 'updateApplicant', by: 'Camille', id: 'F-2', fields: { Stage: 'Hired' } }).ok, false);
  assert.equal(env.api({ action: 'updateApplicant', by: 'Camille', id: 'F-2', fields: { Email: 'nope' } }).ok, false);
  assert.equal(env.api({ action: 'updateApplicant', by: 'Camille', id: 'F-2', fields: { 'Resume Link': 'javascript:x' } }).ok, false);
  assert.equal(env.api({ action: 'updateApplicant', by: 'Camille', id: 'F-2', fields: { Phone: '0917' } }).data.updated, 0);
});

test('status emails wait for approval: moving queues one, moving again replaces it, approve sends once, never twice', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  const pending = () => env.rows('Outbox').filter((e) => e['Applicant ID'] === 'F-2' && e.Status === 'Pending approval');
  // Hired queues a Hired email for approval; nothing is sent
  const r = env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Hired', company: 'Club Wealth', startDate: '2026-11-12' });
  assert.equal(r.ok, true, r.error);
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].Type, 'Hired');
  assert.match(pending()[0].Subject, /Club Wealth \| Start Date: Thursday, November 12, 2026/);
  assert.match(env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-2').Tags, /Hired \| Clubwealth/);
  assert.equal(pending()[0]['Queued By'], 'Am');
  ctxCalls.posts = []; env.ctx.tick();
  assert.equal(ctxCalls.posts.filter((p) => /zapier/.test(p.url)).length, 0, 'nothing goes out before approval');
  // moved again before approval: the old one is cancelled, the new one queued (never two)
  env.api({ action: 'setStage', by: 'Camille', ids: ['F-2'], stage: 'Benched' });
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].Type, 'Benched');
  const old = env.rows('Outbox').find((e) => e['Applicant ID'] === 'F-2' && e.Type === 'Hired');
  assert.equal(old.Status, 'Cancelled');
  assert.equal(old['Decided By'], 'Camille');
  // Don't send
  assert.equal(env.api({ action: 'skipEmail', by: 'Am', emailId: pending()[0]['Email ID'] }).ok, true);
  assert.equal(pending().length, 0);
  // Onboarding uses the Hired template; approve sends it
  env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Onboarding', company: 'Homexa', startDate: '2026-11-13' });
  const h = pending()[0];
  assert.match(h.Subject, /^\[TEST\] Homexa|^Homexa/);
  assert.equal(h.Type, 'Hired');
  assert.equal(env.api({ action: 'approveEmail', by: 'Camille', emailId: h['Email ID'] }).ok, true);
  const approved = env.rows('Outbox').find((e) => e['Email ID'] === h['Email ID']);
  assert.equal(approved.Status, 'Queued');
  assert.equal(approved['Decided By'], 'Camille');
  assert.equal(env.api({ action: 'approveEmail', by: 'Camille', emailId: h['Email ID'] }).ok, false, 'cannot approve twice');
  // the same type is never queued again for this applicant
  env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Passed Interview' });
  env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Hired', company: 'Homexa', startDate: '2026-11-13' });
  assert.equal(pending().length, 0);
  assert.match(env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-2').Notes, /Hired email not queued again/);
  // a stage with no email queues nothing; undo cancels what the move queued
  const u = env.api({ action: 'setStage', by: 'Am', ids: ['F-3'], stage: 'Not Fit', notFitType: 'general', reason: 'Communication skills' });
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'F-3' && e.Status === 'Pending approval' && e.Type === 'Rejected').length, 1);
  env.api({ action: 'undoStage', by: 'Am', ...u.data.undo });
  assert.equal(env.rows('Outbox').filter((e) => e['Applicant ID'] === 'F-3' && e.Status === 'Pending approval').length, 0);
});

test('Banned: applicants whose email is on the Rejected tab move to Banned once; a team member is flagged to check', () => {
  const header = ['Lenght of stay (Days)', 'Remarks', 'Timestamp', 'Email Address', 'First and Last Name', 'Mobile Number', 'Full Address', 'Date of Birth', 'Position Hired For', 'Start date (Friday Date)'];
  const env = load({ mode: 'LIVE', now: pdt('2026-10-29T08:00:00'), rejected: ['maria@example.com'],
    onboarding: { CW: [header, ['10', 'Working', 'x', 'maria@example.com', 'Maria Santos', '0917', 'SECRET ADDRESS', '1/1/1990', 'ISA', '10/16/2026']] },
    formRows: [formRow(pdt('2026-10-23T10:00:00'), 'Maria Clara', 'Santos', 'maria@example.com', 'Collections VA', 'Yes')] });
  env.ctx.importHistory();
  env.ctx.setup();
  env.ctx.tick(); env.ctx.tick();
  const a = env.rows('Applicants')[0];
  assert.equal(a.Stage, 'Banned');
  assert.equal(env.rows('History').filter((h) => h['To Stage'] === 'Banned').length, 1);
  assert.equal(env.rows('Needs Attention').filter((f) => f.Type === 'Banned team member?').length, 1);
  assert.equal(env.rows('Outbox').filter((e) => /Invite/.test(e.Type)).length, 0);
});

test('Active Team Members: the Onboarding sheet is copied without private fields, and a site edit wins until cleared', () => {
  const cw = ['Lenght of stay (Days)', 'Remarks', 'Timestamp', 'Email Address', 'First and Last Name', 'Mobile Number', 'Full Address', 'Date of Birth', 'Position Hired For', 'Start date (Friday Date)', 'How did you hear about us?', 'Government Issued ID'];
  const hx = ['Column 27', 'Column 26', 'Timestamp', 'Email Address', 'First and Last Name', 'Mobile Number', 'Full Address', 'Date of Birth', 'Company Hired For', 'Position Hired For', 'Start date (Friday Date)'];
  const env = load({ mode: 'LIVE', now: pdt('2026-10-29T08:00:00'), onboarding: {
    CW: [cw, ['230.6', 'Working', 't', 'Ana@x.com', 'Ana Cruz', '0917', '123 Street', '1/1/1990', 'CW ISA', '3/13/2026', 'OLJ', 'id.jpg'],
      ['20', 'Terminated', 't', 'bo@x.com', 'Bo Lim', '0918', '9 Road', '2/2/1991', 'HX TC / LC', '9/1/2026', 'FB', 'id2.jpg']],
    HOMEXA: [hx, ['13.1', '', 't', 'cy@x.com', 'Cy Go', '0919', '7 Ave', '3/3/1992', '', 'Transaction/Listing Coordinator', '10/15/2026']],
    PFL: [['Timestamp', 'Email Address']] } });
  env.ctx.setup();
  env.ctx.tick();
  const team = env.rows('Team (Onboarding)');
  assert.equal(team.length, 3);
  assert.deepEqual(team.map((m) => [m.Email, m.Company, m.Department, m.Status, m.Days]).sort(), [
    ['ana@x.com', 'Club Wealth', 'ISA', 'Working', '230'], ['bo@x.com', 'Club Wealth', 'TC/LC', 'Terminated', '20'], ['cy@x.com', 'Homexa', 'TC/LC', '', '13']]);
  assert.equal(JSON.stringify(team).includes('123 Street'), false, 'address is not copied');
  assert.equal(JSON.stringify(team).includes('1/1/1990'), false, 'birthday is not copied');
  // site edit wins; the sheet value is kept to show next to it; clearing goes back to the sheet value
  assert.equal(env.api({ action: 'updateTeam', by: 'Camille', email: 'ana@x.com', field: 'Department', value: 'Client Care' }).ok, true);
  let ana = env.api({ action: 'data' }).data.team.find((m) => m.Email === 'ana@x.com');
  assert.equal(ana.Department, 'Client Care');
  assert.equal(ana.edited.Department, 'ISA');
  assert.equal(ana.Active, 'Y');
  assert.equal(env.api({ action: 'data' }).data.team.find((m) => m.Email === 'bo@x.com').Active, '');
  assert.equal(env.api({ action: 'data' }).data.team.find((m) => m.Email === 'cy@x.com').Active, 'Y', 'blank status counts as active');
  env.api({ action: 'updateTeam', by: 'Camille', email: 'ana@x.com', field: 'Department', value: '', clear: true });
  ana = env.api({ action: 'data' }).data.team.find((m) => m.Email === 'ana@x.com');
  assert.equal(ana.Department, 'ISA');
  assert.equal(env.api({ action: 'updateTeam', by: 'Camille', email: 'ana@x.com', field: 'Email', value: 'z' }).ok, false);
  // the Onboarding sheet is never written
  assert.equal(env.ctx.SpreadsheetApp.openById('ONB').getSheetByName('CW').data.length, 3);
});

test('Active Team Members: older onboarding sheets are included, and a rehire shows once with the latest hire', () => {
  const cw = ['Lenght of stay (Days)', 'Remarks', 'Timestamp', 'Email Address', 'First and Last Name', 'Mobile Number', 'Full Address', 'Date of Birth', 'Position Hired For', 'Start date (Friday Date)'];
  const old = ['STATUS', 'MANUAL INPUT', '90 days?', 'Timestamp', 'Email Address', 'First and Last Name', 'Start date', 'Preferred Name at Work ', 'Mobile Number', 'Full Address', 'Date of Birth', 'Position Hired For'];
  const env = load({ mode: 'LIVE', now: pdt('2026-10-29T08:00:00'), onboarding: {
    CW: [cw, ['10', 'Working', 't', 'rose@x.com', 'Rose Flores', '0917', 'addr', 'dob', 'RE ISA', '9/18/2026']],
    '2025': [cw, ['551', 'Terminated', 't', 'Rose@x.com', 'Rosarie Flores', '0917', 'addr', 'dob', 'CW ISA', '5/2/2025'],
      ['531', 'Working', 't', 'am@x.com', 'Am M', '0918', 'addr', 'dob', 'CW Admin', '5/16/2025']],
    'Form Responses 1': [old, ['Term', '', '', 't', 'ed@x.com', 'Ed Go', '1/5/2024', 'Ed', '0919', 'addr', 'dob', 'ISA'],
      ['Working', '', '', 't', 'jo@x.com', 'Jo Lim', '3/1/2024', 'Jo', '0920', 'addr', 'dob', 'Client Care']] } });
  env.ctx.setup();
  env.ctx.tick();
  const team = env.rows('Team (Onboarding)');
  assert.deepEqual(team.map((m) => m.Email).sort(), ['am@x.com', 'ed@x.com', 'jo@x.com', 'rose@x.com']);
  const rose = team.find((m) => m.Email === 'rose@x.com');
  assert.equal(rose.Status, 'Working', 'rehire: the 2026 hire wins over the 2025 one');
  assert.equal(rose['Start Date'], '2026-09-18');
  const ed = team.find((m) => m.Email === 'ed@x.com');
  assert.equal(ed.Status, 'Terminated', '"Term" is shown as Terminated');
  assert.equal(ed['Source Tab'], '2023-2024 · Form Responses 1');
  assert.equal(ed.Days, String(Math.round((Date.parse('2026-10-29') - Date.parse('2024-01-05')) / 86400000)));
  assert.equal(team.find((m) => m.Email === 'jo@x.com').Department, 'Client Care');
});

test('move to another session: Wednesday only, old queued emails cancelled, new invite only when asked', () => {
  const env = invitedEnv({ AUTO_INVITES: 'OFF', EMAIL_SENDING: 'ON' });
  env.ctx.tick();
  const id = 'F-2';
  assert.equal(env.api({ action: 'sendInvite', by: 'Am', id, channel: 'email' }).ok, true);
  const old = env.rows('Applicants').find((x) => x['Applicant ID'] === id)['Interview Date'];
  assert.match(env.api({ action: 'moveSession', by: 'Am', ids: [id], date: '2026-11-12' }).error, /not a Wednesday/);
  assert.match(env.api({ action: 'moveSession', by: 'Am', ids: [id], date: '2026-10-21' }).error, /already started/);
  const r = env.api({ action: 'moveSession', by: 'Am', ids: [id], date: '2026-11-11' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.data.moved, r.data.cancelled, r.data.invited], [1, 1, 0]);
  const a = env.rows('Applicants').find((x) => x['Applicant ID'] === id);
  assert.equal(a['Interview Date'], '2026-11-11');
  assert.match(a.Notes, /Moved from the October 28, 2026 session to Wednesday November 11, 2026.*No new invite sent/);
  assert.equal(env.rows('Outbox').find((e) => e['Applicant ID'] === id && ymdOf(e['Interview Date']) === old).Status, 'Cancelled');
  assert.equal(env.rows('History').pop().Reason, 'Session moved 2026-10-28 → 2026-11-11');
  // with the box ticked a Re-invite for the new date is queued
  const r2 = env.api({ action: 'moveSession', by: 'Am', ids: [id], date: '2026-11-18', sendInvite: true });
  assert.equal(r2.data.invited, 1);
  const q = env.rows('Outbox').filter((e) => e['Applicant ID'] === id && e.Status === 'Queued');
  assert.deepEqual(q.map((e) => [e.Type, e['Interview Date']]), [['Re-invite', '2026-11-18']]);
  assert.match(q[0].Body, /November 18, 2026/);
  assert.equal(env.api({ action: 'moveSession', by: 'Am', ids: [id], date: '2026-11-18' }).data.skipped.length, 1);
});

function ymdOf(v) { return String(v || '').slice(0, 10); }
test('inbox panel: email and OLJ conversations, needs-reply clears after an answer', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  addRow(env, 'Replies', { 'Message ID': 'u1', 'Received At': '2026-10-27 10:00:00', 'From Email': 'Other.Address@gmail.com', Subject: 'RE: ClubWealth | Pre-Interview invite', 'Reply Text': 'Can I move to next week?', Category: 'Other' });
  addRow(env, 'OLJ', { 'Conversation Key': 'c7', 'Job Post': 'Collections Virtual Assistant', 'Applicant Name': 'Lito Lapid', Summary: 'Interested', Thread: JSON.stringify([{ from: 'applicant', at: '2026-10-27T15:00:00.000000Z', text: 'Is the session at 2 PM?' }]) });
  env.ctx.tick();
  let list = env.api({ action: 'inbox', channel: 'email' }).data.conversations;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].email, list[0].applicant, list[0].needsReply], ['other.address@gmail.com', null, true]);
  env.api({ action: 'replyToEmail', by: 'Am', email: 'other.address@gmail.com', text: 'Yes.' });
  assert.equal(env.api({ action: 'inbox', channel: 'email' }).data.conversations[0].needsReply, false);
  list = env.api({ action: 'inbox', channel: 'olj' }).data.conversations;
  assert.deepEqual([list[0].key, list[0].applicant.id, list[0].needsReply, list[0].last], ['c7', 'O-c7', true, 'Is the session at 2 PM?']);
  env.api({ action: 'sendOljMessage', by: 'Am', id: 'O-c7', text: 'Yes, 2 PM PT.' });
  assert.equal(env.api({ action: 'inbox', channel: 'olj' }).data.conversations[0].needsReply, false);
});

test('inbox templates: reminders queue once; Hired / Onboarding go to Needs Approval, never straight out', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  addRow(env, 'OLJ', { 'Conversation Key': 'c7', 'Job Post': 'Collections Virtual Assistant', 'Applicant Name': 'Lito Lapid', Summary: 'Interested' });
  env.ctx.tick();
  const A = env.sheets.Applicants.data, h = A[0];
  A.find((r) => r[0] === 'O-c7')[h.indexOf('Interview Date')] = '2026-10-28';
  const r = env.api({ action: 'sendTemplate', by: 'Am', id: 'F-2', template: 'Reminder' });
  assert.equal(r.ok, true, r.error);
  const rem = env.rows('Outbox').find((e) => e.Type === 'Reminder' && e['Applicant ID'] === 'F-2');
  assert.equal(rem.Status, 'Queued');
  assert.match(rem.Body, /pre-interview tomorrow, Wednesday, October 28, 2026/);
  assert.match(env.api({ action: 'sendTemplate', by: 'Am', id: 'F-2', template: 'Reminder' }).error, /already sent or is queued/);
  // OLJ reminder: the routine's wording, so it is never sent twice
  assert.equal(env.api({ action: 'sendTemplate', by: 'Am', id: 'O-c7', template: 'Reminder', channel: 'olj' }).ok, true);
  assert.match(env.rows('Outbox').find((e) => e.Type === 'OLJ Message').Body, /friendly reminder about your virtual pre-interview tomorrow/);
  assert.equal(env.api({ action: 'sendTemplate', by: 'Am', id: 'O-c7', template: 'Reminder', channel: 'olj' }).ok, false);
  // status templates wait for approval
  for (const t of ['Hired', 'Onboarding']) {
    const s = env.api({ action: 'sendTemplate', by: 'Am', id: 'F-2', template: t, company: 'Homexa', startDate: '2026-11-13' });
    assert.equal(s.data.pending, true, s.error);
    assert.equal(env.rows('Outbox').find((e) => e['Email ID'] === s.data.emailId).Status, 'Pending approval');
  }
  assert.match(env.api({ action: 'sendTemplate', by: 'Am', id: 'F-2', template: 'Hired', company: 'Homexa', startDate: '2026-11-13' }).error, /already waiting/);
  assert.equal(env.api({ action: 'sendTemplate', by: 'Am', id: 'F-2', template: 'Hired', channel: 'olj' }).ok, false);
  assert.match(env.api({ action: 'sendTemplate', by: 'Am', id: 'F-2', template: 'Nope' }).error, /Unknown template/);
  assert.equal(env.ctx.EMAIL_TYPES.includes('Onboarding'), true);
});

test('an OLJ invite the sender held back is not queued again until the applicant writes again', () => {
  const env = invitedEnv();
  env.ctx.setup();
  addRow(env, 'OLJ', { 'Conversation Key': 'h1', 'Job Post': 'Collections Virtual Assistant', 'Applicant Name': 'Lito Lapid', Summary: 'Interested; 3 yrs collections experience.' });
  env.ctx.tick();
  const olj = () => env.rows('Outbox').filter((e) => e['Applicant ID'] === 'O-h1' && e.Type === 'OLJ Invite');
  assert.equal(olj().length, 1);
  // the OLJ sender holds it back
  const ob = env.sheets.Outbox, h = ob.data[0];
  const r = ob.data.find((x) => x[h.indexOf('Applicant ID')] === 'O-h1');
  r[h.indexOf('Status')] = 'Failed';
  r[h.indexOf('Error')] = 'Not sent: No summary, resume or cover message yet';
  env.ctx.tick();
  env.ctx.tick();
  assert.equal(olj().length, 1, 'not queued again');
  const a = env.rows('Applicants').find((x) => x['Applicant ID'] === 'O-h1');
  assert.match(a['Invite Hold'], /^OLJ invite held until they write again: No summary/);
  assert.ok(env.rows('Needs Attention').some((f) => f.Type === 'OLJ invite held'));
  // they write again: the hold clears and one new invite is queued
  const t = env.sheets.OLJ, th = t.data[0];
  t.data.find((x) => x[0] === 'h1')[th.indexOf('Summary')] = 'Sent a resume and cover letter.';
  env.ctx.tick();
  assert.equal(olj().filter((e) => e.Status === 'Queued').length, 1);
});

test('re-invite no-shows: No Show and No Confirmation from one session move to the new date with a re-invite', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON', AUTO_INVITES: 'OFF' });
  env.ctx.tick();
  const A = env.sheets.Applicants.data, h = A[0];
  const set = (id, k, v) => { A.find((r) => r[0] === id)[h.indexOf(k)] = v; };
  ['F-2', 'F-3', 'F-4'].forEach((id) => set(id, 'Interview Date', '2026-10-21'));
  set('F-2', 'Stage', 'No Show'); set('F-3', 'Stage', 'No Confirmation'); set('F-4', 'Stage', 'Interview Completed');
  assert.match(env.api({ action: 'reinviteNoShows', by: 'Am', session: '2026-10-21', date: '2026-10-29' }).error, /not a Wednesday/);
  const r = env.api({ action: 'reinviteNoShows', by: 'Am', session: '2026-10-21', date: '2026-11-04' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.reinvited, 2);
  const rows = env.rows('Applicants');
  for (const id of ['F-2', 'F-3']) {
    const a = rows.find((x) => x['Applicant ID'] === id);
    assert.equal(a.Stage, 'Open for re-invite');
    assert.equal(a['Interview Date'], '2026-11-04');
  }
  assert.equal(rows.find((x) => x['Applicant ID'] === 'F-4').Stage, 'Interview Completed', 'completed people are left alone');
  const q = env.rows('Outbox').filter((e) => e.Type === 'Re-invite' && e.Status === 'Queued');
  assert.deepEqual(q.map((e) => e['Applicant ID']).sort(), ['F-2', 'F-3']);
  assert.match(q[0].Body, /November 4, 2026/);
  // running it again finds nobody (they are no longer No Show / No Confirmation)
  assert.equal(env.api({ action: 'reinviteNoShows', by: 'Am', session: '2026-10-21', date: '2026-11-04' }).data.reinvited, 0);
});

test('preview shows the invite or reply without queuing anything; presence lists the others viewing', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON', AUTO_INVITES: 'OFF' });
  env.ctx.tick();
  const before = env.rows('Outbox').length;
  const inv = env.api({ action: 'preview', by: 'Am', kind: 'invite', id: 'F-2' });
  assert.equal(inv.ok, true, inv.error);
  assert.match(inv.data.subject, /Pre-Interview invite/);
  assert.match(inv.data.body, /email-banner\.png/);
  assert.match(inv.data.session, /^\d{4}-\d{2}-\d{2}$/);
  const rep = env.api({ action: 'preview', by: 'Am', kind: 'reply', id: 'F-2', text: 'Hello <b>there</b>' });
  assert.match(rep.data.body, /Hello &lt;b&gt;there&lt;\/b&gt;/, 'reply text is escaped');
  assert.match(env.api({ action: 'preview', by: 'Am', kind: 'reinvite', id: 'F-2', date: '2026-10-29' }).error, /not a Wednesday/);
  assert.equal(env.rows('Outbox').length, before, 'a preview never queues an email');
  assert.match(env.api({ action: 'preview', by: 'Stranger', kind: 'invite', id: 'F-2' }).error, /unknown user/);
  assert.deepEqual(env.api({ action: 'presence', by: 'Am', id: 'F-2' }).data.others, []);
  assert.deepEqual(env.api({ action: 'presence', by: 'Camille', id: 'F-2' }).data.others, ['Am']);
});

test('cancelled sessions: Send invite and previews skip a cancelled Wednesday; moving to it is refused', () => {
  // now is Tue 2026-10-27, so the next Wednesday is 2026-10-28; cancel it
  const env = invitedEnv({ EMAIL_SENDING: 'ON', AUTO_INVITES: 'OFF', CANCELLED_SESSIONS: '2026-10-28' });
  env.ctx.tick();
  const pv = env.api({ action: 'preview', by: 'Am', kind: 'invite', id: 'F-2' });
  assert.equal(pv.data.session, '2026-11-04', 'the preview shows the next open session');
  assert.match(pv.data.body, /November 4, 2026/);
  assert.doesNotMatch(pv.data.body, /October 28/);
  const r = env.api({ action: 'sendInvite', by: 'Am', id: 'F-2', channel: 'email' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.session, '2026-11-04');
  const q = env.rows('Outbox').filter((e) => e['Applicant ID'] === 'F-2' && e.Type === 'Invite' && e.Status === 'Queued');
  assert.match(q[q.length - 1].Body, /November 4, 2026/);
  assert.match(env.api({ action: 'moveSession', by: 'Am', ids: ['F-3'], date: '2026-10-28' }).error, /cancelled/);
  assert.deepEqual(env.api({ action: 'data', slim: true }).data.cancelledSessions, ['2026-10-28']);
});

test('final status templates: Benched and Rejected wording, onboarding emails per company and start date', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  const b = env.ctx.statusEmail('Benched', 'Maria');
  assert.match(b.body, /^<p>Hi Maria,<\/p>/);
  assert.match(b.body, /Tara was very impressed with your qualifications/);
  assert.match(b.body, /email-banner\.png/);
  const r = env.ctx.statusEmail('Rejected', 'Maria');
  assert.match(r.body, /^<p>Hi!<\/p>/);
  assert.match(r.body, /decided not to move forward/);
  assert.match(r.body, /All the best,/);
  assert.doesNotMatch(r.body, /Cheers/);
  const cw = env.ctx.statusEmail('Hired', 'Maria', { company: 'Club Wealth', startDate: '2026-11-12' });
  assert.match(cw.body, /Welcome to Club Wealth!/);
  assert.match(cw.body, /First Day TO DO: Thursday, November 12, 2026/);
  assert.match(cw.body, /forms\.gle\/NjSEBpYwNQ8Z4Niw8/);
  assert.match(cw.body, /clubwealth-zoom-background\.png/);
  const hx = env.ctx.statusEmail('Hired', 'Maria', { company: 'Homexa', startDate: '2026-11-13', position: 'Transaction Coordinator' });
  assert.match(hx.subject, /Homexa \| Start Date: Friday, November 13, 2026/);
  assert.match(hx.body, /BEFORE 8:00 AM Friday/);
  assert.match(hx.body, /homexa-transaction-team\.jpg/);
  assert.match(hx.body, /forms\.gle\/epjTUxnSUSbJBH1v8/);
  assert.throws(() => env.ctx.statusEmail('Hired', 'Maria', { company: 'Homexa' }), /start date/);
  // the move needs a company; the tag is set, and undo puts the old tags back
  const mv = env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Hired', company: 'Homexa', startDate: '2026-11-13' });
  assert.equal(mv.ok, true, mv.error);
  const tag = () => env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-2').Tags;
  assert.equal(tag(), 'Hired | Homexa');
  env.api({ action: 'undoStage', by: 'Am', ...mv.data.undo });
  assert.equal(tag(), '');
});

test('Not Fit needs a why; only General not fit prepares the Rejected email', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  const rejected = (id) => env.rows('Outbox').filter((e) => e['Applicant ID'] === id && e.Type === 'Rejected' && e.Status === 'Pending approval');
  assert.match(env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Not Fit', reason: 'x' }).error, /Pick why/);
  assert.equal(env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Not Fit', notFitType: 'internet' }).ok, true);
  assert.equal(rejected('F-2').length, 0, 'bad internet: no email');
  assert.equal(env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-2')['Decision Reason'], 'Bad internet');
  env.api({ action: 'setStage', by: 'Am', ids: ['F-3'], stage: 'Not Fit', notFitType: 'device', reason: 'i3 7th gen' });
  assert.equal(rejected('F-3').length, 0, 'device: no email');
  assert.equal(env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-3')['Decision Reason'], 'Did not meet device requirements - i3 7th gen');
  env.api({ action: 'setStage', by: 'Am', ids: ['F-4'], stage: 'Not Fit', notFitType: 'general' });
  assert.equal(rejected('F-4').length, 1, 'general not fit: Rejected email waits for approval');
});

test('Onboarded rows are renamed to Onboarding once; a hire can be re-tagged to a company', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  const A = env.sheets.Applicants.data, h = A[0];
  A.find((r) => r[0] === 'F-2')[h.indexOf('Stage')] = 'Onboarded';
  A.find((r) => r[0] === 'F-3')[h.indexOf('Stage')] = 'Hired';
  env.ctx.tick();
  const row = (id) => env.rows('Applicants').find((a) => a['Applicant ID'] === id);
  assert.equal(row('F-2').Stage, 'Onboarding');
  // F-3 was Hired before companies existed: setting the company works although the stage stays Hired
  const r = env.api({ action: 'setStage', by: 'Am', ids: ['F-3'], stage: 'Hired', company: 'Club Wealth', startDate: '2026-11-12' });
  assert.equal(r.data.updated, 1);
  assert.equal(row('F-3').Tags, 'Hired | Clubwealth');
  assert.equal(env.api({ action: 'setStage', by: 'Am', ids: ['F-3'], stage: 'Hired', company: 'Club Wealth', startDate: '2026-11-12' }).data.updated, 0, 'same company again: nothing');
  env.api({ action: 'undoStage', by: 'Am', ...r.data.undo });
  assert.equal(row('F-3').Tags, '');
  assert.equal(row('F-3').Stage, 'Hired');
});

test('a waiting email can be edited: subject and body saved, scripts removed, banner kept', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Benched' });
  const e = env.rows('Outbox').find((x) => x.Type === 'Benched' && x.Status === 'Pending approval');
  const r = env.api({ action: 'editPendingEmail', by: 'Camille', emailId: e['Email ID'], subject: 'Update on your application',
    body: '<p onclick="x()">Hi Maria, new text</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>' });
  assert.equal(r.ok, true, r.error);
  const after = env.rows('Outbox').find((x) => x['Email ID'] === e['Email ID']);
  assert.equal(after.Subject, 'Update on your application');
  assert.match(after.Body, /Hi Maria, new text/);
  assert.doesNotMatch(after.Body, /script|onclick|javascript:/i);
  assert.match(after.Body, /email-banner\.png/, 'banner put back');
  assert.equal(after['Edited By'], 'Camille');
  assert.equal(after.Status, 'Pending approval');
  env.api({ action: 'approveEmail', by: 'Am', emailId: e['Email ID'] });
  assert.match(env.api({ action: 'editPendingEmail', by: 'Am', emailId: e['Email ID'], subject: 'x', body: '<p>y</p>' }).error, /Only emails waiting/);
});

test('Zoom tracking from the site: starts once in the window, polls Zoom, writes rows, finalizes the stages', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  const A = env.sheets.Applicants.data, h = A[0];
  const set = (id, k, v) => { A.find((r) => r[0] === id)[h.indexOf(k)] = v; };
  ['F-2', 'F-3', 'F-4'].forEach((id) => { set(id, 'Interview Date', '2026-10-28'); set(id, 'Stage', 'Confirmed'); });
  // fake Zoom: Maria stays the whole session, Jose leaves at 2:20, Ana never joins
  const zoomCalls = [];
  const participants = [
    { participant_uuid: 'a', user_name: 'Maria Clara Santos_Collections VA', join_time: '2026-10-28T20:50:00Z' },
    { participant_uuid: 'b', user_name: 'Jose Dela Cruz_ISA', join_time: '2026-10-28T20:55:00Z', leave_time: '2026-10-28T21:20:00Z' },
    { participant_uuid: 'c', user_name: 'Staff Person', join_time: '2026-10-28T20:00:00Z' }
  ];
  env.ctx.Utilities.base64Encode = (s) => Buffer.from(String(s)).toString('base64');
  env.ctx.UrlFetchApp = { fetch: (url) => {
    zoomCalls.push(url);
    const body = /oauth\/token/.test(url) ? { access_token: 'tok' } : { participants };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
  } };
  // outside the window: nothing happens
  env.setNow(pdt('2026-10-28T12:00:00'));
  assert.equal(env.api({ action: 'startZoomTracking', by: 'Am', date: '2026-10-28' }).data.started, false);
  assert.equal(env.api({ action: 'startZoomTracking', by: 'Am', date: '2026-10-29' }).data.started, false, 'not the session day');
  assert.equal(zoomCalls.length, 0);
  // 1:41 PM: starts, polls once right away
  env.setNow(pdt('2026-10-28T13:41:00'));
  const s = env.api({ action: 'startZoomTracking', by: 'Am', date: '2026-10-28' });
  assert.equal(s.ok, true, s.error);
  assert.equal(s.data.started, true);
  assert.equal(s.data.status.day, '2026-10-28');
  assert.equal(env.api({ action: 'startZoomTracking', by: 'Camille', date: '2026-10-28' }).data.started, false, 'only once');
  // ticks during the session keep the rows current; matching is done by the engine
  env.setNow(pdt('2026-10-28T14:30:00')); env.ctx.tick();
  const z = () => env.rows('Zoom Attendance').filter((r) => r['Interview Date'] === '2026-10-28');
  assert.equal(z().length, 2, 'only Name_Position participants');
  assert.equal(z().find((r) => /Maria/.test(r['Parsed Name']))['Matched Applicant ID'], 'F-2');
  assert.equal(z().find((r) => /Maria/.test(r['Parsed Name']))['Total Minutes'], 40);
  // after 3:30 PM: final poll, then stages
  env.setNow(pdt('2026-10-28T15:35:00')); env.ctx.tick();
  const st = (id) => env.rows('Applicants').find((a) => a['Applicant ID'] === id).Stage;
  assert.equal(z().find((r) => /Maria/.test(r['Parsed Name']))['Total Minutes'], 100);
  assert.deepEqual([st('F-2'), st('F-3'), st('F-4')], ['Interview Completed', 'Did Not Complete', 'No Show']);
  const settings = Object.fromEntries(env.rows('Settings').map((r) => [r.Key, r.Value]));
  assert.equal(settings.ZOOM_TRACKING_DONE, '2026-10-28');
  const calls = zoomCalls.length; env.setNow(pdt('2026-10-28T15:40:00')); env.ctx.tick();
  assert.equal(zoomCalls.length, calls, 'no more Zoom calls after the session');
  assert.ok(zoomCalls.filter((u) => /zoom/.test(u)).every((u) => /^https:\/\/(zoom\.us\/oauth\/token|api\.zoom\.us\/v2\/metrics\/meetings\/)/.test(u)), 'only the token and the read-only participant list');
});

function batchEnv(settings = {}, onboarding = {}) {
  const env = load({ mode: 'LIVE', now: pdt('2026-10-27T12:00:00'), settings: { EMAIL_SENDING: 'ON', ...settings }, onboarding, formRows: [
    formRow(pdt('2026-10-23T10:00:00'), 'Maria Clara', 'Santos', 'maria@example.com', 'Collections VA', 'Yes'),
    formRow(pdt('2026-10-24T10:00:00'), 'Jose', 'Dela Cruz', 'jose@example.com', 'ISA', 'Yes'),
    formRow(pdt('2026-10-25T10:00:00'), 'Ana', 'Reyes', 'ana@example.com', 'Appointment Setter', 'Yes')
  ] });
  env.ctx.importHistory();
  env.ctx.setup();
  return env;
}

test('Offboarded: unchecked on the ISA Masterfile moves a Hired / Onboarding applicant, by name, hourly', () => {
  const env = batchEnv({}, { 'Active ISAs': [['PromoCode', 'First', 'Last', 'Active'], ['CWMaria', 'Maria Clara', 'Santos', false], ['CWJose', 'Jose', 'Dela Cruz', true], ['CWAna', 'Ana', 'Reyes', 'FALSE']] });
  const A = env.sheets.Applicants.data, h = A[0];
  const set = (id, k, v) => { A.find((r) => r[0] === id)[h.indexOf(k)] = v; };
  set('F-2', 'Stage', 'Hired'); set('F-3', 'Stage', 'Onboarding'); set('F-4', 'Stage', 'Passed Interview');
  env.ctx.tick();
  const st = (id) => env.rows('Applicants').find((a) => a['Applicant ID'] === id).Stage;
  assert.deepEqual([st('F-2'), st('F-3'), st('F-4')], ['Offboarded', 'Onboarding', 'Passed Interview'], 'only unchecked AND hired; Ana is not hired');
  assert.equal(env.rows('History').some((x) => x['Applicant ID'] === 'F-2' && x['To Stage'] === 'Offboarded'), true);
  assert.equal(env.rows('Outbox').some((e) => e['Applicant ID'] === 'F-2' && e.Status === 'Pending approval'), false, 'no email');
});

test('pause invites: the CRM switch, a paused applicant, and job ads that are paused', () => {
  const env = batchEnv({ AUTO_INVITES: 'ON' });
  assert.equal(env.api({ action: 'setAutoInvites', by: 'Am', on: false }).data.autoInvites, 'OFF');
  assert.equal(env.api({ action: 'data' }).data.autoInvites, 'OFF');
  env.api({ action: 'setAutoInvites', by: 'Am', on: true });
  // per applicant
  env.api({ action: 'pauseInvites', by: 'Am', id: 'F-2', paused: true });
  const a = () => env.rows('Applicants').find((x) => x['Applicant ID'] === 'F-2');
  assert.match(a().Tags, /Invites paused/);
  assert.match(env.api({ action: 'sendInvite', by: 'Am', id: 'F-2', channel: 'email' }).error, /paused/);
  assert.equal(env.ctx.inviteHoldReason({ Position: 'Collections VA', Tags: 'Invites paused' }), 'Invites paused for this applicant');
  env.api({ action: 'pauseInvites', by: 'Am', id: 'F-2', paused: false });
  assert.doesNotMatch(a().Tags, /Invites paused/);
  // job ads: only ISA active
  const r = env.api({ action: 'setActivePositions', by: 'Am', active: ['Inside Sales Agent (ISA)', 'Nope'] });
  assert.deepEqual(r.data.active, ['Inside Sales Agent (ISA)']);
  assert.equal(env.ctx.inviteHoldReason({ Position: 'Collections VA' }), 'Job ad paused: Collections VA');
  assert.equal(env.ctx.inviteHoldReason({ Position: 'Inside Sales Agent (ISA)' }), '');
  const ads = env.api({ action: 'data' }).data.jobAds;
  assert.deepEqual(ads.filter((x) => x.active).map((x) => x.position), ['Inside Sales Agent (ISA)']);
});

test("Don't send puts the applicant back in the stage before the move; templates save and delete", () => {
  const env = batchEnv();
  env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Passed Interview' });
  env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Hired', company: 'Homexa', startDate: '2026-11-13' });
  const e = env.rows('Outbox').find((x) => x['Applicant ID'] === 'F-2' && x.Status === 'Pending approval');
  const r = env.api({ action: 'skipEmail', by: 'Camille', emailId: e['Email ID'] });
  assert.equal(r.data.backTo, 'Passed Interview');
  const a = env.rows('Applicants').find((x) => x['Applicant ID'] === 'F-2');
  assert.equal(a.Stage, 'Passed Interview');
  assert.doesNotMatch(String(a.Tags), /Hired \|/);
  assert.equal(env.rows('Outbox').filter((x) => x['Applicant ID'] === 'F-2' && x.Status === 'Pending approval').length, 0, 'going back queues nothing new');
  // templates
  assert.equal(env.api({ action: 'saveTemplate', by: 'Am', name: 'Reschedule', subject: 'New date', body: 'Hi {first_name}, ...' }).ok, true);
  assert.equal(env.api({ action: 'data' }).data.emailTemplates[0].Name, 'Reschedule');
  env.api({ action: 'saveTemplate', by: 'Camille', name: 'reschedule', subject: 'New date', body: 'Hi {first_name}, updated' });
  assert.equal(env.rows('Email Templates').length, 1, 'same name updates');
  env.api({ action: 'deleteTemplate', by: 'Am', name: 'Reschedule' });
  assert.equal(env.rows('Email Templates').length, 0);
});

test('Active Team Members: emergency contact name and mobile are copied; address and birthday still are not', () => {
  const header = ['Timestamp', 'Email Address', 'First and Last Name', 'Mobile Number', 'Full Address', 'Date of Birth', 'Position Hired For', 'Start date',
    'Emergency Contact information (Name and Relationship)', 'Emergency Contact information (Mobile number)'];
  const env = load({ mode: 'LIVE', now: pdt('2026-10-29T08:00:00'),
    onboarding: { PFL: [header, ['x', 'jo@example.com', 'Jo Cruz', '0917', 'SECRET ADDRESS', '1/1/1990', 'Loan Processor', '10/16/2026', 'Ana Cruz (mother)', '0918 555 0000']] } });
  env.ctx.setup();
  env.ctx.syncTeamNow();
  const m = env.rows('Team (Onboarding)').find((r) => r.Email === 'jo@example.com');
  assert.equal(m['Emergency Contact'], 'Ana Cruz (mother)');
  assert.equal(m['Emergency Mobile'], '0918 555 0000');
  assert.doesNotMatch(JSON.stringify(m), /SECRET ADDRESS|1990/);
});

test('mass email and mass OLJ message: one personal copy each, skips who cannot get it', () => {
  const env = batchEnv();
  addRow(env, 'OLJ', { 'Conversation Key': 'm1', 'Job Post': 'Collections Virtual Assistant', 'Applicant Name': 'Lito Lapid', Summary: 'Interested' });
  env.ctx.tick();
  const before = env.rows('Outbox').length;
  const r = env.api({ action: 'bulkMessage', by: 'Am', channel: 'email', ids: ['F-2', 'F-3', 'O-m1'], subject: 'Quick update', text: 'Hi {first_name}, new date soon.' });
  assert.equal(r.ok, true, r.error);
  const sent = env.rows('Outbox').slice(before).filter((e) => e.Type === 'Reply');
  assert.equal(sent.length, r.data.queued);
  assert.ok(sent.some((e) => /Hi Maria Clara, new date soon/.test(e.Body)));
  assert.ok(sent.every((e) => e.Subject === 'Quick update' && /email-banner/.test(e.Body)));
  const o = env.api({ action: 'bulkMessage', by: 'Am', channel: 'olj', ids: ['F-2', 'O-m1'], text: 'Hi {first_name}!' });
  assert.equal(o.data.queued, 1);
  assert.match(o.data.skipped[0], /not from OnlineJobs/);
  assert.equal(env.rows('Outbox').filter((e) => e.Type === 'OLJ Message' && e.Body === 'Hi Lito!').length, 1);
  assert.match(env.api({ action: 'bulkMessage', by: 'Am', channel: 'email', ids: [], text: 'x' }).error, /Select/);
});

test('fill-ins work with [Brackets] or {braces}: first name, full name, position', () => {
  const env = batchEnv();
  const p = env.ctx.personalize;
  const a = { 'First Name': 'Krista', 'Last Name': 'Buendia', Position: 'Inside Sales Agent (ISA)' };
  assert.equal(p('Dear [First Name], the [Position] role. {first_name} / [Name] / {full_name} / [ROLE]', a),
    'Dear Krista, the Inside Sales Agent (ISA) role. Krista / Krista Buendia / Krista Buendia / Inside Sales Agent (ISA)');
  assert.equal(p('Dear [First Name], the [Position] role', {}), 'Dear there, the open role');
  assert.equal(p('[link] stays', a), '[link] stays');
});

test('rescheduled: a Confirmed applicant with a new invite goes back to Invited until they confirm again (first name is enough from their own email)', () => {
  const env = invitedEnv({ AUTO_INVITES: 'OFF', EMAIL_SENDING: 'ON' });
  env.ctx.tick();
  const id = 'F-2';
  env.api({ action: 'sendInvite', by: 'Am', id, channel: 'email' });
  const A = env.sheets.Applicants.data, h = A[0];
  A.find((r) => r[0] === id)[h.indexOf('Stage')] = 'Confirmed';
  A.find((r) => r[0] === id)[h.indexOf('Confirmed At')] = '2026-10-27 09:00:00';
  const r = env.api({ action: 'moveSession', by: 'Am', ids: [id], date: '2026-11-18', sendInvite: true });
  assert.equal(r.data.invited, 1, r.error);
  const a = () => env.rows('Applicants').find((x) => x['Applicant ID'] === id);
  assert.equal(a().Stage, 'Invited');
  assert.equal(a()['Confirmed At'], '');
  addRow(env, 'Replies', { 'Message ID': 'rs1', 'From Email': a().Email, 'Reply Text': a()['First Name'].split(' ')[0] });
  env.ctx.tick();
  assert.equal(a().Stage, 'Confirmed');
  // moving without a new invite leaves the stage alone
  env.api({ action: 'moveSession', by: 'Am', ids: [id], date: '2026-11-25' });
  assert.equal(a().Stage, 'Confirmed');
});

test('preview pencil: an edited subject and email replace the generated invite, banner kept', () => {
  const env = invitedEnv({ AUTO_INVITES: 'OFF', EMAIL_SENDING: 'ON' });
  env.ctx.tick();
  const r = env.api({ action: 'sendInvite', by: 'Am', id: 'F-2', channel: 'email', edited: { subject: 'New subject', body: '<p>Edited text</p><script>x</script>' } });
  assert.equal(r.ok, true, r.error);
  const e = env.rows('Outbox').filter((x) => x['Applicant ID'] === 'F-2' && x.Status === 'Queued').pop();
  assert.equal(e.Subject, 'New subject');
  assert.match(e.Body, /Edited text/);
  assert.doesNotMatch(e.Body, /<script/);
  assert.match(e.Body, /img/);
  assert.match(env.api({ action: 'sendInvite', by: 'Am', id: 'F-3', channel: 'email', edited: { subject: '', body: 'x' } }).error, /subject/);
});

test('job ads: pausing a position emails its Applied / Invited / Confirmed applicants the "Position on hold" template, once', () => {
  const env = batchEnv();
  env.api({ action: 'saveTemplate', by: 'Am', name: 'Position on hold', subject: 'ClubWealth | Update on Your Application', body: 'Dear [First Name], the [Position] role is on hold.' });
  const A = env.sheets.Applicants.data, h = A[0];
  A.find((r) => r[0] === 'F-3')[h.indexOf('Stage')] = 'Passed Interview';
  const shown = env.api({ action: 'data' }).data.jobAds.map((x) => x.position);
  const before = env.rows('Outbox').length;
  const r = env.api({ action: 'setActivePositions', by: 'Am', shown, active: shown.filter((p) => p !== 'Inside Sales Agent (ISA)') });
  assert.equal(r.ok, true, r.error);
  const sent = env.rows('Outbox').slice(before).filter((e) => e.Status === 'Queued');
  // Jose (F-3) is ISA but Passed Interview: not emailed. Ana (F-4, Appointment Setter = ISA) is.
  assert.deepEqual(sent.map((e) => e['Applicant ID']), ['F-4']);
  assert.equal(sent[0].Subject, 'ClubWealth | Update on Your Application');
  assert.match(sent[0].Body, /Dear Ana, the Inside Sales Agent \(ISA\) role is on hold/);
  assert.match(env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-4').Tags, /Position on hold/);
  assert.equal(env.ctx.inviteHoldReason({ Position: 'Inside Sales Agent (ISA)' }), 'Job ad paused: Inside Sales Agent (ISA)');
  // saving again does not email twice; ticking it again removes the tag
  env.api({ action: 'setActivePositions', by: 'Am', shown, active: shown.filter((p) => p !== 'Inside Sales Agent (ISA)') });
  assert.equal(env.rows('Outbox').slice(before).length, 1);
  env.api({ action: 'setActivePositions', by: 'Am', shown, active: shown });
  assert.doesNotMatch(env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-4').Tags, /Position on hold/);
  // the wording edited in the preview is the one that goes out
  const b2 = env.rows('Outbox').length;
  env.api({ action: 'setActivePositions', by: 'Am', shown, active: shown.filter((p) => p !== 'Inside Sales Agent (ISA)'), subject: 'Edited subject', text: 'Hi [First Name], edited.' });
  const e2 = env.rows('Outbox').slice(b2).filter((e) => e.Status === 'Queued');
  assert.deepEqual(e2.map((e) => [e['Applicant ID'], e.Subject]), [['F-4', 'Edited subject']]);
  assert.match(e2[0].Body, /Hi Ana, edited\./);
  env.api({ action: 'setActivePositions', by: 'Am', shown, active: shown });
  assert.equal(env.ctx.inviteHoldReason({ Position: 'Inside Sales Agent (ISA)' }), '');
});

test('job ads list positions that are live on OnlineJobs.ph (applicants in the last 14 days)', () => {
  const env = batchEnv();
  addRow(env, 'OLJ', { 'Conversation Key': 'j1', 'Job Post': 'AI-SAVVY MARKETING &amp; ADS SPECIALIST', 'Applicant Name': 'A B', 'Last Message At': '2026-10-26T10:00:00.000Z' });
  addRow(env, 'OLJ', { 'Conversation Key': 'j2', 'Job Post': 'Old General VA post', 'Applicant Name': 'C D', 'Last Message At': '2026-09-01T10:00:00.000Z' });
  const ads = env.api({ action: 'data' }).data.jobAds;
  const m = ads.find((x) => x.position === 'Marketing & Ads Specialist');
  assert.ok(m, JSON.stringify(ads));
  assert.equal(m.active, true);
  assert.deepEqual(m.oljPosts, ['AI-SAVVY MARKETING & ADS SPECIALIST']);
  assert.equal(ads.some((x) => x.position === 'General VA'), false, 'older than 14 days');
});

test('position on hold: mass email with "Put them on hold" stops the reminder and the No Show; Nov 10 emails are backfilled once', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON' });
  env.ctx.setup();
  addRow(env, 'Replies', { 'Message ID': 'h1', 'From Email': 'maria@example.com', 'Reply Text': 'Maria Santos', Category: 'Confirmed' });
  addRow(env, 'Replies', { 'Message ID': 'h2', 'From Email': 'jose@example.com', 'Reply Text': 'Jose Dela Cruz', Category: 'Confirmed' });
  env.ctx.tick();
  const st = (id) => env.rows('Applicants').find((a) => a['Applicant ID'] === id);
  assert.equal(st('F-2').Stage, 'Confirmed');
  // Maria: mass email with the box ticked
  const r = env.api({ action: 'bulkMessage', by: 'Miguel', channel: 'email', ids: ['F-2'], subject: 'ClubWealth | Update on Your Application', text: 'Dear [First Name], on hold.', hold: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.held, 1);
  assert.match(st('F-2').Tags, /Position on hold/);
  // Jose: an older on-hold email without the box (like Nov 10), marked sent: the backfill puts him on hold
  env.api({ action: 'bulkMessage', by: 'Miguel', channel: 'email', ids: ['F-3'], subject: 'ClubWealth | Update on Your Application', text: 'Dear [First Name], on hold.' });
  const O = env.sheets.Outbox.data, oh = O[0];
  O.forEach((row, i) => { if (i && row[oh.indexOf('Applicant ID')] === 'F-3' && row[oh.indexOf('Type')] === 'Reply') row[oh.indexOf('Status')] = 'Sent'; });
  const S = env.sheets.Settings.data; const k = S.findIndex((x) => x[0] === 'ON_HOLD_BACKFILL'); if (k > 0) S.splice(k, 1);
  env.ctx.tick();
  assert.match(st('F-3').Tags, /Position on hold/);
  // Wednesday 6 AM: no reminder for either
  env.setNow(pdt('2026-10-28T06:00:00'));
  env.ctx.tick();
  assert.deepEqual(env.rows('Outbox').filter((e) => e.Type === 'Reminder').map((e) => e['Applicant ID']), []);
  // after the session: not marked No Show
  env.setNow(pdt('2026-10-28T15:35:00'));
  env.ctx.tick();
  assert.equal(st('F-2').Stage, 'Confirmed');
  assert.equal(st('F-3').Stage, 'Confirmed');
  assert.equal(env.ctx.inviteHoldReason({ Position: 'Collections VA', Tags: 'Position on hold' }), 'Position on hold');
});

test('replies from an applicant in any stage are matched by email (flagged to read, stage unchanged); old unmatched items are relinked once', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON', UNMATCHED_RELINKED: 'DONE' });
  env.ctx.tick();
  const A = env.sheets.Applicants.data, h = A[0];
  A.find((r) => r[0] === 'F-2')[h.indexOf('Stage')] = 'No Confirmation';
  const S = env.sheets.Settings.data; S.splice(S.findIndex((x) => x[0] === 'UNMATCHED_RELINKED'), 1);
  addRow(env, 'Needs Attention', { 'Flag ID': 'N-old', 'Created At': '2026-10-28 10:00:00', Type: 'Unmatched reply', Detail: 'No matching applicant | From: Maria@Example.com | Got it, thanks.', Status: 'Open' });
  addRow(env, 'Replies', { 'Message ID': 'u1', 'From Email': 'maria@example.com', 'Reply Text': 'Thanks for the update.' });
  env.ctx.tick();
  const flags = env.rows('Needs Attention');
  const old = flags.find((f) => f['Flag ID'] === 'N-old');
  assert.equal(old['Applicant ID'], 'F-2');
  assert.equal(old.Type, 'Reply needs reading');
  assert.equal(flags.filter((f) => f.Type === 'Unmatched reply' && f.Status === 'Open').length, 0);
  assert.ok(flags.some((f) => f['Applicant ID'] === 'F-2' && /No Confirmation/.test(f.Detail)));
  assert.equal(env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-2').Stage, 'No Confirmation');
});

test('No Show / No Confirmation asking to reschedule: Open for re-invite, the Re-invite waits in Needs Approval; Don\'t send puts them back', () => {
  const env = invitedEnv({ EMAIL_SENDING: 'ON', UNMATCHED_RELINKED: 'DONE', ON_HOLD_BACKFILL: 'DONE' });
  env.ctx.setup();
  env.ctx.tick();
  const A = env.sheets.Applicants.data, h = A[0];
  A.find((r) => r[0] === 'F-2')[h.indexOf('Stage')] = 'No Confirmation';
  addRow(env, 'Replies', { 'Message ID': 'rs9', 'From Email': 'maria@example.com', 'Reply Text': 'Hi, I sincerely apologize for missing my scheduled Zoom interview. Is there any possibility of rescheduling?' });
  env.ctx.tick();
  const a = () => env.rows('Applicants').find((x) => x['Applicant ID'] === 'F-2');
  assert.equal(a().Stage, 'Open for re-invite');
  const pend = env.rows('Outbox').filter((e) => e['Applicant ID'] === 'F-2' && e.Status === 'Pending approval');
  assert.deepEqual(pend.map((e) => e.Type), ['Re-invite']);
  assert.equal(pend[0]['Interview Date'], a()['Interview Date']);
  const r = env.api({ action: 'skipEmail', by: 'Miguel', emailId: pend[0]['Email ID'] });
  assert.equal(r.data.backTo, 'No Confirmation');
  assert.equal(a().Stage, 'No Confirmation');
});

test('Needs Approval bulk send: several approved at once, the ones that cannot go are listed', () => {
  const env = batchEnv();
  env.api({ action: 'setStage', by: 'Am', ids: ['F-2', 'F-3'], stage: 'Benched' });
  const pend = env.rows('Outbox').filter((e) => e.Status === 'Pending approval').map((e) => e['Email ID']);
  assert.equal(pend.length, 2);
  const r = env.api({ action: 'approveEmails', by: 'Miguel', emailIds: [...pend, 'E-nope'] });
  assert.equal(r.data.queued, 2);
  assert.equal(r.data.failed.length, 1);
  assert.equal(env.rows('Outbox').filter((e) => pend.includes(e['Email ID']) && e.Status === 'Queued').length, 2);
});

test('live Zoom: an unmatched name is retried each check (no early "Not an invitee"); no last name on file needs every word to match', () => {
  const env = invitedEnv({ ZOOM_TRACKING_FOR: '2026-10-28' });
  env.ctx.setup();
  env.setNow(pdt('2026-10-28T14:05:00'));
  assert.equal(env.ctx.nameMatches('Jolan Kris Cabildo', 'Kris', ''), false);
  assert.equal(env.ctx.nameMatches('Kris', 'Kris', ''), true);
  addRow(env, 'Zoom Attendance', { 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Nobody Here_ISA', 'Parsed Name': 'Nobody Here', 'Parsed Position': 'ISA', 'Total Minutes': 5, Result: 'Not an invitee' });
  env.ctx.processZoom_(env.ctx.settings_());
  const row = env.rows('Zoom Attendance').find((r) => r['Parsed Name'] === 'Nobody Here');
  assert.equal(row.Result, '', 'cleared while the session is tracked');
});

test('Zoom: applicants moved to the session as Open for re-invite are matched and get a result', () => {
  const env = invitedEnv();
  const A = env.sheets.Applicants.data, h = A[0];
  A.find((r) => r[0] === 'F-2')[h.indexOf('Stage')] = 'Open for re-invite';
  env.setNow(pdt('2026-10-28T15:35:00'));
  addRow(env, 'Zoom Attendance', { 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Maria Santos_Collections', 'Parsed Name': 'Maria Santos', 'Parsed Position': 'Collections', 'Total Minutes': 75 });
  env.ctx.tick();
  env.sheets.Settings.appendRow(['ZOOM_FINALIZE', '2026-10-28', '']);
  env.ctx.tick();
  const z = env.rows('Zoom Attendance').find((r) => r['Parsed Name'] === 'Maria Santos');
  assert.equal(z['Matched Applicant ID'], 'F-2');
  assert.equal(env.rows('Applicants').find((a) => a['Applicant ID'] === 'F-2').Stage, 'Interview Completed');
});

test("Don't send can keep the stage (keepStage) or move back (default)", () => {
  const env = batchEnv();
  env.api({ action: 'setStage', by: 'Am', ids: ['F-2', 'F-3'], stage: 'Benched' });
  const pend = env.rows('Outbox').filter((e) => e.Status === 'Pending approval');
  const keep = env.api({ action: 'skipEmail', by: 'Miguel', emailId: pend[0]['Email ID'], keepStage: true });
  assert.equal(keep.data.backTo, '');
  assert.equal(env.rows('Applicants').find((a) => a['Applicant ID'] === pend[0]['Applicant ID']).Stage, 'Benched');
  const back = env.api({ action: 'skipEmail', by: 'Miguel', emailId: pend[1]['Email ID'] });
  assert.notEqual(back.data.backTo, '');
});

test('database copy: off until the first full copy; then each save sends only the rows it changed', () => {
  const { ctxCalls } = require('./harness');
  const env = batchEnv();
  ctxCalls.posts = [];
  env.api({ action: 'addNote', by: 'Am', id: 'F-2', note: 'hello' });
  assert.equal(ctxCalls.posts.filter((p) => /db\/ingest/.test(p.url)).length, 0, 'nothing before the first copy');
  const r = env.api({ action: 'dbPushAll', by: 'Miguel' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.started, true);
  env.ctx.dbFullCopyJob(); // the background timer
  assert.ok(env.api({ action: 'dbCounts' }).data.Applicants >= 3, 'counts need no user');
  const full = ctxCalls.posts.filter((p) => /db\/ingest/.test(p.url)).map((p) => JSON.parse(p.body));
  assert.ok(full.some((b) => b.op === 'trim' && b.tab === 'Applicants'));
  assert.ok(full.some((b) => b.op === 'kv' && b.key === 'jobAds'));
  ctxCalls.posts = [];
  env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Benched' });
  const sent = ctxCalls.posts.filter((p) => /db\/ingest/.test(p.url)).map((p) => JSON.parse(p.body));
  const apps = sent.filter((b) => b.tab === 'Applicants').flatMap((b) => b.rows);
  assert.deepEqual(apps.map((x) => x.data['Applicant ID']), ['F-2']);
  assert.equal(apps[0].data.Stage, 'Benched');
  assert.ok(sent.some((b) => b.tab === 'History'), 'history row sent');
  assert.ok(sent.some((b) => b.tab === 'Outbox'), 'prepared email sent');
});
