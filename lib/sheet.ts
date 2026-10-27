import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';

export type Row = Record<string, string | number>;
export type PipelineData = {
  applicants: Row[];
  history: Row[];
  flags: Row[];
  zoom: Row[];
  outbox: Row[];
  mode: string;
};

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
 * Served instantly when cached; refreshed in the background at most every 60 seconds, and right after any change.
 */
export const getData = unstable_cache(
  async () => call<PipelineData>({ action: 'data', slim: true }),
  ['pipeline-data-v2'],
  { revalidate: 60, tags: [PIPELINE_TAG] }
);

/** One applicant with every column (application answers, links, notes), cached like the lists. */
export const getApplicant = unstable_cache(
  async (id: string): Promise<Row | null> => {
    try {
      const r = await call<{ applicant: Row | null }>({ action: 'applicant', id });
      return r.applicant;
    } catch {
      // Older Apps Script without the "applicant" action: fall back to the full data set.
      const full = await call<PipelineData>({ action: 'data' });
      return full.applicants.find((a) => String(a['Applicant ID']) === id) || null;
    }
  },
  ['pipeline-applicant-v1'],
  { revalidate: 60, tags: [PIPELINE_TAG] }
);

export async function act(action: string, by: string, payload: Record<string, unknown>) {
  const res = await call<Record<string, unknown>>({ action, by, ...payload });
  revalidateTag(PIPELINE_TAG);
  return res;
}
