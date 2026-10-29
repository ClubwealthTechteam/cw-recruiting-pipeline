'use client';
import { useMemo, useState } from 'react';
import type { TeamMember } from '@/lib/sheet';
import { useAction } from './useAction';

const DEPARTMENTS = ['ISA', 'TC/LC', 'Collections', 'Client Care', 'Admin', 'AI & Tech', 'Marketing', 'Other'];
const STATUSES = ['Working', 'Pending', 'Restart', 'Delay for a week', 'Terminated', 'Resigned', 'AWOL', 'No show', 'NO 2nd Chance', 'Did not continue'];
const isActive = (m: TeamMember) => m.Active === 'Y';

/** Sections per department, active people first; the other statuses are in the status dropdown. */
export default function TeamList({ team }: { team: TeamMember[] }) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('Active');
  const [sheet, setSheet] = useState('');
  const sheetOf = (m: TeamMember) => String(m['Source Tab'] || '').split(' · ')[0];
  const sheets = [...new Set(team.map(sheetOf).filter(Boolean))].sort().reverse();
  const companies = [...new Set(team.map((m) => m.Company).filter(Boolean))].sort();
  const statuses = [...new Set(team.map((m) => m.Status || '(blank)'))].sort();
  const rows = useMemo(() => team.filter((m) =>
    (!dept || m.Department === dept) && (!company || m.Company === company) && (!sheet || sheetOf(m) === sheet) &&
    (status === 'All' || (status === 'Active' ? isActive(m) : (m.Status || '(blank)') === status)) &&
    (!q || `${m.Name} ${m.Email} ${m.Position}`.toLowerCase().includes(q.toLowerCase()))
  ).sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || String(b['Start Date']).localeCompare(String(a['Start Date']))), [team, dept, company, status, q, sheet]);
  const depts = [...DEPARTMENTS, ...new Set(team.map((m) => m.Department).filter((x) => x && !DEPARTMENTS.includes(x)))];
  const active = team.filter(isActive).length;

  return (
    <>
      <section className="tiles">
        <div className="tile"><div className="tile-label">Active</div><div className="tile-value">{active}</div><div className="tile-note">Working or no status yet</div></div>
        {depts.filter((x) => team.some((m) => m.Department === x && isActive(m))).map((x) => (
          <div key={x} className="tile"><div className="tile-label">{x}</div><div className="tile-value">{team.filter((m) => m.Department === x && isActive(m)).length}</div><div className="tile-note">active</div></div>
        ))}
      </section>
      <div className="filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or position" />
        <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={company} onChange={(e) => setCompany(e.target.value)}><option value="">All companies</option>{companies.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={sheet} onChange={(e) => setSheet(e.target.value)} aria-label="Onboarding sheet"><option value="">All sheets</option>{sheets.map((x) => <option key={x} value={x}>{x} sheet</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="Active">Active (Working or no status)</option><option value="All">All statuses</option>
          {statuses.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      {depts.filter((x) => rows.some((m) => m.Department === x)).map((x) => (
        <section key={x} className="panel">
          <h2>{x} <span className="muted small">{rows.filter((m) => m.Department === x).length}</span></h2>
          <table className="table team-table">
            <thead><tr><th>Name</th><th>Position</th><th>Company</th><th>Status</th><th>Start date</th><th>Days</th><th>Heard about us</th><th>Mobile</th><th /></tr></thead>
            <tbody>{rows.filter((m) => m.Department === x).map((m) => <Member key={m.Email || m.Name} m={m} />)}</tbody>
          </table>
        </section>
      ))}
      {rows.length === 0 && <p className="empty">No team members match these filters.</p>}
    </>
  );
}

function Member({ m }: { m: TeamMember }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ Department: m.Department || '', Status: m.Status || '', Position: m.Position || '', Notes: m.Notes || '' });
  const { run, busy, error } = useAction();
  const edited = m.edited || {};
  const mark = (f: string) => (f in edited ? <span className="tag" title={`Onboarding sheet: ${edited[f] || '(blank)'} · edited in CRM by ${m.editedBy || ''}`}>edited in CRM</span> : null);

  async function save() {
    for (const f of ['Department', 'Status', 'Position', 'Notes'] as const) {
      if ((v[f] || '') !== (m[f] || '')) if (!(await run({ action: 'updateTeam', email: m.Email, field: f, value: v[f] }))) return;
    }
    setEdit(false);
  }

  return (
    <>
      <tr className={m.Active === 'Y' ? '' : 'muted-row'}>
        <td>{m.Name || '(no name)'}<div className="muted small">{m.Email}</div>{m.Notes && <div className="small">{m.Notes}</div>}</td>
        <td>{m.Position}{mark('Position')}</td><td>{m.Company}</td>
        <td>{m.Status || <span className="muted">no status</span>}{mark('Status')}</td>
        <td>{m['Start Date']}</td><td>{m.Days}</td><td>{m['Heard About Us']}</td><td>{m.Mobile}</td>
        <td><button className="btn small-btn ghost" onClick={() => setEdit(!edit)}>{edit ? 'Close' : 'Edit'}</button></td>
      </tr>
      {edit && (
        <tr><td colSpan={9}>
          <div className="inline-form">
            <label className="small">Department <select value={v.Department} onChange={(e) => setV({ ...v, Department: e.target.value })}>{DEPARTMENTS.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="small">Status <select value={v.Status} onChange={(e) => setV({ ...v, Status: e.target.value })}><option value="">(no status)</option>{[...new Set([...STATUSES, m.Status].filter(Boolean))].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="small">Position <input value={v.Position} onChange={(e) => setV({ ...v, Position: e.target.value })} /></label>
            <label className="small">Notes <input value={v.Notes} onChange={(e) => setV({ ...v, Notes: e.target.value })} size={30} /></label>
            <button className="btn primary small-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            {Object.keys(edited).filter((f) => f !== 'Notes').map((f) => (
              <button key={f} className="btn small-btn ghost" disabled={busy} title={`Onboarding sheet value: ${edited[f] || '(blank)'}`}
                onClick={() => run({ action: 'updateTeam', email: m.Email, field: f, value: '', clear: true }, { success: `${f}: back to the Onboarding sheet value ✓` })}>
                Use sheet value for {f}
              </button>
            ))}
            {error && <span className="error">{error}</span>}
          </div>
        </td></tr>
      )}
    </>
  );
}
