/**
 * Pure pipeline rules: interview dates, email wording, name and position matching.
 * No SpreadsheetApp calls here, so tests/logic.test.js can run this file in Node.
 */

var TZ = 'America/Los_Angeles';
var JOIN_URL = 'https://www.clubwealthhelp.com';
var JOIN_LABEL = 'www.clubwealthhelp.com';

var STAGES = [
  'Applied',
  'Invited',
  'Confirmed',
  'Open for re-invite',
  'Interview Completed',
  'Did Not Complete',
  'Uninterested | Left Zoom',
  'No Show',
  'No Confirmation',
  'Passed Pre-Interview',
  'Passed Interview',
  'Benched',
  'Hired',
  'Onboarding',
  'Offboarded',
  'Not Fit',
  'Banned'
];

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** Calendar parts of an instant in Pacific time: {y, m (1-12), d, dow (0=Sun), hh, mm}. */
function ptParts(date) {
  var f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  });
  var o = {};
  f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
  var dows = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +o.year, m: +o.month, d: +o.day, dow: dows[o.weekday], hh: +o.hour, mm: +o.minute };
}

/** 'YYYY-MM-DD' for a Pacific calendar date. */
function ymd(y, m, d) {
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

/** Adds days to a 'YYYY-MM-DD' string (calendar arithmetic, no time zone involved). */
function addDays(ymdStr, n) {
  var p = ymdStr.split('-');
  var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function todayPT(now) {
  var p = ptParts(now || new Date());
  return ymd(p.y, p.m, p.d);
}

/** Wednesday invite cut-off (Pacific, 24h): before it, an applicant still joins that day's 2 PM session. */
var SAME_DAY_CUTOFF_HOUR = 12;

/**
 * The Wednesday an applicant is invited to (Miguel, 2026-10-28).
 * Applied Sun–Tue, or Wednesday before 12:00 PM PT: that week's Wednesday.
 * Applied Wednesday from 12:00 PM PT through Saturday: the following Wednesday.
 */
function interviewDateFor(appliedAt) {
  var p = ptParts(appliedAt);
  var ahead = (3 - p.dow + 7) % 7;
  if (ahead === 0 && p.hh >= SAME_DAY_CUTOFF_HOUR) ahead = 7;
  return skipCancelled(addDays(ymd(p.y, p.m, p.d), ahead));
}

// ---------- cancelled sessions (Miguel, 2026-11-02): Settings CANCELLED_SESSIONS, e.g. "2026-11-04, 2026-12-23" ----------

var CANCELLED_SESSIONS = {};

/** Loads the cancelled Wednesdays from the Settings value (comma, space or new-line separated YYYY-MM-DD). */
function setCancelledSessions(value) {
  CANCELLED_SESSIONS = {};
  String(value || '').split(/[\s,;]+/).forEach(function (d) { if (/^\d{4}-\d{2}-\d{2}$/.test(d)) CANCELLED_SESSIONS[d] = true; });
}

function isCancelledSession(ymdStr) { return !!CANCELLED_SESSIONS[String(ymdStr || '')]; }

/** The same Wednesday, or the next one that is not cancelled. */
function skipCancelled(ymdStr) {
  var d = ymdStr;
  for (var i = 0; i < 52 && isCancelledSession(d); i++) d = addDays(d, 7);
  return d;
}

/**
 * Re-invite date: the Wednesday after the original interview date. If that is already past
 * (they replied very late), roll forward to the next Wednesday that is still ahead.
 */
function reinviteDateFor(originalYmd, now) {
  var next = addDays(originalYmd, 7);
  var today = todayPT(now);
  while (next < today) next = addDays(next, 7);
  return skipCancelled(next);
}

/**
 * Why a session date cannot be used for "Move to another session", or '' when it can (Miguel, 2026-10-30).
 * It must be a Wednesday, and not a session that has already started (2:00 PM PT).
 */
function sessionDateProblem(ymdStr, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymdStr || ''))) return 'Pick a session date';
  var p = ymdStr.split('-');
  if (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() !== 3) return longDate(ymdStr) + ' is not a Wednesday';
  var t = ptParts(now || new Date());
  var today = ymd(t.y, t.m, t.d);
  if (ymdStr < today || (ymdStr === today && t.hh >= 14)) return 'The ' + longDate(ymdStr) + ' session has already started';
  if (isCancelledSession(ymdStr)) return 'The ' + longDate(ymdStr) + ' session is cancelled';
  return '';
}

/** Is 2:00 PM Pacific on this date in daylight time? Pacific DST: 2nd Sunday of March to 1st Sunday of November. */
function isDaylight(ymdStr) {
  var p = ymdStr.split('-');
  var y = +p[0];
  function nthSunday(month, n) {
    var first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  }
  var start = ymd(y, 3, nthSunday(3, 2));
  var end = ymd(y, 11, nthSunday(11, 1));
  return ymdStr >= start && ymdStr < end;
}

