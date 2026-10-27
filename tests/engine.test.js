// End-to-end run of apps-script/Code.gs against an in-memory spreadsheet. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

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
  assert.equal(apps[0].Position, 'Appointment Setter');
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
  env.ctx.SpreadsheetApp.openById().getSheetByName().appendRow(formRow(pdt('2026-10-27T12:00:00'), 'New', 'Applicant', 'NEW@Example.com', 'TC'));
  env.ctx.tick();
  const out = env.rows('Outbox');
  assert.equal(out.length, 1);
  assert.equal(out[0].To, 'new@example.com');
  assert.equal(out[0].Subject, 'ClubWealth | Pre-Interview invite');
});

function invitedEnv(extraSettings = {}) {
  const env = load({ mode: 'LIVE', now: pdt('2026-10-27T12:00:00'), settings: extraSettings, formRows: [
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

test('Zoom: 30+ minutes completed, under 30 did not complete, unseen no show, non-invitees ignored', () => {
  const env = invitedEnv();
  env.setNow(pdt('2026-10-28T15:35:00'));
  addRow(env, 'Zoom Attendance', { 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Maria Santos_Collections', 'Parsed Name': 'Maria Santos', 'Parsed Position': 'Collections', 'Total Minutes': 45 });
  addRow(env, 'Zoom Attendance', { 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Jose Dela Cruz_ISA', 'Parsed Name': 'Jose Dela Cruz', 'Parsed Position': 'ISA', 'Total Minutes': 12 });
  addRow(env, 'Zoom Attendance', { 'Interview Date': '2026-10-28', 'Zoom Display Name': 'Random Guy_VA', 'Parsed Name': 'Random Guy', 'Parsed Position': 'VA', 'Total Minutes': 50 });
  env.ctx.tick();
  // not final yet: stages unchanged
  assert.ok(env.rows('Applicants').every((a) => a.Stage === 'Invited'));
  env.sheets.Settings.appendRow(['ZOOM_FINALIZE', '2026-10-28', '']);
  env.ctx.tick();
  const a = Object.fromEntries(env.rows('Applicants').map((x) => [x['First Name'], x]));
  assert.equal(a['Maria Clara'].Stage, 'Interview Completed');
  assert.equal(a['Maria Clara']['Zoom Minutes'], 45);
  assert.equal(a.Jose.Stage, 'Did Not Complete');
  assert.equal(a.Ana.Stage, 'No Show');
  assert.equal(env.rows('Zoom Attendance')[2].Result, 'Not an invitee');
  env.ctx.tick(); // finalizing twice changes nothing
  assert.equal(env.rows('History').filter((h) => h['To Stage'] === 'No Show').length, 1);
});

test('OLJ: new conversation becomes Applied; once an email is found it gets an invite', () => {
  const env = invitedEnv();
  addRow(env, 'OLJ', { 'Conversation Key': 'c123', 'Job Post': 'Collections Virtual Assistant', 'Applicant Name': 'Lito Lapid', Summary: 'Interested; 3 yrs collections.' });
  env.ctx.tick();
  let lito = env.rows('Applicants').find((x) => x['Applicant ID'] === 'O-c123');
  assert.equal(lito.Stage, 'Applied');
  assert.equal(lito.Source, 'OLJ');
  assert.equal(env.rows('Outbox').length, 0);
  env.sheets.OLJ.data[1][env.sheets.OLJ.data[0].indexOf('Email Found')] = 'lito@example.com';
  env.ctx.tick();
  env.ctx.tick();
  const out = env.rows('Outbox');
  assert.equal(out.length, 1);
  assert.equal(out[0].To, 'lito@example.com');
  assert.equal(env.rows('Applicants').filter((x) => x.Source === 'OLJ').length, 1);
});

test('site API: secret required, bulk stage change logs history, reason required for Not Fit', () => {
  const env = invitedEnv();
  assert.equal(JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ secret: 'nope', action: 'data' }) } }).s).ok, false);
  const d = env.api({ action: 'data' });
  assert.equal(d.ok, true);
  assert.equal(d.data.applicants.length, 3);
  assert.equal(env.api({ action: 'setStage', by: 'Am', ids: ['F-2'], stage: 'Not Fit' }).ok, false);
  const r = env.api({ action: 'setStage', by: 'Am', ids: ['F-2', 'F-3'], stage: 'Passed' });
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
  assert.equal(a.Jose.Stage, 'No Show');
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
