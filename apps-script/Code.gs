/**
 * Recruiting Pipeline engine for the "RECRUITMENT PIPELINE BASE" spreadsheet (standalone project;
 * Script Property PIPELINE_SHEET_ID points at the sheet).
 *
 * Every 5 minutes, and the moment a form response arrives, tick():
 *   1. copies new form responses into Applicants and queues their invites (Outbox),
 *   2. applies emails Zapier has sent (stage -> Invited, reminder stamps),
 *   3. sorts and applies applicant replies Zapier has copied in (Replies tab, rules only, no Claude),
 *   4. adds OLJ applicants the Claude routine has summarized (OLJ tab),
 *   5. applies Zoom attendance the Claude routine has recorded (Zoom Attendance tab),
 *   6. on Wednesdays from 6:00 AM, queues reminders for confirmed applicants.
 *
 * Zapier sends every Outbox row with Status "Queued" from CareersCW and marks it "Sent".
 * The site reads and writes through doPost (see api()).
 */

var SH = {
  APPLICANTS: 'Applicants', HISTORY: 'History', OUTBOX: 'Outbox', REPLIES: 'Replies',
  FLAGS: 'Needs Attention', ZOOM: 'Zoom Attendance', OLJ: 'OLJ', POSITIONS: 'Positions',
  SETTINGS: 'Settings', LOG: 'Run Log', TEST_FORM: 'Test Form', CHAT: 'Chat', SCORES: 'Scorecards', VIEWS: 'Views', EMAILAPPS: 'Email Applications',
  TEAM: 'Team (Onboarding)', TEAM_UPDATES: 'Team Updates', TEMPLATES: 'Email Templates'
};

// Form Responses 1 columns (0-based), read only.
var FORM = {
  TS: 0, FIRST: 1, LAST: 2, FB: 3, EMAIL: 4, PHONE: 5, COUNTRY: 6, POSITION: 7, HAS_EXP: 8,
  YEARS: 9, RECENT: 10, US_CLIENTS: 11, US_REALTOR: 12, OVERVIEW: 13, SPEED: 14, SPEED_LINK: 15,
  VOICE: 16, RESUME: 17, INVITE_SENT: 19
};

var PRE_INTERVIEW = ['Invited', 'Confirmed'];

// ---------- sheet helpers ----------

/**
 * The pipeline spreadsheet. Works in a standalone script project: set Script Property
 * PIPELINE_SHEET_ID to the spreadsheet's ID. (If the script is ever attached to the sheet, that is used.)
 */
function ss_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('PIPELINE_SHEET_ID');
  if (!id) throw new Error('Set Script Property PIPELINE_SHEET_ID to the pipeline spreadsheet ID');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) throw new Error('Missing tab: ' + name);
  return s;
}

/** Reads a tab as objects keyed by header, each with _row (1-based sheet row). */
function table_(name) {
  var s = sheet_(name);
  var values = s.getDataRange().getValues();
  var headers = values.shift() || [];
  var rows = values.map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { if (h) o[h] = r[j]; });
    return o;
  }).filter(function (o) { return headers.some(function (h) { return h && o[h] !== ''; }); });
  return { sheet: s, headers: headers, rows: rows };
}

/** Writes only the given fields of one row. */
function update_(t, row, fields) {
  Object.keys(fields).forEach(function (k) {
    var c = t.headers.indexOf(k);
    if (c === -1) throw new Error('Missing column "' + k + '" in ' + t.sheet.getName());
    t.sheet.getRange(row._row, c + 1).setValue(fields[k]);
    row[k] = fields[k];
  });
}

function append_(t, fields) {
  var r = t.headers.map(function (h) { return fields[h] !== undefined ? fields[h] : ''; });
  t.sheet.appendRow(r);
  var o = { _row: t.sheet.getLastRow() };
  t.headers.forEach(function (h, j) { o[h] = r[j]; });
  t.rows.push(o);
  return o;
}

/** Appends to a log-style tab without reading its rows (only the header). */
function appendTo_(name, fields) {
  var s = sheet_(name);
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  s.appendRow(headers.map(function (h) { return fields[h] !== undefined ? fields[h] : ''; }));
}

function settings_() {
  var t = table_(SH.SETTINGS);
  var map = {};
  t.rows.forEach(function (r) { map[r.Key] = r; });
  // every invite date (Send invite, automatic invites, re-invites, previews) skips the cancelled Wednesdays
  var cv = map.CANCELLED_SESSIONS ? map.CANCELLED_SESSIONS.Value : '';
  if (Object.prototype.toString.call(cv) === '[object Date]') cv = Utilities.formatDate(cv, TZ, 'yyyy-MM-dd');
  if (typeof setCancelledSessions === 'function') setCancelledSessions(cv);
  if (typeof setActivePositions === 'function') setActivePositions(map.ACTIVE_POSITIONS ? map.ACTIVE_POSITIONS.Value : '');
  // PAUSED_POSITIONS (any position, incl. OLJ-only ones) replaces ACTIVE_POSITIONS once Job Ads is saved again
  if (map.PAUSED_POSITIONS && typeof setPausedPositions === 'function') setPausedPositions(map.PAUSED_POSITIONS.Value);
  return {
    // Sheets turns typed dates like 2026-10-28 into Date values; always hand back YYYY-MM-DD text.
    get: function (k) {
      if (!map[k]) return '';
      var v = map[k].Value;
      return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v);
    },
    // a date with its time (Sheets turns "2026-11-11 13:50:19" into a Date; get() would drop the time)
    stamp: function (k) {
      if (!map[k]) return '';
      var v = map[k].Value;
      return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss') : String(v);
    },
    set: function (k, v) {
      if (map[k]) update_(t, map[k], { Value: v });
      else map[k] = append_(t, { Key: k, Value: v });
    }
  };
}

function nowStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function id_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + '-' +
    Math.floor(Math.random() * 1e4);
}

function log_(job, result, counts, notes) {
  appendTo_(SH.LOG, {
    'Run At (PT)': nowStr_(), Job: job, Result: result,
    Counts: typeof counts === 'string' ? counts : JSON.stringify(counts || {}), Notes: notes || ''
  });
}

function flag_(applicantId, type, detail) {
  appendTo_(SH.FLAGS, {
    'Flag ID': id_('N'), 'Created At': nowStr_(), 'Applicant ID': applicantId || '',
    Type: type, Detail: detail, Status: 'Open'
  });
}

function setStage_(apps, a, stage, by, reason) {
  var from = a.Stage;
  update_(apps, a, { Stage: stage, 'Stage Updated At': nowStr_(), 'Stage Updated By': by });
  appendTo_(SH.HISTORY, {
    'Timestamp (PT)': nowStr_(), 'Applicant ID': a['Applicant ID'], 'From Stage': from,
    'To Stage': stage, 'Changed By': by, Reason: reason || ''
  });
}

function positionOverrides_() {
  var o = {};
  table_(SH.POSITIONS).rows.forEach(function (r) {
    var k = String(r['Position (as typed, lowercase)'] || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (k && r.Position) o[k] = r.Position;
  });
  return o;
}

/** OLJ times can arrive as UTC ISO text ("2026-10-28T16:47:18.000000Z"); stored as Pacific time like form rows. */
function ptStamp_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  var t = String(v || '').trim();
  if (!/T.*(Z|[+-]\d\d:?\d\d)$/.test(t)) return t;
  var d = new Date(t.replace(/\.(\d{3})\d*/, '.$1'));
  return isNaN(d.getTime()) ? t : Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss');
}

function ymdOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

// ---------- email queue ----------

/** Queues one email. In TEST mode it always goes to TEST_EMAIL. */
function queueEmail_(st, applicant, type, mail, interviewYmd, by) {
  var test = st.get('MODE') !== 'LIVE';
  var to = test ? st.get('TEST_EMAIL') : String(applicant.Email || '').trim();
  if (!to) {
    flag_(applicant['Applicant ID'], 'No email address', type + ' could not be queued: no email address.');
    return null;
  }
  return append_(table_(SH.OUTBOX), {
    'Email ID': id_('E'), 'Applicant ID': applicant['Applicant ID'], Type: type, To: to,
    Subject: (test ? '[TEST] ' : '') + mail.subject, Body: mail.body, 'Interview Date': interviewYmd,
    'Queued At': nowStr_(), Status: 'Queued', Test: test ? 'Y' : '', 'Queued By': by || ''
  });
}

// ---------- do-not-invite list ----------

var rejectedCache_ = null;
/** Emails on the form sheet's "Rejected" tab (column A, no header). Miguel, 2026-10-28: that tab is the do-not-invite list. */
function rejectedEmails_(st) {
  if (rejectedCache_) return rejectedCache_;
  rejectedCache_ = {};
  var sh = SpreadsheetApp.openById(st.get('SOURCE_SHEET_ID')).getSheetByName('Rejected');
  if (!sh || sh.getLastRow() < 1) return rejectedCache_;
  sh.getRange(1, 1, sh.getLastRow(), 1).getValues().forEach(function (r) {
    var e = String(r[0] || '').trim().toLowerCase();
    if (/@/.test(e)) rejectedCache_[e] = true;
  });
  return rejectedCache_;
}

/** A reason string when this applicant must not be invited, else ''. */
function doNotInvite_(st, a) {
  var e = String(a.Email || '').trim().toLowerCase();
  return e && rejectedEmails_(st)[e] ? 'Email is on the Rejected tab of the form sheet' : '';
}

function queueInvite_(st, a, interviewYmd, type) {
  // Before Zapier is connected Am invites by hand; AUTO_INVITES = OFF keeps the system from queuing duplicates.
  if (st.get('MODE') === 'LIVE' && st.get('AUTO_INVITES') === 'OFF') return null;
  if (invitesPaused(a) || onHold(a)) return null; // the profile's Pause invites / Position on hold
  var blocked = doNotInvite_(st, a);
  if (blocked) {
    var already = table_(SH.FLAGS).rows.some(function (f) {
      return f['Applicant ID'] === a['Applicant ID'] && f.Type === 'Do not invite' && f.Status === 'Open';
    });
    if (!already) flag_(a['Applicant ID'], 'Do not invite', (type || 'Invite') + ' not queued: ' + blocked + '.');
    return null;
  }
  return queueEmail_(st, a, type || 'Invite', inviteEmail(interviewYmd, new Date()), interviewYmd);
}

// ---------- 1. form intake ----------

function formRows_(st) {
  if (st.get('MODE') === 'LIVE') {
    var src = SpreadsheetApp.openById(st.get('SOURCE_SHEET_ID')).getSheetByName('Form Responses 1');
    return { values: src.getDataRange().getValues(), marker: 'LAST_FORM_ROW_IMPORTED', prefix: 'F' };
  }
  return { values: sheet_(SH.TEST_FORM).getDataRange().getValues(), marker: 'LAST_TEST_ROW_IMPORTED', prefix: 'T' };
}

function applicantFromForm_(prefix, rowNum, r, overrides) {
  return {
    'Applicant ID': prefix + '-' + rowNum, Source: 'Form', 'Source Ref': 'Row ' + rowNum,
    'Applied At (PT)': r[FORM.TS] instanceof Date ? Utilities.formatDate(r[FORM.TS], TZ, 'yyyy-MM-dd HH:mm:ss') : r[FORM.TS],
    'First Name': String(r[FORM.FIRST]).trim(), 'Last Name': String(r[FORM.LAST]).trim(),
    Email: String(r[FORM.EMAIL]).trim().toLowerCase(), Phone: r[FORM.PHONE], Country: r[FORM.COUNTRY],
    'Position (as typed)': r[FORM.POSITION], Position: standardPosition(r[FORM.POSITION], overrides),
    'Has Experience': r[FORM.HAS_EXP], 'Years Experience': r[FORM.YEARS], 'Recent Client': r[FORM.RECENT],
    'US Clients VA': r[FORM.US_CLIENTS], 'US Realtor VA': r[FORM.US_REALTOR], 'Experience Overview': r[FORM.OVERVIEW],
    'Internet Speed': r[FORM.SPEED], 'Speedtest Link': r[FORM.SPEED_LINK], 'Voice Recording Link': r[FORM.VOICE],
    'Resume Link': r[FORM.RESUME], 'Facebook Link': r[FORM.FB], 'Invite Count': 0, 'Created At': nowStr_(),
    'Screen Track': screenTrack(r[FORM.POSITION]) || 'Not screened'
  };
}

function importNewFormRows_(st) {
  var src = formRows_(st);
  var last = parseInt(st.get(src.marker), 10);
  if (isNaN(last)) return 0; // not started: run importHistory() (LIVE) or startTestIntake() (TEST) first
  var apps = table_(SH.APPLICANTS);
  var overrides = positionOverrides_();
  var n = 0;
  for (var i = last; i < src.values.length; i++) {
    var r = src.values[i];
    if (!r[FORM.TS]) continue;
    var rowNum = i + 1;
    var fields = applicantFromForm_(src.prefix, rowNum, r, overrides);
    var appliedAt = r[FORM.TS] instanceof Date ? r[FORM.TS] : new Date(r[FORM.TS]);
    fields.Stage = 'Applied';
    fields['Stage Updated At'] = nowStr_();
    fields['Stage Updated By'] = 'System';
    fields['Interview Date'] = interviewDateFor(appliedAt);
    var a = append_(apps, fields);
    appendTo_(SH.HISTORY, {
      'Timestamp (PT)': nowStr_(), 'Applicant ID': a['Applicant ID'], 'From Stage': '',
      'To Stage': 'Applied', 'Changed By': 'System', Reason: 'Form response'
    });
    screenAndInvite_(st, apps, a);
    st.set(src.marker, rowNum);
    n++;
  }
  return n;
}

/**
 * One-time, at go-live: copies every applicant Am already invited ("Invite Sent Out?" = Yes) as Invited,
 * plus not-yet-invited applicants whose Wednesday is still ahead as Applied. No emails. Past interview
 * dates are marked Historical. Then starts live intake after the last form row.
 */
function importHistory() {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var st = settings_();
    if (st.get('LAST_FORM_ROW_IMPORTED')) throw new Error('History already imported.');
    var values = SpreadsheetApp.openById(st.get('SOURCE_SHEET_ID')).getSheetByName('Form Responses 1')
      .getDataRange().getValues();
    var overrides = positionOverrides_();
    var today = todayPT();
    var out = [];
    var hdr = sheet_(SH.APPLICANTS).getRange(1, 1, 1, sheet_(SH.APPLICANTS).getLastColumn()).getValues()[0];
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      if (!r[FORM.TS]) continue;
      var invited = String(r[FORM.INVITE_SENT]).trim().toLowerCase() === 'yes';
      var iv = interviewDateFor(r[FORM.TS] instanceof Date ? r[FORM.TS] : new Date(r[FORM.TS]));
      // Not invited yet and their Wednesday is still ahead: bring in as Applied (Am may still invite them by hand).
      if (!invited && iv < today) continue;
      var f = applicantFromForm_('F', i + 1, r, overrides);
      f.Stage = invited ? 'Invited' : 'Applied';
      f['Stage Updated At'] = nowStr_();
      f['Stage Updated By'] = 'Import';
      f['Interview Date'] = iv;
      f['Invite Count'] = invited ? 1 : 0;
      f.Historical = iv < today ? 'Y' : '';
      out.push(hdr.map(function (h) { return f[h] !== undefined ? f[h] : ''; }));
    }
    var s = sheet_(SH.APPLICANTS);
    if (out.length) s.getRange(s.getLastRow() + 1, 1, out.length, hdr.length).setValues(out);
    st.set('LAST_FORM_ROW_IMPORTED', values.length);
    log_('importHistory', 'ok', { imported: out.length, lastRow: values.length });
  } finally {
    lock.releaseLock();
  }
}

/** TEST mode: start reading the Test Form tab from its current end. */
function startTestIntake() {
  var st = settings_();
  st.set('LAST_TEST_ROW_IMPORTED', Math.max(1, sheet_(SH.TEST_FORM).getLastRow()));
}

/**
 * While invites are still sent by hand (before Zapier), Am marks "Invite Sent Out?" = Yes on the form sheet.
 * Form applicants still at Applied whose form row says Yes move to Invited. LIVE only; reads the form, never writes it.
 */
function syncManualInvites_(st) {
  if (st.get('MODE') !== 'LIVE' || !st.get('LAST_FORM_ROW_IMPORTED')) return 0;
  var apps = table_(SH.APPLICANTS);
  var waiting = apps.rows.filter(function (a) { return a.Stage === 'Applied' && /^F-\d+$/.test(a['Applicant ID']); });
  if (!waiting.length) return 0;
  var values = SpreadsheetApp.openById(st.get('SOURCE_SHEET_ID')).getSheetByName('Form Responses 1').getDataRange().getValues();
  var n = 0;
  waiting.forEach(function (a) {
    var r = values[Number(a['Applicant ID'].slice(2)) - 1];
    if (r && String(r[FORM.INVITE_SENT]).trim().toLowerCase() === 'yes') {
      update_(apps, a, { 'Invite Count': (Number(a['Invite Count']) || 0) + 1, 'Last Invite At': nowStr_() });
      setStage_(apps, a, 'Invited', 'Am (by hand)', 'Invite Sent Out? = Yes on the form sheet');
      n++;
    }
  });
  return n;
}

/** Fills Screen Track for current applicants that do not have one yet (rows added before screening existed). */
function backfillScreenTracks_() {
  var apps = table_(SH.APPLICANTS);
  if (apps.headers.indexOf('Screen Track') === -1) return 0;
  var n = 0;
  apps.rows.forEach(function (a) {
    if (a['Screen Track'] || a.Historical === 'Y') return;
    update_(apps, a, { 'Screen Track': screenTrack(a['Position (as typed)'] || a['OLJ Job Post']) || 'Not screened' });
    n++;
  });
  return n;
}

// ---------- 2. sending (Zapier) and sent emails ----------

var EMAIL_TYPES = ['Invite', 'Re-invite', 'Reminder', 'Confirmation', 'Reply', 'Hired', 'Rejected', 'Benched', 'Onboarding'];

/**
 * Hands each queued email to the Zapier "recruiting-pipeline-email-sender" hook, which sends it from
 * CareersCW@clubwealth.com over SMTP. Runs only while Settings EMAIL_SENDING = ON and the hook URL is in the
 * ZAPIER_SEND_HOOK script property. OLJ invites are never emailed. Marks each row Sent, or Failed with the reason.
 */
function dispatchEmails_(st) {
  if (st.get('EMAIL_SENDING') !== 'ON') return 0;
  var hook = PropertiesService.getScriptProperties().getProperty('ZAPIER_SEND_HOOK');
  if (!hook) return 0;
  var out = table_(SH.OUTBOX);
  var byId = indexBy_(table_(SH.APPLICANTS).rows, 'Applicant ID');
  var n = 0;
  out.rows.filter(function (e) {
    return e.Status === 'Queued' && EMAIL_TYPES.indexOf(e.Type) !== -1;
  }).slice(0, 6).forEach(function (e, i) {
    var a = byId[e['Applicant ID']];
    if (e.Type !== 'Confirmation' && !approvedEmailBody(e.Body)) {
      update_(out, e, { Status: 'Failed', Error: 'Not the approved template (Club Wealth sign-off and banner). Update Logic.gs and re-queue.' });
      return;
    }
    // Microsoft 365 refuses SMTP logins that overlap, so emails go one at a time, about 25 s apart (6 per 5-minute run).
    if (i > 0) Utilities.sleep(25000);
    var blocked = a && (e.Type === 'Invite' || e.Type === 'Re-invite') ? doNotInvite_(st, a) : '';
    if (blocked) {
      update_(out, e, { Status: 'Cancelled', Error: 'Do not invite: ' + blocked });
      return;
    }
    var res;
    try {
      res = UrlFetchApp.fetch(hook, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({
          email_id: e['Email ID'], type: e.Type, to: e.To, subject: e.Subject, html_body: e.Body, test: e.Test === 'Y'
        })
      });
    } catch (err) {
      update_(out, e, { Status: 'Failed', Error: 'Zapier not reached: ' + String(err && err.message || err).slice(0, 200) });
      return;
    }
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      update_(out, e, { Status: 'Sent', 'Sent At': nowStr_() });
      n++;
    } else {
      update_(out, e, { Status: 'Failed', Error: 'Zapier returned ' + code });
    }
  });
  return n;
}

