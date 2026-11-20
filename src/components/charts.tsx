/**
 * SVG charts used by the live dashboard, run reports and exported HTML (rendered statically with
 * renderToStaticMarkup, where hover falls back to native <title> tooltips).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { t as translate } from '@/lib/i18n';

/**
 * Chart texts follow the app language on screen; exported reports (`staticWidth` set) stay English.
 * (`t` is taken by loop variables in this file.)
 */
function tr(exported: boolean, text: string, vars?: Record<string, string | number>): string {
  if (!exported) return translate(text, vars);
  let out = text;
  for (const [k, v] of Object.entries(vars ?? {})) out = out.split(`{${k}}`).join(String(v));
  return out;
}

export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  area?: boolean;
  dashed?: boolean;
}

export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(+v.toFixed(10));
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

export const fmtClock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
};

export const fmtCompact = (v: number) =>
  Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : `${+v.toFixed(v < 10 ? 2 : 0)}`;

function useWidth(fixed?: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fixed ?? 600);
  useLayoutEffect(() => {
    if (fixed || !ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, [fixed]);
  return [ref, w];
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          <svg width="14" height="8" aria-hidden>
            <line x1="0" y1="4" x2="14" y2="4" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dashed ? '3 2' : undefined} strokeLinecap="round" />
          </svg>
          {s.name}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ title, subtitle, legend, children, className }: { title: string; subtitle?: ReactNode; legend?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`chart-card rounded-lg border border-border bg-surface p-3 ${className ?? ''}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[12.5px] font-semibold">{title}</h3>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
        <div className="flex-1" />
        {legend}
      </div>
      {children}
    </section>
  );
}

const PAD = { l: 44, r: 12, t: 8, b: 22 };

/** Time-series lines/areas on one y-axis with crosshair tooltip. */
export function LineChart({
  x,
  series,
  height = 190,
  yFormat = fmtCompact,
  xFormat = fmtClock,
  refLines = [],
  stacked = false,
  staticWidth,
  yMax,
  markers = [],
}: {
  x: number[];
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  refLines?: { value: number; label: string; color?: string }[];
  stacked?: boolean;
  staticWidth?: number;
  yMax?: number;
  markers?: { x: number; label: string }[];
}) {
  const [ref, width] = useWidth(staticWidth);
  const [hover, setHover] = useState<number | null>(null);
  const n = x.length;
  // Stack cumulatively when asked (status codes, step throughput).
  const drawn = stacked
    ? series.map((s, si) => ({
        ...s,
        top: s.values.map((_, i) => series.slice(0, si + 1).reduce((a, t) => a + (t.values[i] ?? 0), 0)),
        bottom: s.values.map((_, i) => series.slice(0, si).reduce((a, t) => a + (t.values[i] ?? 0), 0)),
      }))
    : series.map((s) => ({ ...s, top: s.values, bottom: s.values.map(() => 0) }));
  const dataMax = Math.max(yMax ?? 0, ...drawn.flatMap((s) => s.top.filter((v): v is number => v !== null && Number.isFinite(v))), 0);
  // A reference line far above the data (e.g. p95 < 1000 ms vs 3 ms actual) would squash every
  // series onto the baseline; keep it on the scale only when it is near the data, otherwise
  // mention it as an off-scale note.
  const onScale = refLines.filter((r) => !dataMax || r.value <= dataMax * 3);
  const offScale = refLines.filter((r) => !onScale.includes(r));
  const maxV = Math.max(dataMax, ...onScale.map((r) => r.value), 0);
  const ticks = niceTicks(maxV || 1);
  const top = ticks[ticks.length - 1]!;
  const w = width;
  const h = height;
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const x0 = x[0] ?? 0;
  const x1 = Math.max(x[n - 1] ?? 1, x0 + 1);
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * iw;
  const sy = (v: number) => PAD.t + ih - (v / top) * ih;
  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${sx(x[i]!).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const area = (topV: (number | null)[], bot: (number | null)[]) => {
    if (!n) return '';
    const up = topV.map((v, i) => `${sx(x[i]!).toFixed(1)},${sy(v ?? 0).toFixed(1)}`);
    const down = bot.map((v, i) => `${sx(x[i]!).toFixed(1)},${sy(v ?? 0).toFixed(1)}`).reverse();
    return `M${up.join('L')}L${down.join('L')}Z`;
  };
  const xTicks = (() => {
    const span = x1 - x0;
    const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const step = steps.find((s) => span / s <= Math.max(3, Math.floor(iw / 80))) ?? 7200;
    const out: number[] = [];
    for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) out.push(t);
    return out;
  })();
  const interactive = !staticWidth;
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!n) return;
    const r = e.currentTarget.getBoundingClientRect();
    const v = x0 + ((e.clientX - r.left) / r.width) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x[i]! - v) < Math.abs(x[best]! - v)) best = i;
    setHover(best);
  };
  const tipLeft = hover !== null ? sx(x[hover]!) : 0;
  return (
    <div ref={ref} className="relative w-full">
      <svg width={w} height={h} className="chart block" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={w - PAD.r} y1={sy(t)} y2={sy(t)} strokeDasharray={t === 0 ? undefined : '2 3'} />
            <text x={PAD.l - 6} y={sy(t) + 3.5} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={h - 6} textAnchor="middle">
            {xFormat(t)}
          </text>
        ))}
        {markers.map((m, i) => (
          <g key={i}>
            <line x1={sx(m.x)} x2={sx(m.x)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted-foreground)" strokeDasharray="2 3" />
            <text x={sx(m.x) + 3} y={PAD.t + 10}>
              {m.label}
            </text>
          </g>
        ))}
        {drawn.map((s) =>
          s.area || stacked ? <path key={`a-${s.name}`} d={area(s.top, s.bottom)} fill={s.color} opacity={stacked ? 0.55 : 0.14} /> : null,
        )}
        {drawn.map((s) => (
          <path key={s.name} d={path(s.top)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '4 3' : undefined} />
        ))}
        {offScale.map((r, i) => (
          <text key={`off-${r.label}`} x={w - PAD.r - 2} y={PAD.t + 10 + i * 13} textAnchor="end" style={{ fill: r.color ?? 'var(--danger)' }}>
            ▲ {r.label} {tr(!!staticWidth, '(above the chart)')}
          </text>
        ))}
        {onScale.map((r) => (
          <g key={r.label}>
            <line x1={PAD.l} x2={w - PAD.r} y1={sy(r.value)} y2={sy(r.value)} stroke={r.color ?? 'var(--danger)'} strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={w - PAD.r - 2} y={sy(r.value) - 4} textAnchor="end" style={{ fill: r.color ?? 'var(--danger)' }}>
              {r.label}
            </text>
          </g>
        ))}
        {hover !== null && interactive && (
          <g pointerEvents="none">
            <line x1={tipLeft} x2={tipLeft} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted-foreground)" strokeWidth={1} />
            {drawn.map((s) => {
              const v = s.top[hover];
              return v === null || v === undefined ? null : <circle key={s.name} cx={tipLeft} cy={sy(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
            })}
          </g>
        )}
        {interactive ? (
          <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        ) : (
          x.map((t, i) => (
            <rect key={i} className="hover-col" x={sx(t) - iw / Math.max(n, 1) / 2} y={PAD.t} width={Math.max(1, iw / Math.max(n, 1))} height={ih} fill="transparent">
              <title>{`${xFormat(t)}\n${series.map((s) => `${s.name}: ${s.values[i] === null || s.values[i] === undefined ? '–' : yFormat(s.values[i]!)}`).join('\n')}`}</title>
            </rect>
          ))
        )}
      </svg>
      {hover !== null && interactive && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11.5px] shadow-lg"
          style={{ left: Math.min(tipLeft + 12, w - 170), top: PAD.t }}
        >
          <div className="mb-1 font-semibold">{xFormat(x[hover]!)}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 text-muted-foreground">{s.name}</span>
              <span className="font-mono">{s.values[hover] === null || s.values[hover] === undefined ? '–' : yFormat(s.values[hover]!)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Response-time distribution with percentile markers. */
export function Histogram({
  bins,
  markers,
  height = 190,
  staticWidth,
  color = 'var(--series-1)',
}: {
  bins: { from: number; to: number; count: number }[];
  markers: { value: number; label: string }[];
  height?: number;
  staticWidth?: number;
  color?: string;
}) {
  const [ref, w] = useWidth(staticWidth);
  if (!bins.length) return <div className="p-6 text-center text-[12px] text-muted-foreground">{tr(!!staticWidth, 'No data')}</div>;
  const h = height;
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const maxC = Math.max(...bins.map((b) => b.count), 1);
  const ticks = niceTicks(maxC);
  const top = ticks[ticks.length - 1]!;
  const lo = bins[0]!.from;
  const hi = bins[bins.length - 1]!.to;
  const sx = (v: number) => PAD.l + ((v - lo) / Math.max(hi - lo, 1e-9)) * iw;
  const sy = (v: number) => PAD.t + ih - (v / top) * ih;
  const bw = iw / bins.length;
  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={h} className="chart block">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={w - PAD.r} y1={sy(t)} y2={sy(t)} strokeDasharray={t ? '2 3' : undefined} />
            <text x={PAD.l - 6} y={sy(t) + 3.5} textAnchor="end">
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        {bins.map((b, i) => {
          const bh = Math.max(0, PAD.t + ih - sy(b.count));
          return (
            <g key={i}>
              <rect x={PAD.l + i * bw + 1} y={sy(b.count)} width={Math.max(1, bw - 2)} height={bh} rx={Math.min(3, bw / 3)} fill={color} opacity={i === bins.length - 1 && bins.length > 40 ? 0.55 : 0.9} />
              <rect className="hover-col" x={PAD.l + i * bw} y={PAD.t} width={bw} height={ih} fill="transparent">
                <title>{`${b.from.toFixed(1)}–${b.to.toFixed(1)} ms: ${tr(!!staticWidth, '{n} requests', { n: b.count })}`}</title>
              </rect>
            </g>
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={PAD.l + f * iw} y={h - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
            {`${Math.round(lo + f * (hi - lo))} ms`}
          </text>
        ))}
        {placeLabels(markers.filter((m) => m.value >= lo && m.value <= hi).map((m) => ({ ...m, x: sx(m.value) })), w - PAD.r).map((m) => (
          <g key={m.label}>
            <line x1={m.x} x2={m.x} y1={PAD.t} y2={PAD.t + ih} stroke="var(--foreground)" strokeDasharray="3 3" opacity={0.7} />
            <text x={m.lx} y={PAD.t + 10 + m.row * 13} textAnchor={m.anchor} style={{ fill: 'var(--foreground)', paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3, strokeLinejoin: 'round' }}>
              {m.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function seqColor(t: number): string {
  // Sequential blue: surface → seq-700, through color-mix so both themes work.
  if (t <= 0) return 'transparent';
  const pct = Math.round(15 + t * 85);
  return `color-mix(in oklch, var(--seq-500) ${pct}%, var(--seq-100))`;
}

/** Latency heatmap: time on x, latency bands on y, request count as color. */
export function Heatmap({
  x,
  rows,
  bounds,
  height = 210,
  staticWidth,
}: {
  x: number[];
  rows: number[][];
  bounds: number[];
  height?: number;
  staticWidth?: number;
}) {
  const [ref, w] = useWidth(staticWidth);
  const nRows = bounds.length + 1;
  // Merge seconds into at most ~120 columns.
  const cols = Math.min(120, x.length);
  const per = Math.max(1, Math.ceil(x.length / Math.max(cols, 1)));
  const merged: { t: number; v: number[] }[] = [];
  for (let i = 0; i < x.length; i += per) {
    const v = new Array(nRows).fill(0) as number[];
    for (let j = i; j < Math.min(i + per, x.length); j++) rows[j]?.forEach((c, k) => (v[k] = (v[k] ?? 0) + c));
    merged.push({ t: x[i]!, v });
  }
  // Only show the rows that ever had data (plus one around).
  const used = new Array(nRows).fill(false) as boolean[];
  merged.forEach((m) => m.v.forEach((c, k) => c > 0 && (used[k] = true)));
  let first = used.indexOf(true);
  let last = used.lastIndexOf(true);
  if (first < 0) {
    first = 0;
    last = 0;
  }
  first = Math.max(0, first - 1);
  last = Math.min(nRows - 1, last + 1);
  const shown = last - first + 1;
  const max = Math.max(1, ...merged.flatMap((m) => m.v));
  const padL = 64;
  const iw = w - padL - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const cw = iw / Math.max(merged.length, 1);
  const ch = ih / shown;
  const label = (k: number) => (k === 0 ? `≤${bounds[0]} ms` : k >= bounds.length ? `>${bounds[bounds.length - 1]! / 1000}s` : `≤${bounds[k]! >= 1000 ? `${bounds[k]! / 1000}s` : `${bounds[k]} ms`}`);
  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={height} className="chart block">
        {Array.from({ length: shown }, (_, r) => {
          const k = first + r;
          const y = PAD.t + ih - (r + 1) * ch;
          return (
            <g key={k}>
              <text x={padL - 6} y={y + ch / 2 + 3.5} textAnchor="end">
                {label(k)}
              </text>
              {merged.map((m, i) => {
                const c = m.v[k] ?? 0;
                return (
                  <rect key={i} x={padL + i * cw} y={y} width={Math.max(1, cw - (cw > 4 ? 1 : 0))} height={Math.max(1, ch - 1)} fill={c ? seqColor(Math.log1p(c) / Math.log1p(max)) : 'var(--surface-muted)'} rx={cw > 6 ? 1.5 : 0}>
                    <title>{`${fmtClock(m.t)} · ${label(k)}: ${tr(!!staticWidth, '{n} requests', { n: c })}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
        {merged
          .filter((_, i) => i % Math.max(1, Math.ceil(merged.length / Math.max(3, Math.floor(iw / 80)))) === 0)
          .map((m) => (
            <text key={m.t} x={padL + merged.indexOf(m) * cw} y={height - 6}>
              {fmtClock(m.t)}
            </text>
          ))}
      </svg>
      <div className="mt-1 flex items-center justify-end gap-2 text-[10.5px] text-muted-foreground">
        {tr(!!staticWidth, 'fewer')}
        <span className="inline-block h-2 w-24 rounded" style={{ background: `linear-gradient(90deg, ${seqColor(0.05)}, ${seqColor(1)})` }} />
        {tr(!!staticWidth, 'more requests')}
      </div>
    </div>
  );
}

