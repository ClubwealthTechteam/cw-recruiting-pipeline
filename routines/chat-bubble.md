# Routine: Recruiting – chat bubble answers

**ID:** trig_01F9YX14BE331PUA3nteh2eM · **Schedule:** none (fired by the site, one run per question) · **Connectors:** none

Flow: the site stores the question in the Chat tab (Apps Script), fires this routine through its API trigger
(`CHAT_ROUTINE_ID`, `CHAT_ROUTINE_TOKEN` in Vercel), the routine reads `/api/chat/context` with a one-time token,
and posts its answer to `/api/chat/reply`. The widget polls until the answer arrives (about a minute).
Read-only: the routine cannot change any pipeline data. No emails or phone numbers are in the context.
