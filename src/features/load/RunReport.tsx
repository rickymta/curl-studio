import { CheckCircle2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { ChartCard, fmtClock, fmtCompact, Heatmap, HBars, Histogram, Legend, LineChart, SERIES, Sparkline, StackBar } from '@/components/charts';
import { formatBytes, formatDuration, formatMs, formatNum, formatPct } from '@/lib/format';
import type { Point, RunRecord, Summary } from '@/lib/load/types';

export function statusColor(code: string): string {
  const c = Number(code);
  if (c === 0) return 'var(--series-8)';
  if (c < 300) return 'var(--success)';
  if (c < 400) return 'var(--series-1)';
  if (c < 500) return 'var(--warning)';
  return 'var(--danger)';
}

export function Tile({ label, value, sub, tone, spark }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad'; spark?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={`mt-0.5 text-[22px] leading-tight font-semibold ${tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-success' : ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      {spark && <div className="mt-1">{spark}</div>}
    </div>
  );
}

const ms = (v: number) => formatMs(v);
const pctFmt = (v: number) => `${(v * 100).toFixed(1)}%`;

export interface ReportData {
  name: string;
  summary: Summary;
  timeline: Point[];
  heatBoundsMs: number[];
  stepNames: Record<string, string>;
  thresholdP95?: number;
}

/** Tightest overall p95 latency threshold (drawn on the response-time chart). */
export function minP95(run: RunRecord): number | undefined {
  const v = (run.scenario?.thresholds ?? []).filter((t) => t.metric === 'http_req_duration' && !t.step && /95/.test(t.stat)).map((t) => t.value);
  return v.length ? Math.min(...v) : undefined;
}

export function fromRun(run: RunRecord): ReportData {
  const p95 = minP95(run);
  return {
    name: run.name,
    summary: run.summary,
    timeline: run.timeline,
    heatBoundsMs: run.heatBoundsMs,
    stepNames: Object.fromEntries((run.scenario?.steps ?? []).map((s) => [s.id, s.name])),
    thresholdP95: p95,
  };
}

/** KPI tiles. */
export function Kpis({ d }: { d: ReportData }) {
  const s = d.summary;
  const rps = d.timeline.map((p) => p.requests);
  const p95 = d.timeline.map((p) => p.p95);
  const checks = s.checksPass + s.checksFail;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
      <Tile label="Requests" value={formatNum(s.requests)} sub={`${formatNum(s.iterations)} iterations`} />
      <Tile label="Throughput" value={`${formatNum(s.rps, 1)}/s`} sub={`peak ${formatNum(s.peakRps)}/s`} spark={<Sparkline values={rps} />} />
      <Tile label="Error rate" value={formatPct(s.errorRate)} sub={`${formatNum(s.failures)} failed`} tone={s.errorRate > 0.01 ? 'bad' : 'good'} />
      <Tile label="p95 latency" value={ms(s.latency.p95)} sub={`p99 ${ms(s.latency.p99)} · max ${ms(s.latency.max)}`} spark={<Sparkline values={p95} color="var(--series-2)" />} />
      <Tile label="Avg latency" value={ms(s.latency.avg)} sub={`median ${ms(s.latency.p50)} · TTFB ${ms(s.waiting.avg)}`} />
      <Tile label="Apdex" value={s.apdex.score.toFixed(2)} sub={`T = ${s.apdex.tMs} ms`} tone={s.apdex.score >= 0.85 ? 'good' : s.apdex.score < 0.7 ? 'bad' : undefined} />
      <Tile label="Virtual users" value={formatNum(s.vusMax)} sub="max concurrent" />
      <Tile label="Checks" value={checks ? formatPct(s.checksPass / checks, 1) : '–'} sub={`${formatNum(s.checksFail)} failed of ${formatNum(checks)}`} tone={s.checksFail ? 'bad' : checks ? 'good' : undefined} />
      <Tile label="Data received" value={formatBytes(s.bytesIn)} sub={`${formatBytes(s.bytesIn / Math.max(s.durationS, 1))}/s`} />
      <Tile label="Data sent" value={formatBytes(s.bytesOut)} sub={`${formatBytes(s.bytesOut / Math.max(s.durationS, 1))}/s`} />
      <Tile label="Duration" value={formatDuration(s.durationS)} sub={`iteration avg ${ms(s.iteration.avg)}`} />
      <Tile label="Dropped iterations" value={formatNum(s.droppedIterations)} sub="arrival-rate executor" tone={s.droppedIterations ? 'bad' : undefined} />
    </div>
  );
}