/** Horizontal bars with labels and values (comparisons across steps, status codes). */
/**
 * Put marker labels (p50/p95/p99) on rows so none overlap: each label goes on the first row
 * whose previous label ends before it starts; labels near the right edge flip to the left.
 */
export function placeLabels<T extends { x: number; label: string }>(items: T[], right: number, charW = 6.2) {
  const rows: number[] = [];
  return [...items]
    .sort((a, b) => a.x - b.x)
    .map((m) => {
      const width = m.label.length * charW + 6;
      const flip = m.x + 3 + width > right;
      const start = flip ? m.x - 3 - width : m.x + 3;
      let row = rows.findIndex((end) => end < start);
      if (row < 0) row = rows.length;
      rows[row] = start + width;
      return { ...m, row, lx: flip ? m.x - 3 : m.x + 3, anchor: (flip ? 'end' : 'start') as 'end' | 'start' };
    });
}

export function HBars({
  items,
  format = fmtCompact,
  color = 'var(--series-1)',
  scale = 'linear',
}: {
  items: { label: string; value: number; color?: string; hint?: string }[];
  format?: (v: number) => string;
  color?: string;
  /** `log` keeps small values readable next to one very large value. */
  scale?: 'linear' | 'log';
}) {
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  const lmin = Math.log10(Math.max(Math.min(...items.map((i) => i.value).filter((v) => v > 0), max), 1e-9));
  const frac = (v: number) => {
    if (scale === 'linear') return v / max;
    if (v <= 0) return 0;
    const lmax = Math.log10(max);
    // Map [min/2, max] onto the bar, so the smallest value still shows a bar.
    const lo = lmin - 0.3;
    return lmax === lo ? 1 : (Math.log10(v) - lo) / (lmax - lo);
  };
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-[12px]" title={it.hint}>
          <span className="w-40 shrink-0 truncate text-muted-foreground" title={it.label}>
            {it.label}
          </span>
          <div className="relative h-3.5 flex-1">
            <div className="absolute inset-y-0 left-0 rounded-r" style={{ width: `${Math.max(0.5, frac(it.value) * 100)}%`, background: it.color ?? color }} />
          </div>
          <span className="w-20 shrink-0 text-right font-mono">{format(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Stacked 100% bar (Apdex satisfied/tolerating/frustrated, pass/fail). */
export function StackBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
          ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm" style={{ background: p.color }} />
            {p.label} <b className="text-foreground">{((p.value / total) * 100).toFixed(1)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Small trend line for stat tiles. */
export function Sparkline({ values, color = 'var(--series-1)', width = 120, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(...values, 1e-9);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} className="block">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