function applySentEmails_(st) {
  var out = table_(SH.OUTBOX);
  var apps = table_(SH.APPLICANTS);
  var byId = indexBy_(apps.rows, 'Applicant ID');
  var n = 0;
  out.rows.forEach(function (e) {
    if (e.Applied) return;
    var a = byId[e['Applicant ID']];
    var status = String(e.Status);
    if (status === 'Failed') {
      var heldBack = e.Type === 'OLJ Invite' && /^Not sent: /.test(String(e.Error || ''));
      if (heldBack && a) {
        // The OLJ sender held the invite back (e.g. no summary yet). Hold the applicant so it is not queued again
        // every tick; the hold clears when they write something new on OLJ (processOLJ_). Miguel, 2026-10-30.
        update_(apps, a, { 'Invite Hold': OLJ_HOLD_PREFIX + String(e.Error).replace(/^Not sent: /, '') });
        flag_(e['Applicant ID'], 'OLJ invite held', String(e.Error).replace(/^Not sent: /, 'OLJ invite not sent: '));
      } else {
        flag_(e['Applicant ID'], 'Email failed', e.Type + ' to applicant failed: ' + (e.Error || 'no detail'));
      }
      update_(out, e, { Applied: 'Y' });
      return;
    }
    if (status !== 'Sent' || !a) return;
    if (e.Type === 'Invite' || e.Type === 'Re-invite' || e.Type === 'OLJ Invite') {
      update_(apps, a, {
        'Interview Date': ymdOf_(e['Interview Date']), 'Invite Count': (Number(a['Invite Count']) || 0) + 1,
        'Last Invite At': e['Sent At'] || nowStr_()
      });
      if (a.Stage === 'Applied' || a.Stage === 'Open for re-invite') {
        setStage_(apps, a, 'Invited', String(e['Queued By'] || 'System'), e.Type + ' sent for ' + ymdOf_(e['Interview Date']));
      }
    } else if (e.Type === 'Reminder') {
      update_(apps, a, { 'Reminder Sent At': e['Sent At'] || nowStr_() });
    }
    update_(out, e, { Applied: 'Y' });
    n++;
  });
  return n;
}

function indexBy_(rows, key) {
  var m = {};
  rows.forEach(function (r) { m[r[key]] = r; });
  return m;
}

// ---------- 3. replies (sorted by the Claude routine) ----------

/**
 * Zapier copies each CareersCW email into Replies (From Email, Subject, Reply Text).
 * Category is set here by classifyReply() unless already filled in by hand
 * (Confirmed | Cannot Attend | Question | Other | Ignored). Matching is done here:
 * sender email first, then the typed full name against upcoming invitees. Never guesses.
 */
function processReplies_(st) {
  var reps = table_(SH.REPLIES);
  var apps = table_(SH.APPLICANTS);
  var today = todayPT();
  var n = 0;
  reps.rows.forEach(function (rep) {
    if (rep['Processed At']) return;
    if (!rep.Category) update_(reps, rep, { Category: classifyReply(rep.Subject, rep['Reply Text']) });
    if (rep.Category === 'Ignored') {
      update_(reps, rep, { 'Action Taken': 'Ignored (auto-reply or bounce)', 'Processed At': nowStr_() });
      return;
    }
    var m = matchReply_(apps.rows, rep, today);
    if (m.applicant && rep.Category === 'Other' && confirmsFor(rep['Reply Text'], m.applicant['First Name'], m.applicant['Last Name'], m.method === 'Email')) {
      update_(reps, rep, { Category: 'Confirmed' });
    }
    var action;
    if (!m.applicant) {
      flag_('', 'Unmatched reply', m.why + ' | From: ' + rep['From Email'] + ' | ' + stripQuoted(rep['Reply Text']).slice(0, 300));
      action = 'Flagged: ' + m.why;
    } else {
      action = applyReply_(st, apps, m.applicant, rep);
    }
    update_(reps, rep, {
      'Matched Applicant ID': m.applicant ? m.applicant['Applicant ID'] : '',
      'Match Method': m.method || '', 'Action Taken': action, 'Processed At': nowStr_()
    });
    n++;
  });
  return n;
}

function matchReply_(rows, rep, today) {
  var from = String(rep['From Email'] || '').trim().toLowerCase();
  var open = rows.filter(function (a) {
    return PRE_INTERVIEW.concat(['Open for re-invite']).indexOf(a.Stage) !== -1 && !a.Historical;
  });
  var byEmail = open.filter(function (a) { return from && String(a.Email).toLowerCase() === from; });
  if (byEmail.length) {
    byEmail.sort(function (x, y) { return String(y['Applied At (PT)']).localeCompare(String(x['Applied At (PT)'])); });
    return { applicant: byEmail[0], method: 'Email' };
  }
  var typed = typedFullName(rep['Reply Text']);
  var byName = open.filter(function (a) {
    return ymdOf_(a['Interview Date']) >= today && nameMatches(typed, a['First Name'], a['Last Name']);
  });
  if (byName.length === 1) return { applicant: byName[0], method: 'Full name' };
  // Anyone else with that email, whatever their stage (Miguel, 2026-11-11): e.g. a reply after No Confirmation.
  var anyEmail = anyByEmail_(rows, from);
  if (anyEmail) return { applicant: anyEmail, method: 'Email (any stage)' };
  return { applicant: null, why: byName.length ? 'Name matches ' + byName.length + ' applicants' : 'No matching applicant' };
}

/**
 * A No Show / No Confirmation applicant asked to reschedule: they go to Open for re-invite on the next Wednesday,
 * and their Re-invite email is prepared with Status "Pending approval" (sent only after Approve & send; Don't send
 * puts them back). OLJ applicants without an email, do-not-contact and on-hold applicants are flagged instead.
 */
function rescheduleRequest_(st, apps, a, text) {
  var why = doNotInvite_(st, a) || (onHold(a) ? 'position on hold' : '') || (!a.Email ? 'no email address' : '');
  if (why) {
    flag_(a['Applicant ID'], 'Reply needs reading', 'Asks to reschedule (' + a.Stage + '; not prepared: ' + why + '): ' + text);
    return 'Flagged: asks to reschedule (' + why + ')';
  }
  var next = interviewDateFor(new Date());
  var reason = 'Asked to reschedule after ' + a.Stage + ': ' + text.slice(0, 200);
  setStage_(apps, a, 'Open for re-invite', 'System', reason);
  update_(apps, a, { 'Interview Date': next, 'Reminder Sent At': '', 'Confirmed At': '', 'Re-invite Reason': reason });
  var q = queueEmail_(st, a, 'Re-invite', inviteEmail(next, new Date()), next, 'System (reschedule request)');
  if (q) {
    var out = table_(SH.OUTBOX);
    update_(out, out.rows.filter(function (r) { return r['Email ID'] === q['Email ID']; })[0], { Status: 'Pending approval' });
  }
  return 'Open for re-invite; Re-invite for ' + next + ' waiting in Needs Approval';
}

/** The applicant with this email, current applications first, newest first; null when none. */
function anyByEmail_(rows, email) {
  var e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  var hits = rows.filter(function (a) { return String(a.Email || '').trim().toLowerCase() === e; });
  hits.sort(function (x, y) {
    return (x.Historical ? 1 : 0) - (y.Historical ? 1 : 0) || String(y['Applied At (PT)']).localeCompare(String(x['Applied At (PT)']));
  });
  return hits[0] || null;
}

/**
 * One time (Miguel, 2026-11-11): open "Unmatched reply" items whose sender email is an applicant's email are linked
 * to that applicant and shown as "Reply needs reading".
 */
function relinkUnmatched_(st) {
  if (st.get('UNMATCHED_RELINKED') === 'DONE') return 0;
  var flags = table_(SH.FLAGS);
  var apps = table_(SH.APPLICANTS);
  var rows = apps.rows;
  var n = 0;
  flags.rows.forEach(function (f) {
    if (f.Type !== 'Unmatched reply' || f.Status !== 'Open' || f['Applicant ID']) return;
    var m = String(f.Detail || '').match(/From: ([^\s|]+)/);
    var a = m && anyByEmail_(rows, m[1]);
    if (!a) return;
    var text = String(f.Detail).split(' | ').slice(2).join(' | ');
    if ((a.Stage === 'No Show' || a.Stage === 'No Confirmation') && wantsReschedule(text)) {
      // asked for another chance: handled like a new reply (re-invite waiting in Needs Approval)
      var done = rescheduleRequest_(st, apps, a, text);
      update_(flags, f, { 'Applicant ID': a['Applicant ID'], Status: /^Flagged/.test(done) ? 'Open' : 'Resolved', Detail: String(f.Detail).replace(/^No matching applicant \| /, '') + ' → ' + done });
    } else {
      update_(flags, f, { 'Applicant ID': a['Applicant ID'], Type: 'Reply needs reading', Detail: String(f.Detail).replace(/^No matching applicant \| /, '') });
    }
    n++;
  });
  st.set('UNMATCHED_RELINKED', 'DONE');
  return n;
}

function applyReply_(st, apps, a, rep) {
  var cat = String(rep.Category);
  // Missed the session and asks for another chance (Miguel, 2026-11-11): Open for re-invite, and the invite for the
  // next Wednesday waits in Needs Approval.
  if ((a.Stage === 'No Show' || a.Stage === 'No Confirmation') && wantsReschedule(rep['Reply Text'])) {
    return rescheduleRequest_(st, apps, a, stripQuoted(rep['Reply Text']).slice(0, 500));
  }
  // Matched outside the invite stages (e.g. Benched, Not Fit): never changes their stage; someone reads it.
  if (PRE_INTERVIEW.concat(['Open for re-invite']).indexOf(a.Stage) === -1) {
    flag_(a['Applicant ID'], cat === 'Question' ? 'Applicant question' : 'Reply needs reading', '(' + a.Stage + ') ' + stripQuoted(rep['Reply Text']).slice(0, 500));
    return 'Flagged for Recruitment (stage ' + a.Stage + ')';
  }
  if (cat === 'Confirmed') {
    if (a.Stage === 'Confirmed') return 'Already confirmed';
    setStage_(apps, a, 'Confirmed', 'System', 'Replied with full name');
    update_(apps, a, { 'Confirmed At': nowStr_() });
    if (st.get('SEND_CONFIRMATION_REPLY') === 'YES') {
      queueEmail_(st, a, 'Confirmation', confirmationEmail(a['First Name'], ymdOf_(a['Interview Date'])), ymdOf_(a['Interview Date']));
    }
    return 'Confirmed';
  }
  if (cat === 'Cannot Attend') {
    var next = reinviteDateFor(ymdOf_(a['Interview Date']));
    setStage_(apps, a, 'Open for re-invite', 'System', stripQuoted(rep['Reply Text']).slice(0, 300));
    update_(apps, a, { 'Re-invite Reason': stripQuoted(rep['Reply Text']).slice(0, 500) });
    queueInvite_(st, a, next, 'Re-invite');
    return 'Open for re-invite; re-invite queued for ' + next;
  }
  flag_(a['Applicant ID'], cat === 'Question' ? 'Applicant question' : 'Reply needs reading', stripQuoted(rep['Reply Text']).slice(0, 500));
  return 'Flagged for Recruitment';
}

// ---------- 4. OLJ applicants (summarized by the Claude routine) ----------

/** Invite Hold text when the OLJ sender held an invite back (Miguel, 2026-10-30). */
var OLJ_HOLD_PREFIX = 'OLJ invite held until they write again: ';

function processOLJ_(st) {
  var olj = table_(SH.OLJ);
  var apps = table_(SH.APPLICANTS);
  var byId = indexBy_(apps.rows, 'Applicant ID');
  var overrides = positionOverrides_();
  var n = 0;
  olj.rows.forEach(function (o) {
    var email = String(o['Email Found'] || '').trim().toLowerCase();
    var a = o['Applicant ID'] ? byId[o['Applicant ID']] : null;
    if (!a) {
      var parts = String(o['Applicant Name'] || '').trim().split(/\s+/);
      a = append_(apps, {
        'Applicant ID': 'O-' + o['Conversation Key'], Source: 'OLJ', 'Source Ref': o['Conversation Key'],
        'Applied At (PT)': ptStamp_(o['Last Message At']) || nowStr_(), 'First Name': parts.slice(0, -1).join(' ') || parts[0] || '',
        'Last Name': parts.length > 1 ? parts[parts.length - 1] : '', Email: email,
        'Position (as typed)': o['Job Post'], Position: standardPosition(o['Job Post'], overrides),
        'OLJ Job Post': o['Job Post'], 'OLJ Summary': o.Summary, 'OLJ Email Requested At': o['Email Requested At'] || '',
        'Screen Track': screenTrack(o['Job Post']) || 'Not screened',
        Stage: 'Applied', 'Stage Updated At': nowStr_(), 'Stage Updated By': 'System',
        'Invite Count': 0, 'Created At': nowStr_()
      });
      appendTo_(SH.HISTORY, {
        'Timestamp (PT)': nowStr_(), 'Applicant ID': a['Applicant ID'], 'From Stage': '', 'To Stage': 'Applied',
        'Changed By': 'System', Reason: 'OnlineJobs.ph message'
      });
      update_(olj, o, { 'Applicant ID': a['Applicant ID'] });
      n++;
    } else if (String(a['OLJ Summary']) !== String(o.Summary)) {
      var f = { 'OLJ Summary': o.Summary };
      // They wrote something new on OLJ: an invite the sender held back may now go out.
      if (String(a['Invite Hold'] || '').indexOf(OLJ_HOLD_PREFIX) === 0) { f['Invite Hold'] = ''; a['Invite Hold'] = ''; }
      update_(apps, a, f);
    }
    if (email && !a.Email) update_(apps, a, { Email: email });
    if (a.Stage === 'Applied' && !(Number(a['Invite Count']) > 0) && !a['Invite Hold'] && !pendingInvite_(a['Applicant ID'])) {
      screenAndInvite_(st, apps, a);
    }
  });
  return n;
}

// ---------- 4b. applications emailed to CareersCW (copied in by the email routine) ----------

var EMAIL_INTAKE_HOLD = 'Email intake invites are off until Miguel approves the list (Settings EMAIL_INTAKE = ON)';

/**
 * The hourly email routine copies each application emailed to the CareersCW Inbox into the "Email Applications" tab
 * (Message ID, Received At, From Email, Applicant Name, Subject, Position (as typed), Summary, Referral). Here each new
 * row becomes an applicant with Source "Email" (or is linked to the applicant who already has that email), screened and
 * invited like a form applicant once Settings EMAIL_INTAKE = ON (Miguel, 2026-10-28). Referrals get the "Referral" tag.
 */
function processEmailApps_(st) {
  if (!ss_().getSheetByName(SH.EMAILAPPS)) return 0;
  var ea = table_(SH.EMAILAPPS);
  var apps = table_(SH.APPLICANTS);
  var overrides = positionOverrides_();
  var on = st.get('EMAIL_INTAKE') === 'ON';
  var n = 0;
  ea.rows.forEach(function (r) {
    if (r['Processed At']) return;
    var email = String(r['From Email'] || '').trim().toLowerCase();
    if (!/@/.test(email)) { update_(ea, r, { 'Processed At': nowStr_(), Note: 'No sender email' }); return; }
    var same = apps.rows.filter(function (a) { return String(a.Email || '').trim().toLowerCase() === email && a.Historical !== 'Y'; })[0];
    if (same) {
      if (r.Referral && apps.headers.indexOf('Tags') !== -1) update_(apps, same, { Tags: cleanTags_((same.Tags ? same.Tags + ', ' : '') + 'Referral') });
      update_(ea, r, { 'Applicant ID': same['Applicant ID'], 'Processed At': nowStr_(), Note: 'Already in the CRM' });
      return;
    }
    var parts = String(r['Applicant Name'] || '').trim().split(/\s+/).filter(Boolean);
    var a = append_(apps, {
      'Applicant ID': 'E-' + r._row, Source: 'Email', 'Source Ref': r['Message ID'],
      'Applied At (PT)': ptStamp_(r['Received At']) || nowStr_(),
      'First Name': parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || ''), 'Last Name': parts.length > 1 ? parts[parts.length - 1] : '',
      Email: email, 'Position (as typed)': r['Position (as typed)'], Position: standardPosition(r['Position (as typed)'], overrides),
      'Experience Overview': r.Summary, 'Screen Track': screenTrack(r['Position (as typed)']) || 'Not screened',
      Tags: r.Referral ? 'Referral' : '', Notes: r.Referral ? nowStr_() + ' System: Referred by ' + String(r.Referral).slice(0, 100) : '',
      Stage: 'Applied', 'Stage Updated At': nowStr_(), 'Stage Updated By': 'System', 'Invite Count': 0, 'Created At': nowStr_()
    });
    appendTo_(SH.HISTORY, {
      'Timestamp (PT)': nowStr_(), 'Applicant ID': a['Applicant ID'], 'From Stage': '', 'To Stage': 'Applied',
      'Changed By': 'System', Reason: 'Emailed application to CareersCW'
    });
    update_(ea, r, { 'Applicant ID': a['Applicant ID'], 'Processed At': nowStr_() });
    if (on) screenAndInvite_(st, apps, a);
    else update_(apps, a, { 'Invite Hold': EMAIL_INTAKE_HOLD });
    n++;
  });
  if (on) {
    // switched on after the QA list: invite the email applicants that were waiting for it
    apps.rows.forEach(function (a) {
      if (a.Source === 'Email' && a.Stage === 'Applied' && a['Invite Hold'] === EMAIL_INTAKE_HOLD) { screenAndInvite_(st, apps, a); n++; }
    });
  }
  return n;
}

var RESUME_FOLDER = 'Recruiting Pipeline - Resumes';
/** Applicant columns the site's "Edit profile" may change (never stage, dates, IDs or anything the system sets). */
var EDITABLE_FIELDS = ['First Name', 'Last Name', 'Email', 'Phone', 'Country', 'Position (as typed)', 'Experience Overview',
  'Internet Speed', 'Resume Link', 'Speedtest Link', 'Voice Recording Link', 'Facebook Link'];
var RESUME_TYPES = { 'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'image/png': 'png', 'image/jpeg': 'jpg' };

/**
 * Saves a resume uploaded on the Candidates page (base64, 3 MB at most) to the Drive folder "Recruiting Pipeline -
 * Resumes" (made by the script the first time; its id is kept in Script Property RESUME_FOLDER_ID) through the
 * Drive API, and returns its link. The file is shared with anyone at Club Wealth who has the link (falls back to
 * private if the domain does not allow it). Needs the drive.file scope (appsscript.json).
 */
function checkResume_(file) {
  if (!RESUME_TYPES[file.type]) throw new Error('Resume must be a PDF, Word document or image.');
  var bytes = Utilities.base64Decode(String(file.data));
  if (bytes.length > 3 * 1024 * 1024) throw new Error('Resume is larger than 3 MB.');
  return bytes;
}

function saveResume_(a, file) {
  var ext = RESUME_TYPES[file.type];
  var bytes = checkResume_(file);
  var props = PropertiesService.getScriptProperties();
  var fid = props.getProperty('RESUME_FOLDER_ID');
  if (!fid || !driveApi_('get', 'files/' + fid + '?fields=id,trashed')) {
    fid = driveApi_('post', 'files?fields=id', { name: RESUME_FOLDER, mimeType: 'application/vnd.google-apps.folder' }).id;
    props.setProperty('RESUME_FOLDER_ID', fid);
  }
  var name = a['Applicant ID'] + ' - ' + (a['First Name'] + ' ' + a['Last Name']).trim() + ' - resume.' + ext;
  // multipart upload: the file's details, then its bytes
  var boundary = 'cwresume' + Date.now();
  var meta = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name: name, parents: [fid] }) + '\r\n--' + boundary + '\r\nContent-Type: ' + file.type + '\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: meta.concat(bytes, tail),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Could not save the resume to Drive (' + res.getResponseCode() + '): ' + driveReason_(res));
  var f = JSON.parse(res.getContentText());
  // anyone at Club Wealth with the link can view it; stays private if the domain does not allow that
  try { driveApi_('post', 'files/' + f.id + '/permissions', { type: 'domain', domain: 'clubwealth.com', role: 'reader', allowFileDiscovery: false }); } catch (e) { /* private */ }
  return f.webViewLink || 'https://drive.google.com/file/d/' + f.id + '/view';
}

