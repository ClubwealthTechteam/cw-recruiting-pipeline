# Routine: Recruiting – candidate screening

**Schedule:** `CRON_TZ=America/Los_Angeles 23 6-20/2 * * *` (every 2 hours, 6:23 AM–8:23 PM PT) · **Routine:** trig_011oftMuKspALRFGKg3zkzV7 · **Connectors:** Google Sheets · No scripts (connectors only). Writes only Applicants AP:AR (Screen Tag, Screen Summary, Screened At) for unrated rows; skips pre-system rows, test applicants and positions with no rule.

Screening rules (approved by Miguel, 2026-10-28):
| Track | Rule |
|---|---|
| Transaction Coordinator | 6+ months as a transaction coordinator |
| ISA CW | 6+ months BPO experience |
| ISA Homexa | 6+ months as an ISA in the real estate industry with a known real estate agency |
| ISA (unspecified) | judge against both ISA rules; say which one it fits |
| Collections | any collections experience (any industry) |

**Cross-fit rule (Miguel, 2026-10-29):** judge against the applicant's own track first. If they do not meet it, check
the other open tracks. An ISA applicant who meets ISA CW (6+ months BPO) is never Not Fit, even if they do not meet ISA
Homexa; a TC/LC or Collections applicant whose experience meets ISA CW (or another open track) is not Not Fit either.
They are tagged Great or Good for the track they fit, and the summary starts "Fits <track> (applied for <track>):".
Not Fit = meets none of the open tracks. On 2026-10-29 every earlier Not Fit was re-checked once under this rule.

Tags: **Great** = clearly meets the rule (1+ year or highly relevant) · **Good** = meets the 6-month minimum · **Not Fit** = the stated experience meets none of the open tracks (no experience details = "Not rated yet", see below).
The tag only guides Recruitment; it never changes a stage.

**No details rule (Miguel, 2026-10-28):** an applicant whose application or OLJ summary says nothing about their work
experience is NOT tagged Not Fit. The tag stays empty ("Not rated yet") and the summary says "Not rated yet: … no
experience details". Not Fit is only for applicants whose stated experience does not meet the rule. (The first run on
2026-10-28 had tagged 32 OLJ applicants Not Fit for this reason; those were cleared by hand.)
