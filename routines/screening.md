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

Tags: **Great** = clearly meets the rule (1+ year or highly relevant) · **Good** = meets the 6-month minimum · **Not Fit** = does not meet it or not enough information.
The tag only guides Recruitment; it never changes a stage.