/**
 * Small Drive v3 REST call with the script's own token. Uses only the drive.file permission (files the script
 * created), which DriveApp cannot do: DriveApp needs full Drive access even to create a folder.
 * GET returns null when the file is not found or not visible.
 */
/** Google's own reason from a failed Drive call (e.g. "Google Drive API has not been used in project … or it is disabled"). */
function driveReason_(res) {
  try { return String(JSON.parse(res.getContentText()).error.message).slice(0, 200); } catch (e) { return 'no details'; }
}

function driveApi_(method, path, body) {
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/' + path, {
    method: method, contentType: 'application/json', payload: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (method === 'get' && code === 404) return null;
  if (code >= 300) throw new Error('Drive returned ' + code + ': ' + driveReason_(res));
  var o = JSON.parse(res.getContentText() || '{}');
  return method === 'get' && o.trashed ? null : o;
}

/**
 * Screens one new applicant and, if they pass, queues their invite for the session interviewDateFor gives
 * (Wednesday 12 PM PT cut-off): an email for form applicants, an OLJ message for OLJ applicants. A held-back
 * applicant keeps Stage Applied with the reason in "Invite Hold", shown on the site. Nothing is queued while
 * AUTO_INVITES is OFF.
 */
function screenAndInvite_(st, apps, a) {
  if (st.get('MODE') === 'LIVE' && st.get('AUTO_INVITES') === 'OFF') return null;
  var rejected = doNotInvite_(st, a);
  if (rejected) {
    // Miguel, 2026-10-29: emails on the Rejected tab go straight to Banned; they are never invited.
    update_(apps, a, { 'Invite Hold': rejected });
    if (a.Stage !== 'Banned') setStage_(apps, a, 'Banned', 'System', rejected);
    return null;
  }
  var hold = inviteHoldReason(a) || sameEmailInvited_(a);
  if (hold) {
    update_(apps, a, { 'Invite Hold': hold });
    return null;
  }
  var session = interviewDateFor(new Date());
  update_(apps, a, { 'Interview Date': session, 'Invite Hold': '' });
  if (a.Source === 'OLJ') {
    return append_(table_(SH.OUTBOX), {
      'Email ID': id_('E'), 'Applicant ID': a['Applicant ID'], Type: 'OLJ Invite', To: 'OLJ:' + a['Source Ref'],
      Subject: '(OnlineJobs.ph message)', Body: '', 'Interview Date': session, 'Queued At': nowStr_(), Status: 'Queued',
      'Queued By': 'System (screened)'
    });
  }
  return queueInvite_(st, a, session, 'Invite');
}

/**
 * Catches the same person applying twice (form and OLJ, or two forms): another applicant row with the same email,
 * or the same first and last name, already has an invite queued or sent for a session that has not passed.
 */
function sameEmailInvited_(a) {
  var e = String(a.Email || '').trim().toLowerCase();
  // first given name + surname, so "Maria A. Santos" on OLJ matches "Maria Santos" on the form
  var key = function (r) {
    var f = normName(r['First Name']).split(' ')[0], l = normName(r['Last Name']).split(' ').pop();
    return f && l ? f + ' ' + l : '';
  };
  var name = key(a);
  var today = todayPT(new Date());
  var invitedIds = {};
  table_(SH.OUTBOX).rows.forEach(function (x) {
    if (['Invite', 'Re-invite', 'OLJ Invite'].indexOf(x.Type) !== -1 && (x.Status === 'Queued' || x.Status === 'Sent') &&
        ymdOf_(x['Interview Date']) >= today) invitedIds[x['Applicant ID']] = String(x.To).trim().toLowerCase();
  });
  var hit = table_(SH.APPLICANTS).rows.filter(function (b) {
    if (b['Applicant ID'] === a['Applicant ID'] || !(b['Applicant ID'] in invitedIds)) return false;
    var be = String(b.Email || '').trim().toLowerCase();
    return (e && (be === e || invitedIds[b['Applicant ID']] === e)) ||
      (!!name && key(b) === name);
  })[0];
  return hit ? 'Already invited as ' + hit['Applicant ID'] + ' (same person)' : '';
}

function pendingInvite_(applicantId) {
  return table_(SH.OUTBOX).rows.some(function (e) {
    return e['Applicant ID'] === applicantId && (e.Type === 'Invite' || e.Type === 'Re-invite' || e.Type === 'OLJ Invite') &&
      (e.Status === 'Queued' || e.Status === 'Sent');
  });
}

// ---------- 5. Zoom attendance (recorded by the Claude routine) ----------

/**
 * The routine writes one row per strict "Name_Position" participant with Total Minutes for the day,
 * then sets Settings ZOOM_FINALIZE = that date. Matching and stage results happen here.
 */
function processZoom_(st) {
  var z = table_(SH.ZOOM);
  var apps = table_(SH.APPLICANTS);
  var n = 0;
  var byId = indexBy_(apps.rows, 'Applicant ID');
  // While the session is being tracked, an unmatched Zoom name is tried again every check (Miguel, 2026-11-11);
  // it becomes "Not an invitee" only when the session is finalized.
  var liveDay = st.get('ZOOM_TRACKING_FOR');
  var tracking = !!liveDay && st.get('ZOOM_TRACKING_DONE') !== liveDay;
  z.rows.forEach(function (r) {
    var day = ymdOf_(r['Interview Date']);
    var liveRow = tracking && day === liveDay;
    // Live during the session: matched rows are rewritten every few minutes, so keep the applicant's minutes so far current.
    if (r['Matched Applicant ID'] && !r.Result) {
      var ma = byId[r['Matched Applicant ID']];
      if (liveRow && ma && !nameMatches(r['Parsed Name'], ma['First Name'], ma['Last Name'])) {
        // matched by the older, looser rule: undo and match again
        update_(z, r, { 'Matched Applicant ID': '' });
        if (PRE_INTERVIEW.indexOf(ma.Stage) !== -1) update_(apps, ma, { 'Zoom Minutes': '', Arrival: '', 'Minutes Early': '' });
      } else {
        if (liveZoom_(apps, ma, r)) n++;
        return;
      }
    }
    if (r['Matched Applicant ID'] || (r.Result && !(liveRow && r.Result === 'Not an invitee'))) return;
    var cands = apps.rows.filter(function (a) {
      return ymdOf_(a['Interview Date']) === day && PRE_INTERVIEW.indexOf(a.Stage) !== -1 &&
        nameMatches(r['Parsed Name'], a['First Name'], a['Last Name']);
    });
    if (cands.length > 1) {
      var pos = standardPosition(r['Parsed Position'], positionOverrides_());
      var tie = cands.filter(function (a) { return a.Position === pos; });
      if (tie.length === 1) cands = tie;
    }
    if (cands.length === 1) {
      update_(z, r, { 'Matched Applicant ID': cands[0]['Applicant ID'], Result: '' });
      liveZoom_(apps, cands[0], r);
    } else if (liveRow && !cands.length) {
      if (r.Result) update_(z, r, { Result: '' }); // not matched yet: try again next check
      return;
    } else {
      update_(z, r, { Result: cands.length ? 'Ambiguous' : 'Not an invitee' });
      if (cands.length) flag_('', 'Zoom name matches several applicants', r['Zoom Display Name'] + ' on ' + day);
    }
    n++;
  });

  var fin = st.get('ZOOM_FINALIZE');
  if (fin && fin !== st.get('ZOOM_FINALIZED_LAST')) {
    var minMin = Number(st.get('MIN_MINUTES_COMPLETED')) || 60;
    var minutes = {};
    z.rows.forEach(function (r) {
      if (ymdOf_(r['Interview Date']) === fin && r['Matched Applicant ID']) {
        minutes[r['Matched Applicant ID']] = (minutes[r['Matched Applicant ID']] || 0) + (Number(r['Total Minutes']) || 0);
      }
    });
    var counts = { completed: 0, dnc: 0, noshow: 0, noconf: 0, min: minMin };
    apps.rows.forEach(function (a) {
      if (ymdOf_(a['Interview Date']) !== fin || PRE_INTERVIEW.indexOf(a.Stage) === -1) return;
      var m = minutes[a['Applicant ID']];
      if (m === undefined && onHold(a)) return; // told the position is on hold: not a no-show
      // Not seen in Zoom: No Show only for people who confirmed; invited but never confirmed is No Confirmation.
      var res = m !== undefined ? zoomResult(m, minMin) : a.Stage === 'Confirmed' ? 'No Show' : 'No Confirmation';
      if (m !== undefined) update_(apps, a, { 'Zoom Minutes': Math.round(m) });
      setStage_(apps, a, res, 'System', m === undefined ? 'Not seen in Zoom' : Math.round(m) + ' minutes in Zoom');
      if (!isTest_(a)) counts[{ 'No Show': 'noshow', 'No Confirmation': 'noconf', 'Did Not Complete': 'dnc' }[res] || 'completed']++;
    });
    z.rows.forEach(function (r) {
      if (ymdOf_(r['Interview Date']) === fin && r['Matched Applicant ID'] && !r.Result) {
        update_(z, r, { Result: zoomResult(minutes[r['Matched Applicant ID']] || 0, minMin) });
      }
    });
    st.set('ZOOM_FINALIZED_LAST', fin);
    log_('zoomFinalize', 'ok', counts, fin);
    slack_(slackSessionResults(fin, counts, siteUrl_()));
  }
  return n;
}

/**
 * Copies one matched Zoom row onto its applicant while they are still Invited or Confirmed: arrival (early/late
 * against the 2 PM start; the invite asks for 10 minutes early) and minutes so far. Final stages are set at ZOOM_FINALIZE.
 * Returns true when something changed.
 */
var lateArrivals_ = [];

/** Test applicants (Source "Test", e.g. T-MIGUEL) stay in the CRM but are never counted or alerted. */
function isTest_(a) {
  return !!a && a.Source === 'Test';
}

function liveZoom_(apps, a, r) {
  if (!a || PRE_INTERVIEW.indexOf(a.Stage) === -1) return false;
  var f = {};
  if (r.Arrival && !a.Arrival && Number(r['Minutes Early']) < 0 && !isTest_(a)) {
    lateArrivals_.push({ name: (a['First Name'] + ' ' + a['Last Name']).trim(), minutesLate: -Number(r['Minutes Early']) });
  }
  var mins = Math.round(Number(r['Total Minutes']) || 0);
  if (mins && String(a['Zoom Minutes']) !== String(mins)) f['Zoom Minutes'] = mins;
  if (r.Arrival && apps.headers.indexOf('Arrival') !== -1 && String(a.Arrival) !== String(r.Arrival)) {
    f.Arrival = r.Arrival;
    f['Minutes Early'] = r['Minutes Early'];
  }
  if (!Object.keys(f).length) return false;
  update_(apps, a, f);
  return true;
}

// ---------- 6. Wednesday reminders ----------

function queueReminders_(st) {
  var p = ptParts(new Date());
  var today = todayPT();
  if (p.dow !== 3 || p.hh < 6 || p.hh >= 14 || st.get('REMINDERS_QUEUED_FOR') === today) return 0;
  var apps = table_(SH.APPLICANTS);
  var n = 0;
  apps.rows.forEach(function (a) {
    // OLJ applicants get their reminder as an OLJ message (routines/olj_confirm.js), never by email.
    if (a.Stage === 'Confirmed' && a.Source !== 'OLJ' && ymdOf_(a['Interview Date']) === today && !a['Reminder Sent At'] && !onHold(a)) {
      queueEmail_(st, a, 'Reminder', reminderEmail(today), today);
      n++;
    }
  });
  st.set('REMINDERS_QUEUED_FOR', today);
  return n;
}

// ---------- Slack DMs to Am and Camille (Zapier) ----------

/**
 * Posts one short message to the Zapier "recruiting-pipeline-slack-alerts" hook, which DMs Am and Camille.
 * Script Property SLACK_HOOK holds the hook URL; without it nothing is sent. Settings SLACK_ALERTS = OFF pauses it.
 */
function slack_(text) {
  if (!text) return false;
  var hook = PropertiesService.getScriptProperties().getProperty('SLACK_HOOK');
  if (!hook || settings_().get('SLACK_ALERTS') === 'OFF') return false;
  try {
    var res = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ text: text }) });
    return res.getResponseCode() < 300;
  } catch (err) {
    log_('slack', 'error', '', String(err && err.message || err).slice(0, 200));
    return false;
  }
}

function siteUrl_() {
  return String(PropertiesService.getScriptProperties().getProperty('SITE_URL') || '').replace(/\/$/, '');
}

/**
 * Batched each tick: new Great/Good-fit applicants (by Screened At) and new Needs Attention items (by Created At)
 * since the last message, plus late joiners seen live during a Wednesday session. Starts from "now" the first time,
 * so it never sends a backlog.
 */
function slackAlerts_(st) {
  if (!PropertiesService.getScriptProperties().getProperty('SLACK_HOOK') || st.get('SLACK_ALERTS') === 'OFF') return 0;
  var now = nowStr_();
  // Kept in Script Properties, NOT the Settings tab: Sheets turns "2026-10-28 12:23:30" into a date and settings_()
  // reads dates back as "2026-10-28" (no time), which made every run re-send the same alerts (fixed 2026-10-28).
  var props = PropertiesService.getScriptProperties();
  var since = props.getProperty('SLACK_SINCE_AT');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since || '')) { props.setProperty('SLACK_SINCE_AT', now); return 0; }
  var apps = table_(SH.APPLICANTS).rows;
  var byId = indexBy_(apps, 'Applicant ID');
  var name = function (a) { return a ? (a['First Name'] + ' ' + a['Last Name']).trim() : ''; };
  var good = apps.filter(function (a) {
    return (a['Screen Tag'] === 'Great' || a['Screen Tag'] === 'Good') && a.Historical !== 'Y' && !isTest_(a) && ptStamp_(a['Screened At']) > since;
  }).map(function (a) { return { name: name(a), position: a.Position || a['Position (as typed)'], tag: a['Screen Tag'] }; });
  var flags = table_(SH.FLAGS).rows.filter(function (f) { return f.Status === 'Open' && ptStamp_(f['Created At']) > since && !isTest_(byId[f['Applicant ID']]); })
    .map(function (f) { return { type: f.Type, name: name(byId[f['Applicant ID']]) }; });
  var msgs = [slackNewApplicants(good, siteUrl_()), slackAttention(flags, siteUrl_()), slackLate(lateArrivals_)].filter(Boolean);
  lateArrivals_ = [];
  if (!msgs.length) return 0; // nothing new: no write, so a quiet tick stays quiet
  var sent = msgs.filter(function (m) { return slack_(m); }).length;
  props.setProperty('SLACK_SINCE_AT', now);
  return sent;
}

/** Thursday morning (time trigger from setup): last session's numbers, by source and by position, as one DM. */
function weeklyReport() {
  var apps = table_(SH.APPLICANTS).rows.filter(function (a) { return a.Historical !== 'Y' && !isTest_(a); });
  var today = todayPT();
  var days = apps.map(function (a) { return ymdOf_(a['Interview Date']); }).filter(function (d) { return d && d < today; }).sort();
  if (!days.length) return;
  var day = days[days.length - 1];
  var inv = apps.filter(function (a) { return ymdOf_(a['Interview Date']) === day && a.Stage !== 'Applied'; });
  var done = function (a) { return ['Interview Completed', 'Passed Pre-Interview', 'Passed Interview', 'Hired', 'Onboarding'].indexOf(a.Stage) !== -1; };
  var joined = function (a) { return Number(a['Zoom Minutes']) > 0 || done(a) || a.Stage === 'Did Not Complete' || a.Stage === 'Uninterested | Left Zoom'; };
  var group = function (key) {
    var m = {};
    inv.forEach(function (a) {
      var k = a[key] || 'Other';
      m[k] = m[k] || { label: k === 'OLJ' ? 'OnlineJobs.ph' : k, invited: 0, completed: 0 };
      m[k].invited++;
      if (done(a)) m[k].completed++;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (x, y) { return y.invited - x.invited; });
  };
  slack_(slackWeekly({
    day: day, invited: inv.length, confirmed: inv.filter(function (a) { return a['Confirmed At']; }).length,
    joined: inv.filter(joined).length, completed: inv.filter(done).length,
    bySource: group('Source'), byPosition: group('Position')
  }, siteUrl_()));
}

// ---------- live updates to the site ----------

/**
 * Tells the site its cached copy is out of date, so the next page load reads the sheet.
 * Script Property SITE_URL (e.g. https://cwrecruitmentpipeline.vercel.app); uses the same API_SECRET.
 */
function notifySite_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SITE_URL');
  if (!url) return;
  try {
    UrlFetchApp.fetch(url.replace(/\/$/, '') + '/api/revalidate', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ secret: props.getProperty('API_SECRET') })
    });
  } catch (err) {
    // the site still refreshes within a minute on its own
  }
}

/** Runs the moment a form response is submitted (installable trigger on the form sheet; it only reads it). */
function onFormSubmitIntake() {
  tick();
}

/** Runs when anyone edits the pipeline sheet by hand. */
function onPipelineChange() {
  notifySite_();
}

// ---------- the 5-minute job ----------

function tick() {
  // Each step takes the lock on its own (Tara, 2026-11-10): a save from the site waits for one step (seconds), not
  // the whole run (which can take over a minute when the team sync or Zoom tracking runs).
  var lock = LockService.getScriptLock();
  var st, c = {};
  var steps = [
    ['rename', function () { renameStageOnce_(st, 'Onboarded', 'Onboarding', 'STAGE_RENAMED_ONBOARDING'); return 0; }],
    ['onHold', function () { return onHoldBackfill_(st); }],
    ['relinked', function () { return relinkUnmatched_(st); }],
    ['intake', function () { return importNewFormRows_(st); }],
    ['manualInvites', function () { return syncManualInvites_(st); }],
    ['screenTracks', function () { return backfillScreenTracks_(); }],
    ['emailed', function () { return dispatchEmails_(st); }],
    ['sent', function () { return applySentEmails_(st); }],
    ['replies', function () { return processReplies_(st); }],
    ['olj', function () { return processOLJ_(st); }],
    ['emailApps', function () { return processEmailApps_(st); }],
    ['team', function () { return safeTeamSync_(st); }],
    ['banned', function () { return bannedSweep_(st); }],
    ['zoomTracked', function () { return safeZoomTrack_(st); }],
    ['offboarded', function () { return offboardSync_(st); }],
    ['zoom', function () { return processZoom_(st); }],
    ['reminders', function () { return queueReminders_(st); }],
    ['slack', function () { return slackAlerts_(st); }]
  ];
  try {
    for (var i = 0; i < steps.length; i++) {
      if (!lock.tryLock(30000)) { c.skipped = steps[i][0]; break; } // the rest runs on the next tick
      try {
        st = settings_();
        var v = steps[i][1]();
        if (steps[i][0] !== 'rename') c[steps[i][0]] = v;
      } finally {
        lock.releaseLock();
      }
    }
    if (Object.keys(c).some(function (k) { return c[k]; })) {
      log_('tick', 'ok', c);
      notifySite_();
    }
  } catch (err) {
    log_('tick', 'error', '', String(err && err.message || err));
    throw err;
  }
}

