import 'server-only';
import { createSign } from 'node:crypto';

/**
 * Google access for the CRM itself (database stage 3, Miguel 2026-11-13): the service account
 * cw-recruiting-crm@cw-ai-task-hub.iam.gserviceaccount.com, its key in GOOGLE_SERVICE_ACCOUNT_JSON (Vercel).
 * Signs a short-lived token (OAuth JWT bearer) and calls the Sheets and Drive APIs with it. No extra packages.
 */
type Key = { client_email: string; private_key: string; token_uri?: string };
export const SERVICE_ACCOUNT = 'cw-recruiting-crm@cw-ai-task-hub.iam.gserviceaccount.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';

export function googleConfigured() { return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON; }

function key(): Key {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set in Vercel.');
  let k: Key;
  try { k = JSON.parse(raw); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: paste the whole key file.'); }
  if (!k.client_email || !k.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.');
  return k;
}

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
let cached: { token: string; exp: number } | null = null;

export async function googleToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const k = key();
  const now = Math.floor(Date.now() / 1000);
  const aud = k.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({ iss: k.client_email, scope: SCOPES, aud, iat: now, exp: now + 3600 }))}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(k.private_key);
  const res = await fetch(aud, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64(sig)}` }), cache: 'no-store'
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error('Google refused the service account key: ' + (j.error_description || j.error || res.status));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

export async function googleGet<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await googleToken()}` }, cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: (j as { error?: { message?: string } }).error?.message || String(res.status) };
  return { ok: true, data: j as T };
}

/** The files the CRM needs and the access it needs (docs/stage3-plan.md). */
export const GOOGLE_FILES: { name: string; id: string; need: 'Editor' | 'Viewer'; folder?: boolean }[] = [
  { name: 'Recruitment Pipeline sheet', id: '11CpfMQhC97DCqFQhZuBL73XCUw8H3zrb_FAKW7vcv8o', need: 'Editor' },
  { name: 'Form responses sheet', id: '1nj4oJFLTT_s6yj4voBF2wRsB-renriq2T_kh7j82PQ0', need: 'Viewer' },
  { name: 'Onboarding sheet (current)', id: '1cZ8RXgdvQ32CzXQlLMwojNe16cm3jQuwllTWBWaQHqI', need: 'Viewer' },
  { name: 'Onboarding sheet (2025)', id: '1-gltrA1qQekPpYik49VL_lgc0PvqkxsipRz4d1l89F4', need: 'Viewer' },
  { name: 'Onboarding sheet (2023-2024)', id: '1ql473Qhn0mJHkHrvuINZAkHSRClr3ClYbPkyPzMLJ8g', need: 'Viewer' },
  { name: 'ISA Masterfile', id: '1ahOwILkD6_S_YDoEiy_zg4hmqkvEUgsMVoXXfW0t3Bg', need: 'Viewer' },
  { name: 'Drive folder: Recruiting Pipeline - Resumes', id: '1KwQpUU0FKvlf-96mKij15w3vqal0Bmzv', need: 'Editor', folder: true }
];

export type AccessResult = { name: string; need: string; result: 'ok' | 'read-only' | 'no access'; detail: string };

/** Can the CRM open each file, and edit the ones it must write to? */
export async function checkGoogleAccess(): Promise<AccessResult[]> {
  return Promise.all(GOOGLE_FILES.map(async (f) => {
    const r = await googleGet<{ name: string; capabilities?: { canEdit?: boolean; canAddChildren?: boolean } }>(
      `https://www.googleapis.com/drive/v3/files/${f.id}?fields=name,capabilities(canEdit,canAddChildren)&supportsAllDrives=true`
    );
    if (!r.ok) return { name: f.name, need: f.need, result: 'no access' as const, detail: r.status === 404 ? 'not shared with the service account (or the link changed)' : r.error };
    const canWrite = f.folder ? !!r.data.capabilities?.canAddChildren : !!r.data.capabilities?.canEdit;
    return { name: f.name, need: f.need, result: f.need === 'Editor' && !canWrite ? 'read-only' as const : 'ok' as const, detail: r.data.name };
  }));
}
