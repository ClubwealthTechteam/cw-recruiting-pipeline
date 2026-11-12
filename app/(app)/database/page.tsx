import { dbConfigured, tabStats, getKvs, opStats } from '@/lib/db';
import { read, dataSource } from '@/lib/sheet';
import DatabaseControls from '@/components/DatabaseControls';
import { notFound } from 'next/navigation';
import { requireUser, isDbAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Database (Miguel, 2026-11-12): the copy of the Google Sheet in Neon, tab by tab against the sheet, the last full
 * copy, and the switch that makes the CRM read from it. The sheet stays in charge of saving in this stage.
 */
export default async function Database() {
  if (!isDbAdmin(await requireUser())) notFound(); // Miguel only
  if (!dbConfigured()) {
    return (<><header className="page-head"><h1>Database</h1></header>
      <section className="panel"><p>The database is not connected yet. In Vercel: cw-recruiting-pipeline → Storage → Neon → Connect (prefix DATABASE), then redeploy.</p></section></>);
  }
  let stats: { tab: string; rows: number; updated: string }[] = [];
  let kv: Record<string, unknown> = {};
  let err = '';
  let ops = { pending: 0, failed: 0 };
  try { [stats, kv, ops] = await Promise.all([tabStats(), getKvs(['readFromDb', 'readFromDbBy', 'lastFullCopy', 'fastSaves']), opStats()]); } catch (e) { err = e instanceof Error ? e.message : 'Could not reach the database'; }
  let sheet: Record<string, number> = {};
  try { sheet = await read<Record<string, number>>('dbCounts', {}); } catch { /* older Code.gs */ }
  const source = await dataSource();
  const byTab = new Map(stats.map((x) => [x.tab, x]));
  const tabs = [...new Set([...Object.keys(sheet), ...stats.map((x) => x.tab)])];
  const mismatch = tabs.filter((t) => sheet[t] !== undefined && (byTab.get(t)?.rows ?? 0) !== sheet[t]);
  const ready = !!kv.lastFullCopy && Object.keys(sheet).length > 0 && mismatch.length === 0;
  return (
    <>
      <header className="page-head">
        <h1>Database</h1>
        <p className="sub">A copy of the Google Sheet in the CRM&apos;s own database (Neon). The sheet still does all the saving; every change is copied here within seconds, and each tab is fully re-copied about once an hour.</p>
      </header>
      {err && <section className="panel warn"><strong>Database error:</strong> {err}</section>}
      <section className="panel">
        <p><strong>The CRM reads from:</strong> {source === 'database' ? 'the database ✓' : 'the Google Sheet'}{kv.lastFullCopy ? <> · last full copy {String(kv.lastFullCopy)}</> : <> · no full copy yet</>}</p>
        <DatabaseControls readFromDb={source === 'database'} ready={ready} fastSaves={kv.fastSaves === true} />
        {source === 'database' && (
          <p className="hint" style={{ marginTop: 8 }}>
            <b>Fast saves {kv.fastSaves === true ? 'are on' : 'are off'}.</b> Moving stages (and Undo), notes, tags, Mark resolved, Approve and Don&apos;t send show at once; the sheet does the real work a few seconds later, in order.
            {' '}Waiting now: {ops.pending}{ops.failed ? ` · did not go through (last 7 days): ${ops.failed}` : ''}.
          </p>
        )}
        {!kv.lastFullCopy && <p className="hint" style={{ marginTop: 8 }}>Start with <b>Copy everything now</b>. When every row below matches, switch the CRM to read from the database.</p>}
      </section>
      <section className="panel">
        <table className="table">
          <thead><tr><th>Tab</th><th>Rows in the sheet</th><th>Rows in the database</th><th>Last change copied</th><th></th></tr></thead>
          <tbody>
            {tabs.map((t) => {
              const d = byTab.get(t);
              const ok = sheet[t] === undefined || (d?.rows ?? 0) === sheet[t];
              return <tr key={t}><td>{t}</td><td>{sheet[t] ?? '—'}</td><td>{d?.rows ?? 0}</td><td>{d?.updated || '—'}</td><td>{ok ? <span className="badge green">Matches</span> : <span className="badge red">Different</span>}</td></tr>;
            })}
          </tbody>
        </table>
        {Object.keys(sheet).length === 0 && <p className="hint">Paste the new Code.gs to see the sheet&apos;s counts here.</p>}
      </section>
    </>
  );
}
