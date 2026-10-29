'use client';
import { useState } from 'react';
import { useAction } from './useAction';
import { MAX_RESUME, RESUME_ACCEPT, toBase64 } from './AddApplicant';

/** The applicant columns that can be edited here (the Apps Script allows the same list and nothing else). */
const FIELDS: { key: string; label: string; type?: string; wide?: boolean; area?: boolean }[] = [
  { key: 'First Name', label: 'First name' }, { key: 'Last Name', label: 'Last name' },
  { key: 'Email', label: 'Email', type: 'email' }, { key: 'Phone', label: 'Phone' },
  { key: 'Country', label: 'Country' }, { key: 'Position (as typed)', label: 'Position (as applied)' },
  { key: 'Internet Speed', label: 'Internet speed' }, { key: 'Resume Link', label: 'Resume link', type: 'url' },
  { key: 'Speedtest Link', label: 'Speedtest link', type: 'url' }, { key: 'Voice Recording Link', label: 'Voice recording link', type: 'url' },
  { key: 'Facebook Link', label: 'Facebook link', type: 'url' },
  { key: 'Experience Overview', label: 'Experience overview', wide: true, area: true }
];

/** "Edit profile" on the candidate page: change contact details and links, or upload a resume. Only changed fields are sent. */
export default function EditProfile({ id, current }: { id: string; current: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, string>>(current);
  const [resume, setResume] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const { run, busy, error } = useAction();
  const changed = Object.fromEntries(FIELDS.map((f) => f.key).filter((k) => (v[k] || '').trim() !== (current[k] || '').trim()).map((k) => [k, (v[k] || '').trim()]));
  const dirty = Object.keys(changed).length > 0 || !!resume;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    let file: { name: string; type: string; data: string } | undefined;
    if (resume) {
      try { file = { name: resume.name, type: resume.type, data: await toBase64(resume) }; } catch (err) { setFileError((err as Error).message); return; }
    }
    if (await run({ action: 'updateApplicant', id, fields: changed, resume: file })) { setOpen(false); setResume(null); }
  }

  if (!open) return <button type="button" className="btn small-btn" onClick={() => { setV(current); setOpen(true); }}>Edit profile</button>;
  return (
    <form className="add-applicant panel edit-profile" onSubmit={save}>
      <div className="add-head"><strong>Edit profile</strong><span className="hint">Every change is added to the Notes with your name.</span></div>
      <div className="add-grid">
        {FIELDS.map((f) => (
          <label key={f.key} className={f.wide ? 'wide' : ''}>{f.label}
            {f.area
              ? <textarea rows={4} value={v[f.key] || ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
              : <input type={f.type || 'text'} value={v[f.key] || ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                  required={f.key === 'First Name' || f.key === 'Last Name'} disabled={f.key === 'Resume Link' && !!resume} />}
          </label>
        ))}
        <label>Upload resume (replaces the link)
          <input type="file" accept={RESUME_ACCEPT} onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setFileError(file && file.size > MAX_RESUME ? 'Resume is larger than 3 MB.' : '');
            setResume(file && file.size <= MAX_RESUME ? file : null);
          }} />
        </label>
      </div>
      <div className="add-actions">
        <button className="btn primary" disabled={busy || !dirty || !!fileError}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        {(fileError || error) && <span className="error">{fileError || error}</span>}
        <span className="hint">Stage and invites are changed in Move stage and Invite, not here.</span>
      </div>
    </form>
  );
}
