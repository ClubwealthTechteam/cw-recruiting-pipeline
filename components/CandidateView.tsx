import { Fragment } from 'react';
import EditProfile from './EditProfile';
import { PendingStatusEmail, StatusEmailLog } from './StatusEmails';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getData, getDataWithHistory, getApplicantDetail } from '@/lib/sheet';
import { currentUser } from '@/lib/auth';
import { s, fullName, ymd, formatDate, formatDateTime, statusEmails, sessionTimes, stampPht, nowStampPT, splitTags } from '@/lib/pipeline';
import Presence from '@/components/Presence';
import NotDuplicate from '@/components/NotDuplicate';
import ProfileKeys from '@/components/ProfileKeys';
import PauseInvitesButton from '@/components/PauseInvitesButton';
import StageBadge from '@/components/StageBadge';
import StageForm from '@/components/StageForm';
import { NoteForm, EmailForm } from '@/components/SmallForms';
import DataError from '@/components/DataError';
import FitBadge from '@/components/FitBadge';
import InviteButtons from '@/components/InviteButtons';
import SessionForm from '@/components/SessionForm';
import Scorecard from '@/components/Scorecard';
import Inbox from '@/components/Inbox';
import TagEditor from '@/components/TagEditor';

const EDITABLE = ['First Name', 'Last Name', 'Email', 'Phone', 'Country', 'Position (as typed)', 'Experience Overview', 'Internet Speed', 'Resume Link', 'Speedtest Link', 'Voice Recording Link', 'Facebook Link'];
const LINKS = ['Resume Link', 'Voice Recording Link', 'Speedtest Link', 'Facebook Link'];
const FIELDS = ['Position (as typed)', 'Country', 'Phone', 'Has Experience', 'Years Experience', 'Recent Client', 'US Clients VA', 'US Realtor VA', 'Internet Speed'];

