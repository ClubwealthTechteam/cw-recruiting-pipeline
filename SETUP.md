# Recruiting Pipeline – setup

Everything below is done once. Nothing emails a real applicant until Settings `MODE` is changed to `LIVE`.

## 1. Apps Script (the pipeline engine)

Use the standalone Apps Script project (script.google.com), signed in as the marketing account.

1. Replace `Code.gs` with `apps-script/Code.gs`. Add a file named `Logic` (**+ → Script**) and paste `apps-script/Logic.gs`.
2. **Project Settings** (gear) → tick **Show "appsscript.json" manifest file in editor**, then replace its content with `apps-script/appsscript.json`.
3. **Project Settings → Script Properties → Add script property**, two of them:
   - `PIPELINE_SHEET_ID` = the ID of the RECRUITMENT PIPELINE BASE sheet (the long part of its link between `/d/` and `/edit`).
   - `API_SECRET` = a long random string (30+ characters). Keep it for step 2.
4. In the editor choose the function **setup** and click **Run**. Approve the Google permissions (marketing account).
   This adds the **Test Form** tab, the **Applied** column in Outbox, and the every-5-minutes trigger.
5. **Deploy → New deployment → gear → Web app**: Execute as **Me**, Who has access **Anyone**. Click **Deploy**, copy the **Web app URL**.
   ("Anyone" is needed so Vercel can reach it; every request must carry `API_SECRET`, or it is refused.)

## 2. Vercel environment variables

Project → **Settings → Environment Variables** (Production and Preview):

| Name | Value |
|---|---|
| `ACCESS_CODES` | `{"Miguel":"CW-....-....","Camille":"CW-....-....","Am":"CW-....-...."}` |
| `SESSION_SECRET` | a long random string (30+ characters) |
| `APPS_SCRIPT_URL` | the Web app URL from step 1.6 |
| `APPS_SCRIPT_SECRET` | the same value as `API_SECRET` |

Then **Deployments → Redeploy**.

## 3. Zapier (CareersCW@clubwealth.com) — sending only

Connection: **SMTP by Zapier** for CareersCW@clubwealth.com (smtp.office365.com, port 587, Use TLS = No; the
connection still upgrades to TLS). Replies are not read automatically (Microsoft 365 blocks IMAP password logins);
Am reads the CareersCW inbox and moves email applicants to Confirmed on the site.

Workflow **recruiting-pipeline-email-sender** (private, https://zapier.com/workflow/01a1831b-ac07-7da4-8012-701ef2afcff3):
a catch hook that sends one email per call from CareersCW, only with the pipeline's own subjects.

Apps Script → Project Settings → Script Properties: add `ZAPIER_SEND_HOOK` = the hook's webhook URL (kept out of the
sheet on purpose). Then Settings `EMAIL_SENDING` = `ON`. Every 5 minutes Apps Script posts each Queued Invite,
Re-invite, Reminder or Confirmation to the hook and marks it Sent (or Failed, which is flagged). OLJ invites are never
emailed. Set `EMAIL_SENDING` to anything else to stop all email at once.

## 4. Testing (MODE = TEST)

Add rows to the **Test Form** tab (same columns as the real form) with fake names. Every email goes to `TEST_EMAIL`
with `[TEST]` in the subject. Reply from techteam@ with the fake full name to test confirmation.

## 5. Go live

1. Settings `MODE` → `LIVE`.
2. In Apps Script run **importHistory** once: brings in every applicant Am already invited (no emails), then
   new form responses are invited automatically.
3. Am stops sending invites by hand from that moment.

## Claude routines

See `routines/`. Each one is created in claude.ai only after Miguel approves its usage.
