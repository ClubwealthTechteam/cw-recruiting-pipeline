import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getData, getDataWithHistory, getApplicant } from '@/lib/sheet';
import { s, fullName, ymd, formatDate, formatDateTime } from '@/lib/pipeline';
import StageBadge from '@/components/StageBadge';
import StageForm from '@/components/StageForm';
import { NoteForm, EmailForm } from '@/components/SmallForms';
import DataError from '@/components/DataError';
import FitBadge from '@/components/FitBadge';
import InviteButtons from '@/components/InviteButtons';

const LINKS = ['Resume Link', 'Voice Recording Link', 'Speedtest Link', 'Facebook Link'];
const FIELDS = ['Position (as typed)', 'Country', 'Phone', 'Has Experience', 'Years Experience', 'Recent Client', 'US Clients VA', 'US Realtor VA', 'Internet Speed'];

function safeUrl(v: unknown): string | null {
  try {
    const u = new URL(s(v).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}

export default async function Candidate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = decodeURIComponent(id);
  let d, a;
  try {
    [d, a] = await Promise.all([getData(), getApplicant(appId)]);
    // applicants from before the system: their history is only in the full data set
    if (a && s(a.Historical) === 'Y') d = await getDataWithHistory();
  } catch (e) { return <DataError error={e} />; }
  if (!a) notFound();

  type Ev = { at: string; text: string; who?: string };
  const events: Ev[] = [];
  for (const h of d.history.filter((x) => s(x['Applicant ID']) === appId)) {
    events.push({ at: s(h['Timestamp (PT)']), text: `${h['From Stage'] ? `${h['From Stage']} → ` : ''}${h['To Stage']}${h.Reason ? ` · ${h.Reason}` : ''}`, who: s(h['Changed By']) });
  }
  for (const e of d.outbox.filter((x) => s(x['Applicant ID']) === appId)) {
    events.push({ at: s(e['Sent At'] || e['Queued At']), text: `${e.Type} email ${s(e.Status).toLowerCase()}${e['Interview Date'] ? ` for ${formatDate(ymd(e['Interview Date']))}` : ''}${e.Test === 'Y' ? ' (test)' : ''}` });
  }
  for (const z of d.zoom.filter((x) => s(x['Matched Applicant ID']) === appId)) {
    events.push({ at: s(z['Recorded At'] || z['Interview Date']), text: `Zoom: "${z['Zoom Display Name']}" · ${z['Total Minutes']} minutes${z.Arrival ? ` · ${z.Arrival}` : ''}` });
  }
  events.push({ at: s(a['Applied At (PT)']), text: `Applied via ${s(a.Source) === 'OLJ' ? 'OnlineJobs.ph' : 'the application form'}` });
  if (s(a['Stage Updated By']) === 'Import') events.push({ at: s(a['Stage Updated At']), text: 'Brought into the system as Invited (invited by hand before the system started)' });
  if (a['Confirmed At']) events.push({ at: s(a['Confirmed At']), text: 'Replied with full name (confirmed)' });
  events.sort((x, y) => y.at.localeCompare(x.at));
  const flags = d.flags.filter((f) => s(f['Applicant ID']) === appId && s(f.Status) === 'Open');

  return (
    <>
      <p><Link href="/candidates" className="muted">← Candidates</Link></p>
      <header className="page-head detail-head">
        <div>
          <h1>{fullName(a) || '(no name)'}</h1>
          <div className="muted">{s(a.Position)} · {s(a.Source)} · Applied {formatDateTime(s(a['Applied At (PT)']))}</div>
        </div>
        <StageBadge stage={s(a.Stage)} />
      </header>
      {flags.length > 0 && <div className="panel warn">{flags.length} open item{flags.length > 1 ? 's' : ''} in <Link href="/attention">Needs Attention</Link> for this applicant.</div>}
      <div className="two-col">
        <section className="panel">
          <h2>Screening</h2>
          <p><FitBadge tag={s(a['Screen Tag'])} track={s(a['Screen Track'])} /> <span className="muted">{s(a['Screen Track'])}</span></p>
          {a['Screen Summary'] ? <p className="prewrap">{s(a['Screen Summary'])}</p> : <p className="muted">Not screened yet.</p>}
        </section>
        <section className="panel">
          <h2>Invite</h2>
          {s(a['Do Not Invite']) && <p className="error"><strong>Do not invite.</strong> {s(a['Do Not Invite'])}.</p>}
          {!s(a['Do Not Invite']) && s(a['Invite Hold']) && <p className="hint"><strong>Not invited automatically:</strong> {s(a['Invite Hold'])}. You can still invite by hand if this is a mistake.</p>}
          <InviteButtons id={appId} isOlj={s(a.Source) === 'OLJ'} hasEmail={!!a.Email} emailReady={d.emailSending === 'ON'} blocked={!!s(a['Do Not Invite'])} />
          <p className="hint">Invites are for the next Wednesday at 2:00 PM PT. The applicant moves to Invited once it is sent.</p>
        </section>
      </div>
      <section className="panel"><h2>Move stage</h2><StageForm ids={[appId]} current={s(a.Stage)} /></section>
      <div className="two-col">
        <section className="panel">
          <h2>Application</h2>
          <dl className="fields">
            <dt>Email</dt><dd>{s(a.Email) || '—'}</dd>
            <dt>Session</dt><dd>{a['Interview Date'] ? `Wednesday, ${formatDate(ymd(a['Interview Date']))}, 2:00 PM PT` : '—'}</dd>
            <dt>Invites sent</dt><dd>{s(a['Invite Count']) || '0'}</dd>
            <dt>Zoom minutes</dt><dd>{s(a['Zoom Minutes']) || '—'}</dd>
            <dt>Arrival</dt><dd>{s(a.Arrival) || '—'}</dd>
            {a['Re-invite Reason'] && (<><dt>Re-invite reason</dt><dd>{s(a['Re-invite Reason'])}</dd></>)}
            {a['Decision Reason'] && (<><dt>Decision reason</dt><dd>{s(a['Decision Reason'])}</dd></>)}
            {FIELDS.map((f) => a[f] ? <Fragment key={f}><dt>{f}</dt><dd>{s(a[f])}</dd></Fragment> : null)}
            {LINKS.map((f) => { const u = safeUrl(a[f]); return u ? <Fragment key={f}><dt>{f.replace(' Link', '')}</dt><dd><a href={u} target="_blank" rel="noopener noreferrer">Open</a></dd></Fragment> : null; })}
          </dl>
          {a['Experience Overview'] && (<><h3>Experience overview</h3><p className="prewrap">{s(a['Experience Overview'])}</p></>)}
          {s(a.Source) === 'OLJ' && (
            <>
              <h3>OnlineJobs.ph</h3>
              <p className="muted">Job post: {s(a['OLJ Job Post'])}{a['OLJ Email Requested At'] ? ` · Email requested ${formatDate(ymd(a['OLJ Email Requested At']))}` : ''}</p>
              <p className="prewrap">{s(a['OLJ Summary'])}</p>
              <EmailForm id={appId} current={s(a.Email)} />
            </>
          )}
        </section>
        <section className="panel">
          <h2>Timeline</h2>
          <ul className="timeline">
            {events.map((e, i) => <li key={i}><span className="when">{e.at.slice(0, 16)}</span> {e.text}{e.who ? <span className="muted"> · {e.who}</span> : null}</li>)}
          </ul>
          <h2>Notes</h2>
          {a.Notes ? <p className="prewrap">{s(a.Notes)}</p> : <p className="muted">No notes yet.</p>}
          <NoteForm id={appId} />
        </section>
      </div>
    </>
  );
}
