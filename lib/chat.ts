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

/**
 * Starts the "Recruiting – chat bubble" Claude routine (runs on the Claude plan, no API key or API charges).
 * Same mechanism as the Admin Hub: the routine's own API trigger token, kept in Vercel.
 */
export async function fireChatRoutine(text: string) {
  const id = process.env.CHAT_ROUTINE_ID;
  const token = process.env.CHAT_ROUTINE_TOKEN;
  if (!id || !token) throw new Error('The assistant is not connected yet (CHAT_ROUTINE_ID / CHAT_ROUTINE_TOKEN).');
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
  if (!res.ok) throw new Error(res.status === 429 ? 'The assistant is busy. Try again in a minute.' : `The assistant could not start (${res.status}).`);
}
