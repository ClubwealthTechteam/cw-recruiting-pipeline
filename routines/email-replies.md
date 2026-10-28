# Routine: Recruiting – CareersCW email replies (hourly, 6 AM–8 PM PT)

**Schedule:** `CRON_TZ=America/Los_Angeles 7 6-20 * * *` (routines run at most hourly) · **Routine:** trig_01Rf8xkzVZwFrmF3zNctdvMb · **Connectors:** Microsoft 365 (CareersCW@clubwealth.com, read only), Google Sheets · **No scripts** (connectors only, so it is not blocked like the script routines)

Microsoft 365 refuses IMAP password logins, so replies are read through Claude's Microsoft 365 connector,
signed in as CareersCW. Miguel, 2026-10-28: the mailbox is **read only** for Claude, and the routine is the one
that updates the pipeline. It never sends, replies, moves, flags, deletes or marks mail read.

The routine only copies replies into the **Replies** tab. The Apps Script then does the sorting every 5 minutes,
with the same free rules as before (`classifyReply` in `apps-script/Logic.gs`):
full name matching the applicant → **Confirmed**; can't attend → **Open for re-invite** (re-invite queued for the
following Wednesday); question or anything else → **Needs Attention**.

## Prompt

```
Club Wealth Recruiting Pipeline: copy replies to our pre-interview emails from the CareersCW inbox into the pipeline.
Approved by Miguel Ababon (Tech Team), 2026-10-28.
RULES: the Microsoft 365 connector is READ ONLY for you. Never send, reply, forward, move, flag, delete or mark
anything read. Write only to the "Replies" tab of spreadsheet 11CpfMQhC97DCqFQhZuBL73XCUw8H3zrb_FAKW7vcv8o. Never
change any other tab. Your final reply has counts only: no names, emails or message text.

1. With the Google Sheets connector, read column A (Message ID) of tab "Replies" to know what is already copied.
2. With the Microsoft 365 connector (outlook_email_search), find emails received in the CareersCW@clubwealth.com
   inbox in the last 3 days whose subject contains "Pre-Interview invite" or "Pre-reminder invite" (replies are
   usually "RE: ClubWealth | Pre-Interview invite"). Skip emails sent FROM any @clubwealth.com address.
3. For each email whose message id is not already in column A, read it (read_resource) and prepare a row:
   [Message ID, Received At (Pacific time, YYYY-MM-DD HH:mm:ss), From Email (lowercase), Subject,
    Reply Text (only the applicant's new text: drop the quoted original invite and signatures, max 2000 chars)]
   Leave the other columns (Matched Applicant ID, Match Method, Category, Action Taken, Processed At) empty;
   the Apps Script fills them.
4. Append all new rows to "Replies" in one call.
5. Reply with counts only: emails found, already copied, newly copied.
```

## Setup (after the connector shows Connected)
Create the routine with the prompt above, the schedule above, and both connectors attached (Microsoft 365 and
Google Sheets) in the routine's connector list. First run: check the Replies tab and the Run Log.
