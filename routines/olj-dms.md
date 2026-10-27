# Routine: Recruiting – OnlineJobs.ph DMs (4 times a day)

**Status: draft. Not built until Miguel answers the "marked as read" question and approves the email-request wording.**

**Schedule (proposed):** `CRON_TZ=America/Los_Angeles 17 7,10,13,16 * * *`
**Environment:** Default (`OLJ_EMAIL`, `OLJ_PASSWORD`)
**Connectors:** Google Sheets only

Rules: sign in once per run, normal pace, stop on any captcha or verification code. Job posts only, never Archive.
The only thing it may send is the one approved "please share your email" message, once per applicant.
Never reply otherwise, archive, label, pin, hire or change settings.