/** Run once from the editor: adds missing tabs/columns and the triggers (every 5 minutes, on form submit, on sheet edit). */
function setup() {
  var ss = ss_();
  var out = sheet_(SH.OUTBOX);
  var oh = out.getRange(1, 1, 1, out.getLastColumn()).getValues()[0];
  if (oh.indexOf('Applied') === -1) { out.getRange(1, oh.length + 1).setValue('Applied').setFontWeight('bold'); oh.push('Applied'); }
  if (oh.indexOf('Queued By') === -1) out.getRange(1, oh.length + 1).setValue('Queued By').setFontWeight('bold');
  ensureCols_(SH.OUTBOX, DECIDED_COLS);
  ensureTab_(SH.TEAM, TEAM_COLS);
  ensureTab_(SH.TEAM_UPDATES, TEAM_UPDATE_COLS);
  var ap = sheet_(SH.APPLICANTS);
  var aph = ap.getRange(1, 1, 1, ap.getLastColumn()).getValues()[0];
  ['Invite Hold', 'Minutes Early', 'Arrival', 'Tags', 'Resume Experience'].forEach(function (h) {
    if (aph.indexOf(h) === -1) { ap.getRange(1, aph.length + 1).setValue(h).setFontWeight('bold'); aph.push(h); }
  });
  var oj = sheet_(SH.OLJ);
  var ojh = oj.getRange(1, 1, 1, oj.getLastColumn()).getValues()[0];
  if (ojh.indexOf('Thread') === -1) oj.getRange(1, ojh.length + 1).setValue('Thread').setFontWeight('bold');
  var zs = sheet_(SH.ZOOM);
  var zh = zs.getRange(1, 1, 1, zs.getLastColumn()).getValues()[0];
  ['Minutes Early', 'Arrival'].forEach(function (h) {
    if (zh.indexOf(h) === -1) { zs.getRange(1, zh.length + 1).setValue(h).setFontWeight('bold'); zh.push(h); }
  });
  if (!ss.getSheetByName(SH.TEST_FORM)) {
    var tf = ss.insertSheet(SH.TEST_FORM);
    var src = SpreadsheetApp.openById(settings_().get('SOURCE_SHEET_ID')).getSheetByName('Form Responses 1');
    var hdr = src.getRange(1, 1, 1, 20).getValues();
    tf.getRange(1, 1, 1, 20).setValues(hdr).setFontWeight('bold');
    tf.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SH.SCORES)) {
    var sc = ss.insertSheet(SH.SCORES);
    sc.getRange(1, 1, 1, 9).setValues([['Applicant ID', 'Scored By', 'Scored At', 'Communication', 'English', 'Experience', 'Internet', 'Average', 'Note']]).setFontWeight('bold');
    sc.setFrozenRows(1);
  }
  scoreColumns_();
  if (!ss.getSheetByName(SH.EMAILAPPS)) {
    var em = ss.insertSheet(SH.EMAILAPPS);
    em.getRange(1, 1, 1, 11).setValues([['Message ID', 'Received At', 'From Email', 'Applicant Name', 'Subject', 'Position (as typed)', 'Summary', 'Referral', 'Applicant ID', 'Processed At', 'Note']]).setFontWeight('bold');
    em.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SH.VIEWS)) {
    var vw = ss.insertSheet(SH.VIEWS);
    vw.getRange(1, 1, 1, 4).setValues([['Name', 'Query', 'Created By', 'Created At']]).setFontWeight('bold');
    vw.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SH.CHAT)) {
    var ch = ss.insertSheet(SH.CHAT);
    ch.getRange(1, 1, 1, 7).setValues([['Chat ID', 'Asked At', 'Asked By', 'Question', 'Status', 'Answer', 'Answered At']]).setFontWeight('bold');
    ch.setFrozenRows(1);
  }
  startTestIntake();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['tick', 'onFormSubmitIntake', 'onPipelineChange', 'weeklyReport'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create(); // 5 min keeps well inside Google's daily trigger-time quota
  ScriptApp.newTrigger('onFormSubmitIntake').forSpreadsheet(settings_().get('SOURCE_SHEET_ID')).onFormSubmit().create();
  ScriptApp.newTrigger('onPipelineChange').forSpreadsheet(ss.getId()).onChange().create();
  // Thursday 9 AM in the script's time zone (set Project Settings > Time zone to America/Los_Angeles).
  ScriptApp.newTrigger('weeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(9).create();
}

// ---------- status emails that need approval (Hired / Rejected / Benched) ----------

var DECIDED_COLS = ['Decided By', 'Decided At'];

/** Adds any missing header cells to a tab (so a new column works before setup() is run again). */
function ensureTab_(name, cols) {
  var ss = ss_();
  if (ss.getSheetByName(name)) return;
  var t = ss.insertSheet(name);
  t.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  t.setFrozenRows(1);
}

function ensureCols_(name, cols) {
  var sh = sheet_(name);
  var h = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  cols.forEach(function (k) { if (h.indexOf(k) === -1) { sh.getRange(1, h.length + 1).setValue(k).setFontWeight('bold'); h.push(k); } });
}

/**
 * After someone moves an applicant on the site: cancel any status email still waiting for approval, and queue the
 * one for the new stage as "Pending approval" (Miguel, 2026-10-29: never sent until Am or Camille approve it).
 * Returns the new email's id, or null. A type already sent (or approved) to this applicant is never queued again.
 */
function statusEmailOnMove_(st, apps, a, stage, by, opts) {
  ensureCols_(SH.OUTBOX, DECIDED_COLS);
  var out = table_(SH.OUTBOX);
  var id = a['Applicant ID'];
  out.rows.forEach(function (e) {
    if (e['Applicant ID'] === id && e.Status === 'Pending approval') {
      update_(out, e, { Status: 'Cancelled', Error: 'Replaced: moved to ' + stage + ' by ' + by, 'Decided By': by, 'Decided At': nowStr_() });
    }
  });
  var type = STATUS_EMAIL_FOR_STAGE[stage];
  if (!type || (opts && opts.noEmail)) return null;
  return queueStatusEmail_(st, out, apps, a, type, by, opts);
}

/** Prepares one status email for approval (Status "Pending approval"). Never twice: not when one was already sent. */
function queueStatusEmail_(st, out, apps, a, type, by, opts) {
  var id = a['Applicant ID'];
  var done = out.rows.filter(function (e) { return e['Applicant ID'] === id && e.Type === type && (e.Status === 'Sent' || e.Status === 'Queued'); })[0];
  if (done) {
    update_(apps, a, { Notes: (a.Notes ? a.Notes + '\n' : '') + nowStr_() + ' System: ' + type + ' email not queued again (already ' + String(done.Status).toLowerCase() + ' ' + ymdOf_(done['Sent At'] || done['Queued At']) + ')' });
    return null;
  }
  var test = st.get('MODE') !== 'LIVE';
  var to = test ? st.get('TEST_EMAIL') : String(a.Email || '').trim();
  if (!to) { flag_(id, 'No email address', type + ' email could not be prepared: no email address.'); return null; }
  var mail = statusEmail(type, a['First Name'], opts || { company: companyFromTags(a.Tags), position: a.Position });
  return append_(out, {
    'Email ID': id_('E'), 'Applicant ID': id, Type: type, To: to, Subject: (test ? '[TEST] ' : '') + mail.subject, Body: mail.body,
    'Interview Date': ymdOf_(a['Interview Date']), 'Queued At': nowStr_(), Status: 'Pending approval', Test: test ? 'Y' : '', 'Queued By': by
  })['Email ID'];
}

/** Approve & send, or Don't send, one status email waiting for approval. */
function decideStatusEmail_(st, req, approve) {
  ensureCols_(SH.OUTBOX, DECIDED_COLS);
  var out = table_(SH.OUTBOX);
  var e = out.rows.filter(function (r) { return r['Email ID'] === req.emailId; })[0];
  if (!e) throw new Error('Email not found.');
  if (e.Status !== 'Pending approval') throw new Error('This email is no longer waiting for approval (it is ' + e.Status + ').');
  if (!approve) {
    update_(out, e, { Status: 'Cancelled', Error: "Don't send: " + req.by, 'Decided By': req.by, 'Decided At': nowStr_() });
    return { cancelled: true, backTo: revertAfterSkip_(e, req.by) };
  }
  if (st.get('EMAIL_SENDING') !== 'ON') throw new Error('Email sending is off (Settings EMAIL_SENDING).');
  // once-only for status emails; a Reply waiting for approval (e.g. a correction) may follow earlier replies
  var twice = e.Type !== 'Reply' && e.Type !== 'Re-invite' && out.rows.some(function (r) {
    return r !== e && r['Applicant ID'] === e['Applicant ID'] && r.Type === e.Type && (r.Status === 'Sent' || r.Status === 'Queued');
  });
  if (twice) throw new Error('A ' + e.Type + ' email was already sent to this applicant.');
  update_(out, e, { Status: 'Queued', 'Decided By': req.by, 'Decided At': nowStr_() });
  return { queued: true };
}

// ---------- Banned (emails on the form sheet's Rejected tab) ----------

/**
 * Every applicant whose email is on the Rejected tab goes to Banned (Miguel, 2026-10-29), once. If the same email is
 * also an Active Team Member, a Needs Attention item asks Recruitment to check.
 */
function bannedSweep_(st) {
  var bad = rejectedEmails_(st);
  if (!Object.keys(bad).length) return 0;
  var apps = table_(SH.APPLICANTS);
  var team = {};
  if (ss_().getSheetByName(SH.TEAM)) table_(SH.TEAM).rows.forEach(function (m) { team[String(m.Email || '').trim().toLowerCase()] = m; });
  var n = 0;
  apps.rows.forEach(function (a) {
    var e = String(a.Email || '').trim().toLowerCase();
    if (!e || !bad[e] || a.Stage === 'Banned' || a.Source === 'Test') return;
    setStage_(apps, a, 'Banned', 'System', 'Email is on the Rejected tab of the form sheet');
    if (team[e]) flag_(a['Applicant ID'], 'Banned team member?', 'Moved to Banned (email on the Rejected tab), but this email is also on the Onboarding sheet (' + (team[e].Company || '') + ', ' + (team[e].Status || 'no status') + '). Please check.');
    n++;
  });
  return n;
}

// ---------- Active Team Members: copy of the Onboarding sheet + edits made on the site ----------

var ONBOARDING_SHEET_ID_DEFAULT = '1cZ8RXgdvQ32CzXQlLMwojNe16cm3jQuwllTWBWaQHqI';
var TEAM_COLS = ['Email', 'Name', 'Company', 'Position', 'Department', 'Status', 'Start Date', 'Days', 'Heard About Us', 'Mobile', 'Facebook', 'Source Tab', 'Synced At', 'Emergency Contact', 'Emergency Mobile'];
var TEAM_UPDATE_COLS = ['Timestamp', 'Email', 'Field', 'Value', 'Action', 'By'];
var TEAM_EDITABLE = ['Department', 'Status', 'Position', 'Notes'];
var TEAM_TABS = { CW: 'Club Wealth', HOMEXA: 'Homexa', PFL: 'Perfect Fit Loans' };
/**
 * Older onboarding sheets (Miguel, 2026-10-29), read only. Only the tabs Miguel linked: the 2025 file's other tabs
 * ("2026", "*2026 Updated") repeat the same people with different statuses, so they are left out.
 */
var TEAM_OLDER_SOURCES = [
  { id: '1-gltrA1qQekPpYik49VL_lgc0PvqkxsipRz4d1l89F4', label: '2025', tabs: { '2025': 'Club Wealth' } },
  { id: '1ql473Qhn0mJHkHrvuINZAkHSRClr3ClYbPkyPzMLJ8g', label: '2023-2024', tabs: { 'Form Responses 1': 'Club Wealth' } }
];

/**
 * Copies the Onboarding sheets (2026, 2025 and 2023-2024; read only, never written) into "Team (Onboarding)", at most once an hour
 * (force = true from the editor). Only the fields the page needs: no address, birthday, ID or payment details. Emergency contact
 * name and mobile were added for the Active Team Members page (Miguel, 2026-11-10).
 */
function syncTeam_(st, force) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('TEAM_SYNC_MS') || 0);
  if (!force && Date.now() - last < 55 * 60000) return 0;
  var fmt = function (v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v == null ? '' : v).trim(); };
  var today = todayPT();
  var byKey = {};
  var sources = [{ id: st.get('ONBOARDING_SHEET_ID') || ONBOARDING_SHEET_ID_DEFAULT, label: '2026', tabs: TEAM_TABS }].concat(TEAM_OLDER_SOURCES);
  sources.forEach(function (s, order) {
    var src = SpreadsheetApp.openById(s.id);
    Object.keys(s.tabs).forEach(function (tab) {
      var sh = src.getSheetByName(tab);
      if (!sh || sh.getLastRow() < 2) return;
      var v = sh.getDataRange().getValues();
      var h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
      var col = function (re) { for (var i = 0; i < h.length; i++) if (re.test(h[i])) return i; return -1; };
      var iRemarks = col(/^(remarks|status)$/) !== -1 ? col(/^(remarks|status)$/) : (/^column \d+$/.test(h[1] || '') ? 1 : -1);
      var iDays = col(/^lenght of stay|^length of stay/) !== -1 ? col(/^lenght of stay|^length of stay/) : (/^column \d+$/.test(h[0] || '') ? 0 : -1);
      var c = { email: col(/^email address$/), name: col(/^first and last name$/), mobile: col(/^mobile number$/), pos: col(/^position hired for$/),
        start: col(/^start date/), heard: col(/^how did you hear/), fb: col(/^facebook profile link$/), company: col(/^company hired for$/),
        ecName: col(/^emergency contact.*name/), ecMobile: col(/^emergency contact.*(mobile|number|phone)/) };
      v.slice(1).forEach(function (r) {
        var email = fmt(r[c.email]).toLowerCase();
        var name = fmt(r[c.name]);
        if (!email && !name) return;
        var pos = fmt(r[c.pos]);
        var start = c.start !== -1 ? fmt(r[c.start]) : '';
        var md = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(start);
        var startYmd = /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10)
          : md ? md[3] + '-' + ('0' + md[1]).slice(-2) + '-' + ('0' + md[2]).slice(-2) : '';
        // Days: the sheet's own count when it has one, else counted from the start date
        var days = iDays !== -1 && fmt(r[iDays]) !== '' ? String(Math.floor(Number(r[iDays]) || 0))
          : (startYmd ? String(Math.round((Date.parse(today) - Date.parse(startYmd)) / 86400000)) : '');
        var status = iRemarks !== -1 ? fmt(r[iRemarks]) : '';
        if (/^term$/i.test(status)) status = 'Terminated';
        var row = [email, name, (c.company !== -1 && fmt(r[c.company])) || s.tabs[tab], pos, departmentOf(pos), status, startYmd || start, days,
          c.heard !== -1 ? fmt(r[c.heard]) : '', c.mobile !== -1 ? fmt(r[c.mobile]) : '', c.fb !== -1 ? fmt(r[c.fb]) : '',
          s.label + (s.label === tab ? '' : ' · ' + tab), nowStr_(),
          c.ecName !== -1 ? fmt(r[c.ecName]) : '', c.ecMobile !== -1 ? fmt(r[c.ecMobile]) : ''];
        // the same person in several sheets or tabs (rehires): keep the most recent start; ties keep the newer sheet
        var key = email || normName(name);
        var prev = byKey[key];
        if (!prev || String(row[6]) > String(prev.row[6]) || (String(row[6]) === String(prev.row[6]) && order < prev.order)) byKey[key] = { row: row, order: order };
      });
    });
  });
  var out = Object.keys(byKey).map(function (k) { return byKey[k].row; })
    .sort(function (a, b) { return String(b[6]).localeCompare(String(a[6])); });
  var ss = ss_();
  var t = ss.getSheetByName(SH.TEAM) || ss.insertSheet(SH.TEAM);
  var oldRows = t.getLastRow();
  t.getRange(1, 1, 1, TEAM_COLS.length).setValues([TEAM_COLS]).setFontWeight('bold');
  if (out.length) t.getRange(2, 1, out.length, TEAM_COLS.length).setValues(out);
  if (oldRows > out.length + 1) {
    var blanks = [];
    for (var i = out.length + 2; i <= oldRows; i++) blanks.push(TEAM_COLS.map(function () { return ''; }));
    t.getRange(out.length + 2, 1, blanks.length, TEAM_COLS.length).setValues(blanks);
  }
  props.setProperty('TEAM_SYNC_MS', String(Date.now()));
  return out.length;
}

/** The hourly team copy must never stop the rest of the 5-minute run (e.g. if the Onboarding sheet is not shared). */
function safeTeamSync_(st) {
  try { return syncTeam_(st); } catch (err) { log_('teamSync', 'error', '', String(err && err.message || err)); return 0; }
}

/** Run from the editor to copy the Onboarding sheet now (otherwise it happens once an hour). */
function syncTeamNow() { return syncTeam_(settings_(), true); }

/**
 * Team list for the site: the Onboarding copy with the site's edits on top (Miguel, 2026-10-29: a site edit wins for
 * that field until someone clicks "Use sheet value"). Each member carries edited = { field: sheet value }.
 */
function teamForSite_() {
  if (!ss_().getSheetByName(SH.TEAM)) return [];
  var upd = {};
  if (ss_().getSheetByName(SH.TEAM_UPDATES)) {
    table_(SH.TEAM_UPDATES).rows.forEach(function (u) {
      var k = String(u.Email).trim().toLowerCase() + '|' + u.Field;
      upd[k] = u; // rows are in time order, so the last one wins
    });
  }
  return plain_(table_(SH.TEAM).rows).filter(function (m) { return m.Email || m.Name; }).map(function (m) {
    m.edited = {};
    m.Notes = '';
    TEAM_EDITABLE.forEach(function (f) {
      var u = upd[String(m.Email).trim().toLowerCase() + '|' + f];
      if (u && u.Action === 'Set') { m.edited[f] = m[f] || ''; m[f] = u.Value; m.editedBy = u.By; }
    });
    m.Active = teamActive(m.Status) ? 'Y' : '';
    return m;
  });
}

// ---------- site API ----------

