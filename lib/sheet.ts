import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { ptStamp } from '@/lib/pipeline';

export type Row = Record<string, string | number>;
/** One Active Team Members row: the Onboarding copy with site edits on top; edited = { field: value in the Onboarding sheet }. */
export type TeamMember = Record<string, string> & { edited?: Record<string, string> };
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
  fetchedAt?: number;
};

/** Applied times in one format (Pacific), so every page sorts and dates them the same way. */
function normalize(d: PipelineData): PipelineData {
  for (const a of d.applicants) if (a['Applied At (PT)']) a['Applied At (PT)'] = ptStamp(a['Applied At (PT)']);
  return d;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
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
  if (!res.ok) throw new Error(`Pipeline service returned ${res.status}`);
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
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
export const getData = unstable_cache(
  async () => ({ ...normalize(await call<PipelineData>({ action: 'data', slim: true })), fetchedAt: Date.now() }),
  ['pipeline-data-v3'],
  { revalidate: 30, tags: [PIPELINE_TAG] }
);

/** Everything, including the ~2,000 applicants from before the system. Only for "Include applicants from before the system". */
export const getDataWithHistory = unstable_cache(
  async () => ({ ...normalize(await call<PipelineData>({ action: 'data', slim: true, withHistory: true })), fetchedAt: Date.now() }),
  ['pipeline-data-all-v1'],
  { revalidate: 120, tags: [PIPELINE_TAG] }
);

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
