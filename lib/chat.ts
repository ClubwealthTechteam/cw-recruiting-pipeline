import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** One-time token the chat routine uses to read context and post its answer for one question. */
export function chatToken(id: string): string {
  return createHmac('sha256', process.env.SESSION_SECRET || '').update(`chat:${id}`).digest('base64url');
}

export function validChatToken(id: string, token: string): boolean {
  const a = Buffer.from(chatToken(id));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Starts a Claude routine through its API trigger (runs on the Claude plan; same method as the Admin Hub). */
export async function fireRoutine(id: string | undefined, token: string | undefined, text: string) {
  if (!id || !token) throw new Error('not configured');
  const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${id}/fire`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'busy, try again in a minute' : `could not start (${res.status})`);
}

/** The "Recruiting – chat bubble answers" routine. */
export async function fireChatRoutine(text: string) {
  if (!process.env.CHAT_ROUTINE_ID || !process.env.CHAT_ROUTINE_TOKEN) throw new Error('The assistant is not connected yet (CHAT_ROUTINE_ID / CHAT_ROUTINE_TOKEN).');
  try {
    await fireRoutine(process.env.CHAT_ROUTINE_ID, process.env.CHAT_ROUTINE_TOKEN, text);
  } catch (e) {
    throw new Error(`The assistant ${e instanceof Error ? e.message : 'could not start'}.`);
  }
}
