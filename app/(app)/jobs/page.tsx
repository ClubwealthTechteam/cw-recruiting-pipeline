import { getData } from '@/lib/sheet';
import { s, ymd, daysAgoPT } from '@/lib/pipeline';
import DataError from '@/components/DataError';
import JobAdsForm from '@/components/JobAdsForm';
import InvitesSwitch from '@/components/InvitesSwitch';

/** Job Ads: which positions are being advertised, and the switch for all automatic invites. */
export default async function JobAds() {
  let d;
  try { d = await getData(); } catch (e) { return <DataError error={e} />; }
  const ads = d.jobAds || [];
  const since = daysAgoPT(7);
  const stats: Record<string, { week: number; held: number; waiting: number }> = {};
  for (const ad of ads) {
    const mine = d.applicants.filter((a) => s(a.Position) === ad.position && s(a.Historical) !== 'Y');
    stats[ad.position] = {
      week: mine.filter((a) => ymd(a['Applied At (PT)']) > since).length,
      held: mine.filter((a) => s(a['Invite Hold']).startsWith('Job ad paused')).length,
      // who gets the "Position on hold" email if this ad is paused
      waiting: mine.filter((a) => ['Applied', 'Invited', 'Confirmed'].includes(s(a.Stage)) && !/Position on hold/.test(s(a.Tags)) && s(a.Source) !== 'Test').length
    };
  }
  return (
    <>
      <header className="page-head"><h1>Job Ads</h1><p className="sub">Tick the ads that are running now. Untick an ad when it is taken down (e.g. TC/LC or Collections).</p></header>
      <section className="panel"><InvitesSwitch on={d.autoInvites !== 'OFF'} /><p className="hint" style={{ margin: '6px 0 0' }}>Pauses every automatic invite, for all positions (e.g. during an event). Invites sent by hand from a profile still work.</p></section>
      {ads.length ? <JobAdsForm ads={ads} stats={stats} /> : <section className="panel"><p className="muted">Paste the new Code.gs to see the job ads here.</p></section>}
    </>
  );
}
