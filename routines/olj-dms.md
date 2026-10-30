# Routine: Recruiting – OnlineJobs.ph DMs: send queued + read inbox (4 times a day)

**Schedule:** `CRON_TZ=America/Los_Angeles 17 7,10,13,16 * * *` · **Environment:** Default (`OLJ_EMAIL`, `OLJ_PASSWORD`) · **Connectors:** Google Sheets

`routines/olj_dms.js` signs in once per run, reads the job posts and their conversation lists, and stops on any
captcha or verification. It never opens an unread conversation (that would mark it read for Recruitment); it opens
already-read conversations only when new or changed, to summarize what the applicant wrote. Archived conversations
are skipped. It never replies, sends, archives, labels, pins or changes anything.

Every conversation in the list includes the applicant's email, so the approved "please share your email" message
is not needed and the routine sends nothing on OLJ.

The routine writes one row per conversation to the **OLJ** tab; the Apps Script adds new OLJ applicants to the
pipeline as Applied with their summary.

## OLJ inbox in the CRM (from 2026-10-28)
For each conversation it opened (read ones only), `olj_dms.js` also returns `thread`: the last 20 messages from both
sides (`from`: applicant or us, `at`, `text` up to 1,000 characters). The run writes it as JSON to the OLJ tab's
**Thread** column (K; `setup()` adds it) next to the summary; when `thread` is null, the existing value is kept.
Unread conversations are never opened, so the CRM shows them as "Unread on OLJ" until Recruitment opens them on OLJ.

Answers typed in the CRM are Outbox rows Type **OLJ Message** (Status Queued, Body = the text). The next OLJ sender run
passes them to `olj_send.js` as `{ emailId, key, type: "OLJ Message", text }`; they are sent exactly as typed, once,
then marked Sent. They are never emailed.

## Sending queued OLJ messages (from 2026-10-30)
Each run first sends what Recruitment queued in the CRM (Outbox Type **OLJ Invite** or **OLJ Message**, Status Queued),
at most 10 per run, with `olj_send.js`, then reads the inbox. Invites and reminders for a session that has already
started (Wednesday 2:00 PM PT) are cancelled, not sent. Results go back to Outbox columns I:K: Sent (with Sent At),
Cancelled (already in the conversation), or Failed with the reason (shown in Needs Attention). Anything not reached
stays Queued for the next run. So an OLJ message typed at 9 AM goes out at 10:17 AM.

The reader also fills the **Thread** column: rows with an empty Thread are left out of `known.json`, so their
(read) conversations are opened again, 15 per run, until every row has its messages.

## Read since Oct 24 (from 2026-10-30)
Miguel, 2026-10-30: each run opens every **read** conversation whose last message is on or after 2026-10-24
(`--since 2026-10-24 --max-open 80`), instead of 15 per run. Unread conversations are still never opened, so they
stay unread for Recruitment and show as "Unread on OLJ" in the CRM until someone opens them on OLJ.
