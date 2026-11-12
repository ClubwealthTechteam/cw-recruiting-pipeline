import 'server-only';
import { rowsByKey, type Patch } from '@/lib/db';
import { STAGES } from '@/lib/pipeline';

/**
 * Database stage 2 (Miguel, 2026-11-12): the common saves are shown in the CRM at once, then the Apps Script does
 * the real work on the sheet a few seconds later (lib/savequeue.ts). Each handler checks the same rules as Code.gs,
 * works out the change to show now (patches) and how to undo it if the sheet refuses (revert), and answers the page
 * the way the Apps Script would. A save not listed here still goes straight to the Apps Script.
 */
export type Fast = { data: Record<string, unknown>; patches: Patch[]; revert: Patch[]; body: Record<string, unknown>; label: string };
type P = Record<string, unknown>;
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** "YYYY-MM-DD HH:mm:ss" in Pacific time, as the Apps Script writes it. */
export function ptNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Same as Code.gs NOT_FIT_TYPES / HIRED_TAGS. */
const NOT_FIT: Record<string, string> = { internet: 'Bad internet', device: 'Did not meet device requirements', general: 'General not fit' };
const HIRED_TAGS: Record<string, string> = { Homexa: 'Hired | Homexa', 'Club Wealth': 'Hired | Clubwealth' };

function cleanTags(raw: unknown) {
  const seen = new Set<string>();
  return s(raw).split(',').map((t) => t.trim().slice(0, 40)).filter((t) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12).join(', ');
}

/** One patch for the change and one with the values before it. */
function change(tab: string, row: number, before: P, set: P, patches: Patch[], revert: Patch[]) {
  patches.push({ tab, row, set });
  revert.push({ tab, row, set: Object.fromEntries(Object.keys(set).map((k) => [k, before[k] ?? ''])) });
}