function doPost(e) {
  var res;
  try {
    var req = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
    if (!secret || req.secret !== secret) throw new Error('unauthorized');
    res = { ok: true, data: api_(req) };
    if (['zoomRows', 'chatAsk', 'chatAnswer'].indexOf(req.action) !== -1) notifySite_();
  } catch (err) {
    var msg = String(err && err.message || err);
    // The 5-minute update or another save was still running (Tara, 2026-11-10): say so plainly; the site retries once.
    if (/lock timeout|another process was holding the lock/i.test(msg)) {
      // nothing was changed yet: safe for the site to try again
      res = { ok: false, busy: true, error: 'The system was busy finishing another update. Nothing was saved. Please try again in a moment.' };
    } else if (/too many times|Service Spreadsheets (failed|timed out)|Service error/i.test(msg)) {
      res = { ok: false, error: 'Google Sheets did not respond in time. Refresh the page to check whether your change was saved before trying again.' };
    } else res = { ok: false, error: msg };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function plain_(rows) {
  return rows.map(function (r) {
    var o = {};
    Object.keys(r).forEach(function (k) {
      if (k === '_row') return;
      o[k] = r[k] instanceof Date ? Utilities.formatDate(r[k], TZ, 'yyyy-MM-dd HH:mm:ss') : r[k];
    });
    return o;
  });
}

var MANUAL_BY = ['Miguel', 'Camille', 'Am'];

var LIST_FIELDS = ['Applicant ID', 'Source', 'Applied At (PT)', 'First Name', 'Last Name', 'Email', 'Position (as typed)',
  'Position', 'Stage', 'Stage Updated At', 'Stage Updated By', 'Interview Date', 'Invite Count', 'Confirmed At',
  'Reminder Sent At', 'Zoom Minutes', 'Historical', 'Screen Track', 'Screen Tag', 'Screen Summary', 'Invite Hold',
  'Minutes Early', 'Arrival', 'Tags'];

/** The few fields sent for applicants from before the system, enough for counts by week, source and stage. */
var OLD_FIELDS = ['Applicant ID', 'Source', 'Applied At (PT)', 'Position', 'Stage', 'Historical'];

/** Adds any scorecard criterion column the Scorecards tab does not have yet (e.g. Work Setup, added 2026-10-28). */
function scoreColumns_() {
  var sh = ss_().getSheetByName(SH.SCORES);
  if (!sh) return;
  var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  SCORE_CRITERIA.forEach(function (k) {
    if (hdr.indexOf(k) === -1) { sh.getRange(1, hdr.length + 1).setValue(k).setFontWeight('bold'); hdr.push(k); }
  });
}

/** Rows of a tab that may not exist yet (before setup is run again): [] instead of an error. */
function optionalRows_(name) {
  return ss_().getSheetByName(name) ? plain_(table_(name).rows) : [];
}

/** Comma-separated tags, trimmed, de-duplicated, case kept from the first time each was typed. */
function cleanTags_(raw) {
  var seen = {};
  return String(raw || '').split(',').map(function (t) { return t.trim().slice(0, 40); }).filter(function (t) {
    var k = t.toLowerCase();
    if (!t || seen[k]) return false;
    seen[k] = true;
    return true;
  }).slice(0, 12).join(', ');
}

/** True when this address has written to CareersCW (it is in the Replies tab), so the CRM may show or answer its emails. */
function knownSender_(email) {
  if (!email) return false;
  return table_(SH.REPLIES).rows.some(function (r) { return String(r['From Email'] || '').trim().toLowerCase() === email; });
}

/** One applicant's email conversation: what we sent (Outbox) and what they wrote back (Replies), oldest first. */
function thread_(a) {
  var id = a['Applicant ID'];
  var email = String(a.Email || '').trim().toLowerCase();
  var out = plain_(table_(SH.OUTBOX).rows).filter(function (e) {
    var mineE = id ? e['Applicant ID'] === id : (!e['Applicant ID'] && email && String(e.To).trim().toLowerCase() === email);
    return mineE && e.Type !== 'OLJ Invite' && e.Type !== 'OLJ Message' && e.Test !== 'Y' && (e.Status === 'Sent' || e.Status === 'Queued');
  }).map(function (e) {
    return { dir: 'out', at: e['Sent At'] || e['Queued At'], type: e.Type, subject: e.Subject, status: e.Status, by: e['Queued By'] || 'System',
      text: e.Type === 'Reply' ? stripTags_(e.Body) : '' };
  });
  var inn = plain_(table_(SH.REPLIES).rows).filter(function (r) {
    return (id && r['Matched Applicant ID'] === id) || (email && String(r['From Email']).trim().toLowerCase() === email);
  }).map(function (r) {
    return { dir: 'in', at: r['Received At'], subject: r.Subject, text: stripQuoted(r['Reply Text']).slice(0, 2000), category: r.Category };
  });
  if (ss_().getSheetByName(SH.EMAILAPPS) && email) {
    plain_(table_(SH.EMAILAPPS).rows).forEach(function (r) {
      if (String(r['From Email']).trim().toLowerCase() !== email) return;
      inn.push({ dir: 'in', at: r['Received At'], subject: r.Subject, type: 'Application', text: 'Application email: ' + String(r.Summary || '').slice(0, 1500) });
    });
  }
  return out.concat(inn, oljThread_(a)).sort(function (x, y) { return String(x.at).localeCompare(String(y.at)); });
}

/**
 * OnlineJobs.ph conversation for an OLJ applicant: the messages the OLJ reader saved (OLJ tab "Thread", JSON, only
 * for conversations already read on OLJ; it never opens unread ones), plus CRM answers still waiting to be sent.
 */
function oljThread_(a) {
  if (a.Source !== 'OLJ') return [];
  var row = table_(SH.OLJ).rows.filter(function (o) { return o['Applicant ID'] === a['Applicant ID'] || o['Conversation Key'] === a['Source Ref']; })[0];
  var saved = [];
  try { saved = row && row.Thread ? JSON.parse(row.Thread) : []; } catch (err) { saved = []; }
  var items = saved.map(function (m) {
    return { dir: m.from === 'us' ? 'out' : 'in', channel: 'OLJ', at: ptStamp_(m.at), text: String(m.text || '').slice(0, 2000) };
  });
  if (row && /^Unread on OLJ/.test(String(row.Summary))) {
    items.push({ dir: 'in', channel: 'OLJ', at: ptStamp_(row['Last Message At']), text: '', note: 'Unread on OLJ (not opened by the CRM, so it stays unread for you). Open OLJ to read it.' });
  }
  plain_(table_(SH.OUTBOX).rows).forEach(function (e) {
    if (e['Applicant ID'] !== a['Applicant ID'] || e.Status !== 'Queued') return;
    if (e.Type === 'OLJ Message') items.push({ dir: 'out', channel: 'OLJ', at: e['Queued At'], text: e.Body, status: 'Queued', by: e['Queued By'] });
    if (e.Type === 'OLJ Invite') items.push({ dir: 'out', channel: 'OLJ', at: e['Queued At'], type: 'OLJ Invite', text: 'Pre-interview invite (OLJ)', status: 'Queued', by: e['Queued By'] });
  });
  return items;
}

function stripTags_(html) {
  var s = String(html || '');
  var i = s.indexOf('<p>Cheers,');
  if (i !== -1) s = s.slice(0, i);
  return s.replace(/<br\s*\/?>/g, '\n').replace(/<\/p>\s*<p>/g, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}

// ---------- site inbox (Dashboard > OLJ Inbox / Email Inbox) ----------

/**
 * Conversations for the inbox panel, newest first: who wrote, their last message and whether it still needs an answer.
 * Email: CareersCW replies (Replies tab), matched or not. OLJ: conversations the OLJ reader saved (it never opens unread
 * ones). Test rows are left out. Read only.
 */
function inbox_(channel) {
  var apps = indexBy_(table_(SH.APPLICANTS).rows, 'Applicant ID');
  var out = table_(SH.OUTBOX).rows;
  var who = function (a) {
    return a ? { id: a['Applicant ID'], name: (String(a['First Name'] || '') + ' ' + String(a['Last Name'] || '')).trim(), position: a.Position || '',
      stage: a.Stage || '', session: ymdOf_(a['Interview Date']), source: a.Source || '', email: a.Email || '' } : null;
  };
  var convs = {};
  if (channel === 'olj') {
    table_(SH.OLJ).rows.forEach(function (o) {
      var a = apps[o['Applicant ID']];
      if (a && a.Source === 'Test') return;
      var msgs = [];
      try { msgs = o.Thread ? JSON.parse(o.Thread) : []; } catch (err) { msgs = []; }
      var last = msgs[msgs.length - 1];
      var unread = /^Unread on OLJ/.test(String(o.Summary));
      convs[o['Conversation Key']] = {
        key: o['Conversation Key'], applicant: who(a), name: a ? '' : String(o['Applicant Name'] || ''),
        at: ptStamp_(last ? last.at : o['Last Message At']) || ptStamp_(o['Last Message At']),
        last: unread ? 'Unread on OLJ' : last ? String(last.text || '').slice(0, 140) : String(o.Summary || '').slice(0, 140),
        needsReply: unread || !!(last && last.from !== 'us')
      };
    });
    out.forEach(function (e) {
      var c = e.Type === 'OLJ Message' && convs[String(e.To || '').replace(/^OLJ:/, '')];
      if (c && (e.Status === 'Queued' || e.Status === 'Sent') && String(e['Queued At']) >= c.at) c.needsReply = false;
    });
  } else {
    // Replies that matched no applicant (e.g. they wrote after their stage changed) still belong to the applicant
    // with that email: the newest one, preferring applicants from after the system started.
    var byEmail = {};
    Object.keys(apps).forEach(function (k) {
      var a = apps[k], e = String(a.Email || '').trim().toLowerCase(), b = e && byEmail[e];
      if (!e) return;
      if (!b || (b.Historical === 'Y' && a.Historical !== 'Y') || ((b.Historical === 'Y') === (a.Historical === 'Y') && String(a['Applied At (PT)']) > String(b['Applied At (PT)']))) byEmail[e] = a;
    });
    table_(SH.REPLIES).rows.forEach(function (r) {
      var a = apps[r['Matched Applicant ID']] || byEmail[String(r['From Email'] || '').trim().toLowerCase()];
      if (a && a.Source === 'Test' && String(a.Email).toLowerCase() !== 'techteam@clubwealth.com') return;
      var email = String(r['From Email'] || '').trim().toLowerCase();
      var k = a ? a['Applicant ID'] : email;
      var at = ptStamp_(r['Received At']);
      var c = convs[k];
      if (c && c.at >= at) return;
      convs[k] = { key: k, applicant: who(a), email: email, at: at, subject: r.Subject || '', last: stripQuoted(r['Reply Text']).slice(0, 140), needsReply: true };
    });
    out.forEach(function (e) {
      if (e.Type !== 'Reply' || (e.Status !== 'Sent' && e.Status !== 'Queued')) return;
      var c = convs[e['Applicant ID']] || convs[String(e.To || '').trim().toLowerCase()];
      if (c && String(e['Sent At'] || e['Queued At']) >= c.at) c.needsReply = false;
    });
  }
  var list = Object.keys(convs).map(function (k) { return convs[k]; });
  list.sort(function (x, y) { return String(y.at).localeCompare(String(x.at)); });
  return { conversations: list.slice(0, 300) };
}

// ---------- chat bubble (answers come from a Claude routine, read-only) ----------

function chatRow_(t, id) {
  return t.rows.filter(function (r) { return r['Chat ID'] === id; })[0];
}

function chatGet_(id) {
  var r = chatRow_(table_(SH.CHAT), id);
  if (!r) return { found: false };
  return { found: true, status: r.Status, question: r.Question, answer: r.Answer || '', askedBy: r['Asked By'] };
}

function chatAnswer_(id, answer) {
  var t = table_(SH.CHAT);
  var r = chatRow_(t, id);
  if (!r) throw new Error('not found');
  if (r.Status !== 'Pending') throw new Error('already answered');
  update_(t, r, { Status: 'Answered', Answer: String(answer || '').slice(0, 5000), 'Answered At': nowStr_() });
  return { ok: true };
}

/** Backup path for the Zoom routine when it has no Sheets connector: {rows: [...], finalize: 'YYYY-MM-DD'}. */
function zoomRowsApi_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var z = table_(SH.ZOOM);
    var cols = ['Interview Date', 'Zoom Display Name', 'Parsed Name', 'Parsed Position', 'Total Minutes', 'First Join', 'Last Leave', 'Segments'];
    if (z.headers.indexOf('Arrival') !== -1) cols.push('Minutes Early', 'Arrival');
    (req.rows || []).slice(0, 500).forEach(function (r) {
      var o = {};
      cols.forEach(function (c) { o[c] = r[c] !== undefined ? r[c] : ''; });
      o['Recorded At'] = nowStr_();
      append_(z, o);
    });
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.finalize || ''))) settings_().set('ZOOM_FINALIZE', req.finalize);
    return { added: (req.rows || []).length };
  } finally {
    lock.releaseLock();
  }
}

