import Link from 'next/link';

type Section = { title: string; href?: string; items: string[] };

/** Every feature of the CRM and its automations, in plain words. Keep this list up to date when features change. */
const SECTIONS: Section[] = [
  {
    title: 'New applicants and screening',
    items: [
      'New Google Form and OnlineJobs.ph applicants appear in the CRM by themselves. Applications emailed to CareersCW are read, summarized and added as Source Email once email intake is on (Settings EMAIL_INTAKE = ON).',
      'Referrals (someone a team member referred, with no form, OLJ or email application) are added by hand as Source Referral with a Referral tag.',
      'Positions are standardized ("Appointment Setter" counts as ISA).',
      'Before any invite, each applicant is checked for an open position (Collections, ISA, TC/LC), the Rejected tab, and duplicates (same email or same name). Anyone held back shows why under Invite on their profile.',
      'Fit rating (Great, Good or Not Fit, with a one-line reason) is given every 2 hours from 6 AM to 8 PM PT. "Not rated yet" means the next run has not reached them, or the position has no screening rule.',
      'OLJ applicants are only invited once they say they are interested and send a summary, resume or cover message.'
    ]
  },
  {
    title: 'Invites and reminders',
    items: [
      'Pre-interview invites go out by themselves: by email from CareersCW (Club Wealth sign-off and banner) or by OLJ message for OLJ applicants.',
      'Wednesday 12 PM PT cut-off: before it, the invite is for today\'s session; after it, next Wednesday\'s.',
      'Wednesday reminders: by email at 6 AM to confirmed applicants; on OLJ during the morning checks.',
      'Applicants who say they can\'t attend are re-invited to the following Wednesday.',
      'Move to another session (under Invite on a profile, or for selected applicants in the bulk bar) puts someone on any upcoming Wednesday. Emails still waiting for the old date are cancelled; tick "Send new invite" to email the invite for the new date.'
    ]
  },
  {
    title: 'Replies and confirmations',
    items: [
      'Replies to CareersCW are copied in every hour (the mailbox is read only). Replying with their full name confirms the applicant.',
      'OLJ replies are checked on Tuesdays and Wednesdays with the same rules.',
      'Questions and anything unclear go to Needs Attention.'
    ]
  },
  {
    title: 'Zoom attendance (Wednesdays)',
    href: '/session',
    items: [
      'From 1:40 PM, arrival (minutes early or late) and Zoom minutes update live on This Week\'s Session, about every 5 minutes.',
      'While the session runs, a green "In Zoom now" or grey "Left Zoom 2:13 PM" badge shows next to the stage on Candidates, the Board and the Session page. It disappears after the 3:30 wrap-up.',
      'The invite asks applicants to join 10 minutes early; green = on time, amber = under 10 minutes early, red = late.',
      'If someone renames themselves in Zoom, their time stops counting at the rename.',
      'At 3:30 PM the stages are set: Interview Completed (stayed 1h+ in Zoom), Did Not Complete (under 1 hour), No Show (confirmed but did not join) or No Confirmation (invited, never confirmed, did not join).',
      'Someone who says the role is not for them and leaves the session: move them to Uninterested | Left Zoom by hand. The 3:30 wrap-up leaves them as they are.'
    ]
  },
  {
    title: 'Dashboard',
    href: '/',
    items: ['Confirmation, show-up and completion rates, applicants per week (Form, OLJ, Email, Referral), the pipeline by stage and by position. Click any bar to see the people.', 'Filter by session to see one Wednesday on its own (rates, pipeline and positions for that session\'s invitees), or change the applied period: last 30, 60 or 90 days, or all time.']
  },
  {
    title: 'Candidates',
    href: '/candidates',
    items: [
      '+ Add applicant (referral) above the table adds someone by hand (Source Referral, tagged Referral). With an email it can send the pre-interview invite straight away, with the same screening and cut-off as form applicants.',
      'Filter by stage, fit, source, position, score, tag and session. Counts per position update with the filters.',
      'Saved views (shared by the team): pick filters, then "+ Save this view".',
      'Newest applicant first, with the time they applied. The header stays on top while scrolling.',
      'Select several applicants to move them at once. Hover a row to change the stage or add a note right there.',
      'Click a name to open the profile in a side panel (Esc closes it).'
    ]
  },
  {
    title: 'Pipeline Board',
    href: '/board',
    items: [
      'One column per stage: Applied, Invited, Confirmed, Interview Completed, Passed Pre-Interview, Passed Interview, Hired, Onboarded, then re-invite, Did Not Complete, Uninterested | Left Zoom, No Show, No Confirmation and Not Fit.',
      'Drag a card to another column to move the applicant. Drag near the edge to scroll sideways, or use the "Move…" menu on the card.'
    ]
  },
  {
    title: 'Candidate profile',
    items: [
      'Edit profile (under the name) fixes a name, email, phone, country, position, links or experience overview, and can upload a resume. Every change is added to the Notes with who made it.',
      'Interview scorecard: rate Communication, English, Experience, Internet and Work setup (workspace & device) from 1 to 5. It shows 0 until rated; then the CRM suggests Passed (3.5 or higher with no 1s) or Not Fit, and one click applies it. Passed moves someone to Passed Pre-Interview, then to Passed Interview; after both they are marked Hired.',
      'Inbox: the email conversation and, for OLJ applicants, the OLJ conversation, with a box to reply. Email replies go out from CareersCW with the sign-off and banner; OLJ replies go out on the next OLJ run. Unread OLJ conversations stay unread for you.',
      'Tags, notes, the timeline of everything that happened, application answers and links, and invite buttons.'
    ]
  },
  { title: 'This Week\'s Session', href: '/session', items: ['Everyone invited to the Wednesday session: confirmed, reminder sent, arrival and Zoom minutes.'] },
  { title: 'Talent Pool', href: '/talent', items: ['Great and Good fits who were not hired and are not in an interview right now, plus anyone tagged "Talent pool". Invite them again when a position reopens.'] },
  { title: 'Reports', href: '/reports', items: ['By source and by position: applied, invited, confirmed, joined, completed, passed and hired, with completion rate, pass rate and days to hire. Last 30 days, 90 days or all.'] },
  { title: 'Needs Approval', href: '/approvals', items: ['Moving someone to Hired or Onboarded (Hired email), Not Fit (Rejected email) or Benched (Benched email) never sends anything by itself: it prepares the email and shows "ready to send — waiting for approval" on their profile and here, with the exact email.', 'Approve & send sends it from CareersCW; Don\'t send cancels it. Moving them again before approval cancels the old email and prepares the new one, and the same email is never sent twice. Every step is listed under Status emails on the profile.'] },
  { title: 'Active Team Members', href: '/team', items: ['Everyone from the Onboarding sheets (2026: CW, Homexa, PFL; 2025; 2023-2024), copied every hour, grouped by department. Someone hired more than once shows once, with their latest hire. Active people (Working or no status yet) come first; pick another status in the status dropdown.', 'Edit changes department, status, position or notes here only (saved in the Team Updates tab). An edit wins over the Onboarding sheet until you click Use sheet value. The Onboarding sheet itself is never changed.'] },
  { title: 'Banned', items: ['Anyone whose email is on the Rejected tab of the form sheet moves to Banned, and new applications from those emails go straight there. They are never invited.'] },
  { title: 'Needs Attention', href: '/attention', items: ['Applicant questions, replies the system could not match, failed emails and do-not-invite hits. Mark each one resolved when done.', 'Unmatched email replies (for example a reschedule request from a different address): Open emails & reply shows the whole email, lets you answer from CareersCW, and Link to applicant files it under the right person (and can save the new email on them), so you can re-invite them from their profile.'] },
  {
    title: 'Slack messages to Am and Camille',
    items: ['New Great or Good applicants, new Needs Attention items, late joiners during the session, the session results, and a weekly report every Thursday at 9 AM.']
  },
  {
    title: 'Undo',
    items: [
      'After a stage move, a note or a tag change, click Undo in the pop-up, the ↶ Undo button on Candidates or the Pipeline Board, or press Ctrl+Z.',
      'Undoing a move puts the applicant back and cancels any email the move queued that has not gone out yet.'
    ]
  },
  {
    title: 'Shortcuts and tips',
    items: [
      'Ctrl+K: find anyone or any page.',
      '« at the top of the sidebar shrinks it to icons.',
      'The blue bar at the top means a page is loading. A notice appears when a new version of the CRM is out.',
      'Test applicants are shown with a "Test · not counted" tag and never count in numbers or reports.',
      'Ask (bottom right): ask a question about the pipeline.'
    ]
  }
];

export default function Help() {
  return (
    <>
      <header className="page-head">
        <h1>Help: what the CRM does</h1>
        <p className="sub">Everything the Recruiting Pipeline does for Recruitment, and where to find it.</p>
      </header>
      <div className="help-grid">
        {SECTIONS.map((sec) => (
          <section key={sec.title} className="panel">
            <h2>{sec.href ? <Link href={sec.href}>{sec.title}</Link> : sec.title}</h2>
            <ul className="help-list">{sec.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
        ))}
      </div>
    </>
  );
}
