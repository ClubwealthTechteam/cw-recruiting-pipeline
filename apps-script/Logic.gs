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
  'Onboarded',
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
function inviteHoldReason(a) {
  var pos = String(a.Position || '');
  if (OPEN_POSITIONS.indexOf(pos) === -1) return 'Position not open: ' + (pos || 'unknown');
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
function confirmsFor(text, first, last) {
  var body = stripQuoted(text);
  if (!body || CANNOT_ATTEND.test(body) || body.indexOf('?') !== -1) return false;
  var words = normName(body).split(' ');
  var f = normName(first).split(' ')[0], l = normName(last).split(' ').pop();
  var named = !!(f && l && words.indexOf(f) !== -1 && words.indexOf(l) !== -1);
  return named || ACCEPTS.test(body);
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

/** Which approval email a stage move queues (Miguel, 2026-10-29). Onboarded uses the Hired template. */
var STATUS_EMAIL_FOR_STAGE = { 'Hired': 'Hired', 'Onboarded': 'Hired', 'Not Fit': 'Rejected', 'Benched': 'Benched' };
var STATUS_EMAIL_TYPES = ['Hired', 'Rejected', 'Benched'];

/**
 * The status email for one applicant. PLACEHOLDER text until Miguel sends the final templates: the subject and body
 * say so plainly, so a placeholder can never pass as the real email. Same Club Wealth sign-off and banner as every email.
 */
function statusEmail(type, firstName) {
  var hi = '<p>Hi ' + escapeHtml(String(firstName || '').trim() || 'there') + ',</p>';
  var text = {
    Hired: '[PLACEHOLDER - Hired email. Miguel will send the final text.]',
    Rejected: '[PLACEHOLDER - Rejected email. Miguel will send the final text.]',
    Benched: '[PLACEHOLDER - Benched email (passed the interview, no job offer yet). Miguel will send the final text.]'
  }[type];
  if (!text) throw new Error('No status email for ' + type);
  var subject = { Hired: 'ClubWealth | Welcome to the team', Rejected: 'ClubWealth | Your application', Benched: 'ClubWealth | Your application update' }[type];
  return { subject: subject + ' [PLACEHOLDER]', body: hi + '<p>' + text + '</p>' + SIGNATURE_HTML };
}

// ---------- Active Team Members (from the Onboarding sheet) ----------

/** Department from the free-typed "Position Hired For" (Miguel, 2026-10-29: role family; can be corrected on the site). */
function departmentOf(position) {
  var p = String(position || '').toLowerCase();
  if (/collection|accounts? receivable/.test(p)) return 'Collections';
  if (/transaction|listing|\btc\b|\blc\b/.test(p)) return 'TC/LC';
  if (/\bisa\b|inside sales|appointment|cold call|sales agent/.test(p)) return 'ISA';
  if (/client care|customer/.test(p)) return 'Client Care';
  if (/marketing|ads\b|social media/.test(p)) return 'Marketing';
  if (/\bai\b|tech|developer|automation/.test(p)) return 'AI & Tech';
  if (/admin|assistant|\bva\b/.test(p)) return 'Admin';
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
    reinviteDateFor: reinviteDateFor, isDaylight: isDaylight, longDate: longDate,
    inviteEmail: inviteEmail, reminderEmail: reminderEmail, confirmationEmail: confirmationEmail,
    normName: normName, nameMatches: nameMatches, parseZoomName: parseZoomName,
    standardPosition: standardPosition, zoomResult: zoomResult, STAGES: STAGES,
    stripQuoted: stripQuoted, typedFullName: typedFullName, classifyReply: classifyReply, confirmsFor: confirmsFor, screenTrack: screenTrack,
    inviteHoldReason: inviteHoldReason, approvedEmailBody: approvedEmailBody, OPEN_POSITIONS: OPEN_POSITIONS,
    replyEmail: replyEmail, scoreSummary: scoreSummary, SCORE_CRITERIA: SCORE_CRITERIA,
    slackNewApplicants: slackNewApplicants, slackAttention: slackAttention, slackLate: slackLate,
    slackSessionResults: slackSessionResults, slackWeekly: slackWeekly
  };
}
