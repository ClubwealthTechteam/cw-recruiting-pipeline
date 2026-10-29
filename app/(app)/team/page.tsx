import { getData } from '@/lib/sheet';
import DataError from '@/components/DataError';
import TeamList from '@/components/TeamList';

/** Active Team Members: a copy of the Onboarding sheet (synced hourly), with edits made here kept in "Team Updates". */
export default async function Team() {
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const team = d.team || [];
  return (
    <>
      <header className="page-head">
        <h1>Active Team Members</h1>
        <p className="sub">From the Onboarding sheet (read only, copied every hour). Changes made here are saved in the pipeline sheet&apos;s &quot;Team Updates&quot; tab and win over the Onboarding sheet until you click &quot;Use sheet value&quot;.</p>
      </header>
      {team.length === 0 ? <section className="panel"><p className="empty">No team members yet. They appear after the first hourly copy of the Onboarding sheet.</p></section> : <TeamList team={team} />}
    </>
  );
}