function longDate(ymdStr) {
  var p = ymdStr.split('-');
  return MONTHS[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
}

// Miguel, 2026-10-28: sign as Club Wealth with the brand banner (served by the site from public/email-banner.png).
var BANNER_URL = 'https://cwrecruitmentpipeline.vercel.app/email-banner.png';
var SIGNATURE_HTML =
  '<p>Cheers,<br>Club Wealth</p>' +
  '<p><img src="' + BANNER_URL + '" alt="Club Wealth | Perfect Fit Loans | Homexa" width="570" ' +
  'style="display:block;width:570px;max-width:100%;height:auto;border:0"></p>';

function link() {
  return '<a href="' + JOIN_URL + '">' + JOIN_LABEL + '</a>';
}

/** Pre-interview invite. sentAt decides "tomorrow" wording. Wording is fixed by Recruitment; only date and zone change. */
function inviteEmail(interviewYmd, sentAt) {
  var zoneWord = isDaylight(interviewYmd) ? 'Daylight' : 'Standard';
  var zoneUpper = zoneWord.toUpperCase();
  var today = todayPT(sentAt);
  var when = (today === interviewYmd ? 'today, Wednesday, ' : addDays(today, 1) === interviewYmd ? 'tomorrow, Wednesday, ' : 'on Wednesday, ') +
    longDate(interviewYmd);
  var body =
    '<p>Greetings from Club Wealth!</p>' +
    '<p>Please join our virtual pre-interview ' + when + ', at 2:00 PM PACIFIC ' + zoneUpper +
    ' TIME on our Zoom interview.</p>' +
    '<p>You can refer to Time Buddy to check the time in your area and calculate your time zone to Pacific ' +
    zoneWord + ' Time. Follow this to ensure you do not miss the interview.</p>' +
    '<p>Note the time zone difference: Pacific ' + zoneWord +
    ' Time is what we follow here, as the Company is based in Washington State.</p>' +
    '<p>Here is the link to join the interview: ' + link() + '</p>' +
    '<p><b>Important Reminders:</b></p>' +
    '<ul>' +
    '<li>Kindly join 10 minutes before the call. Late attendees will not be entertained.</li>' +
    '<li>Use your own work equipment for the interview (headset, microphone, and camera must be working well. ' +
    'Preferably connected with a LAN cable). Failure to use the proper equipment will not be processed.</li>' +
    '<li>Upon joining Zoom, please change your name with the role you applied for. (Ex. John Smith_Position)</li>' +
    '<li>Effective communication is essential for successfully passing an interview.</li>' +
    '<li>No reschedules</li>' +
    '</ul>' +
    '<p>Note: Setting your expectations that we require a minimum of 50 Mbps for both download and upload speeds ' +
    'while connected to a LAN cable, as you will be working from home and managing multiple applications. ' +
    'This ensures we can work efficiently together once you are hired.</p>' +
    '<p>Please confirm your availability by replying with your FULL NAME</p>' +
    SIGNATURE_HTML;
  return { subject: 'ClubWealth | Pre-Interview invite', body: body };
}

/** Wednesday 6:00 AM reminder, to confirmed applicants only. */
function reminderEmail(interviewYmd, sentAt) {
  var daylight = isDaylight(interviewYmd);
  var zone = daylight ? 'Pacific Daylight Time (PDT)' : 'Pacific Standard Time (PST)';
  var body =
    '<p>Hi!</p>' +
    '<p>This is a friendly reminder about your virtual pre-interview ' + reminderWhen_(interviewYmd, sentAt) + ', Wednesday, ' +
    longDate(interviewYmd) + ', at 2:00 PM ' + zone + '.</p>' +
    '<p>Please join via Zoom using this link: ' + link() + '</p>' +
    '<p>You may use Time Buddy to check the time in your area and ensure you join on time.</p>' +
    '<p>Kindly remember to:</p>' +
    '<ul>' +
    '<li>Join 10 minutes early (late attendees will not be entertained)</li>' +
    '<li>Use your own equipment (working headset, mic, and camera; LAN connection preferred)</li>' +
    '<li>Rename yourself with your full name and position (e.g., John Smith_Position)</li>' +
    '</ul>' +
    '<p>Thank you, and we look forward to seeing you at the interview!</p>' +
    SIGNATURE_HTML;
  return { subject: 'ClubWealth | Pre-reminder invite', body: body };
}

/** "later today" on the day (the 6 AM reminder), else "tomorrow" or "on" when sent by hand from the inbox earlier. */
function reminderWhen_(interviewYmd, sentAt) {
  if (!sentAt) return 'later today';
  var today = todayPT(sentAt);
  return today === interviewYmd ? 'later today' : addDays(today, 1) === interviewYmd ? 'tomorrow' : 'on';
}

/**
 * The Wednesday reminder as an OLJ message: the same words the OLJ routine sends (routines/olj_confirm.js), which
 * recognises "friendly reminder about your virtual pre-interview" and so never sends a second one.
 */
function oljReminderText(interviewYmd, sentAt) {
  var zone = isDaylight(interviewYmd) ? 'Pacific Daylight Time (PDT)' : 'Pacific Standard Time (PST)';
  return [
    'Hi!',
    'This is a friendly reminder about your virtual pre-interview ' + reminderWhen_(interviewYmd, sentAt) + ', Wednesday, ' + longDate(interviewYmd) + ', at 2:00 PM ' + zone + '.',
    'Please join via Zoom using this link: ' + JOIN_LABEL + '\nYou may use Time Buddy to check the time in your area and ensure you join on time.',
    'Kindly remember to:',
    '\u2022 Join 10 minutes early (late attendees will not be entertained)\n\u2022 Use your own equipment (working headset, mic, and camera; LAN connection preferred)\n\u2022 Rename yourself with your full name and position (e.g., John Smith_Position)',
    'Thank you, and we look forward to seeing you at the interview!'
  ].join('\n\n');
}

/** Bot reply after someone confirms (signed "- Club Wealth", no person). Only queued when Settings SEND_CONFIRMATION_REPLY = YES. */
function confirmationEmail(firstName, interviewYmd) {
  var zone = isDaylight(interviewYmd) ? 'Pacific Daylight Time (PDT)' : 'Pacific Standard Time (PST)';
  var body =
    '<p>Hi ' + escapeHtml(firstName || 'there') + ',</p>' +
    '<p>Thank you for confirming. You are confirmed for our virtual pre-interview on Wednesday, ' +
    longDate(interviewYmd) + ', at 2:00 PM ' + zone + '.</p>' +
    '<p>Here is the link to join the interview: ' + link() + '</p>' +
    '<p>Kindly join 10 minutes early and rename yourself with your full name and position (e.g., John Smith_Position).</p>' +
    '<p>- Club Wealth</p>';
  return { subject: 'ClubWealth | Pre-Interview confirmed', body: body };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Lowercase, accents removed, punctuation to spaces, single spaces. */
function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Does a typed full name match an applicant's first and last name?
 * Tolerates capitals, spacing, punctuation and an added or missing middle name:
 * every token of the shorter side must appear in the longer side, and the last names must agree.
 */
function nameMatches(typed, first, last) {
  var t = normName(typed).split(' ').filter(String);
  var a = (normName(first) + ' ' + normName(last)).trim().split(' ').filter(String);
  if (!t.length || !a.length) return false;
  var lastTok = normName(last).split(' ').pop();
  if (lastTok && t.indexOf(lastTok) === -1) return false;
  var shorter = t.length <= a.length ? t : a;
  var longer = t.length <= a.length ? a : t;
  return shorter.every(function (x) { return longer.indexOf(x) !== -1; });
}

/**
 * Strict Zoom rename format: "Name_Position" with exactly one underscore separating two non-empty parts.
 * Returns {name, position} or null. "_Training" (staff in training) never counts.
 */
function parseZoomName(display) {
  var s = String(display || '').trim();
  var parts = s.split('_');
  if (parts.length !== 2) return null;
  var name = parts[0].trim();
  var position = parts[1].trim();
  if (!name || !position) return null;
  if (/^training\b/i.test(position)) return null;
  return { name: name, position: position };
}

/** Standard position names, matched by keywords on the free-text answer. The Positions tab overrides these. */
var POSITION_RULES = [
  [/collection|accounts? receivable/, 'Collections VA'],
  [/inside sales|\bisa\b/, 'Inside Sales Agent (ISA)'],
  // Miguel, 2026-10-28: Real Estate Appointment Setter is the ISA job.
  [/appointment|setter|cold call|lead gen/, 'Inside Sales Agent (ISA)'],
  [/customer (service|support)|case manager/, 'Customer Service'],
  [/transaction|listing|admin|\btc\b|\blc\b/, 'Real Estate Admin VA (TC/LC)'],
  [/marketing|ads/, 'Marketing & Ads Specialist'],
  [/customer service|case manager/, 'Customer Service'],
  [/general|virtual assist|\bva\b/, 'General VA']
];

/** The positions Club Wealth is hiring for now (Miguel, 2026-10-28). Only these are invited automatically. */
var OPEN_POSITIONS = ['Collections VA', 'Inside Sales Agent (ISA)', 'Real Estate Admin VA (TC/LC)'];

/**
 * Screening before any invite (Miguel, 2026-10-28). Returns '' when the applicant may be invited, else the reason
 * they are held back. Form applicants also need experience and 50+ Mbps; OLJ applicants are checked for interest
 * and a summary/resume by the OLJ sender before it sends.
 */
// ---------- job ads and paused invites (Miguel, 2026-11-10) ----------

/** Positions whose job ad is active (Settings ACTIVE_POSITIONS, comma separated). Empty setting = all open positions. */
var ACTIVE_POSITIONS = OPEN_POSITIONS.slice();
function setActivePositions(value) {
  var v = String(value || '').trim();
  ACTIVE_POSITIONS = v ? v.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return OPEN_POSITIONS.indexOf(x) !== -1; }) : OPEN_POSITIONS.slice();
  PAUSED_POSITIONS = OPEN_POSITIONS.filter(function (p) { return ACTIVE_POSITIONS.indexOf(p) === -1; });
}
/**
 * Paused job ads (Settings PAUSED_POSITIONS, any position name; 'NONE' = nothing paused). Until it is first saved,
 * the paused positions are the open ones missing from ACTIVE_POSITIONS.
 */
