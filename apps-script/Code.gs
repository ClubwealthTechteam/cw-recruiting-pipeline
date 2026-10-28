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
  SETTINGS: 'Settings', LOG: 'Run Log', TEST_FORM: 'Test Form', CHAT: 'Chat'
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
  return {
    // Sheets turns typed dates like 2026-10-28 into Date values; always hand back YYYY-MM-DD text.
    get: function (k) {
      if (!map[k]) return '';
      var v = map[k].Value;
      return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v);
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

function ymdOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

// ---------- email queue ----------

/** Queues one email. In TEST mode it always goes to TEST_EMAIL. */
function queueEmail_(st, applicant, type, mail, interviewYmd) {
  var test = st.get('MODE') !== 'LIVE';
  var to = test ? st.get('TEST_EMAIL') : String(applicant.Email || '').trim();
  if (!to) {
    flag_(applicant['Applicant ID'], 'No email address', type + ' could not be queued: no email address.');
    return null;
  }
  return append_(table_(SH.OUTBOX), {
    'Email ID': id_('E'), 'Applicant ID': applicant['Applicant ID'], Type: type, To: to,
    Subject: (test ? '[TEST] ' : '') + mail.subject, Body: mail.body, 'Interview Date': interviewYmd,
    'Queued At': nowStr_(), Status: 'Queued', Test: test ? 'Y' : ''
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

var EMAIL_TYPES = ['Invite', 'Re-invite', 'Reminder', 'Confirmation'];

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
      flag_(e['Applicant ID'], 'Email failed', e.Type + ' to applicant failed: ' + (e.Error || 'no detail'));
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
  return { applicant: null, why: byName.length ? 'Name matches ' + byName.length + ' applicants' : 'No matching applicant' };
}

function applyReply_(st, apps, a, rep) {
  var cat = String(rep.Category);
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
        'Applied At (PT)': o['Last Message At'] || nowStr_(), 'First Name': parts.slice(0, -1).join(' ') || parts[0] || '',
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
      update_(apps, a, { 'OLJ Summary': o.Summary });
    }
    if (email && !a.Email) update_(apps, a, { Email: email });
    if (a.Stage === 'Applied' && !(Number(a['Invite Count']) > 0) && !a['Invite Hold'] && !pendingInvite_(a['Applicant ID'])) {
      screenAndInvite_(st, apps, a);
    }
  });
  return n;
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
  var hold = inviteHoldReason(a) || rejected || sameEmailInvited_(a);
  if (hold) {
    update_(apps, a, { 'Invite Hold': hold });
    if (rejected) flag_(a['Applicant ID'], 'Do not invite', 'Invite not queued: ' + rejected + '.');
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

/** "Already invited (same email)" when another applicant row with this email already has an invite queued or sent. */
function sameEmailInvited_(a) {
  var e = String(a.Email || '').trim().toLowerCase();
  if (!e) return '';
  var dup = table_(SH.OUTBOX).rows.some(function (x) {
    return x['Applicant ID'] !== a['Applicant ID'] && String(x.To).trim().toLowerCase() === e &&
      ['Invite', 'Re-invite'].indexOf(x.Type) !== -1 && (x.Status === 'Queued' || x.Status === 'Sent') &&
      ymdOf_(x['Interview Date']) >= todayPT(new Date());
  });
  return dup ? 'Already invited (same email)' : '';
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
  z.rows.forEach(function (r) {
    if (r['Matched Applicant ID'] || r.Result) return;
    var day = ymdOf_(r['Interview Date']);
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
      update_(z, r, { 'Matched Applicant ID': cands[0]['Applicant ID'] });
    } else {
      update_(z, r, { Result: cands.length ? 'Ambiguous' : 'Not an invitee' });
      if (cands.length) flag_('', 'Zoom name matches several applicants', r['Zoom Display Name'] + ' on ' + day);
    }
    n++;
  });

  var fin = st.get('ZOOM_FINALIZE');
  if (fin && fin !== st.get('ZOOM_FINALIZED_LAST')) {
    var minMin = Number(st.get('MIN_MINUTES_COMPLETED')) || 30;
    var minutes = {};
    z.rows.forEach(function (r) {
      if (ymdOf_(r['Interview Date']) === fin && r['Matched Applicant ID']) {
        minutes[r['Matched Applicant ID']] = (minutes[r['Matched Applicant ID']] || 0) + (Number(r['Total Minutes']) || 0);
      }
    });
    var counts = { completed: 0, dnc: 0, noshow: 0 };
    apps.rows.forEach(function (a) {
      if (ymdOf_(a['Interview Date']) !== fin || PRE_INTERVIEW.indexOf(a.Stage) === -1) return;
      var m = minutes[a['Applicant ID']];
      var res = m === undefined ? 'No Show' : zoomResult(m, minMin);
      if (m !== undefined) update_(apps, a, { 'Zoom Minutes': Math.round(m) });
      setStage_(apps, a, res, 'System', m === undefined ? 'Not seen in Zoom' : Math.round(m) + ' minutes in Zoom');
      counts[res === 'No Show' ? 'noshow' : res === 'Did Not Complete' ? 'dnc' : 'completed']++;
    });
    z.rows.forEach(function (r) {
      if (ymdOf_(r['Interview Date']) === fin && r['Matched Applicant ID'] && !r.Result) {
        update_(z, r, { Result: zoomResult(minutes[r['Matched Applicant ID']] || 0, minMin) });
      }
    });
    st.set('ZOOM_FINALIZED_LAST', fin);
    log_('zoomFinalize', 'ok', counts, fin);
  }
  return n;
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
    if (a.Stage === 'Confirmed' && a.Source !== 'OLJ' && ymdOf_(a['Interview Date']) === today && !a['Reminder Sent At']) {
      queueEmail_(st, a, 'Reminder', reminderEmail(today), today);
      n++;
    }
  });
  st.set('REMINDERS_QUEUED_FOR', today);
  return n;
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
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var st = settings_();
    var c = {
      intake: importNewFormRows_(st),
      manualInvites: syncManualInvites_(st),
      screenTracks: backfillScreenTracks_(),
      emailed: dispatchEmails_(st),
      sent: applySentEmails_(st),
      replies: processReplies_(st),
      olj: processOLJ_(st),
      zoom: processZoom_(st),
      reminders: queueReminders_(st)
    };
    if (Object.keys(c).some(function (k) { return c[k]; })) {
      log_('tick', 'ok', c);
      notifySite_();
    }
  } catch (err) {
    log_('tick', 'error', '', String(err && err.message || err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** Run once from the editor: adds missing tabs/columns and the triggers (every 5 minutes, on form submit, on sheet edit). */
function setup() {
  var ss = ss_();
  var out = sheet_(SH.OUTBOX);
  var oh = out.getRange(1, 1, 1, out.getLastColumn()).getValues()[0];
  if (oh.indexOf('Applied') === -1) { out.getRange(1, oh.length + 1).setValue('Applied').setFontWeight('bold'); oh.push('Applied'); }
  if (oh.indexOf('Queued By') === -1) out.getRange(1, oh.length + 1).setValue('Queued By').setFontWeight('bold');
  var ap = sheet_(SH.APPLICANTS);
  var aph = ap.getRange(1, 1, 1, ap.getLastColumn()).getValues()[0];
  if (aph.indexOf('Invite Hold') === -1) ap.getRange(1, aph.length + 1).setValue('Invite Hold').setFontWeight('bold');
  if (!ss.getSheetByName(SH.TEST_FORM)) {
    var tf = ss.insertSheet(SH.TEST_FORM);
    var src = SpreadsheetApp.openById(settings_().get('SOURCE_SHEET_ID')).getSheetByName('Form Responses 1');
    var hdr = src.getRange(1, 1, 1, 20).getValues();
    tf.getRange(1, 1, 1, 20).setValues(hdr).setFontWeight('bold');
    tf.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SH.CHAT)) {
    var ch = ss.insertSheet(SH.CHAT);
    ch.getRange(1, 1, 1, 7).setValues([['Chat ID', 'Asked At', 'Asked By', 'Question', 'Status', 'Answer', 'Answered At']]).setFontWeight('bold');
    ch.setFrozenRows(1);
  }
  startTestIntake();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['tick', 'onFormSubmitIntake', 'onPipelineChange'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create(); // 5 min keeps well inside Google's daily trigger-time quota
  ScriptApp.newTrigger('onFormSubmitIntake').forSpreadsheet(settings_().get('SOURCE_SHEET_ID')).onFormSubmit().create();
  ScriptApp.newTrigger('onPipelineChange').forSpreadsheet(ss.getId()).onChange().create();
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
    res = { ok: false, error: String(err && err.message || err) };
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
  'Reminder Sent At', 'Zoom Minutes', 'Historical', 'Screen Track', 'Screen Tag', 'Screen Summary', 'Invite Hold'];

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
    var st = settings_();
    var apps = plain_(table_(SH.APPLICANTS).rows);
    if (req.slim) {
      // List pages and dashboards only: small columns, so the response stays fast.
      apps = apps.map(function (a) {
        var o = {};
        LIST_FIELDS.forEach(function (k) { if (a[k] !== '' && a[k] !== undefined) o[k] = a[k]; });
        return o;
      });
    }
    return {
      applicants: apps,
      history: plain_(table_(SH.HISTORY).rows),
      flags: plain_(table_(SH.FLAGS).rows),
      zoom: plain_(table_(SH.ZOOM).rows),
      outbox: plain_(table_(SH.OUTBOX).rows).map(function (e) { delete e.Body; return e; }),
      mode: st.get('MODE'),
      emailSending: st.get('EMAIL_SENDING')
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
    return { applicant: out };
  }
  if (req.action === 'zoomRows') return zoomRowsApi_(req);
  if (req.action === 'chatGet') return chatGet_(req.id);
  if (req.action === 'chatAnswer') return chatAnswer_(req.id, req.answer);
  if (MANUAL_BY.indexOf(req.by) === -1) throw new Error('unknown user');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var st2 = settings_();
    var apps = table_(SH.APPLICANTS);
    var byId = indexBy_(apps.rows, 'Applicant ID');
    if (req.action === 'setStage') {
      if (STAGES.indexOf(req.stage) === -1) throw new Error('bad stage');
      if (['Not Fit', 'Did Not Complete', 'Open for re-invite'].indexOf(req.stage) !== -1 && !req.reason) {
        throw new Error('A reason is required for ' + req.stage);
      }
      var done = 0;
      (req.ids || []).forEach(function (id) {
        var a = byId[id];
        if (!a || a.Stage === req.stage) return;
        setStage_(apps, a, req.stage, req.by, req.reason);
        if (req.stage === 'Not Fit' || req.stage === 'Did Not Complete') update_(apps, a, { 'Decision Reason': req.reason });
        if (req.stage === 'Open for re-invite') {
          update_(apps, a, { 'Re-invite Reason': req.reason });
          var next = a['Interview Date'] ? reinviteDateFor(ymdOf_(a['Interview Date'])) : interviewDateFor(new Date());
          queueInvite_(st2, a, next, 'Re-invite');
        }
        done++;
      });
      return { updated: done };
    }
    if (req.action === 'addNote') {
      var a1 = byId[req.id];
      if (!a1) throw new Error('not found');
      var line = nowStr_() + ' ' + req.by + ': ' + String(req.note || '').slice(0, 1000);
      update_(apps, a1, { Notes: a1.Notes ? a1.Notes + '\n' + line : line });
      return { ok: true };
    }
    if (req.action === 'setEmail') {
      var a2 = byId[req.id];
      var email = String(req.email || '').trim().toLowerCase();
      if (!a2) throw new Error('not found');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('invalid email');
      update_(apps, a2, { Email: email });
      if (a2.Stage === 'Applied' && !(Number(a2['Invite Count']) > 0) && !pendingInvite_(a2['Applicant ID'])) {
        var iv = interviewDateFor(new Date());
        update_(apps, a2, { 'Interview Date': iv });
        queueInvite_(st2, a2, iv, 'Invite');
      }
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
      if (req.channel === 'email') {
        if (st2.get('EMAIL_SENDING') !== 'ON') throw new Error('Email sending is not connected yet (CareersCW in Zapier). Use OLJ, or invite by hand.');
        if (!ai.Email) throw new Error('This applicant has no email address.');
        queueEmail_(st2, ai, 'Invite', inviteEmail(session, new Date()), session);
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