function api_(req) {
  if (req.action === 'data') {
    // By default the ~2,000 applicants invited by hand before the system are sent as a few small fields only
    // (enough for counts), and their history and old emails are left out, so the site loads fast.
    // withHistory sends everything (the "Include applicants from before the system" box).
    var st = settings_();
    var all = !!req.withHistory;
    var rows = table_(SH.APPLICANTS).rows;
    var old = {};
    if (!all) rows.forEach(function (a) { if (a.Historical === 'Y') old[a['Applicant ID']] = true; });
    var mine = function (r) { return !old[r['Applicant ID']]; };
    var pick = function (a, fields) {
      var o = {};
      fields.forEach(function (k) { if (a[k] !== '' && a[k] !== undefined) o[k] = a[k]; });
      return o;
    };
    if (req.slim) rows = rows.map(function (a) {
      var o = pick(a, old[a['Applicant ID']] ? OLD_FIELDS : LIST_FIELDS);
      // Home's "Needs you today": only the form-vs-resume warning line, not the whole resume summary
      var warn = String(a['Resume Experience'] || '').split('\n').filter(function (l) { return l.indexOf('\u26a0') === 0; })[0];
      if (warn && !old[a['Applicant ID']]) o['Resume Warning'] = warn.replace(/^\u26a0\s*/, '');
      return o;
    });
    return {
      applicants: plain_(rows),
      history: plain_(table_(SH.HISTORY).rows.filter(mine)),
      flags: plain_(table_(SH.FLAGS).rows),
      zoom: plain_(table_(SH.ZOOM).rows.filter(function (z) { return !old[z['Matched Applicant ID']]; })),
      outbox: plain_(table_(SH.OUTBOX).rows.filter(mine)).map(function (e) { if (e.Status !== 'Pending approval') delete e.Body; return e; }),
      team: teamForSite_(),
      scores: optionalRows_(SH.SCORES),
      views: optionalRows_(SH.VIEWS),
      withHistory: all,
      mode: st.get('MODE'),
      emailSending: st.get('EMAIL_SENDING'),
      cancelledSessions: Object.keys(CANCELLED_SESSIONS).sort(),
      zoomTracking: zoomTrackingStatus_(st),
      autoInvites: st.get('AUTO_INVITES') === 'OFF' ? 'OFF' : 'ON',
      jobAds: jobAds_(),
      emailTemplates: optionalRows_(SH.TEMPLATES)
    };
  }
  if (req.action === 'applicant') {
    // Jump straight to the one row (column A holds the Applicant ID) instead of reading every applicant.
    var sh = sheet_(SH.APPLICANTS);
    var hit = sh.getRange('A:A').createTextFinder(String(req.id || '')).matchEntireCell(true).findNext();
    if (!hit) return { applicant: null };
    var lastCol = sh.getLastColumn();
    var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var vals = sh.getRange(hit.getRow(), 1, 1, lastCol).getValues()[0];
    var o = { _row: hit.getRow() };
    hdr.forEach(function (h, j) { if (h) o[h] = vals[j]; });
    var out = plain_([o])[0];
    out['Do Not Invite'] = doNotInvite_(settings_(), o);
    return {
      applicant: out, thread: thread_(o),
      scores: optionalRows_(SH.SCORES).filter(function (s) { return s['Applicant ID'] === out['Applicant ID']; })
    };
  }
  if (req.action === 'inbox') return inbox_(req.channel === 'olj' ? 'olj' : 'email');
  if (req.action === 'emailThread') {
    // Needs Attention: the emails from an address no applicant matched, and our replies to it
    var em = String(req.email || '').trim().toLowerCase();
    if (!knownSender_(em)) return { thread: [] };
    return { thread: thread_({ 'Applicant ID': '', Email: em, Source: '' }) };
  }
  if (req.action === 'zoomRows') return zoomRowsApi_(req);
  if (req.action === 'chatGet') return chatGet_(req.id);
  if (req.action === 'chatAnswer') return chatAnswer_(req.id, req.answer);
  if (MANUAL_BY.indexOf(req.by) === -1) throw new Error('unknown user');
  if (req.action === 'preview') return preview_(req);
  if (req.action === 'presence') return presence_(req);
  if (req.action === 'zoomTrackingStatus') return zoomTrackingStatus_(settings_());
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var st2 = settings_();
    var apps = table_(SH.APPLICANTS);
    var byId = indexBy_(apps.rows, 'Applicant ID');
    if (req.action === 'setStage') {
      if (STAGES.indexOf(req.stage) === -1) throw new Error('bad stage');
      if (['Did Not Complete', 'Open for re-invite'].indexOf(req.stage) !== -1 && !req.reason) {
        throw new Error('A reason is required for ' + req.stage);
      }
      // Hired / Onboarding (Miguel, 2026-11-05): pick the company (tag "Hired | Homexa" or "Hired | Clubwealth") and the
      // start date; the Welcome & Onboarding email of that company is prepared for approval.
      var hiring = req.stage === 'Hired' || req.stage === 'Onboarding';
      // Not Fit (Miguel, 2026-11-05): why, from three choices. Only "General not fit" (Tara, Ron or Maggie decided)
      // prepares the Rejected email for approval; bad internet and device requirements get no email.
      var notFit = req.stage === 'Not Fit' ? NOT_FIT_TYPES[req.notFitType] : null;
      if (req.stage === 'Not Fit' && !notFit) throw new Error('Pick why: Bad internet, Did not meet device requirements, or General not fit.');
      if (notFit) req.reason = notFit.label + (req.reason && req.reason !== notFit.label ? ' - ' + req.reason : '');
      if (hiring) {
        if (!HIRED_TAGS[req.company]) throw new Error('Pick Hired | Homexa or Hired | Clubwealth.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.startDate || ''))) throw new Error('Pick the start date for the onboarding email.');
      }
      var done = 0;
      var undo = { moves: [], queued: [] }; // what "Undo" needs to put back (see undoStage)
      (req.ids || []).forEach(function (id) {
        var a = byId[id];
        // already Hired: allowed again only to set or change the company (board: "Hired | company not set" → a company)
        if (!a || (a.Stage === req.stage && !(hiring && companyFromTags(a.Tags) !== req.company))) return;
        undo.moves.push({ id: id, from: a.Stage, decision: String(a['Decision Reason'] || ''), reinvite: String(a['Re-invite Reason'] || ''), tags: String(a.Tags || '') });
        setStage_(apps, a, req.stage, req.by, hiring ? (req.reason ? req.reason + ' · ' : '') + HIRED_TAGS[req.company] + ', starts ' + req.startDate : req.reason);
        if (hiring) {
          var keep = String(a.Tags || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x && x.indexOf('Hired |') !== 0; });
          keep.push(HIRED_TAGS[req.company]);
          update_(apps, a, { Tags: keep.join(', ') });
        }
        var pending = statusEmailOnMove_(st2, apps, a, req.stage, req.by, hiring ? { company: req.company, startDate: req.startDate, position: a.Position } : notFit && !notFit.email ? { noEmail: true } : null);
        if (pending) undo.queued.push(pending);
        if (req.stage === 'Not Fit' || req.stage === 'Did Not Complete') update_(apps, a, { 'Decision Reason': req.reason });
        if (req.stage === 'Open for re-invite') {
          update_(apps, a, { 'Re-invite Reason': req.reason });
          var next = a['Interview Date'] ? reinviteDateFor(ymdOf_(a['Interview Date'])) : interviewDateFor(new Date());
          var q = queueInvite_(st2, a, next, 'Re-invite');
          if (q) undo.queued.push(q['Email ID']);
        }
        done++;
      });
      return { updated: done, undo: undo };
    }
    if (req.action === 'undoStage') {
      // Puts each applicant back in the stage they had, restores the reasons, and cancels any email the move
      // queued that has not gone out yet. Only moves that are still as they were are undone.
      var outU = table_(SH.OUTBOX);
      var cancelled = 0, alreadySent = 0;
      (req.queued || []).forEach(function (eid) {
        var e = outU.rows.filter(function (r) { return r['Email ID'] === eid; })[0];
        if (!e) return;
        if (e.Status === 'Queued' || e.Status === 'Pending approval') { update_(outU, e, { Status: 'Cancelled', Error: 'Undone by ' + req.by }); cancelled++; }
        else if (e.Status === 'Sent') alreadySent++;
      });
      var back = 0;
      (req.moves || []).forEach(function (m) {
        var a = byId[m.id];
        if (!a || STAGES.indexOf(m.from) === -1) return;
        if (a.Stage === m.from && !(typeof m.tags === 'string' && String(a.Tags || '') !== m.tags)) return;
        if (a.Stage !== m.from) setStage_(apps, a, m.from, req.by, 'Undo');
        statusEmailOnMove_(st2, apps, a, '(undo)', req.by); // cancels anything still waiting; an undo never queues a new email
        var f = {};
        if (String(a['Decision Reason'] || '') !== String(m.decision || '')) f['Decision Reason'] = m.decision || '';
        if (String(a['Re-invite Reason'] || '') !== String(m.reinvite || '')) f['Re-invite Reason'] = m.reinvite || '';
        if (typeof m.tags === 'string' && String(a.Tags || '') !== m.tags) f.Tags = m.tags;
        if (Object.keys(f).length) update_(apps, a, f);
        back++;
      });
      return { undone: back, cancelledEmails: cancelled, alreadySent: alreadySent };
    }
    if (req.action === 'addNote') {
      var a1 = byId[req.id];
      if (!a1) throw new Error('not found');
      var line = nowStr_() + ' ' + req.by + ': ' + String(req.note || '').slice(0, 1000);
      update_(apps, a1, { Notes: a1.Notes ? a1.Notes + '\n' + line : line });
      return { ok: true, line: line };
    }
    if (req.action === 'undoNote') {
      var an = byId[req.id];
      if (!an) throw new Error('not found');
      var lines = String(an.Notes || '').split('\n');
      var idx = lines.lastIndexOf(String(req.line || ''));
      if (idx === -1) return { removed: false };
      lines.splice(idx, 1);
      update_(apps, an, { Notes: lines.join('\n') });
      return { removed: true };
    }
    if (req.action === 'setEmail') {
      var a2 = byId[req.id];
      var email = String(req.email || '').trim().toLowerCase();
      if (!a2) throw new Error('not found');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('invalid email');
      update_(apps, a2, { Email: email });
      if (a2.Stage === 'Applied' && !(Number(a2['Invite Count']) > 0) && !pendingInvite_(a2['Applicant ID'])) {
        screenAndInvite_(st2, apps, a2);
      }
      return { ok: true };
    }
    if (req.action === 'addApplicant') {
      // Added by hand from the Candidates page, for referrals (no form, OLJ or email application).
      var first = String(req.firstName || '').trim().slice(0, 100), last = String(req.lastName || '').trim().slice(0, 100);
      var mail = String(req.email || '').trim().toLowerCase();
      var typed = String(req.position || '').trim().slice(0, 200);
      var refBy = String(req.referredBy || '').trim().slice(0, 100);
      if (!first || !last) throw new Error('First and last name are required.');
      if (!typed) throw new Error('Pick a position.');
      if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error('That email address does not look right.');
      var resumeLink = String(req.resumeLink || '').trim();
      if (resumeLink && !/^https?:\/\/\S+$/.test(resumeLink)) throw new Error('The resume link must start with http:// or https://');
      if (req.resume && req.resume.data) checkResume_(req.resume);
      var nameKey = normName(first + ' ' + last);
      var twin = apps.rows.filter(function (x) {
        return x.Historical !== 'Y' && ((mail && String(x.Email || '').trim().toLowerCase() === mail) ||
          normName(x['First Name'] + ' ' + x['Last Name']) === nameKey);
      })[0];
      if (twin) throw new Error('Already in the CRM as ' + twin['Applicant ID'] + ' (' + (twin['First Name'] + ' ' + twin['Last Name']).trim() + ').');
      var maxR = 0;
      apps.rows.forEach(function (x) { var m = /^R-(\d+)$/.exec(String(x['Applicant ID'])); if (m) maxR = Math.max(maxR, Number(m[1])); });
      var newId = 'R-' + (maxR + 1);
      if (req.resume && req.resume.data) resumeLink = saveResume_({ 'Applicant ID': newId, 'First Name': first, 'Last Name': last }, req.resume);
      var noteLine = nowStr_() + ' ' + req.by + ': Added as a referral' + (refBy ? ' from ' + refBy : '') +
        (req.note ? '. ' + String(req.note).slice(0, 1000) : '');
      var added = append_(apps, {
        'Applicant ID': newId, Source: 'Referral', 'Source Ref': refBy ? 'Referred by ' + refBy : 'Referral',
        'Applied At (PT)': nowStr_(), 'First Name': first, 'Last Name': last, Email: mail,
        Phone: String(req.phone || '').trim().slice(0, 40), 'Position (as typed)': typed,
        Position: standardPosition(typed, positionOverrides_()), 'Screen Track': screenTrack(typed) || 'Not screened',
        Stage: 'Applied', 'Stage Updated At': nowStr_(), 'Stage Updated By': req.by, 'Invite Count': 0,
        Tags: 'Referral', Notes: noteLine, 'Resume Link': resumeLink, 'Created At': nowStr_()
      });
      appendTo_(SH.HISTORY, {
        'Timestamp (PT)': nowStr_(), 'Applicant ID': added['Applicant ID'], 'From Stage': '', 'To Stage': 'Applied',
        'Changed By': req.by, Reason: 'Added as a referral' + (refBy ? ' from ' + refBy : '')
      });
      var invited = null;
      if (req.invite && mail) invited = screenAndInvite_(st2, apps, added);
      return { id: added['Applicant ID'], resume: resumeLink, invited: !!invited, session: invited ? ymdOf_(added['Interview Date']) : '', hold: added['Invite Hold'] || '' };
    }
    if (req.action === 'updateApplicant') {
      // "Edit profile" on the candidate page: fix contact details, links and the resume. Each change is noted.
      var ap = byId[req.id];
      if (!ap) throw new Error('not found');
      var ch = req.fields || {}, f2 = {}, said = [];
      Object.keys(ch).forEach(function (k) {
        if (EDITABLE_FIELDS.indexOf(k) === -1) throw new Error('That field cannot be edited: ' + k);
        var v = String(ch[k] == null ? '' : ch[k]).trim().slice(0, k === 'Experience Overview' ? 3000 : 300);
        if (k === 'Email') v = v.toLowerCase();
        if (k === 'Email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('That email address does not look right.');
        if (/ Link$/.test(k) && v && !/^https?:\/\/\S+$/.test(v)) throw new Error(k + ' must start with http:// or https://');
        if ((k === 'First Name' || k === 'Last Name') && !v) throw new Error(k + ' cannot be empty.');
        if (String(ap[k] == null ? '' : ap[k]).trim() === v) return;
        f2[k] = v;
        said.push(k + (k === 'Experience Overview' ? '' : ': ' + (String(ap[k] || '') || 'empty') + ' → ' + (v || 'empty')));
      });
      if (req.resume && req.resume.data) {
        f2['Resume Link'] = saveResume_(ap, req.resume);
        said.push('Resume uploaded');
      }
      if (!said.length) return { updated: 0 };
      if (f2['Position (as typed)'] !== undefined) {
        f2.Position = standardPosition(f2['Position (as typed)'], positionOverrides_());
        f2['Screen Track'] = screenTrack(f2['Position (as typed)']) || 'Not screened';
      }
      f2.Notes = (ap.Notes ? ap.Notes + '\n' : '') + nowStr_() + ' ' + req.by + ': Profile edited (' + said.join('; ').slice(0, 900) + ')';
      update_(apps, ap, f2);
      return { updated: said.length, resume: f2['Resume Link'] || '' };
    }
    if (req.action === 'editPendingEmail') return editPendingEmail_(req);
    if (req.action === 'startZoomTracking') return startZoomTracking_(st2, req);
    if (req.action === 'setAutoInvites') return setAutoInvites_(st2, req);
    if (req.action === 'bulkMessage') return bulkMessage_(st2, byId, req);
    if (req.action === 'setActivePositions') return setActivePositions_(st2, req);
    if (req.action === 'pauseInvites') return pauseInvites_(apps, byId, req);
    if (req.action === 'attachToEmail') return attachToEmail_(req);
    if (req.action === 'saveTemplate' || req.action === 'deleteTemplate') return saveTemplate_(req);
    if (req.action === 'approveEmail') return decideStatusEmail_(st2, req, true);
    if (req.action === 'approveEmails') {
      // Needs Approval bulk send (Miguel, 2026-11-11): each one is checked like a single Approve & send
      var res = { queued: 0, failed: [] };
      (req.emailIds || []).slice(0, 300).forEach(function (eid) {
        try { decideStatusEmail_(st2, { emailId: eid, by: req.by }, true); res.queued++; }
        catch (err) { res.failed.push(eid + ': ' + String(err && err.message || err)); }
      });
      return res;
    }
    if (req.action === 'skipEmail') return decideStatusEmail_(st2, req, false);
    if (req.action === 'updateTeam') {
      var tf = String(req.field || '');
      if (TEAM_EDITABLE.indexOf(tf) === -1) throw new Error('That field cannot be edited.');
      var tm = String(req.email || '').trim().toLowerCase();
      if (!tm || !table_(SH.TEAM).rows.some(function (m) { return String(m.Email).trim().toLowerCase() === tm; })) throw new Error('Team member not found.');
      ensureTab_(SH.TEAM_UPDATES, TEAM_UPDATE_COLS);
      appendTo_(SH.TEAM_UPDATES, { Timestamp: nowStr_(), Email: tm, Field: tf, Value: String(req.value == null ? '' : req.value).trim().slice(0, 500), Action: req.clear ? 'Clear' : 'Set', By: req.by });
      return { ok: true };
    }
    if (req.action === 'sendInvite') {
      var ai = byId[req.id];
      if (!ai) throw new Error('not found');
      var session = interviewDateFor(new Date());
      var outT = table_(SH.OUTBOX);
      var dup = outT.rows.some(function (e) {
        return e['Applicant ID'] === ai['Applicant ID'] && ymdOf_(e['Interview Date']) === session &&
          ['Invite', 'Re-invite', 'OLJ Invite'].indexOf(e.Type) !== -1 && (e.Status === 'Queued' || e.Status === 'Sent');
      });
      if (dup) throw new Error('An invite for Wednesday ' + longDate(session) + ' is already queued or sent.');
      var blockedWhy = doNotInvite_(st2, ai);
      if (blockedWhy) throw new Error('Do not invite: ' + blockedWhy + '.');
      if (invitesPaused(ai)) throw new Error('Invites are paused for this applicant. Click Resume invites on the profile first.');
      if (req.channel === 'email') {
        if (st2.get('EMAIL_SENDING') !== 'ON') throw new Error('Email sending is not connected yet (CareersCW in Zapier). Use OLJ, or invite by hand.');
        if (!ai.Email) throw new Error('This applicant has no email address.');
        queueEmail_(st2, ai, 'Invite', withEdits_(inviteEmail(session, new Date()), req.edited), session, req.by);
      } else if (req.channel === 'olj') {
        if (ai.Source !== 'OLJ' || !ai['Source Ref']) throw new Error('This applicant did not come from OnlineJobs.ph.');
        append_(outT, {
          'Email ID': id_('E'), 'Applicant ID': ai['Applicant ID'], Type: 'OLJ Invite', To: 'OLJ:' + ai['Source Ref'],
          Subject: '(OnlineJobs.ph message)', Body: '', 'Interview Date': session, 'Queued At': nowStr_(), Status: 'Queued',
          'Queued By': req.by
        });
      } else throw new Error('bad channel');
      update_(apps, ai, { 'Interview Date': session });
      return { queued: true, session: session, channel: req.channel };
    }
    if (req.action === 'reinviteNoShows') {
      // "Re-invite no-shows" on This Week's Session (Miguel, 2026-11-01): everyone from one session who is No Show or
      // No Confirmation goes to Open for re-invite on the chosen Wednesday and gets the invite for it (email, or an OLJ
      // invite for OLJ applicants). Works even while AUTO_INVITES is OFF, because a person clicked it.
      var fromDay = String(req.session || '');
      var toDay = String(req.date || '');
      var badTo = sessionDateProblem(toDay, new Date());
      if (badTo) throw new Error(badTo + '.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || fromDay >= toDay) throw new Error('Pick a later session than ' + fromDay + '.');
      var wanted = ['No Show', 'No Confirmation'];
      var outN = table_(SH.OUTBOX);
      var res = { reinvited: 0, olj: 0, skipped: [] };
      apps.rows.filter(function (x) { return ymdOf_(x['Interview Date']) === fromDay && wanted.indexOf(x.Stage) !== -1 && x.Source !== 'Test'; })
        .forEach(function (an) {
          var id = an['Applicant ID'];
          var why = doNotInvite_(st2, an);
          if (why) { res.skipped.push(id + ' (do not invite)'); return; }
          var isOlj = an.Source === 'OLJ' && an['Source Ref'];
          if (!isOlj && !an.Email) { res.skipped.push(id + ' (no email)'); return; }
          if (!isOlj && st2.get('EMAIL_SENDING') !== 'ON') { res.skipped.push(id + ' (email sending is off)'); return; }
          var reason = (an.Stage === 'No Show' ? 'Confirmed but did not join' : 'Did not confirm or join') + ' on ' + fromDay + '; re-invited to ' + toDay;
          setStage_(apps, an, 'Open for re-invite', req.by, reason);
          update_(apps, an, { 'Interview Date': toDay, 'Reminder Sent At': '', 'Re-invite Reason': reason });
          if (isOlj) {
            append_(outN, {
              'Email ID': id_('E'), 'Applicant ID': id, Type: 'OLJ Invite', To: 'OLJ:' + an['Source Ref'],
              Subject: '(OnlineJobs.ph message)', Body: '', 'Interview Date': toDay, 'Queued At': nowStr_(), Status: 'Queued', 'Queued By': req.by
            });
            res.olj++;
          } else {
            queueEmail_(st2, an, 'Re-invite', withEdits_(inviteEmail(toDay, new Date()), req.edited), toDay, req.by);
            res.reinvited++;
          }
        });
      return res;
    }
    if (req.action === 'moveSession') {
      // "Move to another session": puts applicants on a different Wednesday. Queued emails for the old date that
      // have not gone out are cancelled. A new invite for the new date is queued only when sendInvite is ticked.
      var newDate = String(req.date || '');
      var bad = sessionDateProblem(newDate, new Date());
      if (bad) throw new Error(bad + '.');
      var outM = table_(SH.OUTBOX);
      var moved = 0, invitedM = 0, cancelledM = 0, skipped = [];
      (req.ids || []).forEach(function (id) {
        var am = byId[id];
        if (!am) return;
        if (am.Stage === 'Banned') { skipped.push(id + ' (Banned)'); return; }
        var oldDate = ymdOf_(am['Interview Date']);
        if (oldDate === newDate) { skipped.push(id + ' (already on that date)'); return; }
        outM.rows.forEach(function (e) {
          if (e['Applicant ID'] !== id || e.Status !== 'Queued' || ymdOf_(e['Interview Date']) !== oldDate) return;
          if (['Invite', 'Re-invite', 'OLJ Invite', 'Reminder', 'Confirmation'].indexOf(e.Type) === -1) return;
          update_(outM, e, { Status: 'Cancelled', Error: 'Moved to ' + newDate + ' by ' + req.by });
          cancelledM++;
        });
        var said = 'Moved from ' + (oldDate ? 'the ' + longDate(oldDate) : 'no') + ' session to Wednesday ' + longDate(newDate) + ', 2:00 PM PT';
        var mail = '';
        if (req.sendInvite && am.Source === 'OLJ' && am['Source Ref']) {
          append_(outM, {
            'Email ID': id_('E'), 'Applicant ID': id, Type: 'OLJ Invite', To: 'OLJ:' + am['Source Ref'],
            Subject: '(OnlineJobs.ph message)', Body: '', 'Interview Date': newDate, 'Queued At': nowStr_(), Status: 'Queued',
            'Queued By': req.by
          });
          mail = 'OLJ invite queued';
          invitedM++;
        } else if (req.sendInvite) {
          if (st2.get('EMAIL_SENDING') !== 'ON') mail = 'no invite: email sending is off';
          else if (!am.Email) mail = 'no invite: no email address';
          else if (doNotInvite_(st2, am)) mail = 'no invite: ' + doNotInvite_(st2, am);
          else if (queueEmail_(st2, am, 'Re-invite', withEdits_(inviteEmail(newDate, new Date()), req.edited), newDate, req.by)) { mail = 'invite queued'; invitedM++; }
        }
        // Rescheduled (Tara, 2026-11-10): with a new invite sent they are Invited again until they reply to it with
        // their name, which moves them to Confirmed as usual.
        if (mail === 'invite queued' || mail === 'OLJ invite queued') {
          if (am.Stage !== 'Invited' && RESCHEDULE_TO_INVITED.indexOf(am.Stage) !== -1) {
            setStage_(apps, am, 'Invited', req.by, 'Session moved to ' + newDate + '; waiting for them to confirm the new date');
          }
          update_(apps, am, { 'Confirmed At': '' });
        }
        update_(apps, am, {
          'Interview Date': newDate, 'Reminder Sent At': '',
          Notes: (am.Notes ? am.Notes + '\n' : '') + nowStr_() + ' ' + req.by + ': ' + said + '. ' +
            (mail ? mail.charAt(0).toUpperCase() + mail.slice(1) : 'No new invite sent') + '.' +
            (req.reason ? ' ' + String(req.reason).slice(0, 300) : '')
        });
        appendTo_(SH.HISTORY, {
          'Timestamp (PT)': nowStr_(), 'Applicant ID': id, 'From Stage': am.Stage, 'To Stage': am.Stage,
          'Changed By': req.by, Reason: 'Session moved ' + (oldDate || '(none)') + ' \u2192 ' + newDate
        });
        moved++;
      });
      return { moved: moved, invited: invitedM, cancelled: cancelledM, skipped: skipped, date: newDate };
    }
    if (req.action === 'saveScore') {
      var as = byId[req.id];
      if (!as) throw new Error('not found');
      scoreColumns_();
      var sc = table_(SH.SCORES);
      var f2 = { 'Applicant ID': req.id, 'Scored By': req.by, 'Scored At': nowStr_(), Note: String(req.note || '').slice(0, 1000) };
      SCORE_CRITERIA.forEach(function (k) {
        var v = Math.round(Number((req.scores || {})[k]) || 0);
        if (v < 0 || v > 5) throw new Error(k + ' must be 0 to 5');
        f2[k] = v;
      });
      var one = scoreSummary([f2]);
      f2.Average = one.average;
      var mineRow = sc.rows.filter(function (r) { return r['Applicant ID'] === req.id && r['Scored By'] === req.by; })[0];
      if (mineRow) update_(sc, mineRow, f2); else append_(sc, f2);
      return scoreSummary(sc.rows.filter(function (r) { return r['Applicant ID'] === req.id; }));
    }
    if (req.action === 'setTags') {
      var at = byId[req.id];
      if (!at) throw new Error('not found');
      if (apps.headers.indexOf('Tags') === -1) throw new Error('Run setup() once in Apps Script to add the Tags column.');
      var before = String(at.Tags || '');
      update_(apps, at, { Tags: cleanTags_(req.tags) });
      return { tags: at.Tags, before: before };
    }
    if (req.action === 'saveView' || req.action === 'deleteView') {
      var vt = table_(SH.VIEWS);
      var vname = String(req.name || '').trim().slice(0, 60);
      if (!vname) throw new Error('A view needs a name');
      var existing = vt.rows.filter(function (r) { return String(r.Name).toLowerCase() === vname.toLowerCase(); })[0];
      if (req.action === 'deleteView') {
        if (existing) vt.sheet.deleteRow(existing._row);
        return { ok: true };
      }
      var vq = String(req.query || '').replace(/^\?/, '').slice(0, 500);
      if (existing) update_(vt, existing, { Query: vq, 'Created By': req.by, 'Created At': nowStr_() });
      else append_(vt, { Name: vname, Query: vq, 'Created By': req.by, 'Created At': nowStr_() });
      return { ok: true };
    }
    if (req.action === 'sendReply') {
      var ar = byId[req.id];
      var text = String(req.text || '').trim();
      if (!ar) throw new Error('not found');
      if (!text) throw new Error('Type a message first.');
      if (text.length > 5000) throw new Error('Message is too long (5,000 characters max).');
      if (st2.get('EMAIL_SENDING') !== 'ON') throw new Error('Email sending is off (Settings EMAIL_SENDING).');
      if (!ar.Email) throw new Error('This applicant has no email address.');
      var blockedR = doNotInvite_(st2, ar);
      if (blockedR) throw new Error('Do not contact: ' + blockedR + '.');
      var rmail = replyEmail(personalize(text, ar));
      if (String(req.subject || '').trim()) rmail.subject = String(req.subject).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
      var q = queueEmail_(st2, ar, 'Reply', rmail, ymdOf_(ar['Interview Date']), req.by);
      return { queued: !!q };
    }
    if (req.action === 'replyToEmail') {
      // Needs Attention: answer someone who wrote to CareersCW but matched no applicant (e.g. a reschedule request)
      var toE = String(req.email || '').trim().toLowerCase();
      var body = String(req.text || '').trim();
      if (!knownSender_(toE)) throw new Error('This address has not written to CareersCW.');
      if (!body) throw new Error('Type a message first.');
      if (body.length > 5000) throw new Error('Message is too long (5,000 characters max).');
      if (st2.get('EMAIL_SENDING') !== 'ON') throw new Error('Email sending is off (Settings EMAIL_SENDING).');
      var qe = queueEmail_(st2, { 'Applicant ID': '', Email: toE }, 'Reply', replyEmail(body), '', req.by);
      return { queued: !!qe };
    }
    if (req.action === 'linkReply') {
      // Needs Attention: say which applicant an unmatched email belongs to; optionally save the address on them
      var lr = byId[String(req.applicantId || '').trim()];
      var fromE = String(req.email || '').trim().toLowerCase();
      if (!lr) throw new Error('No applicant with that ID.');
      if (!knownSender_(fromE)) throw new Error('This address has not written to CareersCW.');
      var repsL = table_(SH.REPLIES);
      repsL.rows.forEach(function (r) {
        if (String(r['From Email'] || '').trim().toLowerCase() === fromE && !r['Matched Applicant ID']) {
          update_(repsL, r, { 'Matched Applicant ID': lr['Applicant ID'], 'Match Method': 'Linked by ' + req.by });
        }
      });
      var flagsL = table_(SH.FLAGS);
      var fl = flagsL.rows.filter(function (f) { return f['Flag ID'] === req.flagId; })[0];
      if (fl) update_(flagsL, fl, { 'Applicant ID': lr['Applicant ID'] });
      if (req.saveEmail && String(lr.Email || '').trim().toLowerCase() !== fromE) {
        update_(apps, lr, { Email: fromE, Notes: (lr.Notes ? lr.Notes + '\n' : '') + nowStr_() + ' ' + req.by + ': Email changed to ' + fromE + ' (was ' + (lr.Email || 'empty') + ')' });
      }
      return { linked: lr['Applicant ID'] };
    }
    if (req.action === 'sendTemplate') {
      // Inbox templates (Miguel, 2026-10-30). The invite uses sendInvite. Reminders are queued straight away;
      // Hired / Onboarding / Benched / Rejected go to Needs Approval like every status email, never straight out.
      var tp = byId[req.id];
      if (!tp) throw new Error('not found');
      var tpl = String(req.template || '');
      var olj = req.channel === 'olj';
      if (tpl === 'Reminder') {
        var day = ymdOf_(tp['Interview Date']);
        if (!day || sessionDateProblem(day, new Date())) throw new Error('No upcoming session to remind them about. Move them to a session first.');
        var outR = table_(SH.OUTBOX);
        var again = outR.rows.some(function (e) {
          return e['Applicant ID'] === tp['Applicant ID'] && ymdOf_(e['Interview Date']) === day && (e.Status === 'Queued' || e.Status === 'Sent') &&
            (olj ? e.Type === 'OLJ Message' && /friendly reminder about your virtual pre-interview/.test(e.Body) : e.Type === 'Reminder');
        });
        if (again) throw new Error('A reminder for ' + longDate(day) + ' was already sent or is queued.');
        if (olj) {
          if (tp.Source !== 'OLJ' || !tp['Source Ref']) throw new Error('This applicant did not come from OnlineJobs.ph.');
          append_(outR, {
            'Email ID': id_('E'), 'Applicant ID': tp['Applicant ID'], Type: 'OLJ Message', To: 'OLJ:' + tp['Source Ref'],
            Subject: '(OnlineJobs.ph message)', Body: oljReminderText(day, new Date()), 'Interview Date': day, 'Queued At': nowStr_(),
            Status: 'Queued', 'Queued By': req.by
          });
          return { queued: true, template: tpl };
        }
        if (st2.get('EMAIL_SENDING') !== 'ON') throw new Error('Email sending is off (Settings EMAIL_SENDING).');
        if (!tp.Email) throw new Error('This applicant has no email address.');
        if (doNotInvite_(st2, tp)) throw new Error('Do not contact: ' + doNotInvite_(st2, tp) + '.');
        return { queued: !!queueEmail_(st2, tp, 'Reminder', reminderEmail(day, new Date()), day, req.by), template: tpl };
      }
      if (STATUS_EMAIL_TYPES.indexOf(tpl) !== -1) {
        if (olj) throw new Error('Status emails go by email only.');
        ensureCols_(SH.OUTBOX, DECIDED_COLS);
        var outS = table_(SH.OUTBOX);
        var waiting = outS.rows.some(function (e) { return e['Applicant ID'] === tp['Applicant ID'] && e.Type === tpl && e.Status === 'Pending approval'; });
        if (waiting) throw new Error('A ' + tpl + ' email for this applicant is already waiting in Needs Approval.');
        var sOpts = { company: req.company || companyFromTags(tp.Tags), startDate: req.startDate, position: tp.Position };
        var pid = queueStatusEmail_(st2, outS, apps, tp, tpl, req.by, sOpts);
        if (!pid) throw new Error('Not prepared: a ' + tpl + ' email was already sent, or there is no email address (see Notes).');
        return { pending: true, emailId: pid, template: tpl };
      }
      throw new Error('Unknown template.');
    }
    if (req.action === 'sendOljMessage') {
      var ao = byId[req.id];
      var otext = String(req.text || '').trim();
      if (!ao) throw new Error('not found');
      if (ao.Source !== 'OLJ' || !ao['Source Ref']) throw new Error('This applicant did not come from OnlineJobs.ph.');
      if (!otext) throw new Error('Type a message first.');
      if (otext.length > 3000) throw new Error('Message is too long (3,000 characters max).');
      append_(table_(SH.OUTBOX), {
        'Email ID': id_('E'), 'Applicant ID': ao['Applicant ID'], Type: 'OLJ Message', To: 'OLJ:' + ao['Source Ref'],
        Subject: '(OnlineJobs.ph message)', Body: otext, 'Interview Date': ymdOf_(ao['Interview Date']), 'Queued At': nowStr_(),
        Status: 'Queued', 'Queued By': req.by
      });
      return { queued: true };
    }
    if (req.action === 'chatAsk') {
      var cid = id_('C');
      appendTo_(SH.CHAT, { 'Chat ID': cid, 'Asked At': nowStr_(), 'Asked By': req.by, Question: String(req.question || '').slice(0, 1000), Status: 'Pending' });
      return { id: cid };
    }
    if (req.action === 'resolveFlag') {
      var fl = table_(SH.FLAGS);
      var f = fl.rows.filter(function (r) { return r['Flag ID'] === req.flagId; })[0];
      if (!f) throw new Error('not found');
      update_(fl, f, { Status: 'Resolved', 'Resolved By': req.by, 'Resolved At': nowStr_(), 'Resolution Note': req.note || '' });
      return { ok: true };
    }
    throw new Error('unknown action');
  } finally {
    lock.releaseLock();
  }
}

// ---------- site: preview before sending, and who else is viewing (Miguel, 2026-11-02) ----------

/**
 * Exactly what an email would look like, without queuing anything: the site shows it before the Send click.
 * kind: invite (next Wednesday, as "Send invite" uses), reinvite (req.date), reply (req.text). Read only.
 */
function preview_(req) {
  var st = settings_();
  var a = req.id ? indexBy_(table_(SH.APPLICANTS).rows, 'Applicant ID')[req.id] : null;
  if (!a) throw new Error('not found');
  var test = st.get('MODE') !== 'LIVE';
  var to = test ? st.get('TEST_EMAIL') + ' (test mode)' : String(a.Email || '').trim();
  var mail, session = '';
  if (req.kind === 'invite') { session = interviewDateFor(new Date()); mail = inviteEmail(session, new Date()); }
  else if (req.kind === 'reinvite') {
    session = String(req.date || '');
    var bad = sessionDateProblem(session, new Date());
    if (bad) throw new Error(bad + '.');
    mail = inviteEmail(session, new Date());
  } else if (req.kind === 'status') {
    mail = statusEmail(String(req.type || ''), a['First Name'], { company: req.company || companyFromTags(a.Tags), startDate: req.startDate, position: a.Position });
  } else if (req.kind === 'reply') {
    var text = personalize(String(req.text || '').trim(), a);
    if (!text) throw new Error('Type a message first.');
    mail = replyEmail(text);
    if (String(req.subject || '').trim()) mail.subject = String(req.subject).trim().slice(0, 200);
  } else throw new Error('bad preview');
  if (req.channel === 'olj') to = 'OnlineJobs.ph message to ' + [a['First Name'], a['Last Name']].join(' ').trim();
  return {
    to: to, subject: (test ? '[TEST] ' : '') + mail.subject, body: mail.body, session: session,
    name: [a['First Name'], a['Last Name']].join(' ').trim(), doNotInvite: doNotInvite_(st, a) || ''
  };
}

/** Marks req.by as viewing applicant req.id for 90 seconds and returns who else is viewing it now. */
function presence_(req) {
  var id = String(req.id || '');
  if (!id) return { others: [] };
  var cache = CacheService.getScriptCache();
  var key = 'viewing:' + id;
  var now = Date.now();
  var seen = {};
  try { seen = JSON.parse(cache.get(key) || '{}'); } catch (e) { seen = {}; }
  seen[req.by] = now;
  var others = [];
  Object.keys(seen).forEach(function (u) {
    if (now - seen[u] > 60000) delete seen[u];
    else if (u !== req.by) others.push(u);
  });
  cache.put(key, JSON.stringify(seen), 90);
  return { others: others };
}

/** One-time stage rename (Miguel, 2026-11-05: "Onboarded" is now "Onboarding"), on Applicants and History. */
function renameStageOnce_(st, from, to, flag) {
  if (st.get(flag) === 'DONE') return 0;
  var n = 0;
  var apps = table_(SH.APPLICANTS);
  apps.rows.forEach(function (a) { if (a.Stage === from) { update_(apps, a, { Stage: to }); n++; } });
  var hist = table_(SH.HISTORY);
  hist.rows.forEach(function (h) {
    var f = {};
    if (h['To Stage'] === from) f['To Stage'] = to;
    if (h['From Stage'] === from) f['From Stage'] = to;
    if (Object.keys(f).length) { update_(hist, h, f); n++; }
  });
  st.set(flag, 'DONE');
  return n;
}

/**
 * Edit a status email while it waits in Needs Approval (Miguel, 2026-11-05: pencil icon on the site). Only the subject
 * and body change; scripts, styles, frames and event handlers are removed, and the banner is put back if it was deleted.
 */
/** Stages that go back to Invited when their session is moved and a new invite goes out. */
var RESCHEDULE_TO_INVITED = ['Applied', 'Invited', 'Confirmed', 'Open for re-invite', 'No Show', 'No Confirmation'];

/**
 * The pencil on an email preview (Tara, 2026-11-10): the subject and email as edited there replace the generated
 * ones. The banner is kept, as in Needs Approval edits.
 */
function withEdits_(mail, edited) {
  if (!edited || typeof edited !== 'object') return mail;
  var subject = String(edited.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  var body = cleanEmailHtml(String(edited.body || ''));
  if (!subject) throw new Error('The subject cannot be empty.');
  if (!body.replace(/<[^>]*>/g, '').trim()) throw new Error('The email cannot be empty.');
  if (body.length > 60000) throw new Error('The email is too long.');
  if (body.indexOf(BANNER_URL) === -1) body += SIGNATURE_HTML.replace('<p>Cheers,<br>Club Wealth</p>', '');
  return { subject: subject, body: body };
}

function editPendingEmail_(req) {
  ensureCols_(SH.OUTBOX, DECIDED_COLS.concat(['Edited By', 'Edited At']));
  var out = table_(SH.OUTBOX);
  var e = out.rows.filter(function (r) { return r['Email ID'] === req.emailId; })[0];
  if (!e) throw new Error('Email not found.');
  if (e.Status !== 'Pending approval') throw new Error('Only emails waiting for approval can be edited (this one is ' + e.Status + ').');
  var subject = String(req.subject || '').replace(/[\r\n]+/g, ' ').trim();
  var body = cleanEmailHtml(String(req.body || ''));
  if (!subject) throw new Error('The subject cannot be empty.');
  if (!body.replace(/<[^>]*>/g, '').trim()) throw new Error('The email cannot be empty.');
  if (body.length > 60000) throw new Error('The email is too long.');
  if (body.indexOf(BANNER_URL) === -1) body += SIGNATURE_HTML.replace('<p>Cheers,<br>Club Wealth</p>', '');
  var prefix = e.Test === 'Y' && subject.indexOf('[TEST] ') !== 0 ? '[TEST] ' : '';
  update_(out, e, { Subject: prefix + subject, Body: body, 'Edited By': req.by, 'Edited At': nowStr_() });
  return { saved: true };
}

// ---------- Zoom attendance tracking started from the CRM (Miguel, 2026-11-06) ----------
// "Open session" on the session day (from 30 minutes before the 2:00 PM start to the 3:30 PM end) starts tracking
// once: Settings ZOOM_TRACKING_FOR = that day. Every tick then reads Zoom's live participant list for the Help Desk
// meeting (read only), writes the Zoom Attendance rows (never Matched Applicant ID or Result: processZoom_ does that),
// and after 3:30 PM sets ZOOM_FINALIZE, which sets the stages as before.
// Needs Script Properties ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET (the Server-to-Server Zoom app).

var ZOOM_TRACK = { open: '13:30', start: '13:30', interview: '14:00', end: '15:30' };

function zoomConfigured_() {
  var p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('ZOOM_ACCOUNT_ID') && p.getProperty('ZOOM_CLIENT_ID') && p.getProperty('ZOOM_CLIENT_SECRET'));
}

/** A Zoom access token (Server-to-Server OAuth), cached for 50 minutes. Never logged. */
function zoomToken_() {
  var cache = CacheService.getScriptCache();
  var t = cache.get('zoom-token');
  if (t) return t;
  var p = PropertiesService.getScriptProperties();
  var r = UrlFetchApp.fetch('https://zoom.us/oauth/token?grant_type=account_credentials&account_id=' + encodeURIComponent(p.getProperty('ZOOM_ACCOUNT_ID')), {
    method: 'post', muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(p.getProperty('ZOOM_CLIENT_ID') + ':' + p.getProperty('ZOOM_CLIENT_SECRET')) }
  });
  if (r.getResponseCode() !== 200) throw new Error('Zoom sign-in failed (' + r.getResponseCode() + ')');
  t = JSON.parse(r.getContentText()).access_token;
  cache.put('zoom-token', t, 3000);
  return t;
}

