'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAction } from './useAction';

const POSITIONS = ['Collections VA', 'Inside Sales Agent (ISA)', 'Real Estate Admin VA (TC/LC)'];
const EMPTY = { firstName: '', lastName: '', email: '', phone: '', position: POSITIONS[0], other: '', referredBy: '', note: '', invite: true, resumeLink: '' };
export const MAX_RESUME = 3 * 1024 * 1024;
export const RESUME_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg';

/** File → base64 (without the data: prefix), for the Apps Script to save in Drive. */
export const toBase64 = (file: File) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => fail(new Error('Could not read the resume file.'));
  r.readAsDataURL(file);
});

/** Adds someone by hand (referrals: no form, OLJ or email application). They start as Applied, Source Referral, tagged Referral. */
export default function AddApplicant() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [added, setAdded] = useState<{ id: string; invited: boolean; session: string; hold: string } | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [formKey, setFormKey] = useState(0); // remounts the file input after a successful add
  const { run, busy, error } = useAction();
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const position = f.position === 'Other' ? f.other.trim() : f.position;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let file: { name: string; type: string; data: string } | undefined;
    if (resume) {
      try { file = { name: resume.name, type: resume.type, data: await toBase64(resume) }; } catch (err) { setFileError((err as Error).message); return; }
    }
    const data = await run({
      action: 'addApplicant', firstName: f.firstName.trim(), lastName: f.lastName.trim(), email: f.email.trim(), phone: f.phone.trim(),
      position, referredBy: f.referredBy.trim(), note: f.note.trim(), invite: f.invite && !!f.email.trim(),
      resumeLink: resume ? '' : f.resumeLink.trim(), resume: file
    });
    if (data && typeof data === 'object') { setAdded(data as typeof added); setF(EMPTY); setResume(null); setFormKey((k) => k + 1); }
  }

  if (!open) {
    return (
      <div className="add-applicant closed">
        <button type="button" className="btn" onClick={() => { setOpen(true); setAdded(null); }}>+ Add applicant (referral)</button>
        {added && <AddedNote a={added} />}
      </div>
    );
  }
  return (
    <form className="add-applicant panel" onSubmit={submit}>
      <div className="add-head"><strong>Add an applicant by hand</strong><span className="hint">For referrals and anyone who didn&apos;t apply through the form, OLJ or email.</span></div>
      <div className="add-grid">
        <label>First name *<input value={f.firstName} onChange={set('firstName')} required maxLength={100} autoFocus /></label>
        <label>Last name *<input value={f.lastName} onChange={set('lastName')} required maxLength={100} /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} placeholder="for the invite email" /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} maxLength={40} /></label>
        <label>Position *
          <select value={f.position} onChange={set('position')}>{[...POSITIONS, 'Other'].map((p) => <option key={p}>{p}</option>)}</select>
        </label>
        {f.position === 'Other' && <label>Position (type it) *<input value={f.other} onChange={set('other')} required maxLength={200} /></label>}
        <label>Referred by<input value={f.referredBy} onChange={set('referredBy')} placeholder="e.g. Camille, an RM" maxLength={100} /></label>
        <label>Resume file
          <input key={formKey} type="file" accept={RESUME_ACCEPT} onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setFileError(file && file.size > MAX_RESUME ? 'Resume is larger than 3 MB.' : '');
            setResume(file && file.size <= MAX_RESUME ? file : null);
          }} />
        </label>
        <label>…or resume link<input type="url" value={f.resumeLink} onChange={set('resumeLink')} placeholder="Drive or Dropbox link" disabled={!!resume} /></label>
        <label className="wide">Note<textarea value={f.note} onChange={set('note')} rows={2} placeholder="Optional: anything the team should know" /></label>
      </div>
      <label className="check-line">
        <input type="checkbox" checked={f.invite && !!f.email.trim()} disabled={!f.email.trim()} onChange={set('invite')} />
        Send the pre-interview invite now (needs an email; same screening and Wednesday 12 PM cut-off as form applicants)
      </label>
      <div className="add-actions">
        <button className="btn primary" disabled={busy || !!fileError || !f.firstName.trim() || !f.lastName.trim() || !position}>{busy ? 'Adding…' : 'Add applicant'}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        {(fileError || error) && <span className="error">{fileError || error}</span>}
        <span className="hint">Resume: PDF, Word or image, up to 3 MB. Files are saved in the Drive folder "Recruiting Pipeline - Resumes".</span>
      </div>
    </form>
  );
}

function AddedNote({ a }: { a: { id: string; invited: boolean; session: string; hold: string } }) {
  return (
    <span className="hint">
      Added <Link href={`/candidates/${encodeURIComponent(a.id)}`}>{a.id}</Link>.{' '}
      {a.invited ? `Invite queued for Wednesday ${a.session}.` : a.hold ? `Invite held: ${a.hold}.` : 'No invite sent (you can send it from their profile).'}
    </span>
  );
}
