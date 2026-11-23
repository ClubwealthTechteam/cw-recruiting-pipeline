// Re-invited No Show / No Confirmation applicants (Miguel, 2026-11-18). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, HEADERS } = require('./harness');

const pst = (s) => new Date(s + '-08:00');
const row = (tab, o) => HEADERS[tab].map((h) => (o[h] === undefined ? '' : o[h]));

function seed(now) {
  const env = load({ mode: 'LIVE', now: pst(now), settings: { REMINDERS_QUEUED_FOR: '2026-11-18', EMAIL_SENDING: 'ON' } });
  const A = env.sheets.Applicants, O = env.sheets.Outbox, R = env.sheets.Replies;
  A.appendRow(row('Applicants', { 'Applicant ID': 'A1', Source: 'Form', 'First Name': 'Ana', 'Last Name': 'Reyes', Email: 'ana@example.com', Position: 'Inside Sales Agent (ISA)', Stage: 'No Show', 'Interview Date': '2026-11-18' }));
  A.appendRow(row('Applicants', { 'Applicant ID': 'A2', Source: 'Form', 'First Name': 'Ben', 'Last Name': 'Cruz', Email: 'ben@example.com', Position: 'Inside Sales Agent (ISA)', Stage: 'No Confirmation', 'Interview Date': '2026-11-18' }));
  A.appendRow(row('Applicants', { 'Applicant ID': 'A3', Source: 'Form', 'First Name': 'Cy', 'Last Name': 'Dee', Email: 'cy@example.com', Position: 'Inside Sales Agent (ISA)', Stage: 'No Show', 'Interview Date': '2026-11-11' }));
  for (const id of ['A1', 'A2']) {
    O.appendRow(row('Outbox', { 'Email ID': 'E-' + id, 'Applicant ID': id, Type: 'Invite', To: id === 'A1' ? 'ana@example.com' : 'ben@example.com', Subject: 'ClubWealth | Pre-Interview invite', 'Interview Date': '2026-11-18', 'Queued At': '2026-11-17 15:45:00', Status: 'Sent', 'Sent At': '2026-11-17 15:50:00' }));
  }
  R.appendRow(row('Replies', { 'Message ID': 'm1', 'Received At': '2026-11-17 16:10:00', 'From Email': 'ana@example.com', Subject: 'RE: ClubWealth | Pre-Interview invite', 'Reply Text': 'Ana Reyes', Category: 'Other', 'Action Taken': 'Flagged for Recruitment (stage No Show)', 'Processed At': '2026-11-17 16:12:00' }));
  env.sheets['Needs Attention'].appendRow(row('Needs Attention', { 'Flag ID': 'N1', 'Created At': '2026-11-17 16:12:00', 'Applicant ID': 'A1', Type: 'Reply needs reading', Detail: '(No Show) Ana Reyes', Status: 'Open' }));
  return env;
}

test('re-invite fix: invited No Show / No Confirmation become Invited; a full-name reply confirms and gets the reminder', () => {
  const env = seed('2026-11-18T07:00:00');
  const n = env.ctx.reinvitedFix_(env.ctx.settings_());
  assert.equal(n, 2);
  const apps = Object.fromEntries(env.rows('Applicants').map((a) => [a['Applicant ID'], a]));
  assert.equal(apps.A1.Stage, 'Confirmed');
  assert.equal(apps.A2.Stage, 'Invited');
  assert.equal(apps.A3.Stage, 'No Show', 'not invited for an upcoming session: untouched');
  assert.equal(env.rows('Needs Attention')[0].Status, 'Resolved');
  const rem = env.rows('Outbox').filter((e) => e.Type === 'Reminder');
  assert.equal(rem.length, 1); assert.equal(rem[0]['Applicant ID'], 'A1');
  assert.equal(env.ctx.reinvitedFix_(env.ctx.settings_()), 0, 'runs once');
});

test('invite sent to a No Show applicant makes them Invited', () => {
  const env = seed('2026-11-17T15:55:00');
  env.ctx.settings_().set('REINVITED_FIX', 'DONE');
  env.ctx.applySentEmails_(env.ctx.settings_());
  const apps = Object.fromEntries(env.rows('Applicants').map((a) => [a['Applicant ID'], a]));
  assert.equal(apps.A1.Stage, 'Invited');
  assert.equal(apps.A2.Stage, 'Invited');
});

test('Zoom: a name without _Position is recorded; a manual link sticks and counts the minutes', () => {
  const env = load({ mode: 'LIVE', now: pst('2026-11-18T14:30:00'), settings: { ZOOM_TRACKING_FOR: '2026-11-18' } });
  const rows = env.ctx.zoomRowsFromParticipants([
    { id: 'p1', user_name: 'Romeo O', join_time: '2026-11-18T21:50:00Z' },
    { id: 'p2', user_name: 'Ana Reyes_ISA', join_time: '2026-11-18T21:55:00Z' },
    { id: 'p3', user_name: 'Trainee_Training', join_time: '2026-11-18T21:55:00Z' },
  ], '2026-11-18', pst('2026-11-18T14:30:00').getTime(), {});
  const names = rows.map((r) => r['Parsed Name']).sort();
  assert.equal(JSON.stringify(names), JSON.stringify(['Ana Reyes', 'Romeo O']));
  assert.equal(rows.find((r) => r['Parsed Name'] === 'Romeo O')['Parsed Position'], '');
  // link "Romeo O" to the invitee Romeo Opolentisima
  env.sheets.Applicants.appendRow(row('Applicants', { 'Applicant ID': 'F-1', Source: 'Form', 'First Name': 'Romeo', 'Last Name': 'Opolentisima', Email: 'r@example.com', Position: 'Inside Sales Agent (ISA)', Stage: 'Confirmed', 'Interview Date': '2026-11-18' }));
  env.ctx.writeZoomRows_('2026-11-18', rows);
  const res = env.ctx.api_({ action: 'linkZoom', day: '2026-11-18', name: 'Romeo O', id: 'F-1', by: 'Miguel' });
  assert.equal(res.linked, true);
  env.ctx.processZoom_(env.ctx.settings_()); // the next check must not undo the link
  const z = env.rows('Zoom Attendance').find((r) => r['Parsed Name'] === 'Romeo O');
  assert.equal(z['Matched Applicant ID'], 'F-1');
  assert.equal(z['Linked By'], 'Miguel');
  assert.ok(Number(env.rows('Applicants')[0]['Zoom Minutes']) > 0);
});
