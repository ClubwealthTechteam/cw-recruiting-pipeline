# Database stage 3: the background engine moves into the CRM

Decided by Miguel, 2026-11-13:
- **Clock:** Apps Script shrinks to a few lines that only ping the CRM (every minute). Pasted one last time.
- **Google access:** a new service account ("CW Recruiting CRM") reads the form sheet, onboarding sheets and ISA
  Masterfile, and saves resumes / attachments to Drive.
- **Inputs:** Zapier (applicant email replies, email applications) and the OLJ routines post straight to the CRM.

After stage 3 the Neon database is the only place the CRM keeps its data. The Google Sheet becomes a copy that the
CRM writes to (for reading by hand, and as a backup) and is no longer read.

## Order (each step is its own PR, safe to merge alone, with a switch on the Database page to go back)

| Step | Moves to the CRM | Outside changes needed |
|---|---|---|
| 3a | The clock endpoint; **email sending** (Outbox → Zapier hook, Sent / Failed), **Wednesday reminders**, applying sent invites (stage Invited, reminder stamps) | Vercel env: the Zapier email hook URL |
| 3b | **Replies**: Zapier posts each CareersCW reply to the CRM; sorting, matching, confirm / reschedule / flags | Change the Zapier "copy reply to sheet" step to a webhook |
| 3c | **Form intake** (new rows from the form sheet), screening, automatic invites, resumes to Drive | Service account shared on the form sheet + Drive folder |
| 3d | **Zoom** tracking (every minute) and results; **OLJ** (routines post to the CRM); **email applications** | Zoom keys in Vercel; OLJ routines' post address |
| 3e | **Team sync**, **Offboarded** (ISA Masterfile), **Banned** sweep, Slack alerts, weekly report | Service account shared on onboarding sheets + ISA Masterfile |
| 3f | All saves write the database only (no queue); the sheet becomes a copy; Apps Script reduced to the clock | Paste the clock Code.gs one last time |

Every engine test in tests/engine.test.js is kept and run against the CRM version of each job before it switches over.

## Service account setup (Miguel, once)

1. https://console.cloud.google.com → pick (or create) a project → **APIs & Services → Library**: enable
   **Google Sheets API** and **Google Drive API**.
2. **IAM & Admin → Service Accounts → Create service account**: name `cw-recruiting-crm` → Done.
3. Open it → **Keys → Add key → Create new key → JSON** (a file downloads; keep it private, never paste it in chat).
4. In Vercel → cw-recruiting-pipeline → **Settings → Environment Variables**: add `GOOGLE_SERVICE_ACCOUNT_JSON`,
   paste the whole file's contents as the value, tick Production / Preview / Development, Sensitive on, Save.
5. Share with the service account's email (`cw-recruiting-crm@<project>.iam.gserviceaccount.com`):
   - the **Recruitment Pipeline** sheet: Editor
   - the **form responses** sheet: Viewer
   - the **onboarding** sheets and the **ISA Masterfile**: Viewer
   - the Drive folders **Recruiting Pipeline - Resumes** and **Recruiting Pipeline - Email Attachments**: Editor