/** Everyone in (or who was in) today's live Help Desk meeting. Read only. */
function zoomLiveParticipants_(st) {
  var tok = zoomToken_();
  var meeting = st.get('ZOOM_MEETING_ID') || '99195738734';
  var out = [], page = '';
  for (var i = 0; i < 20; i++) {
    var url = 'https://api.zoom.us/v2/metrics/meetings/' + encodeURIComponent(meeting) + '/participants?type=live&page_size=300' + (page ? '&next_page_token=' + encodeURIComponent(page) : '');
    var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Zoom participants ' + r.getResponseCode());
    var d = JSON.parse(r.getContentText());
    out = out.concat(d.participants || []);
    page = d.next_page_token || '';
    if (!page) break;
  }
  return out;
}

/** Writes this day's computed rows into Zoom Attendance: updates each person's row, adds new ones. */
function writeZoomRows_(day, rows) {
  var z = table_(SH.ZOOM);
  var key = function (n) { return String(n || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
  var have = {};
  z.rows.forEach(function (r) { if (ymdOf_(r['Interview Date']) === day) have[key(r['Parsed Name'])] = r; });
  var cols = ['Zoom Display Name', 'Parsed Position', 'Total Minutes', 'First Join', 'Last Leave', 'Segments'];
  if (z.headers.indexOf('Arrival') !== -1) cols.push('Minutes Early', 'Arrival');
  var n = 0;
  rows.forEach(function (row) {
    var old = have[key(row['Parsed Name'])];
    var f = { 'Recorded At': nowStr_() };
    cols.forEach(function (c) { f[c] = row[c]; });
    if (old) {
      if (old.Result && old.Result !== 'Not an invitee') return; // finalized rows are never rewritten
      update_(z, old, f);
    } else {
      f['Interview Date'] = day; f['Parsed Name'] = row['Parsed Name'];
      append_(z, f);
    }
    n++;
  });
  return n;
}

/** "Open session" on the site: starts tracking once, on the session day, from 30 min before the start to the end. */
function startZoomTracking_(st, req) {
  var now = new Date();
  var today = todayPT(now);
  var day = String(req.date || '');
  var hm = Utilities.formatDate(now, TZ, 'HH:mm');
  var status = zoomTrackingStatus_(st);
  if (day !== today) return { started: false, reason: 'not the session day', status: status };
  if (hm < ZOOM_TRACK.open || hm >= ZOOM_TRACK.end) return { started: false, reason: 'outside ' + ZOOM_TRACK.open + '-' + ZOOM_TRACK.end + ' PT', status: status };
  if (st.get('ZOOM_TRACKING_FOR') === today) return { started: false, reason: 'already on', status: status };
  if (!zoomConfigured_()) throw new Error('Zoom is not connected to Apps Script yet (Script Properties ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET).');
  st.set('ZOOM_TRACKING_FOR', today);
  st.set('ZOOM_TRACKING_SINCE', Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss'));
  st.set('ZOOM_TRACKING_BY', req.by);
  log_('zoomTracking', 'started', { by: req.by }, today);
  var first = 0;
  try { first = zoomTrackTick_(st); } catch (e) { log_('zoomTracking', 'first poll failed', { error: String(e).slice(0, 200) }, today); }
  return { started: true, rows: first, status: zoomTrackingStatus_(st) };
}

/** For the site: tracking state of today's (or the last tracked) session. */
function zoomTrackingStatus_(st) {
  return {
    day: st.get('ZOOM_TRACKING_FOR'), since: st.stamp('ZOOM_TRACKING_SINCE'), by: st.get('ZOOM_TRACKING_BY'),
    lastPoll: st.stamp('ZOOM_TRACKING_LAST'), done: st.get('ZOOM_TRACKING_DONE') === st.get('ZOOM_TRACKING_FOR') && !!st.get('ZOOM_TRACKING_FOR'),
    configured: zoomConfigured_()
  };
}

/** Every tick while tracking is on: read Zoom, write the rows; after the end time, finalize once. Returns rows written. */
function zoomTrackTick_(st) {
  var day = st.get('ZOOM_TRACKING_FOR');
  if (!day || st.get('ZOOM_TRACKING_DONE') === day || !zoomConfigured_()) return 0;
  var now = new Date();
  var today = todayPT(now);
  var ended = today > day || Utilities.formatDate(now, TZ, 'HH:mm') >= ZOOM_TRACK.end;
  zoomTimer_(!ended); // the every-minute Zoom check runs only while a session is tracked
  var n = 0;
  if (today === day) {
    var rows = zoomRowsFromParticipants(zoomLiveParticipants_(st), day, now.getTime(), ZOOM_TRACK);
    n = writeZoomRows_(day, rows);
    st.set('ZOOM_TRACKING_LAST', Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss'));
  }
  if (ended) {
    st.set('ZOOM_TRACKING_DONE', day);
    st.set('ZOOM_FINALIZE', day); // processZoom_ (same tick) sets Interview Completed / Did Not Complete / No Show
    log_('zoomTracking', 'finalized', { rows: n }, day);
  }
  return n;
}

/**
 * Zoom every minute during the session (Miguel, 2026-11-11): a 1-minute timer is switched on while a session is
 * tracked. Each run: read Zoom, write the rows, match names, then refresh the site. It switches itself off when the
 * session ends, so it uses no time on other days.
 */
function zoomTimer_(on) {
  try {
    var have = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'zoomEveryMinute'; });
    if (on && !have.length) ScriptApp.newTrigger('zoomEveryMinute').timeBased().everyMinutes(1).create();
    if (!on) have.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  } catch (e) {
    log_('zoomTracking', 'timer ' + (on ? 'on' : 'off') + ' failed', { error: String(e).slice(0, 200) }, '');
  }
}

function zoomEveryMinute() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // the 5-minute update is running; it checks Zoom itself
  var n = 0;
  try {
    var st = settings_();
    n = safeZoomTrack_(st) + processZoom_(st);
  } finally {
    lock.releaseLock();
  }
  if (n) notifySite_();
}

/** The tick never fails because of Zoom: an error is logged and the next tick tries again. */
function safeZoomTrack_(st) {
  try { return zoomTrackTick_(st); } catch (e) { log_('zoomTracking', 'poll failed', { error: String(e).slice(0, 200) }, st.get('ZOOM_TRACKING_FOR')); return 0; }
}

// ---------- Nov 10 additions (Miguel): pause invites, job ads, attachments, templates, Offboarded, Don't send ----------

/** CRM switch for all automatic invites (Settings AUTO_INVITES). Manual invites are not affected. */
function setAutoInvites_(st, req) {
  var on = req.on === true || req.on === 'ON';
  st.set('AUTO_INVITES', on ? 'ON' : 'OFF');
  log_('autoInvites', on ? 'resumed' : 'paused', { by: req.by }, '');
  return { autoInvites: on ? 'ON' : 'OFF' };
}

/** Job Ads checklist: which open positions are active. Applicants for a paused ad are screened but not invited. */
/**
 * Job Ads rows (Tara, 2026-11-10): the open positions, plus every position with an OnlineJobs.ph post that had an
 * applicant message in the last 14 days. A position is Paused when it is in Settings PAUSED_POSITIONS.
 */
function jobAds_() {
  var overrides = positionOverrides_();
  var since = new Date().getTime() - 14 * 86400000;
  var olj = {};
  var oljT = optionalTable_(SH.OLJ);
  (oljT ? oljT.rows : []).forEach(function (r) {
    var at = r['Last Message At'] instanceof Date ? r['Last Message At'].getTime() : Date.parse(String(r['Last Message At'] || ''));
    if (!at || at < since) return;
    var post = String(r['Job Post'] || '').replace(/&amp;/g, '&').trim();
    var pos = standardPosition(post, overrides);
    if (!pos) return;
    var o = olj[pos] || (olj[pos] = { posts: {}, last: 0 });
    o.posts[post] = true;
    if (at > o.last) o.last = at;
  });
  var names = OPEN_POSITIONS.concat(Object.keys(olj).filter(function (p) { return OPEN_POSITIONS.indexOf(p) === -1 && p !== 'Other'; }));
  return names.map(function (p) {
    var o = olj[p];
    return {
      position: p, active: PAUSED_POSITIONS.indexOf(p) === -1, open: OPEN_POSITIONS.indexOf(p) !== -1,
      oljPosts: o ? Object.keys(o.posts) : [], oljLast: o ? Utilities.formatDate(new Date(o.last), TZ, 'yyyy-MM-dd') : ''
    };
  });
}

/** The tab may not exist yet on older sheets. */
function optionalTable_(name) {
  try { return table_(name); } catch (e) { return null; }
}

var ON_HOLD_STAGES = ['Applied', 'Invited', 'Confirmed'];

/**
 * Puts one applicant on hold (Miguel, 2026-11-11): tag "Position on hold" and cancel their queued invites,
 * reminders and confirmations. A tagged applicant gets no reminder or invite and is not marked No Show.
 */
function putOnHold_(apps, out, a, by, note) {
  out.rows.forEach(function (e) {
    if (e['Applicant ID'] !== a['Applicant ID'] || e.Status !== 'Queued') return;
    if (['Invite', 'Re-invite', 'OLJ Invite', 'Reminder', 'Confirmation'].indexOf(e.Type) === -1) return;
    update_(out, e, { Status: 'Cancelled', Error: 'Position on hold (' + by + ')' });
  });
  var tags = String(a.Tags || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  if (tags.indexOf(ON_HOLD_TAG) === -1) tags.push(ON_HOLD_TAG);
  update_(apps, a, { Tags: tags.join(', '), Notes: (a.Notes ? a.Notes + '\n' : '') + nowStr_() + ' ' + by + ': ' + note });
}

/**
 * One time (Miguel, 2026-11-11): the "Position on hold" email went out by mass email on Nov 10, which did not put
 * anyone on hold, so the Wednesday reminder still reached them. Everyone who got an email with the template's
 * subject and is still Applied / Invited / Confirmed is put on hold now.
 */
function onHoldBackfill_(st) {
  if (st.get('ON_HOLD_BACKFILL') === 'DONE') return 0;
  var subject = (templateByName_(ON_HOLD_TEMPLATE) || ON_HOLD_FALLBACK).subject;
  var out = table_(SH.OUTBOX);
  var apps = table_(SH.APPLICANTS);
  var byId = indexBy_(apps.rows, 'Applicant ID');
  var got = {};
  out.rows.forEach(function (e) {
    if (e.Type === 'Reply' && e.Status === 'Sent' && String(e.Subject).replace(/^\[TEST\] /, '') === subject) got[e['Applicant ID']] = true;
  });
  var n = 0;
  Object.keys(got).forEach(function (id) {
    var a = byId[id];
    if (!a || ON_HOLD_STAGES.indexOf(a.Stage) === -1 || onHold(a)) return;
    putOnHold_(apps, out, a, 'System', '"Position on hold" email was sent; now on hold (no reminders or invites)');
    n++;
  });
  st.set('ON_HOLD_BACKFILL', 'DONE');
  log_('onHoldBackfill', 'ok', { onHold: n }, '');
  return n;
}
var ON_HOLD_TAG = 'Position on hold';
var ON_HOLD_TEMPLATE = 'Position on hold';
var ON_HOLD_FALLBACK = {
  subject: 'ClubWealth | Update on Your Application',
  body: 'Dear [First Name],\n\nThank you for your interest in the [Position] role at Club Wealth and for the time and effort you put into ' +
    'your application. We truly appreciate it.\n\nWe\'d like to let you know that this position is currently on hold. This is simply a ' +
    'matter of timing on our end, and we\'ll keep your application on file and reach out to you directly once it reopens, so there\'s ' +
    'no need to reapply.\n\nThank you for your patience, and we wish you all the best.'
};

/**
 * Save on Job Ads. req.active = the ticked positions, req.shown = every position on the page. A position that goes
 * from Active to Paused emails its Applied, Invited and Confirmed applicants the saved "Position on hold" template
 * (OLJ applicants without an email get it as an OLJ message), cancels their queued invites and reminders, and tags
 * them "Position on hold". Ticking it again removes the tag (nobody is emailed).
 */
function setActivePositions_(st, req) {
  var shown = (req.shown || OPEN_POSITIONS).map(String);
  var active = (req.active || []).map(String);
  var before = PAUSED_POSITIONS.slice();
  var paused = before.filter(function (p) { return shown.indexOf(p) === -1; })
    .concat(shown.filter(function (p) { return active.indexOf(p) === -1; }));
  st.set('PAUSED_POSITIONS', paused.length ? paused.join(', ') : 'NONE');
  // kept for older copies of the site that still read it
  var openActive = OPEN_POSITIONS.filter(function (p) { return paused.indexOf(p) === -1; });
  st.set('ACTIVE_POSITIONS', openActive.length ? openActive.join(', ') : 'NONE');
  setPausedPositions(paused.join(', '));
  var newly = paused.filter(function (p) { return before.indexOf(p) === -1; });
  var reopened = before.filter(function (p) { return paused.indexOf(p) === -1; });
  var res = { active: ACTIVE_POSITIONS, paused: paused, emailed: 0, olj: 0, skipped: [], reopened: reopened };
  if (!newly.length && !reopened.length) return res;
  var apps = table_(SH.APPLICANTS);
  var out = table_(SH.OUTBOX);
  var tpl = templateByName_(ON_HOLD_TEMPLATE) || ON_HOLD_FALLBACK;
  // the wording as checked (and maybe edited) in the preview on Job Ads (Miguel, 2026-11-10)
  if (String(req.text || '').trim()) tpl = { subject: String(req.subject || '').trim() || tpl.subject, body: String(req.text).slice(0, 5000) };
  apps.rows.forEach(function (a) {
    if (a.Historical) return;
    var tags = String(a.Tags || '').split(',').map(function (x) { return x.trim(); }).filter(String);
    var held = tags.indexOf(ON_HOLD_TAG) !== -1;
    if (reopened.indexOf(String(a.Position)) !== -1 && held) {
      update_(apps, a, { Tags: tags.filter(function (x) { return x !== ON_HOLD_TAG; }).join(', ') });
      return;
    }
    if (newly.indexOf(String(a.Position)) === -1 || ON_HOLD_STAGES.indexOf(a.Stage) === -1 || held) return;
    var name = (a['First Name'] + ' ' + a['Last Name']).trim() || a['Applicant ID'];
    if (doNotInvite_(st, a)) { res.skipped.push(name + ' (do not contact)'); return; }
    var text = personalize(tpl.body, a);
    if (a.Email && st.get('EMAIL_SENDING') === 'ON') {
      var mail = replyEmail(text);
      mail.subject = String(tpl.subject || ON_HOLD_FALLBACK.subject);
      if (queueEmail_(st, a, 'Reply', mail, ymdOf_(a['Interview Date']), req.by)) res.emailed++;
    } else if (a.Source === 'OLJ' && a['Source Ref']) {
      append_(out, {
        'Email ID': id_('E'), 'Applicant ID': a['Applicant ID'], Type: 'OLJ Message', To: 'OLJ:' + a['Source Ref'],
        Subject: '(OnlineJobs.ph message)', Body: text, 'Interview Date': ymdOf_(a['Interview Date']), 'Queued At': nowStr_(),
        Status: 'Queued', 'Queued By': req.by
      });
      res.olj++;
    } else { res.skipped.push(name + ' (no email address)'); return; }
    putOnHold_(apps, out, a, req.by, 'job ad paused; "Position on hold" message sent');
  });
  log_('jobAds', 'paused ' + newly.join(', '), { emailed: res.emailed, olj: res.olj, skipped: res.skipped.length, by: req.by }, '');
  return res;
}

/** A saved Email Templates row by name: {subject, body}, or null. */
function templateByName_(name) {
  var t = optionalTable_(SH.TEMPLATES);
  var r = t && t.rows.filter(function (x) { return String(x.Name).trim().toLowerCase() === name.toLowerCase(); })[0];
  return r && String(r.Body || '').trim() ? { subject: String(r.Subject || ''), body: String(r.Body) } : null;
}

/** Profile "Pause invites" / "Resume invites": the tag "Invites paused" keeps every automatic invite away from them. */
function pauseInvites_(apps, byId, req) {
  var a = byId[req.id];
  if (!a) throw new Error('not found');
  var tags = String(a.Tags || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x && x !== PAUSE_TAG; });
  if (req.paused) tags.push(PAUSE_TAG);
  update_(apps, a, { Tags: tags.join(', '), Notes: (a.Notes ? a.Notes + '\n' : '') + nowStr_() + ' ' + req.by + ': invites ' + (req.paused ? 'paused' : 'resumed') });
  if (!req.paused && a['Invite Hold'] === 'Invites paused for this applicant') update_(apps, a, { 'Invite Hold': '' });
  return { paused: !!req.paused };
}

var ATTACH_FOLDER = 'Recruiting Pipeline - Email Attachments';
var ATTACH_TYPES = { 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/plain': 'txt' };

/**
 * Attach a file to an email waiting in Needs Approval: saved to the Drive folder "Recruiting Pipeline - Email
 * Attachments", shared so anyone with the link can view it, and a download link is added above the banner.
 */
function attachToEmail_(req) {
  var out = table_(SH.OUTBOX);
  var e = out.rows.filter(function (r) { return r['Email ID'] === req.emailId; })[0];
  if (!e) throw new Error('Email not found.');
  if (e.Status !== 'Pending approval') throw new Error('Files can only be added while the email waits for approval.');
  var f = req.file || {};
  if (!ATTACH_TYPES[f.type]) throw new Error('Attach a PDF, Word, Excel, image or text file.');
  var bytes = Utilities.base64Decode(String(f.data || ''));
  if (bytes.length > 3 * 1024 * 1024) throw new Error('The file is larger than 3 MB.');
  var props = PropertiesService.getScriptProperties();
  var fid = props.getProperty('ATTACH_FOLDER_ID');
  if (!fid || !driveApi_('get', 'files/' + fid + '?fields=id,trashed')) {
    fid = driveApi_('post', 'files?fields=id', { name: ATTACH_FOLDER, mimeType: 'application/vnd.google-apps.folder' }).id;
    props.setProperty('ATTACH_FOLDER_ID', fid);
  }
  var name = String(f.name || ('attachment.' + ATTACH_TYPES[f.type])).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  var boundary = 'cwattach' + Date.now();
  var meta = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name: name, parents: [fid] }) + '\r\n--' + boundary + '\r\nContent-Type: ' + f.type + '\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: meta.concat(bytes, tail),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Could not save the file to Drive (' + res.getResponseCode() + '): ' + driveReason_(res));
  var file = JSON.parse(res.getContentText());
  var shared = 'anyone';
  try { driveApi_('post', 'files/' + file.id + '/permissions', { type: 'anyone', role: 'reader', allowFileDiscovery: false }); }
  catch (err) { shared = 'private'; }
  var link = file.webViewLink || 'https://drive.google.com/file/d/' + file.id + '/view';
  var block = '<p>Attachment: <a href="' + link + '">' + escapeHtml(name) + '</a> (click to open or download)</p>';
  var body = String(e.Body || '');
  var at = body.indexOf('<p><img src="' + BANNER_URL);
  var cheers = body.lastIndexOf('<p>Cheers,');
  var pos = cheers !== -1 ? cheers : at;
  body = pos !== -1 ? body.slice(0, pos) + block + body.slice(pos) : body + block;
  update_(out, e, { Body: body });
  return { link: link, shared: shared };
}

