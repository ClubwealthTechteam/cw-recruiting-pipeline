// In-memory spreadsheet + Apps Script globals for running apps-script/*.gs in Node.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HEADERS = {
  Applicants: ['Applicant ID', 'Source', 'Source Ref', 'Applied At (PT)', 'First Name', 'Last Name', 'Email', 'Phone', 'Country', 'Position (as typed)', 'Position', 'Has Experience', 'Years Experience', 'Recent Client', 'US Clients VA', 'US Realtor VA', 'Experience Overview', 'Internet Speed', 'Speedtest Link', 'Voice Recording Link', 'Resume Link', 'Facebook Link', 'Stage', 'Stage Updated At', 'Stage Updated By', 'Interview Date', 'Invite Count', 'Last Invite At', 'Confirmed At', 'Reminder Sent At', 'Re-invite Reason', 'Zoom Name', 'Zoom Minutes', 'Decision Reason', 'Notes', 'OLJ Job Post', 'OLJ Summary', 'OLJ Email Requested At', 'Historical', 'Created At', 'Screen Track', 'Screen Tag', 'Screen Summary', 'Screened At', 'Invite Hold', 'Minutes Early', 'Arrival'],
  History: ['Timestamp (PT)', 'Applicant ID', 'From Stage', 'To Stage', 'Changed By', 'Reason'],
  Outbox: ['Email ID', 'Applicant ID', 'Type', 'To', 'Subject', 'Body', 'Interview Date', 'Queued At', 'Status', 'Sent At', 'Error', 'Test'],
  Replies: ['Message ID', 'Received At', 'From Email', 'Subject', 'Reply Text', 'Matched Applicant ID', 'Match Method', 'Category', 'Action Taken', 'Processed At'],
  'Needs Attention': ['Flag ID', 'Created At', 'Applicant ID', 'Type', 'Detail', 'Status', 'Resolved By', 'Resolved At', 'Resolution Note'],
  'Zoom Attendance': ['Interview Date', 'Zoom Display Name', 'Parsed Name', 'Parsed Position', 'Matched Applicant ID', 'Total Minutes', 'First Join', 'Last Leave', 'Segments', 'Result', 'Recorded At', 'Minutes Early', 'Arrival'],
  OLJ: ['Conversation Key', 'Job Post', 'Applicant Name', 'OLJ Label', 'Last Message At', 'Summary', 'Email Found', 'Email Requested At', 'Applicant ID', 'Last Checked At'],
  Positions: ['Position (as typed, lowercase)', 'Position', 'Added By'],
  Settings: ['Key', 'Value', 'Notes'],
  'Run Log': ['Run At (PT)', 'Job', 'Result', 'Counts', 'Notes', 'Duration (s)']
};
const FORM_HDR = ['Timestamp', 'First Name', 'Last Name', 'Facebook Account Link', 'Email Address', 'Active Phone Number', 'Country of Origin', 'Position', 'Exp?', 'Years', 'Recent', 'US clients', 'US realtor', 'Overview', 'Speed', 'Speed link', 'Voice', 'Resume', 'Date', 'Invite Sent Out?'];

function makeSheet(name, rows) {
  const data = rows.map((r) => r.slice());
  const width = () => Math.max(1, ...data.map((r) => r.length));
  const cell = (r, c) => (data[r - 1] && data[r - 1][c - 1] !== undefined ? data[r - 1][c - 1] : '');
  const put = (r, c, v) => { while (data.length < r) data.push([]); data[r - 1][c - 1] = v; };
  const sheet = {
    data, getName: () => name,
    getDataRange: () => ({ getValues: () => data.map((r) => Array.from({ length: width() }, (_, j) => (r[j] === undefined ? '' : r[j]))) }),
    getLastRow: () => data.length, getLastColumn: () => width(),
    appendRow: (r) => data.push(r.slice()),
    deleteRow: (r) => data.splice(r - 1, 1),
    setFrozenRows: () => {},
    getRange: (r, c, nr = 1, nc = 1) => {
      if (typeof r === 'string') {
        // 'A:A' text finder: exact match in column A
        return { createTextFinder: (text) => ({ matchEntireCell: () => ({ findNext: () => {
          const i = data.findIndex((row, k) => k > 0 && String(row[0]) === text);
          return i === -1 ? null : { getRow: () => i + 1 };
        } }) }) };
      }
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
        setValue: (v) => { put(r, c, v); return range; },
        setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => put(r + i, c + j, v))); return range; },
        setFontWeight: () => range
      };
      return range;
    }
  };
  return sheet;
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(date, tz, pattern) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach((x) => { p[x.type] = x.value; });
  return pattern.replace('yyyy', p.year).replace('yy', p.year.slice(2)).replace('MM', p.month).replace('dd', p.day)
    .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
}

