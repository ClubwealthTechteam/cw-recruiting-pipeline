import { STAGE_TONE } from '@/lib/pipeline';

export default function StageBadge({ stage }: { stage: string }) {
  return <span className={`badge ${STAGE_TONE[stage] || 'grey'}`}>{stage || '—'}</span>;
}
