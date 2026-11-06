/**
 * The in-app tutorials (Miguel, 2026-11-02). Each step opens a real page, highlights one part of it (an element with
 * data-tour="…") and says exactly what to do there. path "@first-candidate" = the first applicant in the Candidates list.
 * optional steps are skipped when that part is not on the page (e.g. Live in Zoom outside the session).
 */
export type TourStep = { path: string; target?: string; title: string; body: string; optional?: boolean };
export type TourDef = { id: string; title: string; minutes: number; summary: string; steps: TourStep[] };

export const TOURS: TourDef[] = [
  {
    id: 'basics', title: 'Getting around CWCRM', minutes: 2,
    summary: 'The sidebar, the Home page, search and the assistant. Start here.',
    steps: [
      { path: '/', title: 'Welcome to CWCRM', body: 'This tour shows you where everything is. Use Next and Back below, or press Esc to stop at any time. You can restart it from Help → Tutorials.' },
      { path: '/', target: 'nav-home', title: 'Home', body: 'Home is your start page each day. It greets whoever is signed in and shows what needs you today.' },
      { path: '/', target: 'home-todo', title: 'Needs you today', body: 'Work this list from top to bottom. Each line has a button that takes you straight to the people or emails involved: open items to check, status emails to approve, interviews to rate, and invitees who have not confirmed.' },
      { path: '/', target: 'home-session', title: 'The next Wednesday session', body: 'How many are invited and confirmed for the next 2:00 PM PT pre-interview. The time is also shown in Philippine time (PHT), which is what most applicants see. Click Open session to see the list of people.' },
      { path: '/', target: 'home-numbers', title: 'Key numbers', body: 'New applicants this week, invites for the next session, how many fit, and hires this month. Click a number to see the people behind it.' },
      { path: '/', target: 'ask-bar', title: 'Ask the assistant', body: 'Type a question in plain English, for example "How many confirmed for Wednesday?" and press Ask. The answer appears in the Ask bubble at the bottom right after about a minute. It only reads; it never changes anything.' },
      { path: '/', target: 'search', title: 'Find anyone', body: 'Click here or press Ctrl + K anywhere, type part of a name, and press Enter to open that applicant.' },
      { path: '/', target: 'nav-candidates', title: 'Candidates', body: 'The full list of applicants, with filters and saved views. The next tutorial, "Review a new applicant", walks through it.' },
      { path: '/', target: 'nav-inbox-email', title: 'Inboxes', body: 'Email Inbox and OLJ Inbox open as a panel over the page, so you never lose your place. Replies from applicants land here.' },
      { path: '/', target: 'nav-attention', title: 'Needs Attention and Needs Approval', body: 'Needs Attention collects problems the system found (bounced emails, reschedule requests). Needs Approval holds Hired, Rejected and Benched emails; they are never sent until someone approves them.' },
      { path: '/', target: 'me', title: 'Who is signed in', body: 'Your name is here. Everything you do is recorded under it, and the others see it ("Camille is viewing this now"). Sign out here on a shared computer.' }
    ]
  },
  {
    id: 'review', title: 'Review a new applicant', minutes: 3,
    summary: 'Find new applicants, read their profile, check the resume and fit, and leave a note.',
    steps: [
      { path: '/candidates', target: 'views', title: '1. Pick a view', body: 'These tabs are saved views. Click one to filter the list, for example "Applied" for people not yet invited. Set filters and click Save view to keep your own.' },
      { path: '/candidates', target: 'cand-table', title: '2. Spot what is new', body: 'A blue dot before a name means the applicant is new or changed since your last visit on this computer. The Fit column is the screening rating (Great, Good, Not Fit); hover it to read why.' },
      { path: '@first-candidate', target: 'facts', title: '3. The profile: facts on the left', body: 'Contact details, when they applied (Pacific and Philippine time), their application answers and links (resume, voice recording, speed test). "Experience (from resume)" lists each job read from the resume.' },
      { path: '@first-candidate', target: 'duplicate', optional: true, title: 'Possible duplicate', body: 'This person may have applied twice. Open the other record, keep one, and move the other to Not Fit or Banned with the reason "Duplicate". If they are different people, click "Not a duplicate".' },
      { path: '@first-candidate', target: 'recent', optional: true, title: 'Someone else just worked here', body: 'A teammate moved or messaged this applicant in the last hour. Read the conversation before you reply or move them, so nobody does it twice.' },
      { path: '@first-candidate', target: 'timeline', title: '4. Timeline', body: 'Everything that happened to this applicant, newest first: stage moves (and who made them), emails, Zoom attendance.' },
      { path: '@first-candidate', target: 'notes', title: '5. Leave a note', body: 'Type a note for the team and click Add note. Press N on the profile to jump here.' },
      { path: '@first-candidate', target: 'profile-nav', title: '6. Next applicant', body: 'Prev and Next move through the Candidates list without going back. Keyboard: J = next, K = previous, E = reply, S = stage, N = note. Click ⌨ to see the list any time.' }
    ]
  },
  {
    id: 'invite', title: 'Invite someone to the pre-interview', minutes: 2,
    summary: 'Send one invite, or invite many at once, and check the email before it goes out.',
    steps: [
      { path: '@first-candidate', target: 'session-box', title: '1. The Session box', body: 'On the right of every profile. It shows their current session in Pacific and Philippine time, and how many invites they got.' },
      { path: '@first-candidate', target: 'invite', title: '2. Send the invite', body: 'Click "Send invite via Email" (or "via OLJ" for OnlineJobs.ph applicants). Nothing is sent yet: a preview opens first.' },
      { path: '@first-candidate', target: 'invite', title: '3. Check the preview', body: 'The preview shows exactly what the applicant gets: To, Subject, the Wednesday date and time, and the banner. Check the name and date, then click Send. Click Cancel if anything looks wrong. In TEST mode it goes to the test inbox instead.' },
      { path: '/candidates', target: 'cand-table', title: '4. Invite many at once', body: 'Tick the boxes next to several applicants. A bar appears at the top: pick a session in "Session…", tick "Send new invite" and click Move.' },
      { path: '/candidates', target: 'cand-table', title: '5. Bulk preview', body: 'For more than one person the preview shows the count ("This goes to 12 people") and one sample copy. Tick "Yes, send to all 12 people" before the Send button works. This stops accidental mass sends.' }
    ]
  },
  {
    id: 'session', title: 'Run the Wednesday session', minutes: 3,
    summary: 'Before, during and after the 2:00 PM PT call: rules, live Zoom, quick decisions, re-invites.',
    steps: [
      { path: '/session', target: 'nav-session', title: '1. This Week\'s Session', body: 'Open this before 2:00 PM PT on Wednesday. It lists everyone invited to that session. Use Previous / Next week at the top to see other weeks.' },
      { path: '/session', target: 'tracking', optional: true, title: 'Attendance tracking', body: 'On session day, the first click on Open session (Home) from 1:30 PM PT starts Zoom attendance tracking, once. This line says when it started and the last Zoom check; results are set after 3:30 PM.' },
      { path: '/session', target: 'nonneg', title: '2. Non-negotiables', body: 'The rules to read out at the start of the call. Click the bar to open them. On session day they open by themselves.' },
      { path: '/session', target: 'session-day', optional: true, title: '3. Session day mode', body: 'On Wednesday the page switches to session day mode: each person gets Pass, Not Fit, Left Zoom and Did not finish buttons. Not Fit and Did not finish ask for a reason. A message at the bottom lets you Undo.' },
      { path: '/session', target: 'roster', title: '4. The roster', body: 'Everyone invited: whether they confirmed, got the reminder, when they joined (green = early, amber = less than 10 minutes early, red = late) and minutes in Zoom. Click a name to open their profile in a side panel.' },
      { path: '/session', target: 'reinvite', optional: true, title: '5. After the session: re-invite no-shows', body: 'Pick a later Wednesday and click Re-invite no-shows. A preview shows the invite and the number of people; tick the box and click Send.' }
    ]
  },
  {
    id: 'reply', title: 'Answer applicants', minutes: 2,
    summary: 'Read replies in the inboxes and answer by email or OLJ with a preview.',
    steps: [
      { path: '/', target: 'nav-inbox-email', title: '1. Open the Email Inbox', body: 'Click Email Inbox (or OLJ Inbox). The list shows each conversation; a dot means unanswered. Click one to read it and answer right there.' },
      { path: '@first-candidate', target: 'reply', title: '2. Or answer from the profile', body: 'The Conversation box on a profile shows the whole thread. Switch between Email and OLJ with the buttons on top. Press E to jump here.' },
      { path: '@first-candidate', target: 'reply', title: '3. Write and preview', body: 'Type your answer (no greeting sign-off needed: "Cheers, Club Wealth" and the banner are added). Click Send email: a preview opens with the full email. Click Send to queue it; it goes out within 5 minutes.' }
    ]
  },
  {
    id: 'decide', title: 'After the interview: rate, decide, approve', minutes: 2,
    summary: 'Scorecards, moving stages on the board, and approving status emails.',
    steps: [
      { path: '@first-candidate', target: 'scorecard', title: '1. Fill in the scorecard', body: 'Rate all five (1 = poor, 5 = excellent) and click Save my scorecard. Each interviewer saves their own; the average and a suggestion (Passed or Not Fit) appear on top.' },
      { path: '@first-candidate', target: 'stage', title: '2. Move the stage', body: 'Pick the new stage. For a hire pick "Hired | Homexa" or "Hired | Clubwealth" and the start date: that tags them and prepares the right Welcome & Onboarding email. Not Fit, Did Not Complete and re-invites need a reason (pick a common one or type your own). Press S to jump here. Undo is in the message at the bottom.' },
      { path: '/board', target: 'board', title: '3. Or drag on the board', body: 'The Pipeline Board shows every stage as a column. Drag a card to another column to move it. Click a name to open the profile in a panel that slides in from the right.' },
      { path: '/approvals', target: 'nav-approvals', title: '4. Approve status emails', body: 'Moving someone to Hired, Not Fit or Benched prepares an email here. Read the exact email and click Approve & send, or Don\'t send. Nothing goes out without this step.' }
    ]
  }
];

export const TOUR_KEY = 'cw-tour';
export const TOUR_SEEN = 'cw-tour-seen-v1';
export const START_TOUR_EVENT = 'cw-start-tour';