var PAUSED_POSITIONS = [];
function setPausedPositions(value) {
  var v = String(value || '').trim();
  PAUSED_POSITIONS = v && v !== 'NONE' ? v.split(',').map(function (x) { return x.trim(); }).filter(String) : [];
  ACTIVE_POSITIONS = OPEN_POSITIONS.filter(function (p) { return PAUSED_POSITIONS.indexOf(p) === -1; });
}

/** Told their position is on hold (tag "Position on hold"): no reminders, no invites, never marked No Show. */
function onHold(a) {
  return String(a && a.Tags || '').split(',').some(function (t) { return t.trim() === 'Position on hold'; });
}

/** The tag that pauses invites for one applicant (the profile's Pause invites button). */
var PAUSE_TAG = 'Invites paused';
function invitesPaused(a) {
  return String(a && a.Tags || '').split(',').some(function (t) { return t.trim() === PAUSE_TAG; });
}

function inviteHoldReason(a) {
  var pos = String(a.Position || '');
  if (OPEN_POSITIONS.indexOf(pos) === -1) return 'Position not open: ' + (pos || 'unknown');
  if (ACTIVE_POSITIONS.indexOf(pos) === -1) return 'Job ad paused: ' + pos;
  if (invitesPaused(a)) return 'Invites paused for this applicant';
  if (onHold(a)) return 'Position on hold';
  if (String(a.Source) === 'OLJ') return '';
  if (/^\s*no\b/i.test(String(a['Has Experience'] || ''))) return 'No experience';
  if (/below/i.test(String(a['Internet Speed'] || ''))) return 'Internet below 50 Mbps';
  return '';
}

/** True when an email body is the current approved template (Club Wealth sign-off and banner, no personal signature). */
function approvedEmailBody(html) {
  var b = String(html || '');
  return b.indexOf(BANNER_URL) !== -1 && b.indexOf('Am Marbella') === -1;
}

function standardPosition(raw, overrides) {
  var key = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (overrides && overrides[key]) return overrides[key];
  for (var i = 0; i < POSITION_RULES.length; i++) {
    if (POSITION_RULES[i][0].test(key)) return POSITION_RULES[i][1];
  }
  return key ? 'Other' : '';
}