const ctxCalls = {};
function load({ now, formRows = [], mode = 'TEST', settings = {}, rejected = [] }) {
  const sheets = {};
  const props = {};
  for (const [k, h] of Object.entries(HEADERS)) sheets[k] = makeSheet(k, [h]);
  sheets.Outbox.data[0].push('Applied', 'Queued By');
  const base = { MODE: mode, TEST_EMAIL: 'techteam@clubwealth.com', SOURCE_SHEET_ID: 'SRC', MIN_MINUTES_COMPLETED: '30', ...settings };
  for (const [k, v] of Object.entries(base)) sheets.Settings.data.push([k, v, '']);
  sheets['Test Form'] = makeSheet('Test Form', [FORM_HDR, ...(mode === 'TEST' ? formRows : [])]);
  const source = makeSheet('Form Responses 1', [FORM_HDR, ...(mode === 'LIVE' ? formRows : [])]);
  const rejectedSheet = makeSheet('Rejected', rejected.map((e) => [e]));
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now.getTime()); }
    static now() { return now.getTime(); }
  }
  const ctx = {
    Date: FakeDate, Intl, Math, JSON, String, Number, Object, Array, Error, parseInt, isNaN,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getId: () => 'PIPE', getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n, [])) }),
      openById: () => ({ getSheetByName: (n) => (n === 'Rejected' ? rejectedSheet : source) })
    },
    Utilities: { formatDate: fmt, sleep: () => {}, base64Decode: (s) => Array.from(Buffer.from(s, 'base64')), newBlob: (bytes, type, name) => ({ bytes, type, name }) },
    // Drive: one folder; created files are recorded in ctxCalls.files
    DriveApp: {
      Access: { DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
      getFolderById: (id) => { if (!ctxCalls.folder || id !== 'FOLDER1') throw new Error('not found'); return ctxCalls.folder; },
      createFolder: (n) => (ctxCalls.foldersMade = (ctxCalls.foldersMade || 0) + 1, ctxCalls.folder = { name: n, getId: () => 'FOLDER1', createFile: (blob) => { (ctxCalls.files = ctxCalls.files || []).push(blob); return { setSharing() {}, getUrl: () => 'https://drive.google.com/file/d/' + ctxCalls.files.length } } })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    // secrets and hook URLs read as 's3cret'; anything the script stores itself (setProperty) reads back as stored
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : /_AT$/.test(k) ? null : 's3cret'), setProperty: (k, v) => { props[k] = String(v); } }) },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    ScriptApp: { WeekDay: { THURSDAY: 'THURSDAY' }, getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }), onWeekDay: () => ({ atHour: () => ({ create() {} }) }) }), forSpreadsheet: () => ({ onFormSubmit: () => ({ create() {} }), onChange: () => ({ create() {} }) }) }) },
    UrlFetchApp: { fetch: (url, opts) => { (ctxCalls.fetches = ctxCalls.fetches || []).push(url); (ctxCalls.posts = ctxCalls.posts || []).push({ url, body: opts && opts.payload }); return { getResponseCode: () => ctxCalls.code || 200 }; } }
  };
  vm.createContext(ctx);
  for (const f of ['Logic.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script', f), 'utf8'), ctx, { filename: f });
  const rows = (name) => {
    const [h, ...rs] = sheets[name].getDataRange().getValues();
    return rs.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
  };
  const setNow = (d) => { now = d; };
  const api = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ secret: 's3cret', ...body }) } }).s);
  return { ctx, sheets, rows, setNow, api };
}

module.exports = { load, HEADERS, ctxCalls };
