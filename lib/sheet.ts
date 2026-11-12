import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { ptStamp, setCancelledSessions, linkApplications } from '@/lib/pipeline';
import { dbConfigured, getKvs } from '@/lib/db';
import { buildFromDb } from '@/lib/dbdata.server';

export type Row = Record<string, string | number>;
/** One Active Team Members row: the Onboarding copy with site edits on top; edited = { field: value in the Onboarding sheet }. */
export type TeamMember = Record<string, string> & { edited?: Record<string, string> };
/** One Job Ads row. oljPosts: OnlineJobs.ph posts for it with applicants in the last 14 days (oljLast = latest). */
export type JobAd = { position: string; active: boolean; open?: boolean; oljPosts?: string[]; oljLast?: string };
export type PipelineData = {
  applicants: Row[];
  history: Row[];
  flags: Row[];
  zoom: Row[];
  outbox: Row[];
  scores?: Row[];
  views?: Row[];
  team?: TeamMember[];
  mode: string;
  emailSending?: string;
  cancelledSessions?: string[];
  autoInvites?: 'ON' | 'OFF';
  jobAds?: JobAd[];
  emailTemplates?: Row[];
  zoomTracking?: { day?: string; since?: string; by?: string; lastPoll?: string; done?: boolean; configured?: boolean };
  fetchedAt?: number;
};

/** Applied times in one format (Pacific), so every page sorts and dates them the same way. */
function normalize(d: PipelineData): PipelineData {
  setCancelledSessions(d.cancelledSessions);
  for (const a of d.applicants) if (a['Applied At (PT)']) a['Applied At (PT)'] = ptStamp(a['Applied At (PT)']);
  linkApplications(d.applicants, d.team || []);
  return d;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request to the Apps Script. When it answers "busy" (another save or the 5-minute update held the sheet and
 * nothing was changed) it is tried again, up to twice, a few seconds apart, so a save rarely fails for that reason
 * (Tara, 2026-11-10).
 */
async function call<T>(body: Record<string, unknown>, tries = 3): Promise<T> {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) throw new Error('APPS_SCRIPT_URL / APPS_SCRIPT_SECRET are not set');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, secret }),
    cache: 'no-store',
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(res.status >= 500 ? 'Google did not respond in time. Refresh the page to check whether your change was saved.' : `Pipeline service returned ${res.status}`);
  const raw = await res.text();
  let json: { ok: boolean; data?: T; error?: string; busy?: boolean };
  try { json = JSON.parse(raw); } catch { throw new Error('Google sent back an error page instead of an answer. Refresh the page to check whether your change was saved.'); }
  if (!json.ok && json.busy && tries > 1) { await wait(4000); return call<T>(body, tries - 1); }
  if (!json.ok) throw new Error(json.error || 'Pipeline service error');
  return json.data as T;
}

export const PIPELINE_TAG = 'pipeline';

/**
 * Slim pipeline data for list pages and dashboards, from Vercel's shared data cache.
 * Served instantly when cached. Dropped the moment the sheet changes (the Apps Script calls /api/revalidate, which
 * also loads the fresh copy straight away) or anything is changed on the site; otherwise refreshed in the background.
 * Applicants from before the system come with a few fields only (enough for counts) and without their history.
 */
/**
 * Where the page data comes from (Miguel, 2026-11-12): the Neon copy once "Read from the database" is switched on
 * (Database page) and a full copy exists; otherwise, or if the database fails, the sheet through Apps Script as before.
 */
export async function dataSource(): Promise<'database' | 'sheet'> {
  if (!dbConfigured()) return 'sheet';
  try {
    const kv = await getKvs(['readFromDb', 'lastFullCopy']);
    return kv.readFromDb === true && kv.lastFullCopy ? 'database' : 'sheet';
  } catch {
    return 'sheet';
  }
}

async function loadData(withHistory: boolean): Promise<PipelineData> {
  if ((await dataSource()) === 'database') {
    try { return await buildFromDb(withHistory); } catch { /* fall back to the sheet */ }
  }
  return call<PipelineData>({ action: 'data', slim: true, ...(withHistory ? { withHistory: true } : {}) });
}

