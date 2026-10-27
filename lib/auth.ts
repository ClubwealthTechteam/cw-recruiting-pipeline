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

/** Returns the person whose access code this is, or null. ACCESS_CODES is a JSON map of name to code. */
export function userForCode(name: string, code: string): User | null {
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(process.env.ACCESS_CODES || '{}');
  } catch {
    return null;
  }
  const expected = map[name];
  if (!USERS.includes(name as User) || !expected) return null;
  return safeEqual(expected.trim().toUpperCase(), code.trim().toUpperCase()) ? (name as User) : null;
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

// Five wrong codes lock that name for 15 minutes (per server instance; codes are long enough that this is a backstop).
const attempts = new Map<string, { count: number; until: number }>();

export function isLocked(name: string): boolean {
  const a = attempts.get(name);
  return !!a && a.until > Date.now();
}

export function recordFailure(name: string) {
  const a = attempts.get(name) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 5) {
    a.until = Date.now() + 15 * 60_000;
    a.count = 0;
  }
  attempts.set(name, a);
}

export function clearFailures(name: string) {
  attempts.delete(name);
}