export function ThresholdTable({ s, stepNames }: { s: Summary; stepNames: Record<string, string> }) {
  if (!s.thresholds.length) return null;
  return (
    <ChartCard title="Thresholds" subtitle={s.verdict === 'passed' ? 'All thresholds passed' : `${s.thresholds.filter((t) => !t.pass).length} failed`}>
      <table className="w-full text-[12px]">
        <tbody>
          {s.thresholds.map((t, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="w-6 py-1">{t.pass ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}</td>
              <td className="py-1 font-mono">
                {t.metric}
                {t.step ? <span className="text-muted-foreground">{`{${stepNames[t.step] ?? t.step}}`}</span> : null} {t.stat} {t.op} {t.value}
              </td>
              <td className="py-1 text-right font-mono">
                actual{' '}
                <b className={t.pass ? 'text-success' : 'text-danger'}>
                  {t.actual === null ? 'n/a' : t.metric.includes('duration') || t.metric.includes('waiting') ? ms(t.actual) : t.stat === 'rate' && t.actual <= 1 ? formatPct(t.actual) : formatNum(t.actual, 3)}
                </b>
              </td>
              <td className="w-16 py-1 text-right">{t.pass ? <span className="text-success">PASS</span> : <span className="font-semibold text-danger">FAIL</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  );
}

/** Every time-series chart. `staticWidth` renders for export (no hover state). */
export function Charts({ d, staticWidth }: { d: ReportData; staticWidth?: number }) {
  const tl = d.timeline;
  const x = tl.map((p) => p.t);
  const s = d.summary;
  const half = staticWidth ? Math.floor(staticWidth / 2) - 40 : undefined;
  const statusCodes = [...new Set(tl.flatMap((p) => Object.keys(p.status)))].sort();
  const stepIds = s.steps.map((st) => st.id).slice(0, 8);
  const grid = staticWidth ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 gap-3 xl:grid-cols-2';
  const nz = (v: number, n: number) => (n > 0 ? v : null);
  return (
    <div className={grid}>
      <ChartCard
        title="Throughput"
        subtitle="requests per second"
        legend={<Legend items={[{ name: 'Requests/s', color: SERIES[0]! }, { name: 'Failed/s', color: 'var(--danger)' }, { name: 'Iterations/s', color: SERIES[2]!, dashed: true }]} />}
      >
        <LineChart
          staticWidth={half}
          x={x}
          series={[
            { name: 'Requests/s', color: SERIES[0]!, values: tl.map((p) => p.requests), area: true },
            { name: 'Failed/s', color: 'var(--danger)', values: tl.map((p) => p.failures) },
            { name: 'Iterations/s', color: SERIES[2]!, values: tl.map((p) => p.iterations), dashed: true },
          ]}
        />
      </ChartCard>
      <ChartCard
        title="Response time"
        subtitle="percentiles per second"
        legend={<Legend items={['p99', 'p95', 'p90', 'median', 'avg'].map((n, i) => ({ name: n, color: SERIES[[7, 1, 3, 0, 2][i]!]!, dashed: n === 'avg' }))} />}
      >
        <LineChart
          staticWidth={half}
          x={x}
          yFormat={(v) => formatMs(v)}
          refLines={d.thresholdP95 ? [{ value: d.thresholdP95, label: `p95 threshold ${d.thresholdP95} ms` }] : []}
          series={[
            { name: 'p99', color: SERIES[7]!, values: tl.map((p) => nz(p.p99, p.requests)) },
            { name: 'p95', color: SERIES[1]!, values: tl.map((p) => nz(p.p95, p.requests)) },
            { name: 'p90', color: SERIES[3]!, values: tl.map((p) => nz(p.p90, p.requests)) },
            { name: 'median', color: SERIES[0]!, values: tl.map((p) => nz(p.p50, p.requests)) },
            { name: 'avg', color: SERIES[2]!, values: tl.map((p) => nz(p.avg, p.requests)), dashed: true },
          ]}
        />
      </ChartCard>
      <ChartCard title="Virtual users" subtitle="active VUs">
        <LineChart staticWidth={half} x={x} series={[{ name: 'VUs', color: SERIES[6]!, values: tl.map((p) => p.vus), area: true }]} />
      </ChartCard>
      <ChartCard title="Error rate" subtitle="failed / total per second">
        <LineChart
          staticWidth={half}
          x={x}
          yFormat={pctFmt}
          yMax={0.05}
          series={[{ name: 'Error rate', color: 'var(--danger)', values: tl.map((p) => (p.requests ? p.failures / p.requests : null)), area: true }]}
        />
      </ChartCard>
      <ChartCard title="Latency heatmap" subtitle="requests per latency band over time">
        <Heatmap staticWidth={half} x={x} rows={tl.map((p) => p.heat)} bounds={d.heatBoundsMs} />
      </ChartCard>
      <ChartCard title="Response time distribution" subtitle={`${formatNum(s.requests)} requests`}>
        <Histogram
          staticWidth={half}
          bins={s.distribution}
          markers={[
            { value: s.latency.p50, label: `p50 ${formatMs(s.latency.p50)}` },
            { value: s.latency.p95, label: `p95 ${formatMs(s.latency.p95)}` },
            { value: s.latency.p99, label: `p99 ${formatMs(s.latency.p99)}` },
          ]}
        />
      </ChartCard>
      <ChartCard title="Status codes over time" subtitle="stacked, per second" legend={<Legend items={statusCodes.map((c) => ({ name: c === '0' ? 'error' : c, color: statusColor(c) }))} />}>
        <LineChart staticWidth={half} x={x} stacked series={statusCodes.map((c) => ({ name: c === '0' ? 'error' : c, color: statusColor(c), values: tl.map((p) => p.status[c] ?? 0) }))} />
      </ChartCard>
      <ChartCard title="Response time by request" subtitle="average per second" legend={<Legend items={stepIds.map((id, i) => ({ name: d.stepNames[id] ?? id, color: SERIES[i]! }))} />}>
        <LineChart
          staticWidth={half}
          x={x}
          yFormat={(v) => formatMs(v)}
          series={stepIds.map((id, i) => ({ name: d.stepNames[id] ?? id, color: SERIES[i]!, values: tl.map((p) => (p.steps[id]?.count ? p.steps[id]!.avg : null)) }))}
        />
      </ChartCard>
      <ChartCard title="Response time vs virtual users" subtitle="p95 for each second, by concurrency (JMeter “response time vs threads”)">
        <VsChart points={tl.filter((p) => p.requests > 0).map((p) => ({ x: p.vus, y: p.p95 }))} staticWidth={half} xLabel="VUs" />
      </ChartCard>
      <ChartCard title="Bandwidth" subtitle="bytes per second" legend={<Legend items={[{ name: 'Received', color: SERIES[0]! }, { name: 'Sent', color: SERIES[1]! }]} />}>
        <LineChart
          staticWidth={half}
          x={x}
          yFormat={(v) => formatBytes(v)}
          series={[
            { name: 'Received', color: SERIES[0]!, values: tl.map((p) => p.bytesIn) },
            { name: 'Sent', color: SERIES[1]!, values: tl.map((p) => p.bytesOut) },
          ]}
        />
      </ChartCard>
      <ChartCard title="Apdex" subtitle={`score per second (T = ${s.apdex.tMs} ms)`}>
        <LineChart staticWidth={half} x={x} yMax={1} yFormat={(v) => v.toFixed(2)} series={[{ name: 'Apdex', color: SERIES[2]!, values: tl.map((p) => p.apdex) }]} />
        <div className="mt-2">
          <StackBar
            parts={[
              { label: 'Satisfied', value: s.apdex.satisfied, color: 'var(--success)' },
              { label: 'Tolerating', value: s.apdex.tolerating, color: 'var(--warning)' },
              { label: 'Frustrated', value: s.apdex.frustrated, color: 'var(--danger)' },
            ]}
          />
        </div>
      </ChartCard>
      <ChartCard title="Status code distribution">
        <HBars items={Object.entries(s.status).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ label: c === '0' ? 'Network error' : `HTTP ${c}`, value: n, color: statusColor(c) }))} format={(v) => formatNum(v)} />
      </ChartCard>
    </div>
  );
}

/** Scatter of y vs x (one dot per second). */
export function VsChart({ points, staticWidth, xLabel }: { points: { x: number; y: number }[]; staticWidth?: number; xLabel: string }) {
  const w = staticWidth ?? 520;
  const h = 190;
  const P = { l: 52, r: 12, t: 8, b: 24 };
  if (!points.length) return <div className="p-6 text-center text-[12px] text-muted-foreground">No data</div>;
  const maxX = Math.max(...points.map((p) => p.x), 1);
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const sx = (v: number) => P.l + (v / maxX) * (w - P.l - P.r);
  const sy = (v: number) => P.t + (h - P.t - P.b) * (1 - v / maxY);
  const yt = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="chart block" preserveAspectRatio="none">
      {yt.map((v) => (
        <g key={v}>
          <line className="grid" x1={P.l} x2={w - P.r} y1={sy(v)} y2={sy(v)} strokeDasharray={v ? '2 3' : undefined} />
          <text x={P.l - 6} y={sy(v) + 3.5} textAnchor="end">
            {formatMs(v)}
          </text>
        </g>
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={sx(f * maxX)} y={h - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
          {`${Math.round(f * maxX)} ${xLabel}`}
        </text>
      ))}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={4} fill="var(--series-2)" fillOpacity={0.55} stroke="var(--surface)" strokeWidth={1}>
          <title>{`${p.x} ${xLabel}: p95 ${formatMs(p.y)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** JMeter-style aggregate report. */
export function AggregateTable({ s }: { s: Summary }) {
  const cols = ['Request', 'Samples', 'Avg', 'Median', 'p90', 'p95', 'p99', 'Min', 'Max', 'Std dev', 'Error %', 'Throughput', 'Recv KB/s', 'Sent KB/s', 'Apdex'];
  const dur = Math.max(s.durationS, 0.001);
  const row = (name: ReactNode, st: Summary['steps'][number] | null) => {
    const l = st ? st.latency : s.latency;
    const count = st ? st.count : s.requests;
    const er = st ? st.errorRate : s.errorRate;
    const rps = st ? st.rps : s.rps;
    const bi = st ? st.bytesIn : s.bytesIn;
    const bo = st ? st.bytesOut : s.bytesOut;
    const ap = st ? st.apdex : s.apdex.score;
    return [name, formatNum(count), ms(l.avg), ms(l.p50), ms(l.p90), ms(l.p95), ms(l.p99), ms(l.min), ms(l.max), ms(l.stddev), formatPct(er), `${formatNum(rps, 1)}/s`, formatNum(bi / 1024 / dur, 1), formatNum(bo / 1024 / dur, 1), ap.toFixed(2)];
  };
  return (
    <ChartCard title="Aggregate report" subtitle="per request (JMeter aggregate report / k6 per-request metrics)">
      <div className="overflow-auto">
        <table className="w-full text-[12px] whitespace-nowrap">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
              {cols.map((c, i) => (
                <th key={c} className={`px-2 py-1 font-medium ${i ? 'text-right' : ''}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {s.steps.map((st) => (
              <tr key={st.id} className="border-b border-border">
                {row(
                  <span className="font-sans">
                    <b className="mr-1 text-[10px] text-muted-foreground">{st.method}</b>
                    {st.name}
                  </span>,
                  st,
                ).map((c, i) => (
                  <td key={i} className={`px-2 py-1 ${i ? 'text-right' : ''} ${i === 10 && st.errorRate > 0 ? 'text-danger' : ''}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-surface-muted font-semibold">
              {row(<span className="font-sans">TOTAL</span>, null).map((c, i) => (
                <td key={i} className={`px-2 py-1 ${i ? 'text-right' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

export function ChecksAndErrors({ s, stepNames }: { s: Summary; stepNames: Record<string, string> }) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <ChartCard title="Checks" subtitle={`${formatNum(s.checksPass)} passed · ${formatNum(s.checksFail)} failed`}>
        {s.checks.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No checks defined.</div>
        ) : (
          <table className="w-full text-[12px]">
            <tbody>
              {s.checks.map((c, i) => {
                const n = c.pass + c.fail;
                return (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-1">{c.fail ? <XCircle className="size-3.5 text-danger" /> : <CheckCircle2 className="size-3.5 text-success" />}</td>
                    <td className="py-1 text-muted-foreground">{stepNames[c.step] ?? c.step}</td>
                    <td className="py-1">{c.name}</td>
                    <td className="py-1 text-right font-mono">{formatPct(n ? c.pass / n : 1, 1)}</td>
                    <td className="py-1 text-right font-mono text-muted-foreground">
                      ✓ {formatNum(c.pass)} ✗ {formatNum(c.fail)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ChartCard>
      <ChartCard title="Errors" subtitle={s.errors.length ? `top ${Math.min(15, s.errors.length)} by count` : 'none'}>
        {s.errors.length === 0 ? (
          <div className="text-[12px] text-success">No failed requests.</div>
        ) : (
          <table className="w-full text-[12px]">
            <tbody>
              {s.errors.slice(0, 15).map((e, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-1 pr-2 text-right font-mono text-danger">{formatNum(e.count)}</td>
                  <td className="py-1 pr-2 text-muted-foreground">{stepNames[e.step] ?? e.step}</td>
                  <td className="selectable py-1 font-mono break-all">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartCard>
    </div>
  );
}

export function ReportBody({ d, staticWidth }: { d: ReportData; staticWidth?: number }) {
  return (
    <div className="space-y-3">
      <Kpis d={d} />
      <ThresholdTable s={d.summary} stepNames={d.stepNames} />
      <Charts d={d} staticWidth={staticWidth} />
      <AggregateTable s={d.summary} />
      <ChecksAndErrors s={d.summary} stepNames={d.stepNames} />
    </div>
  );
}

export { fmtClock, fmtCompact };
