'use client';
import { useAction } from './useAction';

/** Hides the duplicate warning for good by tagging the applicant "Not duplicate". */
export default function NotDuplicate({ id, tags }: { id: string; tags: string }) {
  const { run, busy } = useAction();
  const next = [...tags.split(',').map((t) => t.trim()).filter(Boolean), 'Not duplicate'].join(', ');
  return <button className="btn small-btn" disabled={busy} onClick={() => run({ action: 'setTags', id, tags: next }, { success: 'Marked as not a duplicate ✓' })}>Not a duplicate</button>;
}
