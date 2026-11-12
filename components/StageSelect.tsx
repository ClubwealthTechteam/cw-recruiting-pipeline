'use client';
import { useRouter } from 'next/navigation';

/** Candidates: stage and position pickers as dropdowns with counts (Miguel, 2026-11-12), instead of rows of tabs. */
export default function StageSelect({ value, options, label = 'Stage' }: { value: string; options: { value: string; label: string; href: string }[]; label?: string }) {
  const router = useRouter();
  return (
    <label className="stage-select">
      <span className="muted small">{label}</span>
      <select value={value} onChange={(e) => { const o = options.find((x) => x.value === e.target.value); if (o) router.push(o.href); }} aria-label={label}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
