import { FIT_TONE } from '@/lib/pipeline';

/**
 * Fit column: Claude's Great / Good / Not Fit rating when there is one, else whether the automatic checks held them
 * back, else why there is no rating yet (no experience details, no rule for the position, or waiting for the next run).
 */
export default function FitBadge({ tag, track, hold, summary, old }: { tag: string; track?: string; hold?: string; summary?: string; old?: boolean }) {
  if (tag) return <span className={`badge ${FIT_TONE[tag] || 'grey'} fit`}>{tag}</span>;
  if (hold) return <span className="badge grey fit" title={hold}>Held back</span>;
  if (old) return <span className="muted small" title="Applied before the system started; not screened">—</span>;
  if ((summary || '').startsWith('Not rated yet')) return <span className="muted small" title={summary}>No experience details</span>;
  if (!track || track === 'Not screened') return <span className="muted small" title="Only Collections, ISA and TC/LC applicants are rated">No rule for position</span>;
  return <span className="muted small" title="The screening routine runs every 2 hours, 6 AM to 8 PM PT">Rating soon</span>;
}