/** Drops the quoted original email that replies carry underneath. */
function stripQuoted(text) {
  var lines = String(text || '').replace(/\r/g, '').split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (/^\s*>/.test(l)) break;
    if (/^\s*On .+wrote:\s*$/i.test(l)) break;
    if (/^\s*-{2,}\s*Original Message/i.test(l)) break;
    if (/^\s*(From|Sent|De|Enviado):\s/i.test(l)) break;
    if (/^\s*Sent from my /i.test(l)) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

var CANNOT_ATTEND = /\b(can ?not|can'?t|cant|unable|won'?t be able|will not be able|not (be )?available|unavailable|resched|another (date|day|time|schedule)|different (date|day|time)|next week instead|conflict|emergency|not attend|can'?t make it|couldn'?t)\b/i;
/**
 * A late reply from a No Show / No Confirmation applicant that asks for another chance (Miguel, 2026-11-11):
 * reschedule, missed it, another session, still interested, I accept, sorry I was not able to...
 */
var WANTS_RESCHEDULE = /\b(re-?sched\w*|missed|miss(ed)? (the|my)|another (date|day|time|schedule|session|slot|chance)|other schedule|next (session|schedule|wednesday|week)|still (very )?interested|second chance|accept(ed)?( the)? invitation|i accept|not able to (attend|join|make)|was(n'?t| not) able to|sorry|apologi[sz]e)\b/i;
function wantsReschedule(text) {
  var body = stripQuoted(text);
  return !!body && !AUTO_REPLY.test(body.slice(0, 200)) && WANTS_RESCHEDULE.test(body);
}

var AUTO_REPLY = /(automatic reply|auto(matic)?[- ]?reply|out of office|undeliverable|delivery status|mail delivery|returned mail|failure notice)/i;
var NAME_FILLER = /\b(confirm(ed|ing)?|yes|yup|noted|thank you|thanks|ty|po|sir|ma'?am|available|i am|i'?m|attend(ing)?|will|be there|my full name is|full name|name|here|hello|hi|good (day|morning|afternoon|evening))\b/gi;

/** A full name typed in a reply: the first line with filler words removed, 2 to 6 letter-only words. */
function typedFullName(text) {
  var first = stripQuoted(text).split('\n').filter(function (l) { return l.trim(); })[0] || '';
  var cleaned = first.replace(NAME_FILLER, ' ').replace(/[^A-Za-zÀ-ÿñÑ.' -]/g, ' ').replace(/\s+/g, ' ').trim();
  var words = cleaned.split(' ').filter(function (w) { return w.replace(/[.'-]/g, '').length > 0; });
  if (words.length < 2 || words.length > 6) return '';
  return words.join(' ');
}

/**
 * Free, rules-based sorting of an applicant reply (no Claude usage).
 * Ignored: auto-replies and bounces. Cannot Attend: wording about not making it.
 * Question: contains a question mark. Confirmed: a typed full name. Anything else: Other (flagged).
 */
var ACCEPTS = /\b(confirm(ed|ing)?|accept(ed|ing)?|available|attend(ing)?|will (be there|join)|i'?ll (be there|join)|see you|count me in|noted|yes)\b/i;

/**
 * A reply from a matched applicant that confirms even without the exact "full name only" form:
 * it names them (first name + surname anywhere) or says they accept/confirm/will attend, and is not a
 * can't-attend or a question. (Today's replies: "I confirm my availability…, <full name>", "I gladly accept".)
 */
function confirmsFor(text, first, last, fromOwnEmail) {
  var body = stripQuoted(text);
  if (!body || CANNOT_ATTEND.test(body) || body.indexOf('?') !== -1) return false;
  var words = normName(body).split(' ').filter(String);
  var f = normName(first).split(' ')[0], l = normName(last).split(' ').pop();
  var named = !!(f && l && words.indexOf(f) !== -1 && words.indexOf(l) !== -1);
  // Just their first name (e.g. "Krista") counts when it came from their own email address (Tara, 2026-11-10).
  var firstOnly = !!(fromOwnEmail && f && words.length <= 4 && words.indexOf(f) !== -1);
  return named || firstOnly || ACCEPTS.test(body);
}

function classifyReply(subject, text) {
  var body = stripQuoted(text);
  if (AUTO_REPLY.test(String(subject || '')) || AUTO_REPLY.test(body.slice(0, 200))) return 'Ignored';
  if (CANNOT_ATTEND.test(body)) return 'Cannot Attend';
  if (body.indexOf('?') !== -1) return 'Question';
  if (typedFullName(body)) return 'Confirmed';
  return 'Other';
}

/**
 * Which screening rule applies to a typed position (approved by Miguel, 2026-10-28):
 *  Transaction Coordinator: 6+ months as TC; ISA CW: 6+ months BPO; ISA Homexa: 6+ months as an ISA for a known
 *  real estate agency; Collections: any collections experience. Other positions are not screened ('').
 */
function screenTrack(raw) {
  var k = String(raw || '').toLowerCase();
  if (/collection|accounts? receivable/.test(k)) return 'Collections';
  if (/inside sales|\bisa\b/.test(k)) {
    if (/club ?wealth/.test(k)) return 'ISA CW';
    if (/real ?estate|realty|homexa/.test(k)) return 'ISA Homexa';
    return 'ISA (unspecified)';
  }
  if (/transaction|listing coordinator|\btc\b|real estate admin/.test(k)) return 'Transaction Coordinator';
  return '';
}

/** Zoom result from total minutes in the meeting. */
function zoomResult(minutes, minMinutes) {
  return minutes >= (minMinutes || 60) ? 'Interview Completed' : 'Did Not Complete';
}


/**
 * Answer typed in the CRM to an applicant's email (plain text). Sent from CareersCW with the approved
 * sign-off and banner, under the invite's subject so it reads as part of the same conversation.
 */
function replyEmail(text) {
  var paras = String(text || '').trim().split(/\n\s*\n/).map(function (p) {
    return '<p>' + escapeHtml(p.trim()).replace(/\n/g, '<br>') + '</p>';
  }).join('');
  return { subject: 'RE: ClubWealth | Pre-Interview invite', body: paras + SIGNATURE_HTML };
}

// ---------- status emails (Hired / Rejected / Benched): queued for approval, never sent on their own ----------

/** Which approval email a stage move queues (Miguel, 2026-10-29). Onboarding uses the Hired template. */
var STATUS_EMAIL_FOR_STAGE = { 'Hired': 'Hired', 'Onboarding': 'Hired', 'Not Fit': 'Rejected', 'Benched': 'Benched' };
/** Why someone is Not Fit (Miguel, 2026-11-05). Only "general" sends the Rejected email (after approval). */
var NOT_FIT_TYPES = {
  internet: { label: 'Bad internet', email: false },
  device: { label: 'Did not meet device requirements', email: false },
  general: { label: 'General not fit', email: true }
};
var STATUS_EMAIL_TYPES = ['Hired', 'Rejected', 'Benched', 'Onboarding'];

/** Hired for which company (Miguel, 2026-11-05): the tag "Hired | Homexa" or "Hired | Clubwealth" and the onboarding email. */
var HIRED_TAGS = { 'Homexa': 'Hired | Homexa', 'Club Wealth': 'Hired | Clubwealth' };
function companyFromTags(tags) {
  var t = String(tags || '');
  if (t.indexOf(HIRED_TAGS.Homexa) !== -1) return 'Homexa';
  if (t.indexOf(HIRED_TAGS['Club Wealth']) !== -1) return 'Club Wealth';
  return '';
}

var ASSET_BASE = 'https://cwrecruitmentpipeline.vercel.app';
var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function weekdayOf(ymdStr) { var p = String(ymdStr).split('-'); return WEEKDAYS[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()]; }
function lis_(items) { return '<ul>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }
var HR = '<hr style="border:0;border-top:1px solid #d0d5dd;margin:16px 0">';
var CHECKLIST = '<p><b>Onboarding Checklist</b><br>Copy the following into your reply email and add your initials beside each item to confirm compliance:</p><ol>' +
  ['Read onboarding information and dress code details.', 'Use a front-facing camera and remain on the helpdesk during work hours.', 'Comply with the dress code.',
   'Keep cell phones in another room with the ringer off; no personal phone use during work hours.', 'Read and agree to all Time and Attendance policies.',
   'Use Facebook Messenger for work communication only (no personal use during work hours).',
   'Follow Tech protocols:' + lis_(['Attempt basic troubleshooting first.', 'Contact your Squad leader for assistance; SLs will coordinate with Tech Team if necessary'])]
    .map(function (x) { return '<li>____ ' + x + '</li>'; }).join('') + '</ol>';
var TIME_POLICY = ['Standard start time is 7:30 AM PST. Flex start times as early as 5:30 AM PST may occur with advance notice.', 'Late arrivals (even for 1 min) require taking the day off.',
  'Two 10-minute paid breaks and a 30-minute unpaid lunch are provided.', 'Maintain accurate Time Doctor logs. Limit edits to three per day, with team leader approval.'];
var QUOTE = '<p><i>"No SUCCESS in the WORLD can compensate for failure in the HOME"</i></p>';

/** The Homexa Zoom background for the role (ISA, Transaction, Listing or Tech VA); ISA when the role is unclear. */
function homexaBackground(position) {
  var p = String(position || '').toLowerCase();
  if (/listing/.test(p)) return ['Listing Team', 'homexa-listing-team.png'];
  if (/transaction|\btc\b|tc\/lc|admin/.test(p)) return ['Transaction Team', 'homexa-transaction-team.jpg'];
  if (/tech/.test(p)) return ['Tech VA', 'homexa-tech-va.png'];
  return ['ISA Team', 'homexa-isa-team.png'];
}

/** The Zoom background shown in the email itself, with a link to download it (Miguel, 2026-11-05). */
function zoomBackgroundBlock(file, label, w) {
  w = w || 480;
  var url = ASSET_BASE + '/onboarding/' + file;
  return '<p><b>Your Zoom background' + (label ? ' (' + label + ')' : '') + '</b><br>Save this image and set it as your Zoom virtual background: ' +
    '<a href="' + url + '">download it here</a>.</p>' +
    '<p><a href="' + url + '"><img src="' + url + '" alt="Zoom background" width="' + w + '" style="display:block;width:' + w + 'px;max-width:100%;height:auto;border:1px solid #d0d5dd;border-radius:6px"></a></p>';
}

/** Welcome & Onboarding email (Camille's templates, 2026-10-16 Homexa and 2026-10-19 Club Wealth), for the start date. */
function onboardingEmail(company, startYmd, position) {
  if (company !== 'Homexa' && company !== 'Club Wealth') throw new Error('Pick Hired | Homexa or Hired | Clubwealth first.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startYmd || ''))) throw new Error('Pick the start date first.');
  var day = weekdayOf(startYmd);
  var first = day + ', ' + longDate(startYmd);
  var b;
  if (company === 'Club Wealth') {
    b = '<p><b>Welcome to Club Wealth!</b><br>We are excited to have you join the team as part of our Club Wealth Team. Below are your schedule, onboarding instructions, and key policies. Please read carefully and ensure that all tasks are completed on time.</p>' + HR +
      '<p><b>Schedule</b></p>' + lis_([
        'Regular Schedule: Monday-Thursday, 5:30 AM - 3:00 PM, and Friday, 5:30 AM - 9:30 AM (PST). <i>*Hours are subject to change, advanced notice will be given.*</i>' +
          '<br>Start: 5:30 AM<br>1st Break: 8:30 AM<br>Lunch: 10:30 AM<br>Last Break: 12:30 PM<br>End: 3:00 PM',
        '<b>First Day TO DO: ' + first + '</b>' + lis_([
          'Please be on Zoom 6:00 AM PACIFIC for Onboarding docs checking and tools set up. After that, you will be following the Regular Schedule',
          'Assignment before Friday: Sign in to <a href="https://learning.clubwealth.com/">ClubWealthU.com</a> (use Google Account)',
          'Use the Zoom Background below and have your name as First name(space)Last name(dash)Training',
          'Join Zoom link: <a href="http://clubwealthhelp.com/">ClubWealthHelp.com</a>'])]) +
      '<p>Reminder: Be logged in and ready 5-10mins before the start time with everything you need (e.g., coffee, water) <b>DO NOT BE LATE</b></p>' +
      zoomBackgroundBlock('clubwealth-zoom-background.png', '', 366) + HR +
      '<p><b>Onboarding Instructions</b><br>To begin your first day of training, ALL onboarding tasks must be completed <b>BEFORE 6:00 AM of your 1st day</b> NO LATE SUBMISSIONS</p>' +
      '<p>1. Google Form Submission<br>Upload the following documents here: <a href="https://forms.gle/NjSEBpYwNQ8Z4Niw8">Google Form | New Hire Onboarding</a><br>Rename files as FirstName LastName_Filename (e.g., John Smith_Headshot)</p>' +
      '<p>2. Software Setup</p>' + lis_(['Install Zoom on your computer for daily use.', 'Have Pacific Standard Time as your PC time zone']) + HR +
      '<p><b>Key Policies &amp; Reminders</b></p>' + lis_([
        'Time and Attendance:' + lis_(TIME_POLICY),
        'Call-Outs:' + lis_(['Notify both Tara and Camille via group FB Messenger at least one hour before your shift.', 'Request OFF should be notified 2 weeks prior to Tara and Camille via EMAIL', 'NO call outs in the first two weeks, otherwise will result in termination.']),
        'Communication:' + lis_(['Send a DM to <a href="https://www.facebook.com/tammcruz">Camille</a> (use this link) on Facebook Messenger', 'Slack communication: You will be added on Team and ISA channels',
          'Once slack account is created, do a group chat with you, Camille and Tara (not channel, no group name needed)'])]) + HR + CHECKLIST + HR +
      '<p>If you have any questions, feel free to reach out. We look forward to seeing you on your first day! 😊</p>' + QUOTE + SIGNATURE_HTML;
    return { subject: 'Club Wealth | Start Date: ' + first + ' | Welcome & Onboarding', body: b };
  }
  var bg = homexaBackground(position);
  b = '<p><b>Welcome to Homexa!</b><br>We are excited to have you join the team as part of our Homexa Team. Below are your schedule, onboarding instructions, and key policies. Please read carefully and ensure that all tasks are completed on time.</p>' + HR +
    '<p><b>Schedule</b></p>' + lis_([
      'Regular Schedule: Monday-Friday, 7:30 AM - 4:30 PM Pacific. <i>*Hours are subject to change, advanced notice will be given.*</i>',
      '<b>First Day TO DO: ' + first + '</b>' + lis_([
        'Please be on Zoom 8:00 AM Pacific',
        'Homework before ' + day + ': Sign in to <a href="https://learning.clubwealth.com/">ClubWealthU.com</a> (use Google Account) finish the course given yesterday',
        'Use the Zoom Background below (Homexa ' + bg[0] + ')',
        'Join Zoom link: <a href="http://homexahelp.com/">HomexaHelp.com</a>'])]) +
    '<p>Reminder: Be logged in and ready 5-10mins before the start time with everything you need (e.g., coffee, water) <b>DO NOT BE LATE</b></p>' +
    zoomBackgroundBlock(bg[1], 'Homexa ' + bg[0]) + HR +
    '<p><b>Onboarding Instructions</b><br>To begin your first day of training, ALL onboarding tasks must be completed <b>BEFORE 8:00 AM ' + day + '</b> NO LATE SUBMISSIONS</p>' +
    '<p>1. Google Form Submission<br>Upload the following documents here: <a href="https://forms.gle/epjTUxnSUSbJBH1v8">Google Form | New Hire Onboarding</a><br>Rename files as FirstName LastName_Filename (e.g., John Smith_Headshot)</p>' +
    '<p>2. Software Setup</p>' + lis_(['Install Zoom on your computer for daily use.', 'Have Pacific Standard Time as your PC time zone']) + HR +
    '<p><b>Key Policies &amp; Reminders</b></p>' + lis_([
      'Time and Attendance:' + lis_(TIME_POLICY),
      'Callouts:' + lis_(['Notify leadership at least one hour before your shift.', 'Request off should be sent 2 weeks prior to your leadership', 'NO call outs in the first two weeks, otherwise will result in termination.']),
      'Payroll: Every other Wednesday through WISE Account']) + HR + CHECKLIST + HR +
    '<p>If you have any questions, feel free to reach out. We look forward to seeing you on your first day! 😊</p>' + QUOTE + SIGNATURE_HTML;
  return { subject: 'Homexa | Start Date: ' + first + ' | Welcome & Onboarding', body: b };
}

/**
 * The status email for one applicant (final templates from Recruitment, 2026-11-05). Hired and Onboarding send the
 * Welcome & Onboarding email of the company in opts.company, for opts.startDate.
 */
function statusEmail(type, firstName, opts) {
  opts = opts || {};
  var name = escapeHtml(String(firstName || '').trim() || 'there');
  if (type === 'Hired' || type === 'Onboarding') return onboardingEmail(opts.company, opts.startDate, opts.position);
  if (type === 'Benched') {
    return {
      subject: 'ClubWealth | Your application update',
      body: '<p>Hi ' + name + ',</p>' +
        '<p>Thank you so much for taking the time to speak with us yesterday!<br>We truly enjoyed getting to know you and learning more about your experience.</p>' +
        '<p>We are currently taking some time to finalize and assess our hiring needs to ensure we have the right structure and onboarding plan in place for this role. Because of that, we\'d like to ask for your patience as we complete this process.</p>' +
        '<p>Tara was very impressed with your qualifications and believes you would be a great fit for both the role and our team culture. We are excited about the possibility of working together and would love to stay connected while we finalize next steps.</p>' +
        '<p>Please hang tight, and we\'ll be sure to reach out as soon as we have completed our assessment and are ready to move forward with onboarding. In the meantime, feel free to reach out if you have any questions.</p>' +
        '<p>Thank you again for your time and interest in joining our team. We look forward to reconnecting with you soon.</p>' + SIGNATURE_HTML
    };
  }
  if (type === 'Rejected') {
    return {
      subject: 'ClubWealth | Your application',
      body: '<p>Hi!</p>' +
        '<p>Thank you for taking the time to speak with Tara yesterday and share more about your background and experience. After careful consideration, we’ve decided not to move forward with your application at this time.</p>' +
        '<p>We truly appreciate the effort you put into the process and the opportunity to learn more about your skills. We wish you the very best in your job search and future endeavors.</p>' +
        '<p>All the best,</p>' + SIGNATURE_HTML.replace('<p>Cheers,<br>Club Wealth</p>', '')
    };
  }
  throw new Error('No status email for ' + type);
}

// ---------- Active Team Members (from the Onboarding sheet) ----------

/** Department from the free-typed "Position Hired For" (Miguel, 2026-10-29: role family; can be corrected on the site). */
function departmentOf(position) {
  var p = String(position || '').toLowerCase().replace(/[_\-\/()]+/g, ' '); // "RE_ISA", "HX-TC/LC"
  if (/collection|accounts? receivable/.test(p)) return 'Collections';
  if (/transaction|listing|\btc\b|\blc\b/.test(p)) return 'TC/LC';
  if (/\bisa\b|inside sales|appoi?ntment|appoinment|cold call|sales (agent|associate|representative)/.test(p)) return 'ISA';
  if (/recruit|\bhr\b|human resource/.test(p)) return 'Recruitment';
  if (/client care|customer/.test(p)) return 'Client Care';
  if (/marketing|ads\b|social media/.test(p)) return 'Marketing';
  if (/\bai\b|tech|developer|automation/.test(p)) return 'AI & Tech';
  if (/admin|assistant|\bva\b|event/.test(p)) return 'Admin';
  if (/designer|developer|wordpress|web/.test(p)) return 'AI & Tech';
  return 'Other';
}

/** Active = Remarks "Working" or blank (recent hires are often blank). */
function teamActive(status) {
  var s = String(status || '').trim().toLowerCase();
  return s === '' || s === 'working';
}

// ---------- interview scorecards ----------

// Miguel, 2026-10-28: Work Setup = the applicant's workspace and device (headset, mic, camera, LAN).
var SCORE_CRITERIA = ['Communication', 'English', 'Experience', 'Internet', 'Work Setup'];
var SCORE_PASS = 3.5;

/**
 * Average of the saved scorecards (each criterion 1-5; 0 = not rated yet). Suggests Passed at 3.5 or higher
 * with no criterion scored 1 by anyone, otherwise Not Fit. Nothing is suggested until someone rates every criterion.
 */
function scoreSummary(cards) {
  var rated = (cards || []).filter(function (c) {
    return SCORE_CRITERIA.every(function (k) { return Number(c[k]) >= 1 && Number(c[k]) <= 5; });
  });
  if (!rated.length) return { average: 0, count: 0, suggestion: '' };
  var per = {};
  SCORE_CRITERIA.forEach(function (k) {
    per[k] = rated.reduce(function (t, c) { return t + Number(c[k]); }, 0) / rated.length;
  });
  var avg = SCORE_CRITERIA.reduce(function (t, k) { return t + per[k]; }, 0) / SCORE_CRITERIA.length;
  var anyOne = rated.some(function (c) { return SCORE_CRITERIA.some(function (k) { return Number(c[k]) === 1; }); });
  avg = Math.round(avg * 10) / 10;
  return { average: avg, count: rated.length, perCriterion: per, suggestion: avg >= SCORE_PASS && !anyOne ? 'Passed' : 'Not Fit' };
}

// ---------- Slack messages (short, bulleted) ----------

function bullets_(lines, max) {
  var shown = lines.slice(0, max || 8).map(function (l) { return '\u2022 ' + l; });
  if (lines.length > shown.length) shown.push('\u2022 +' + (lines.length - shown.length) + ' more');
  return shown.join('\n');
}

/** New Great/Good-fit applicants: [{name, position, tag}] -> one short message. */
function slackNewApplicants(list, siteUrl) {
  if (!list.length) return '';
  return '*' + list.length + ' new good applicant' + (list.length > 1 ? 's' : '') + '*\n' +
    bullets_(list.map(function (a) { return a.name + ', ' + a.position + ' (' + a.tag + ')'; })) +
    (siteUrl ? '\n<' + siteUrl + '/candidates|Open Candidates>' : '');
}

/** Needs Attention items: [{type, name}] -> one short message. */
function slackAttention(list, siteUrl) {
  if (!list.length) return '';
  return '*' + list.length + ' new item' + (list.length > 1 ? 's' : '') + ' in Needs Attention*\n' +
    bullets_(list.map(function (f) { return f.type + (f.name ? ': ' + f.name : ''); })) +
    (siteUrl ? '\n<' + siteUrl + '/attention|Open Needs Attention>' : '');
}

/** Late joiners during the Wednesday session: [{name, minutesLate}]. */
function slackLate(list) {
  if (!list.length) return '';
  return '*Late to the 2 PM session*\n' +
    bullets_(list.map(function (a) { return a.name + ' joined ' + a.minutesLate + ' min late'; }), 15);
}

/** Session results after Zoom is finalized. */
function slackSessionResults(day, c, siteUrl) {
  return '*Session results, ' + longDate(day) + '*\n' + bullets_([
    'Completed (' + (c.min || 60) + '+ min): ' + c.completed, 'Did not complete: ' + c.dnc, 'No show (confirmed): ' + c.noshow,
    'No confirmation: ' + (c.noconf || 0)
  ]) + (siteUrl ? '\n<' + siteUrl + '/session?date=' + day + '|Open the session>' : '');
}

/** Weekly report: last session and the split by source and position. r = {day, invited, confirmed, joined, completed, bySource, byPosition}. */
function slackWeekly(r, siteUrl) {
  var row = function (x) { return x.label + ': ' + x.completed + ' completed of ' + x.invited + ' invited'; };
  return '*Weekly recruiting report*\n' +
    'Last session (' + longDate(r.day) + ')\n' + bullets_([
      'Invited: ' + r.invited, 'Confirmed: ' + r.confirmed, 'Joined Zoom: ' + r.joined, 'Completed: ' + r.completed
    ]) + '\nBy source\n' + bullets_(r.bySource.map(row)) +
    (r.byPosition.length ? '\nBy position\n' + bullets_(r.byPosition.map(row)) : '') +
    (siteUrl ? '\n<' + siteUrl + '/reports|Open Reports>' : '');
}

if (typeof module !== 'undefined') {
  module.exports = {
    statusEmail: statusEmail, STATUS_EMAIL_FOR_STAGE: STATUS_EMAIL_FOR_STAGE, departmentOf: departmentOf, teamActive: teamActive,
    ptParts: ptParts, addDays: addDays, todayPT: todayPT, interviewDateFor: interviewDateFor,
    reinviteDateFor: reinviteDateFor, sessionDateProblem: sessionDateProblem, isDaylight: isDaylight, longDate: longDate,
    inviteEmail: inviteEmail, reminderEmail: reminderEmail, oljReminderText: oljReminderText, confirmationEmail: confirmationEmail,
    normName: normName, nameMatches: nameMatches, parseZoomName: parseZoomName,
    standardPosition: standardPosition, zoomResult: zoomResult, STAGES: STAGES,
    stripQuoted: stripQuoted, typedFullName: typedFullName, classifyReply: classifyReply, confirmsFor: confirmsFor, screenTrack: screenTrack,
    inviteHoldReason: inviteHoldReason, approvedEmailBody: approvedEmailBody, OPEN_POSITIONS: OPEN_POSITIONS,
    replyEmail: replyEmail, scoreSummary: scoreSummary, SCORE_CRITERIA: SCORE_CRITERIA,
    slackNewApplicants: slackNewApplicants, slackAttention: slackAttention, slackLate: slackLate,
    slackSessionResults: slackSessionResults, slackWeekly: slackWeekly
  };
}

/** Removes anything active from edited email HTML: scripts, styles, frames, forms, event handlers, javascript: links. */
function cleanEmailHtml(html) {
  return String(html || '')
    .replace(/<\s*(script|style|iframe|object|embed|form|button|textarea|select)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript|data):[^"']*\2/gi, '$1="#"')
    .replace(/\s(contenteditable|spellcheck)="[^"]*"/gi, '');
}

// ---------- Zoom attendance computed in Apps Script (Miguel, 2026-11-06: tracking started from the CRM) ----------

/** UTC milliseconds of a Pacific wall-clock time on a day ("2026-11-11", "14:00"), daylight saving included. */
function ptMs(day, hhmm) {
  var d = String(day).split('-'), t = String(hhmm).split(':');
  return Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +(t[1] || 0)) + (isDaylight(day) ? 7 : 8) * 3600000;
}
/** "HH:MM" Pacific for UTC milliseconds on that day. */
function ptHm(ms, day) {
  var x = new Date(ms - (isDaylight(day) ? 7 : 8) * 3600000);
  return ('0' + x.getUTCHours()).slice(-2) + ':' + ('0' + x.getUTCMinutes()).slice(-2);
}

/** Arrival against the start (the invite asks for 10 minutes early): [signed minutes early, label]. Same as the routine. */
function zoomArrival(firstJoinMs, startMs) {
  var early = Math.round((startMs - firstJoinMs) / 60000);
  if (early >= 10) return [early, early + ' min early (on time)'];
  if (early > 0) return [early, early + ' min early (' + (10 - early) + ' min short of the 10 min asked)'];
  if (early === 0) return [0, 'Joined at the start time (10 min late for the 10-min-early rule)'];
  return [early, (-early) + ' min late'];
}

/**
 * Zoom Attendance rows from Zoom's participant list for the session day (the same rules as the old routine):
 * strict "Name_Position" names only (never _Training), minutes inside the window (default 13:30-15:30 PT) with
 * overlapping segments merged and rejoins added, arrival against the 2:00 PM start. A participant who renamed keeps the
 * Name_Position name they used. nowMs caps open segments (people still in the meeting).
 */
function zoomRowsFromParticipants(participants, day, nowMs, opts) {
  opts = opts || {};
  var lo = ptMs(day, opts.start || '13:30'), hi = ptMs(day, opts.end || '15:30'), start = ptMs(day, opts.interview || '14:00');
  var end = Math.min(nowMs, hi);
  var parsedById = {};
  (participants || []).forEach(function (p) {
    var pid = p.participant_uuid || p.participant_user_id || p.id || p.user_name;
    if (parseZoomName(p.user_name) && !parsedById[pid]) parsedById[pid] = String(p.user_name).trim();
  });
  var people = {};
  (participants || []).forEach(function (p) {
    var pid = p.participant_uuid || p.participant_user_id || p.id || p.user_name;
    var display = parseZoomName(p.user_name) ? String(p.user_name).trim() : parsedById[pid];
    var parsed = parseZoomName(display);
    var j = Date.parse(p.join_time || '');
    if (!parsed || isNaN(j)) return;
    var l = p.leave_time ? Date.parse(p.leave_time) : end;
    var k = parsed.name.replace(/\s+/g, ' ').toLowerCase();
    var e = people[k] || (people[k] = { display: display, name: parsed.name, position: parsed.position, segs: [] });
    e.segs.push([j, l]);
  });
  var rows = [];
  Object.keys(people).forEach(function (k) {
    var e = people[k];
    var iv = e.segs.map(function (s) { return [Math.max(s[0], lo), Math.min(s[1], end)]; })
      .filter(function (s) { return s[1] > s[0]; }).sort(function (a, b) { return a[0] - b[0]; });
    var total = 0, cur = null;
    iv.forEach(function (s) {
      if (cur && s[0] <= cur[1]) cur[1] = Math.max(cur[1], s[1]);
      else { if (cur) total += cur[1] - cur[0]; cur = s.slice(); }
    });
    if (cur) total += cur[1] - cur[0];
    var mins = total / 60000;
    if (mins <= 0) return;
    var segs = e.segs.slice().sort(function (a, b) { return a[0] - b[0]; });
    var inside = segs.filter(function (s) { return s[1] > lo; });
    var arr = zoomArrival(inside[0][0], start);
    rows.push({
      'Interview Date': day, 'Zoom Display Name': e.display, 'Parsed Name': e.name, 'Parsed Position': e.position,
      'Total Minutes': Math.round(mins * 10) / 10, 'First Join': ptHm(inside[0][0], day),
      'Last Leave': ptHm(Math.max.apply(null, segs.map(function (s) { return s[1]; })), day), Segments: segs.length,
      'Minutes Early': arr[0], Arrival: arr[1]
    });
  });
  return rows;
}

/** {first_name} (and {name}) in a typed message or template become the applicant's own name. */
function personalize(text, a) {
  var first = String(a && a['First Name'] || '').trim() || 'there';
  var full = (String(a && a['First Name'] || '') + ' ' + String(a && a['Last Name'] || '')).trim() || first;
  var pos = String(a && a.Position || '').trim() || 'open';
  // {first_name} or [First Name], {name} / [Name] / [Full Name], {position} / [Position]: braces or brackets, any case.
  function tag(words) { return new RegExp('[\\{\\[]\\s*(?:' + words + ')\\s*[\\}\\]]', 'gi'); }
  return String(text || '')
    .replace(tag('first[_ ]?name'), first)
    .replace(tag('(?:full[_ ]?)?name'), full)
    .replace(tag('position|role'), pos);
}
