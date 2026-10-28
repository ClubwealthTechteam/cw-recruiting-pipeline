# Routine: Recruiting – Zoom attendance (Wednesdays)

**Schedule:** `CRON_TZ=America/Los_Angeles 40 13 * * 3` (Wednesday 1:40 PM PT)
**Environment:** Default (has `ZOOM_ACCOUNT_ID` and the zoom.us network secret)
**Repository:** ClubwealthTechteam/cw-recruiting-pipeline (main)
**Connectors:** Google Sheets only

## Prompt

```
Recruiting pipeline: Wednesday Zoom attendance. Read-only on Zoom; write only to the pipeline sheet.

1. Run in the background:
   python3 -I routines/zoom_attendance.py --out "$TMPDIR/zoom.json" --start 13:45 --end 15:30 --interval 180
   It polls the Club Wealth Help Desk meeting until 3:30 PM PT. Wait for it with Monitor; do not poll it yourself.
   Never print the Zoom token. The script adds the Authorization header itself (approved by Miguel for Zoom only).
2. When it finishes, read the JSON. Append each item in "rows" to the "Zoom Attendance" tab of spreadsheet
   <PIPELINE_SHEET_ID> (the RECRUITMENT PIPELINE BASE sheet; the real ID goes only in the routine, not in this repo) (columns A–I: Interview Date, Zoom Display Name, Parsed Name,
   Parsed Position, Matched Applicant ID (leave blank), Total Minutes, First Join, Last Leave, Segments).
   Leave Result and Matched Applicant ID blank: the sheet's script matches people and sets results.
3. Then, in the Settings tab, set the value of key ZOOM_FINALIZE to today's date (YYYY-MM-DD). Update the existing
   row if the key exists; otherwise append [ZOOM_FINALIZE, date].
4. If the script reports polls = 0 or errors > 0, still do steps 2–3 with what it found, and say so in your reply.
5. Reply with counts only: polls, errors, participants recorded. No names, emails or phone numbers.
Do not change anything else in the sheet, and do not contact anyone.
```


**Arrival (2026-10-28):** each row also carries `Minutes Early` (negative = late) and `Arrival` text, measured from the interview start (`--interview`, default 14:00 PT). The invite asks applicants to join 10 minutes early, so 10+ minutes early is "on time". Apps Script copies both onto the matched applicant; the site shows them on the session page and the applicant page.

## Live mode (from 2026-10-28)
`zoom_attendance.py` saves a snapshot to `--out` after every poll (`"final": false`) and prints `snapshot HH:MM`.
During the session, about every 5 minutes, the session job reads `'Zoom Attendance'!A1:M`, runs
`python3 -I routines/zoom_live_sync.py <sheet values json> <snapshot json>`, and writes its two blocks
(columns F:I and L:M) and appends its new rows. Matched Applicant ID and Result are left to the Apps Script.
The 5-minute Apps Script job (`liveZoom_`) then copies minutes so far and arrival onto each Invited/Confirmed
applicant, so the Session page shows them live. Stages are still set only when ZOOM_FINALIZE is set after 3:30 PM.
