# Recruiting pipeline research: what the best tools do, and what we used

Scope: high-volume remote VA hiring with a weekly group Zoom pre-interview. Sources are vendor help documentation and
studies; claims that could not be verified are marked **unverified**.

## Practices we copied

| Practice | Seen in | In our site |
|---|---|---|
| Board/list over the same data, list as the default for volume | Breezy HR, Kula | Candidates list with stage tabs and counts |
| Bulk actions from checkboxes ("Move to stage") | Breezy HR, JOIN | Select rows → Move to… (used after each Wednesday) |
| Required reason when rejecting | JOIN | Reason required for Not Fit, Did Not Complete, re-invite, with common reasons to pick |
| "Needs attention" queue for items a person must read | Lever (stale flags) | Needs Attention page with count in the sidebar |
| Candidate page with an activity timeline | Greenhouse, Lever, Ashby | Applicant page: applied → invited → reply → Zoom → decisions, with who and when |
| Automatic messages tied to stages | Breezy HR | Invite on Applied, reminder for Confirmed, re-invite on Open for re-invite |
| A reply is a stronger signal than an acceptance | Talview (17.4% of accepted invites did not attend) | "Reply with your FULL NAME" marks Confirmed |
| Report everything by source | Ashby | Applicants per week by Form vs OnlineJobs.ph |
| Written stage definitions | Metabase guide to Ashby | Stages fixed in code and in SETUP/README |

## Dashboard metrics (definitions)

- **Confirmation rate** = confirmed ÷ invited, per Wednesday session.
- **Show-up rate** = joined Zoom ÷ confirmed.
- **Completion rate** = 30+ minutes in Zoom ÷ joined.
- **No-show rate** = No Show ÷ confirmed. Invitees who never confirmed and did not join are No Confirmation.
- **Days to interview** = median days from application to the session attended.
- **Pass rate by position** = Passed or Hired ÷ decided, among those who completed an interview.
- Applicants invited by hand before the system started are excluded from rates (no Zoom data for them).

## Benchmarks (for context, not targets)

- Talview 2025, n=5,889: 82.6% of accepted invites attended; entry-level and high-volume roles 3–5 points worse.
- Fountain 2024: 28–40% no-show for frontline 30-minute interviews (taken from a secondary summary).
- No reliable published benchmark exists for **group** interviews; track our own baseline for 4–6 weeks first.

## Suggested next improvements (not built)

- A second reminder the day before (studies: several reminders reduce no-shows more than one; RR 0.75 across 21 trials).
- Flag applicants who confirm less than 24 hours before the session (higher no-show risk, Talview).
- Inactivity flags per stage (e.g. Interview Completed not reviewed after 2 days), as in Lever.

## Sources

- Breezy HR: https://help.breezy.hr/en/articles/9237171-working-with-positions
- Kula: https://support.kula.ai/articles/7019838429-working-your-pipeline-board-view-and-list-view
- JOIN: https://join.com/en/features/pipeline
- Lever: https://help.lever.co/hc/en-us/articles/20087315482269
- Greenhouse: https://support.greenhouse.io/hc/en-us/articles/208063316-Auto-merge
- Teamtailor: https://teamtailor.com/en/productnews/customize-candidate-columns
- Ashby: https://docs.ashbyhq.com/report-catalog-essentials
- Talview: https://www.talview.com/blog/how-candidate-rsvps-predict-interview-attendance
- Reminder meta-analysis: https://pubmed.ncbi.nlm.nih.gov/27798006/
