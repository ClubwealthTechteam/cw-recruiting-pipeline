import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const USERS = ['Miguel', 'Camille', 'Am'] as const;
export type User = (typeof USERS)[number];

const COOKIE = 'cwrp_session';
const TTL_SECONDS = 60 * 60 * 12;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET is not set');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Returns the person whose access code this is, or null. */
export function userForCode(code: string): User | null {
  const entries = (process.env.ACCESS_CODES || '').split(',').map((e) => e.trim()).filter(Boolean);
  for (const e of entries) {
    const i = e.indexOf('=');
    const name = e.slice(0, i).trim() as User;
    const value = e.slice(i + 1).trim();
    if (USERS.includes(name) && value && safeEqual(value, code.trim())) return name;
  }
  return null;
}

export async function startSession(user: User) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${user}.${exp}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: TTL_SECONDS
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [name, exp, sig] = raw.split('.');
  if (!name || !exp || !sig || !safeEqual(sig, sign(`${name}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return USERS.includes(name as User) ? (name as User) : null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}
