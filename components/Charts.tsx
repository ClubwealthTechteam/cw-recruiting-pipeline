'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/* Plain SVG charts. One y-scale per chart, thin marks, hover tooltips, nulls drawn as gaps (never as 0). */

const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#8a5cd6'];
const GRID = '#e3e7ee';
const INK2 = '#667085';

type Tip = { x: number; y: number; lines: string[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.lines.map((l, i) => <div key={i} className={i === 0 ? 'tip-head' : ''}>{l}</div>)}
    </div>
  );
}

/** Applicants per week, stacked Form + OLJ + Email + Referral, with a 2px gap between segments. */
export function WeeklyBars({ data }: { data: { label: string; form: number; olj: number; email?: number; referral?: number; href?: string }[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const router = useRouter();
  const W = 760, H = 260, L = 40, B = 30, T = 22;
  const max = Math.max(1, ...data.map((d) => d.form + d.olj + (d.email || 0) + (d.referral || 0)));
  const step = (W - L) / data.length, bw = Math.min(46, step * 0.55);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Applicants per week, form and OnlineJobs.ph">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}</text></g>)}
        {data.map((d, i) => {
          const x = L + i * step + (step - bw) / 2;
          const segs = [d.form, d.olj, d.email || 0, d.referral || 0];
          const total = segs.reduce((t, v) => t + v, 0);
          const top = segs.reduce((last, v, k) => (v > 0 ? k : last), -1);
          return (
            <g key={d.label} className={d.href ? 'clickable' : ''} onClick={() => d.href && router.push(d.href)}
              onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY - 10, lines: [`Week of ${d.label}`, `Form: ${d.form}`, `OnlineJobs.ph: ${d.olj}`, `Email: ${d.email || 0}`, `Referral: ${d.referral || 0}`, `Total: ${total}`, ...(d.href ? ['Click to see the people'] : [])] })}>
              <rect x={L + i * step} y={T} width={step} height={H - T - B} fill="transparent" />
              {segs.map((v, k) => {
                if (v <= 0) return null;
                const below = segs.slice(0, k).reduce((t, u) => t + u, 0);
                const h = y(below) - y(below + v);
                return <rect key={k} x={x} y={y(below + v)} width={bw} height={Math.max(0, k > 0 ? h - 2 : h)} rx={k === top ? 4 : 0} fill={SERIES[k]} />;
              })}
              <text x={x + bw / 2} y={y(total) - 5} textAnchor="middle" className="val">{total}</text>
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="axis">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend"><span className="key" style={{ background: SERIES[0] }} /> Form <span className="key" style={{ background: SERIES[1] }} /> OnlineJobs.ph <span className="key" style={{ background: SERIES[2] }} /> Email <span className="key" style={{ background: SERIES[3] }} /> Referral</div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Confirmation, show-up and completion rate per Wednesday session, all on one 0–100% scale. */
export function RateTrend({ data }: { data: { label: string; confirmation: number | null; showUp: number | null; completion: number | null }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 280, L = 48, R = 170, B = 30, T = 16;
  const keys = [['confirmation', 'Confirmation'], ['showUp', 'Show-up'], ['completion', 'Completion']] as const;
  const n = data.length;
  const x = (i: number) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v);
  if (!n) return <p className="empty">The trend appears after the first Wednesday session run by the system.</p>;
  const pathFor = (k: (typeof keys)[number][0]) => {
    let d = '', pen = false;
    data.forEach((p, i) => {
      const v = p[k];
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i)},${y(v)} `;
      pen = true;
    });
    return d;
  };
  const pct = (v: number | null) => (v === null ? 'no data' : `${Math.round(v * 100)}%`);
  // End-of-line labels, nudged apart so they never overlap (18 units minimum spacing).
  const directLabels = keys.flatMap(([k, label]) => {
    const last = [...data].reverse().findIndex((p) => p[k] !== null);
    if (last === -1) return [];
    const i = n - 1 - last;
    return [{ key: k, x: x(i), y: y(data[i][k] as number), text: `${label} ${pct(data[i][k])}` }];
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < directLabels.length; i++) {
    if (directLabels[i].y - directLabels[i - 1].y < 18) directLabels[i].y = directLabels[i - 1].y + 18;
  }
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Confirmation, show-up and completion rate by session">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="axis">{t * 100}%</text></g>)}
        {data.map((p, i) => <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle" className="axis">{p.label}</text>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke={INK2} strokeDasharray="3 3" />}
        {keys.map(([k], si) => <path key={k} d={pathFor(k)} fill="none" stroke={SERIES[si]} strokeWidth={2} />)}
        {keys.map(([k], si) => data.map((p, i) => p[k] === null ? null : (
          <circle key={`${k}${i}`} cx={x(i)} cy={y(p[k] as number)} r={hover === i ? 5 : 4} fill={SERIES[si]} stroke="#fff" strokeWidth={2} />
        )))}
        {directLabels.map((d) => <text key={d.key} x={d.x + 10} y={d.y + 5} className="direct">{d.text}</text>)}
        {data.map((p, i) => (
          <rect key={`h${i}`} x={x(i) - (W - L - R) / Math.max(2, n) / 2} y={T} width={(W - L - R) / Math.max(2, n)} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      <div className="legend">{keys.map(([k, label], si) => <span key={k}><span className="key" style={{ background: SERIES[si] }} /> {label}</span>)}</div>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(x(hover) / W * 100, 70) + '%', top: 10 }}>
          <div className="tip-head">Wednesday {data[hover].label}</div>
          <div>Confirmation: {pct(data[hover].confirmation)}</div>
          <div>Show-up: {pct(data[hover].showUp)}</div>
          <div>Completion: {pct(data[hover].completion)}</div>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars, one series. value is a count or a 0–1 rate (format says which). */
export function HBars({ data, format, ariaLabel }: { data: { label: string; value: number; note?: string; href?: string }[]; format: 'count' | 'pct'; ariaLabel: string }) {
  const [tip, setTip] = useState<Tip>(null);
  const router = useRouter();
  const max = format === 'pct' ? 1 : Math.max(1, ...data.map((d) => d.value));
  const rowH = 36, W = 760, L = 250, R = 110;
  const H = data.length * rowH + 6;
  const show = (v: number) => (format === 'pct' ? `${Math.round(v * 100)}%` : String(v));
  if (!data.length) return <p className="empty">No data yet.</p>;
  return (
    <div className="chart hbars" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {data.map((d, i) => {
          const w = Math.max(d.value > 0 ? 3 : 0, ((W - L - R) * d.value) / max);
          const yy = i * rowH + 6;
          return (
            <g key={d.label} className={d.href ? 'clickable' : ''} onClick={() => d.href && router.push(d.href)}
              onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY - 10, lines: [d.label, show(d.value) + (d.note ? ` · ${d.note}` : ''), ...(d.href ? ['Click to see the people'] : [])] })}>
              <rect x={0} y={yy - 3} width={W} height={rowH} fill="transparent" />
              <text x={L - 12} y={yy + 16} textAnchor="end" className="axis-strong">{d.label}</text>
              <rect x={L} y={yy + 2} width={W - L - R} height={18} fill="#f0f3f8" rx={4} />
              <rect x={L} y={yy + 2} width={w} height={18} fill={SERIES[0]} rx={4} />
              <text x={L + w + 8} y={yy + 16} className="val">{show(d.value)}{d.note ? <tspan className="axis"> · {d.note}</tspan> : null}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
