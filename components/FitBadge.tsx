import { FIT_TONE } from '@/lib/pipeline';

export default function FitBadge({ tag, track }: { tag: string; track?: string }) {
  if (tag) return <span className={`badge ${FIT_TONE[tag] || 'grey'} fit`}>{tag}</span>;
  if (!track || track === 'Not screened') return <span className="muted small">Not screened</span>;
  return <span className="muted small">Screening…</span>;
}