/** Email templates (macros) for the reply box: tab "Email Templates" (Name, Subject, Body, Created By, Updated At). */
function saveTemplate_(req) {
  ensureTab_(SH.TEMPLATES, ['Name', 'Subject', 'Body', 'Created By', 'Updated At']);
  var t = table_(SH.TEMPLATES);
  var name = String(req.name || '').trim().slice(0, 80);
  if (!name) throw new Error('A template needs a name.');
  var row = t.rows.filter(function (r) { return String(r.Name).toLowerCase() === name.toLowerCase(); })[0];
  if (req.action === 'deleteTemplate') {
    if (row) t.sheet.deleteRow(row._row);
    return { deleted: !!row };
  }
  var body = String(req.body || '').trim();
  if (!body) throw new Error('The template is empty.');
  if (body.length > 5000) throw new Error('The template is too long (5,000 characters max).');
  var f = { Subject: String(req.subject || '').trim().slice(0, 200), Body: body, 'Created By': req.by, 'Updated At': nowStr_() };
  if (row) update_(t, row, f);
  else { f.Name = name; append_(t, f); }
  return { saved: name };
}

/**
 * Offboarded (Miguel, 2026-11-10): once an hour, people whose "Active" box is unchecked on the ISA Masterfile's
 * "Active ISAs" tab (read only) move from Hired / Onboarding to Offboarded, matched by first and last name. Never
 * moves anyone back, never sends an email. Settings ISA_MASTERFILE_ID (default below).
 */
var ISA_MASTERFILE_DEFAULT = '1ahOwILkD6_S_YDoEiy_zg4hmqkvEUgsMVoXXfW0t3Bg';
function offboardSync_(st) {
  var last = Number(st.get('OFFBOARD_CHECKED_MS')) || 0;
  if (new Date().getTime() - last < 55 * 60000) return 0;
  st.set('OFFBOARD_CHECKED_MS', String(new Date().getTime()));
  var values;
  try {
    var sh = SpreadsheetApp.openById(st.get('ISA_MASTERFILE_ID') || ISA_MASTERFILE_DEFAULT).getSheetByName('Active ISAs');
    if (!sh) throw new Error('no "Active ISAs" tab');
    values = sh.getDataRange().getValues();
  } catch (e) {
    log_('offboardSync', 'could not read the ISA Masterfile', { error: String(e).slice(0, 200) }, '');
    return 0;
  }
  var h = values[0].map(function (x) { return String(x).trim(); });
  var iF = h.indexOf('First'), iL = h.indexOf('Last'), iA = h.indexOf('Active');
  if (iF === -1 || iL === -1 || iA === -1) { log_('offboardSync', 'columns First / Last / Active not found', {}, ''); return 0; }
  var gone = values.slice(1).filter(function (r) { return r[iA] === false || String(r[iA]).toUpperCase() === 'FALSE'; });
  if (!gone.length) return 0;
  var apps = table_(SH.APPLICANTS);
  var hired = apps.rows.filter(function (a) { return a.Stage === 'Hired' || a.Stage === 'Onboarding'; });
  var n = 0;
  gone.forEach(function (r) {
    var full = (String(r[iF]) + ' ' + String(r[iL])).trim();
    if (!full) return;
    var m = hired.filter(function (a) { return a.Stage !== 'Offboarded' && nameMatches(full, a['First Name'], a['Last Name']); });
    if (m.length === 1) {
      setStage_(apps, m[0], 'Offboarded', 'System', '"Active" unchecked on the ISA Masterfile (Active ISAs)');
      n++;
    } else if (m.length > 1) {
      flag_('', 'Offboarded: name matches several hires', full + ' is unchecked on the ISA Masterfile and matches ' + m.length + ' hired applicants. Move the right one to Offboarded by hand.');
    }
  });
  return n;
}

/**
 * "Don't send" on a status email (Miguel, 2026-11-10): the applicant goes back to the stage they had before the move
 * that prepared it (e.g. Hired → Passed Interview), and a Hired | company tag is removed. Returns the stage or ''.
 */
var EMAIL_FROM_STAGES = { Hired: ['Hired', 'Onboarding'], Onboarding: ['Onboarding', 'Hired'], Rejected: ['Not Fit'], Benched: ['Benched'], 'Re-invite': ['Open for re-invite'] };
function revertAfterSkip_(e, by) {
  var apps = table_(SH.APPLICANTS);
  var a = apps.rows.filter(function (r) { return r['Applicant ID'] === e['Applicant ID']; })[0];
  if (!a || (EMAIL_FROM_STAGES[e.Type] || []).indexOf(a.Stage) === -1) return '';
  var moves = table_(SH.HISTORY).rows.filter(function (h) { return h['Applicant ID'] === a['Applicant ID'] && h['To Stage'] === a.Stage && h['From Stage'] && h['From Stage'] !== a.Stage; });
  var prev = moves.length ? String(moves[moves.length - 1]['From Stage']) : '';
  if (!prev || STAGES.indexOf(prev) === -1) return '';
  var wasHire = a.Stage === 'Hired' || a.Stage === 'Onboarding';
  setStage_(apps, a, prev, by, 'Back: the ' + e.Type + ' email was not sent (Don\'t send)');
  if (wasHire && prev !== 'Hired' && prev !== 'Onboarding') {
    update_(apps, a, { Tags: String(a.Tags || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x && x.indexOf('Hired |') !== 0; }).join(', ') });
  }
  return prev;
}

/**
 * Mass email / mass OLJ message from the Candidates bulk bar (Miguel, 2026-11-10). Each selected applicant gets their
 * own copy ({first_name} filled in). Email: Club Wealth sign-off and banner, from CareersCW (Zapier, 6 per 5 minutes).
 * OLJ: queued for the OLJ routine, OLJ applicants only. Skipped: no email / not from OLJ, do-not-contact, Banned, test.
 */
function bulkMessage_(st, byId, req) {
  var ids = (req.ids || []).slice(0, 300);
  var channel = req.channel === 'olj' ? 'olj' : 'email';
  var text = String(req.text || '').trim();
  if (!ids.length) throw new Error('Select applicants first.');
  if (!text) throw new Error('Type a message first.');
  if (text.length > (channel === 'olj' ? 3000 : 5000)) throw new Error('The message is too long.');
  if (channel === 'email' && st.get('EMAIL_SENDING') !== 'ON') throw new Error('Email sending is off (Settings EMAIL_SENDING).');
  var subject = String(req.subject || '').trim().slice(0, 200);
  var out = channel === 'olj' ? table_(SH.OUTBOX) : null;
  var res = { queued: 0, skipped: [], held: 0 };
  var holdApps = null, holdOut = null;
  ids.forEach(function (id) {
    var a = byId[id];
    if (!a) return;
    var name = (a['First Name'] + ' ' + a['Last Name']).trim() || id;
    var why = doNotInvite_(st, a) || (a.Stage === 'Banned' ? 'Banned' : '') ||
      (channel === 'email' && !a.Email ? 'no email address' : '') || (channel === 'olj' && (a.Source !== 'OLJ' || !a['Source Ref']) ? 'not from OnlineJobs.ph' : '');
    if (why) { res.skipped.push(name + ' (' + why + ')'); return; }
    var body = personalize(text, a);
    if (req.hold && ON_HOLD_STAGES.indexOf(a.Stage) !== -1) {
      // "Put them on hold" (Miguel, 2026-11-11): no reminder, invite or No Show for them after this message
      putOnHold_(holdApps || (holdApps = table_(SH.APPLICANTS)), holdOut || (holdOut = table_(SH.OUTBOX)), holdApps.rows.filter(function (r) { return r['Applicant ID'] === a['Applicant ID']; })[0] || a, req.by, 'put on hold with a mass ' + channel + ' message');
      res.held++;
    }
    if (channel === 'email') {
      var mail = replyEmail(body);
      if (subject) mail.subject = subject;
      if (queueEmail_(st, a, 'Reply', mail, ymdOf_(a['Interview Date']), req.by)) res.queued++;
    } else {
      append_(out, {
        'Email ID': id_('E'), 'Applicant ID': a['Applicant ID'], Type: 'OLJ Message', To: 'OLJ:' + a['Source Ref'],
        Subject: '(OnlineJobs.ph message)', Body: body, 'Interview Date': ymdOf_(a['Interview Date']), 'Queued At': nowStr_(),
        Status: 'Queued', 'Queued By': req.by
      });
      res.queued++;
    }
  });
  log_('bulkMessage', channel, { queued: res.queued, skipped: res.skipped.length, by: req.by }, '');
  return res;
}
