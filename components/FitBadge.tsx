import { FIT_TONE } from '@/lib/pipeline';

/** Fit column: Claude's Great / Good / Not Fit rating when there is one, else whether the automatic checks held them back. */
export default function FitBadge({ tag, hold }: { tag: string; track?: string; hold?: string }) {
  if (tag) return <span className={`badge ${FIT_TONE[tag] || 'grey'} fit`}>{tag}</span>;
  if (hold) return <span className="badge grey fit" title={hold}>Held back</span>;
  return <span className="muted small" title="Passed the automatic checks; no Great / Good / Not Fit rating yet">Not rated yet</span>;
}