const getDataCached = unstable_cache(
  async () => ({ ...normalize(await loadData(false)), fetchedAt: Date.now() }),
  ['pipeline-data-v3'],
  { revalidate: 30, tags: [PIPELINE_TAG] }
);

/** Everything, including the ~2,000 applicants from before the system. Only for "Include applicants from before the system". */
const getDataWithHistoryCached = unstable_cache(
  async () => ({ ...normalize(await loadData(true)), fetchedAt: Date.now() }),
  ['pipeline-data-all-v1'],
  { revalidate: 120, tags: [PIPELINE_TAG] }
);

/** Every read (cached or not) also sets the cancelled Wednesdays for the session helpers in lib/pipeline. */
export async function getData(): Promise<PipelineData> { const d = await getDataCached(); setCancelledSessions(d.cancelledSessions); return d; }
export async function getDataWithHistory(): Promise<PipelineData> { const d = await getDataWithHistoryCached(); setCancelledSessions(d.cancelledSessions); return d; }

/** One message in an applicant's email or OLJ conversation, oldest first. */
export type ThreadItem = {
  dir: 'in' | 'out'; at: string; channel?: 'OLJ'; type?: string; subject?: string; text?: string;
  status?: string; by?: string; category?: string; note?: string;
};
export type ApplicantDetail = { applicant: Row | null; thread: ThreadItem[]; scores: Row[] };

/** One applicant with every column (application answers, links, notes), their conversation and scorecards. */
export const getApplicantDetail = unstable_cache(
  async (id: string): Promise<ApplicantDetail> => {
    try {
      const r = await call<Partial<ApplicantDetail>>({ action: 'applicant', id });
      const a = r.applicant || null;
      if (a?.['Applied At (PT)']) a['Applied At (PT)'] = ptStamp(a['Applied At (PT)']);
      return { applicant: a, thread: r.thread || [], scores: r.scores || [] };
    } catch {
      // Older Apps Script without the "applicant" action: fall back to the full data set.
      const full = await call<PipelineData>({ action: 'data' });
      return { applicant: full.applicants.find((a) => String(a['Applicant ID']) === id) || null, thread: [], scores: [] };
    }
  },
  ['pipeline-applicant-v2'],
  { revalidate: 60, tags: [PIPELINE_TAG] }
);

/** A read-only call that must not clear the shared cache (e.g. chat polling). */
export async function read<T = Record<string, unknown>>(action: string, payload: Record<string, unknown>) {
  return call<T>({ action, ...payload });
}

export async function act(action: string, by: string, payload: Record<string, unknown>) {
  const res = await call<Record<string, unknown>>({ action, by, ...payload });
  revalidateTag(PIPELINE_TAG);
  return res;
}

/** Needs Attention: emails from an address that matched no applicant, and our replies to it (not cached; always fresh). */
export async function getEmailThread(email: string): Promise<ThreadItem[]> {
  const r = await call<{ thread?: ThreadItem[] }>({ action: 'emailThread', email });
  return r.thread || [];
}

/** One conversation in the inbox panel (Dashboard > OLJ Inbox / Email Inbox). */
export type InboxConversation = {
  key: string; at: string; last: string; needsReply: boolean; email?: string; subject?: string; name?: string;
  applicant: { id: string; name: string; position: string; stage: string; session: string; source: string; email: string } | null;
};

/** The inbox panel's list, newest first (not cached, so a new reply shows on the next open). */
export async function getInbox(channel: 'email' | 'olj'): Promise<InboxConversation[]> {
  const r = await call<{ conversations?: InboxConversation[] }>({ action: 'inbox', channel });
  return r.conversations || [];
}

/** One applicant's conversation for the inbox panel (not cached, so a message just sent shows straight away). */
export async function getConversation(id: string): Promise<{ applicant: Row | null; thread: ThreadItem[] }> {
  const r = await call<{ applicant?: Row | null; thread?: ThreadItem[] }>({ action: 'applicant', id });
  return { applicant: r.applicant || null, thread: r.thread || [] };
}
