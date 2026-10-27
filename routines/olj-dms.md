# Routine: Recruiting – OnlineJobs.ph DMs (4 times a day)

**Schedule:** `CRON_TZ=America/Los_Angeles 17 7,10,13,16 * * *` · **Environment:** Default (`OLJ_EMAIL`, `OLJ_PASSWORD`) · **Connectors:** Google Sheets

`routines/olj_dms.js` signs in once per run, reads the job posts and their conversation lists, and stops on any
captcha or verification. It never opens an unread conversation (that would mark it read for Recruitment); it opens
already-read conversations only when new or changed, to summarize what the applicant wrote. Archived conversations
are skipped. It never replies, sends, archives, labels, pins or changes anything.

Every conversation in the list includes the applicant's email, so the approved "please share your email" message
is not needed and the routine sends nothing on OLJ.

The routine writes one row per conversation to the **OLJ** tab; the Apps Script adds new OLJ applicants to the
pipeline as Applied with their summary.
