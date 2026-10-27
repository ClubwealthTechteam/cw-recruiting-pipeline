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
  'No Show',
  'Passed',
  'Hired',
  'Not Fit'
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

/**
 * The Wednesday an applicant is invited to.
 * Applied Sun–Tue: that week's Wednesday. Applied Wed (any time) through Sat: the following Wednesday.
 * Equivalent to "the first Wednesday strictly after the application's Pacific date".
 */
function interviewDateFor(appliedAt) {
  var p = ptParts(appliedAt);
  var ahead = (3 - p.dow + 7) % 7;
  if (ahead === 0) ahead = 7;
  return addDays(ymd(p.y, p.m, p.d), ahead);
}

/**
 * Re-invite date: the Wednesday after the original interview date. If that is already past
 * (they replied very late), roll forward to the next Wednesday that is still ahead.
 */
function reinviteDateFor(originalYmd, now) {
  var next = addDays(originalYmd, 7);
  var today = todayPT(now);
  while (next < today) next = addDays(next, 7);
  return next;
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

var SIGNATURE_HTML =
  '<p>Cheers,<br>Am Marbella | Recruiter<br>' +
  '&quot;No SUCCESS in the WORLD can compensate for failure in the HOME&quot;</p>';

function link() {
  return '<a href="' + JOIN_URL + '">' + JOIN_LABEL + '</a>';
}

/** Pre-interview invite. sentAt decides "tomorrow" wording. Wording is fixed by Recruitment; only date and zone change. */
function inviteEmail(interviewYmd, sentAt) {
  var zoneWord = isDaylight(interviewYmd) ? 'Daylight' : 'Standard';
  var zoneUpper = zoneWord.toUpperCase();
  var tomorrow = addDays(todayPT(sentAt), 1) === interviewYmd;
  var when = (tomorrow ? 'tomorrow, Wednesday, ' : 'on Wednesday, ') + longDate(interviewYmd);
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
function reminderEmail(interviewYmd) {
  var daylight = isDaylight(interviewYmd);
  var zone = daylight ? 'Pacific Daylight Time (PDT)' : 'Pacific Standard Time (PST)';
  var body =
    '<p>Hi!</p>' +
    '<p>This is a friendly reminder about your virtual pre-interview later today, Wednesday, ' +
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

/** DRAFT, pending Miguel's approval: short reply after someone confirms. Only queued when Settings SEND_CONFIRMATION_REPLY = YES. */
function confirmationEmail(firstName, interviewYmd) {
  var zone = isDaylight(interviewYmd) ? 'Pacific Daylight Time (PDT)' : 'Pacific Standard Time (PST)';
  var body =
    '<p>Hi ' + escapeHtml(firstName || 'there') + ',</p>' +
    '<p>Thank you for confirming. You are confirmed for our virtual pre-interview on Wednesday, ' +
    longDate(interviewYmd) + ', at 2:00 PM ' + zone + '.</p>' +
    '<p>Here is the link to join the interview: ' + link() + '</p>' +
    '<p>Kindly join 10 minutes early and rename yourself with your full name and position (e.g., John Smith_Position).</p>' +
    SIGNATURE_HTML;
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
  [/appointment|setter|cold call|lead gen/, 'Appointment Setter'],
  [/transaction|listing|admin/, 'Real Estate Admin VA (TC/LC)'],
  [/marketing|ads/, 'Marketing & Ads Specialist'],
  [/customer service|case manager/, 'Customer Service'],
  [/general|virtual assist|\bva\b/, 'General VA']
];

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
function classifyReply(subject, text) {
  var body = stripQuoted(text);
  if (AUTO_REPLY.test(String(subject || '')) || AUTO_REPLY.test(body.slice(0, 200))) return 'Ignored';
  if (CANNOT_ATTEND.test(body)) return 'Cannot Attend';
  if (body.indexOf('?') !== -1) return 'Question';
  if (typedFullName(body)) return 'Confirmed';
  return 'Other';
}

/** Zoom result from total minutes in the meeting. */
function zoomResult(minutes, minMinutes) {
  return minutes >= (minMinutes || 30) ? 'Interview Completed' : 'Did Not Complete';
}

if (typeof module !== 'undefined') {
  module.exports = {
    ptParts: ptParts, addDays: addDays, todayPT: todayPT, interviewDateFor: interviewDateFor,
    reinviteDateFor: reinviteDateFor, isDaylight: isDaylight, longDate: longDate,
    inviteEmail: inviteEmail, reminderEmail: reminderEmail, confirmationEmail: confirmationEmail,
    normName: normName, nameMatches: nameMatches, parseZoomName: parseZoomName,
    standardPosition: standardPosition, zoomResult: zoomResult, STAGES: STAGES,
    stripQuoted: stripQuoted, typedFullName: typedFullName, classifyReply: classifyReply
  };
}
