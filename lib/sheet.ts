import 'server-only';

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

// Short in-memory cache so moving between pages stays fast; writes clear it.
let cached: { at: number; data: PipelineData } | null = null;

export async function getData(): Promise<PipelineData> {
  if (cached && Date.now() - cached.at < 20_000) return cached.data;
  const data = await call<PipelineData>({ action: 'data' });
  cached = { at: Date.now(), data };
  return data;
}

export async function act(action: string, by: string, payload: Record<string, unknown>) {
  cached = null;
  return call<Record<string, unknown>>({ action, by, ...payload });
}