function safeUrl(v: unknown): string | null {
  try {
    const u = new URL(s(v).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}

/** One applicant's full profile. Used by the profile page and by the side panel on lists (panel = true). */
export default async function CandidateView({ appId, panel = false }: { appId: string; panel?: boolean }) {
  let d, detail;
  try {
    [d, detail] = await Promise.all([getData(), getApplicantDetail(appId)]);
    // applicants from before the system: their history is only in the full data set
    if (detail.applicant && s(detail.applicant.Historical) === 'Y') d = await getDataWithHistory();
  } catch (e) { return <DataError error={e} />; }
  const a = detail.applicant;
  if (!a) notFound();
  const me = (await currentUser()) || 'Miguel';

  type Ev = { at: string; text: string; who?: string };
  const events: Ev[] = [];
  for (const h of d.history.filter((x) => s(x['Applicant ID']) === appId)) {
    events.push({ at: s(h['Timestamp (PT)']), text: `${h['From Stage'] ? `${h['From Stage']} → ` : ''}${h['To Stage']}${h.Reason ? ` · ${h.Reason}` : ''}`, who: s(h['Changed By']) });
  }
  for (const e of d.outbox.filter((x) => s(x['Applicant ID']) === appId)) {
    events.push({ at: s(e['Sent At'] || e['Queued At']), text: `${e.Type} ${s(e.Type).startsWith('OLJ') ? '' : 'email '}${s(e.Status).toLowerCase()}${e['Interview Date'] ? ` for ${formatDate(ymd(e['Interview Date']))}` : ''}${e.Test === 'Y' ? ' (test)' : ''}` });
  }
  for (const z of d.zoom.filter((x) => s(x['Matched Applicant ID']) === appId)) {
    events.push({ at: s(z['Recorded At'] || z['Interview Date']), text: `Zoom: "${z['Zoom Display Name']}" · ${z['Total Minutes']} minutes${z.Arrival ? ` · ${z.Arrival}` : ''}` });
  }
  events.push({ at: s(a['Applied At (PT)']), text: s(a.Source) === 'Referral' ? `Added as a referral${a['Source Ref'] ? ` (${s(a['Source Ref'])})` : ''}` : `Applied via ${s(a.Source) === 'OLJ' ? 'OnlineJobs.ph' : s(a.Source) === 'Email' ? 'an email to CareersCW' : 'the application form'}` });
  if (s(a['Stage Updated By']) === 'Import') events.push({ at: s(a['Stage Updated At']), text: 'Brought into the system as Invited (invited by hand before the system started)' });
  if (a['Confirmed At']) events.push({ at: s(a['Confirmed At']), text: 'Replied with full name (confirmed)' });
  events.sort((x, y) => y.at.localeCompare(x.at));
  const flags = d.flags.filter((f) => s(f['Applicant ID']) === appId && s(f.Status) === 'Open');
  const mail = statusEmails(d.outbox, appId);
  const cards = detail.scores.length ? detail.scores : (d.scores || []).filter((x) => s(x['Applicant ID']) === appId);

  // computed on the cached list (lib/pipeline linkApplications): other positions, repeat application, former VA
  const linked = d.applicants.find((x) => s(x['Applicant ID']) === appId);
  // Possible duplicates: same email, or same first + last name (Miguel, 2026-11-02). Hidden once tagged "Not duplicate".
  const norm = (v: unknown) => s(v).trim().toLowerCase().replace(/\s+/g, ' ');
  const myEmail = norm(a.Email);
  const myName = norm(fullName(a));
  const dups = splitTags(a.Tags).includes('Not duplicate') ? [] : d.applicants.filter((x) => s(x['Applicant ID']) !== appId && (
    (myEmail && norm(x.Email) === myEmail) || (myName.includes(' ') && norm(fullName(x)) === myName)));

  // Someone else worked on this applicant in the last hour: say so, so two people don't reply or move them twice.
  const nowStamp = nowStampPT();
  const minsAgo = (stamp: string) => Math.round((Date.parse(nowStamp.replace(' ', 'T') + 'Z') - Date.parse(stamp.replace(' ', 'T') + 'Z')) / 60000);
  const TEAM = ['Miguel', 'Camille', 'Am'];
  const recent: { who: string; what: string; mins: number }[] = [];
  for (const h of d.history.filter((x) => s(x['Applicant ID']) === appId)) {
    const who = s(h['Changed By']); const m = minsAgo(s(h['Timestamp (PT)']));
    if (TEAM.includes(who) && who !== me && m >= 0 && m <= 60) recent.push({ who, what: `moved this applicant to ${s(h['To Stage'])}`, mins: m });
  }
  for (const e of d.outbox.filter((x) => s(x['Applicant ID']) === appId)) {
    const who = s(e['Queued By']); const m = minsAgo(s(e['Queued At']));
    if (TEAM.includes(who) && who !== me && m >= 0 && m <= 60) recent.push({ who, what: s(e.Type).startsWith('OLJ') ? 'sent an OLJ message' : `sent ${s(e.Type) === 'Reply' ? 'an email reply' : `the ${s(e.Type).toLowerCase()} email`}`, mins: m });
  }
  recent.sort((x, y) => x.mins - y.mins);

  // J / K order: the Candidates list order (newest applicants first)
  const order = d.applicants.filter((x) => s(x.Historical) !== 'Y').sort((x, y) => s(y['Applied At (PT)']).localeCompare(s(x['Applied At (PT)']))).map((x) => s(x['Applicant ID']));
  const at = order.indexOf(appId);
  const prevId = at > 0 ? order[at - 1] : undefined;
  const nextId = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;
  const sessionLine = a['Interview Date'] ? `Wednesday, ${formatDate(ymd(a['Interview Date']))} · ${sessionTimes(ymd(a['Interview Date']))}` : '';
  const initials = fullName(a).split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';

  const notices = (
    <>
      {mail.filter((e) => e.status === 'Pending approval').map((e) => <PendingStatusEmail key={e.id} e={e} />)}
      {recent.length > 0 && <div className="panel info" data-tour="recent"><strong>Heads up:</strong> {recent.slice(0, 2).map((r) => `${r.who} ${r.what} ${r.mins < 1 ? 'just now' : `${r.mins} min ago`}`).join(' · ')}. Check before you reply or move them.</div>}
      {dups.length > 0 && (
        <div className="panel dup" data-tour="duplicate">
          <strong>Possible duplicate:</strong>{' '}
          {dups.slice(0, 3).map((x, i) => <span key={s(x['Applicant ID'])}>{i > 0 && ', '}<a href={`/candidates/${encodeURIComponent(s(x['Applicant ID']))}`}>{fullName(x) || s(x['Applicant ID'])}</a> ({s(x.Source)}, {s(x.Stage)}, applied {formatDate(ymd(x['Applied At (PT)']))})</span>)}
          . Same {myEmail && dups.some((x) => norm(x.Email) === myEmail) ? 'email' : 'name'}. Keep one and move the other to Banned or Not Fit with the reason &quot;Duplicate&quot;, or <NotDuplicate id={appId} tags={s(a.Tags)} />
        </div>
      )}
      {(linked?.['Other Positions'] || linked?.['Former VA'] || linked?.['Repeat Of']) && (
        <div className="panel info" data-tour="applicant-notes">
          {linked?.['Other Positions'] && <div><strong>Also applied for other position:</strong> {s(linked['Other Positions'])}.</div>}
          {linked?.['Repeat Of'] && <div className="muted small">This is a second application from the same person, so it is not counted. The counted one is <a href={`/candidates/${encodeURIComponent(s(linked['Repeat Of']))}`}>{s(linked['Repeat Of'])}</a>.</div>}
          {linked?.['Former VA'] && <div><strong>Applicant is previously a {s(linked['Former VA']).split(' · ')[0]}</strong>{s(linked['Former VA']).includes(' · ') ? ` (${s(linked['Former VA']).split(' · ').slice(1).join(', ')})` : ''}, from the team onboarding list.</div>}
        </div>
      )}
      {/^⚠/m.test(s(a['Resume Experience'])) && <div className="panel warn"><strong>Check experience:</strong> {s(a['Resume Experience']).split('\n').filter((l) => l.startsWith('⚠')).map((l) => l.replace(/^⚠\s*/, '')).join(' ')} Ask about it in the interview.</div>}
      {flags.length > 0 && <div className="panel warn">{flags.length} open item{flags.length > 1 ? 's' : ''} in <Link href="/attention">Needs Attention</Link> for this applicant.</div>}
    </>
  );

  const facts = (
    <section className="panel" data-tour="facts">
      <div className="profile-head">
        <span className="av lg" style={{ background: '#1f5fbf' }}>{initials}</span>
        <div><h1>{fullName(a) || '(no name)'}</h1><div className="muted small">{s(a.Position)} · {s(a.Source)}</div></div>
      </div>
      <p style={{ margin: '10px 0 0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><StageBadge stage={s(a.Stage)} /><FitBadge tag={s(a['Screen Tag'])} track={s(a['Screen Track'])} summary={s(a['Screen Summary'])} /></p>
      <TagEditor id={appId} tags={s(a.Tags)} />
      <h3>Contact</h3>
      <dl className="fields">
        <dt>Email</dt><dd>{s(a.Email) || '—'}</dd>
        {a.Phone && <><dt>Phone</dt><dd>{s(a.Phone)}</dd></>}
        {a.Country && <><dt>Country</dt><dd>{s(a.Country)}</dd></>}
        <dt>Applied</dt><dd>{formatDateTime(s(a['Applied At (PT)']))} PT<div className="time-pht small">{stampPht(s(a['Applied At (PT)']))}</div></dd>
      </dl>
      <h3>Application</h3>
      <dl className="fields">
        {FIELDS.filter((f) => !['Phone', 'Country'].includes(f)).map((f) => a[f] ? <Fragment key={f}><dt>{f}</dt><dd>{s(a[f])}</dd></Fragment> : null)}
        {LINKS.map((f) => { const u = safeUrl(a[f]); return u ? <Fragment key={f}><dt>{f.replace(' Link', '')}</dt><dd><a href={u} target="_blank" rel="noopener noreferrer">Open ↗</a></dd></Fragment> : null; })}
      </dl>
      {a['Experience Overview'] && (<><h3>Experience overview</h3><p className="prewrap">{s(a['Experience Overview'])}</p></>)}
      {a['Resume Experience'] && (<><h3>Experience (from resume)</h3><p className="prewrap">{s(a['Resume Experience'])}</p><p className="hint">Read from the resume by the screening routine. Check the resume for anything that looks off.</p></>)}
      {s(a.Source) === 'OLJ' && (
        <>
          <h3>OnlineJobs.ph</h3>
          <p className="muted">Job post: {s(a['OLJ Job Post'])}{a['OLJ Email Requested At'] ? ` · Email requested ${formatDate(ymd(a['OLJ Email Requested At']))}` : ''}</p>
          <p className="prewrap">{s(a['OLJ Summary'])}</p>
          <EmailForm id={appId} current={s(a.Email)} />
        </>
      )}
      <EditProfile id={appId} current={Object.fromEntries(EDITABLE.map((k) => [k, s(a[k])]))} />
    </section>
  );

  const conversation = (
    <>
      <section className="panel">
        <h2>Conversation</h2>
        <Inbox id={appId} firstName={s(a['First Name'])} templates={(d.emailTemplates || []).map((x) => ({ name: s(x.Name), subject: s(x.Subject), body: s(x.Body) }))} thread={detail.thread} hasEmail={!!a.Email} isOlj={s(a.Source) === 'OLJ'} emailReady={d.emailSending === 'ON'} />
      </section>
      <section className="panel" data-tour="timeline">
        <h2>Timeline</h2>
        <ul className="timeline">
          {events.map((e, i) => <li key={i}><span className="when">{e.at.slice(0, 16)}</span> {e.text}{e.who ? <span className="muted"> · {e.who}</span> : null}</li>)}
        </ul>
      </section>
      <section className="panel" data-tour="notes">
        <h2>Notes</h2>
        {a.Notes ? <p className="prewrap">{s(a.Notes)}</p> : <p className="muted">No notes yet.</p>}
        <NoteForm id={appId} />
      </section>
    </>
  );

  const actions = (
    <>
      <section className="panel" data-tour="stage"><h2>Stage</h2><StageForm ids={[appId]} current={s(a.Stage)} /></section>
      <section className="panel" data-tour="session-box">
        <h2>Session</h2>
        <p style={{ margin: '0 0 4px' }}>{sessionLine || 'No session yet'}</p>
        <p className="hint" style={{ marginTop: 0 }}>Invites sent: {s(a['Invite Count']) || '0'}{a['Zoom Minutes'] ? ` · Zoom: ${s(a['Zoom Minutes'])} min` : ''}{a.Arrival ? ` · ${s(a.Arrival)}` : ''}</p>
        {s(a['Do Not Invite']) && <p className="error"><strong>Do not invite.</strong> {s(a['Do Not Invite'])}.</p>}
        {!s(a['Do Not Invite']) && s(a['Invite Hold']) && <p className="hint"><strong>Not invited automatically:</strong> {s(a['Invite Hold'])}. You can still invite by hand if this is a mistake.</p>}
        {splitTags(a.Tags).includes('Invites paused') && <p className="hint"><strong>Invites are paused</strong> for this applicant: nothing is sent automatically, and Send invite is blocked until you resume.</p>}
        <InviteButtons id={appId} isOlj={s(a.Source) === 'OLJ'} hasEmail={!!a.Email} emailReady={d.emailSending === 'ON'} blocked={!!s(a['Do Not Invite']) || splitTags(a.Tags).includes('Invites paused')} />
        <p style={{ margin: '8px 0 0' }}><PauseInvitesButton id={appId} paused={splitTags(a.Tags).includes('Invites paused')} /></p>
        <p className="hint">Invites are for the next Wednesday, 2:00 PM PT. You see the email before it is sent.</p>
        <h3>Move to another session</h3>
        <SessionForm ids={[appId]} current={ymd(a['Interview Date'])} />
        {a['Re-invite Reason'] && <p className="hint">Re-invite reason: {s(a['Re-invite Reason'])}</p>}
        {a['Decision Reason'] && <p className="hint">Decision reason: {s(a['Decision Reason'])}</p>}
      </section>
      <section className="panel" data-tour="scorecard">
        <h2>Interview scorecard</h2>
        <Scorecard id={appId} me={me} stage={s(a.Stage)} cards={cards} />
      </section>
      <section className="panel">
        <h2>Screening</h2>
        {a['Screen Summary'] ? <p className="prewrap" style={{ margin: 0 }}>{s(a['Screen Summary'])}</p> : <p className="muted">Not screened yet.</p>}
      </section>
      <section className="panel"><h2>Status emails</h2><StatusEmailLog emails={mail} /></section>
    </>
  );

  if (panel) {
    return (
      <>
        <p style={{ display: 'flex', gap: 10, alignItems: 'center' }}><a href={`/candidates/${encodeURIComponent(appId)}`} className="small">Open full page →</a><Presence id={appId} /></p>
        {notices}
        <div className="col" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{facts}{actions}{conversation}</div>
      </>
    );
  }
  return (
    <>
      <div className="profile-top">
        <span><Link href="/candidates" className="muted">Candidates</Link> <span className="muted">/</span> <b>{fullName(a) || appId}</b></span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Presence id={appId} /><ProfileKeys prev={prevId} next={nextId} /></span>
      </div>
      {notices}
      <div className="profile">
        <div className="col">{facts}</div>
        <div className="col">{conversation}</div>
        <div className="col">{actions}</div>
      </div>
    </>
  );
}
