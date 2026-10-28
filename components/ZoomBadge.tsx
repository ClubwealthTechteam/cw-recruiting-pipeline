import type { ZoomLive } from '@/lib/pipeline';

/** "In Zoom now" (green) or "Left Zoom 2:13 PM" (grey) while today's session is live. */
export default function ZoomBadge({ z }: { z?: ZoomLive }) {
  if (!z) return null;
  if (z.inNow) return <span className="badge green zoom-live" title={`${z.minutes} min so far`}>● In Zoom now</span>;
  const [h, m] = z.lastLeave.split(':').map(Number);
  const t = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  return <span className="badge grey" title={`${z.minutes} min in Zoom`}>Left Zoom {t}</span>;
}