export async function fastSave(action: string, by: string, p: P): Promise<Fast | null> {
  const now = ptNow();
  const patches: Patch[] = [], revert: Patch[] = [];
  const body = { action, ...p };

  if (action === 'setStage') {
    const stage = s(p.stage);
    if (!(STAGES as readonly string[]).includes(stage)) throw new Error('bad stage');
    let reason = s(p.reason);
    if (['Did Not Complete', 'Open for re-invite'].includes(stage) && !reason) throw new Error('A reason is required for ' + stage);
    const hiring = stage === 'Hired' || stage === 'Onboarding';
    const notFit = stage === 'Not Fit' ? NOT_FIT[s(p.notFitType)] : undefined;
    if (stage === 'Not Fit' && !notFit) throw new Error('Pick why: Bad internet, Did not meet device requirements, or General not fit.');
    if (notFit) reason = notFit + (reason && reason !== notFit ? ' - ' + reason : '');
    if (hiring) {
      if (!HIRED_TAGS[s(p.company)]) throw new Error('Pick Hired | Homexa or Hired | Clubwealth.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s(p.startDate))) throw new Error('Pick the start date for the onboarding email.');
    }
    const ids = (Array.isArray(p.ids) ? p.ids : []).map(String);
    const rows = await rowsByKey('Applicants', 'Applicant ID', ids);
    const moves: P[] = [];
    for (const { row, data: a } of rows) {
      const company = s(a.Tags).includes('Hired | Homexa') ? 'Homexa' : s(a.Tags).includes('Hired | Clubwealth') ? 'Club Wealth' : '';
      if (s(a.Stage) === stage && !(hiring && company !== s(p.company))) continue;
      moves.push({ id: s(a['Applicant ID']), from: s(a.Stage), decision: s(a['Decision Reason']), reinvite: s(a['Re-invite Reason']), tags: s(a.Tags) });
      const set: P = { Stage: stage, 'Stage Updated At': now, 'Stage Updated By': by };
      if (hiring) set.Tags = [...s(a.Tags).split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('Hired |')), HIRED_TAGS[s(p.company)]].join(', ');
      if (stage === 'Not Fit' || stage === 'Did Not Complete') set['Decision Reason'] = reason;
      if (stage === 'Open for re-invite') set['Re-invite Reason'] = reason;
      change('Applicants', row, a, set, patches, revert);
    }
    return { data: { updated: moves.length, undo: { moves, queued: [], since: now } }, patches, revert, body, label: `Move ${moves.length} to ${stage}` };
  }

  if (action === 'undoStage') {
    const moves = (Array.isArray(p.moves) ? p.moves : []) as P[];
    const rows = await rowsByKey('Applicants', 'Applicant ID', moves.map((m) => s(m.id)));
    let back = 0;
    for (const m of moves) {
      const r = rows.find((x) => s(x.data['Applicant ID']) === s(m.id));
      if (!r || !(STAGES as readonly string[]).includes(s(m.from))) continue;
      const a = r.data;
      if (s(a.Stage) === s(m.from) && !(typeof m.tags === 'string' && s(a.Tags) !== m.tags)) continue;
      const set: P = { Stage: s(m.from), 'Decision Reason': s(m.decision), 'Re-invite Reason': s(m.reinvite) };
      if (typeof m.tags === 'string') set.Tags = m.tags;
      change('Applicants', r.row, a, set, patches, revert);
      back++;
    }
    return { data: { undone: back, cancelledEmails: 0, alreadySent: 0 }, patches, revert, body, label: 'Undo a move' };
  }

  if (action === 'addNote' || action === 'undoNote') {
    const [r] = await rowsByKey('Applicants', 'Applicant ID', [s(p.id)]);
    if (!r) throw new Error('not found');
    const notes = s(r.data.Notes);
    if (action === 'addNote') {
      const line = `${now} ${by}: ${s(p.note).slice(0, 1000)}`;
      change('Applicants', r.row, r.data, { Notes: notes ? notes + '\n' + line : line }, patches, revert);
      return { data: { ok: true, line }, patches, revert, body: { ...body, line }, label: 'Add a note' };
    }
    const lines = notes.split('\n');
    const i = lines.lastIndexOf(s(p.line));
    if (i === -1) return { data: { removed: false }, patches, revert, body, label: 'Undo a note' };
    lines.splice(i, 1);
    change('Applicants', r.row, r.data, { Notes: lines.join('\n') }, patches, revert);
    return { data: { removed: true }, patches, revert, body, label: 'Undo a note' };
  }

  if (action === 'setTags') {
    const [r] = await rowsByKey('Applicants', 'Applicant ID', [s(p.id)]);
    if (!r) throw new Error('not found');
    const tags = cleanTags(p.tags);
    change('Applicants', r.row, r.data, { Tags: tags }, patches, revert);
    return { data: { tags, before: s(r.data.Tags) }, patches, revert, body, label: 'Save tags' };
  }

  if (action === 'resolveFlag') {
    const [r] = await rowsByKey('Needs Attention', 'Flag ID', [s(p.flagId)]);
    if (!r) throw new Error('not found');
    change('Needs Attention', r.row, r.data, { Status: 'Resolved', 'Resolved By': by, 'Resolved At': now, 'Resolution Note': s(p.note) }, patches, revert);
    return { data: { ok: true }, patches, revert, body, label: 'Mark resolved' };
  }

  if (action === 'approveEmail' || action === 'approveEmails' || action === 'skipEmail') {
    const ids = action === 'approveEmails' ? (Array.isArray(p.emailIds) ? p.emailIds : []).map(String).slice(0, 300) : [s(p.emailId)];
    const rows = await rowsByKey('Outbox', 'Email ID', ids);
    const failed: string[] = [];
    for (const id of ids) {
      const r = rows.find((x) => s(x.data['Email ID']) === id);
      if (!r) { failed.push(id + ': Email not found.'); continue; }
      if (s(r.data.Status) !== 'Pending approval') { failed.push(id + ': This email is no longer waiting for approval (it is ' + s(r.data.Status) + ').'); continue; }
      const set: P = action === 'skipEmail'
        ? { Status: 'Cancelled', Error: "Don't send: " + by, 'Decided By': by, 'Decided At': now }
        : { Status: 'Queued', 'Decided By': by, 'Decided At': now };
      change('Outbox', r.row, r.data, set, patches, revert);
    }
    if (action !== 'approveEmails' && failed.length) throw new Error(failed[0].replace(/^[^:]+: /, ''));
    const data = action === 'approveEmails' ? { queued: patches.length, failed } : action === 'skipEmail' ? { cancelled: true, backTo: '' } : { queued: true };
    return { data, patches, revert, body, label: action === 'skipEmail' ? "Don't send an email" : `Approve ${patches.length} email${patches.length === 1 ? '' : 's'}` };
  }

  return null;
}
