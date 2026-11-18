import { useEffect, useState } from 'react';

import { ChartCard, Legend, LineChart, SERIES } from '@/components/charts';
import { Badge, Empty, Spinner } from '@/components/ui';
import { formatBytes, formatDuration, formatMs, formatNum, formatPct, relTime } from '@/lib/format';
import { api } from '@/lib/ipc';
import type { RunRecord, Summary } from '@/lib/load/types';
import { uid } from '@/lib/postman';
import { useTabs } from '@/stores/tabs';
import { confirmAction } from '../actions';

import { useRuns } from './runs';

interface Metric {
  label: string;
  get: (s: Summary) => number;
  fmt: (v: number) => string;
  /** true = lower is better */
  lower: boolean;
}

const METRICS: Metric[] = [
  { label: 'Throughput (req/s)', get: (s) => s.rps, fmt: (v) => formatNum(v, 1), lower: false },
  { label: 'Requests', get: (s) => s.requests, fmt: (v) => formatNum(v), lower: false },
  { label: 'Error rate', get: (s) => s.errorRate, fmt: (v) => formatPct(v), lower: true },
  { label: 'Latency avg', get: (s) => s.latency.avg, fmt: formatMs, lower: true },
  { label: 'Latency p50', get: (s) => s.latency.p50, fmt: formatMs, lower: true },
  { label: 'Latency p90', get: (s) => s.latency.p90, fmt: formatMs, lower: true },
  { label: 'Latency p95', get: (s) => s.latency.p95, fmt: formatMs, lower: true },
  { label: 'Latency p99', get: (s) => s.latency.p99, fmt: formatMs, lower: true },
  { label: 'Latency max', get: (s) => s.latency.max, fmt: formatMs, lower: true },
  { label: 'TTFB avg', get: (s) => s.waiting.avg, fmt: formatMs, lower: true },
  { label: 'Apdex', get: (s) => s.apdex.score, fmt: (v) => v.toFixed(3), lower: false },
  { label: 'Checks pass rate', get: (s) => s.checksPass / Math.max(1, s.checksPass + s.checksFail), fmt: (v) => formatPct(v), lower: false },
  { label: 'Max VUs', get: (s) => s.vusMax, fmt: (v) => formatNum(v), lower: false },
  { label: 'Data received', get: (s) => s.bytesIn, fmt: formatBytes, lower: false },
];

function Delta({ base, v, lower }: { base: number; v: number; lower: boolean }) {
  if (!Number.isFinite(base) || base === 0) return null;
  const d = (v - base) / Math.abs(base);
  if (Math.abs(d) < 0.005) return <span className="text-muted-foreground">±0%</span>;
  const better = lower ? d < 0 : d > 0;
  // >5% change is significant enough to color.
  const strong = Math.abs(d) > 0.05;
  return <span className={strong ? (better ? 'text-success' : 'text-danger') : 'text-muted-foreground'}>{`${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}% ${better ? '▲' : '▼'}`}</span>;
}

export function CompareTab({ runIds }: { runIds: string[] }) {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  useEffect(() => {
    Promise.all(runIds.map((id) => api.get<RunRecord>('loadRuns', id).catch(() => null))).then((r) => setRuns(r.filter((x): x is RunRecord => !!x)));
  }, [runIds]);
  if (!runs) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (runs.length < 2) return <Empty title="Need at least two runs">Some selected runs no longer exist.</Empty>;
  const base = runs[0]!;
  const label = (r: RunRecord, i: number) => `${i === 0 ? 'Baseline' : `Run ${i + 1}`} · ${new Date(r.startedAt).toLocaleString()}`;
  const colors = runs.map((_, i) => SERIES[i]!);
  // Compare by elapsed seconds since start.
  const maxT = Math.max(...runs.map((r) => r.timeline.length));
  const x = Array.from({ length: maxT }, (_, i) => i);
  const series = (get: (p: RunRecord['timeline'][number]) => number | null) => runs.map((r, i) => ({ name: label(r, i), color: colors[i]!, values: x.map((t) => (r.timeline[t] ? get(r.timeline[t]!) : null)) }));
  const legend = <Legend items={runs.map((r, i) => ({ name: label(r, i), color: colors[i]! }))} />;
  const stepNames = [...new Set(runs.flatMap((r) => r.summary.steps.map((s) => s.name)))];
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3">
        <h2 className="text-[16px] font-semibold">Run comparison</h2>
        <p className="text-[12px] text-muted-foreground">Deltas are relative to the baseline (first run). Green = better, red = worse (changes over 5%).</p>
      </div>
      <ChartCard title="Key metrics">
        <div className="overflow-auto">
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                <th className="px-2 py-1 font-medium">Metric</th>
                {runs.map((r, i) => (
                  <th key={r.id} className="px-2 py-1 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full" style={{ background: colors[i] }} />
                      {i === 0 ? 'Baseline' : `Run ${i + 1}`}
                    </span>
                    <div className="font-normal">{r.name}</div>
                    <div className="font-normal">{relTime(Date.parse(r.startedAt))} · {formatDuration(r.summary.durationS)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="px-2 py-1">Verdict</td>
                {runs.map((r) => (
                  <td key={r.id} className="px-2 py-1 text-right">
                    <Badge tone={r.summary.verdict === 'passed' ? 'success' : 'danger'}>{r.summary.verdict || 'n/a'}</Badge>
                  </td>
                ))}
              </tr>
              {METRICS.map((m) => (
                <tr key={m.label} className="border-b border-border">
                  <td className="px-2 py-1">{m.label}</td>
                  {runs.map((r, i) => (
                    <td key={r.id} className="px-2 py-1 text-right font-mono">
                      {m.fmt(m.get(r.summary))} {i > 0 && <span className="ml-1 text-[11px]"><Delta base={m.get(base.summary)} v={m.get(r.summary)} lower={m.lower} /></span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartCard title="p95 latency over time" legend={legend}>
          <LineChart x={x} yFormat={formatMs} series={series((p) => (p.requests ? p.p95 : null))} />
        </ChartCard>
        <ChartCard title="Throughput over time" subtitle="requests/s" legend={legend}>
          <LineChart x={x} series={series((p) => p.requests)} />
        </ChartCard>
        <ChartCard title="Error rate over time" legend={legend}>
          <LineChart x={x} yMax={0.05} yFormat={(v) => `${(v * 100).toFixed(1)}%`} series={series((p) => (p.requests ? p.failures / p.requests : null))} />
        </ChartCard>
        <ChartCard title="Virtual users" legend={legend}>
          <LineChart x={x} series={series((p) => p.vus)} />
        </ChartCard>
      </div>
      <ChartCard title="Per request: p95 latency and error rate" className="mt-3">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
              <th className="px-2 py-1 font-medium">Request</th>
              {runs.map((r, i) => (
                <th key={r.id} className="px-2 py-1 text-right font-medium">
                  {i === 0 ? 'Baseline' : `Run ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stepNames.map((n) => {
              const b = base.summary.steps.find((s) => s.name === n);
              return (
                <tr key={n} className="border-b border-border">
                  <td className="px-2 py-1">{n}</td>
                  {runs.map((r, i) => {
                    const s = r.summary.steps.find((x) => x.name === n);
                    return (
                      <td key={r.id} className="px-2 py-1 text-right font-mono">
                        {s ? (
                          <>
                            {formatMs(s.latency.p95)} · {formatPct(s.errorRate, 1)}
                            {i > 0 && b && (
                              <span className="ml-1 text-[11px]">
                                <Delta base={b.latency.p95} v={s.latency.p95} lower />
                              </span>
                            )}
                          </>
                        ) : (
                          '–'
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ChartCard>
    </div>
  );
}

export function RunsListTab() {
  const runs = useRuns((s) => s.runs);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    useRuns.getState().refresh();
  }, []);
  // Trend of p95/RPS across runs of the same scenario (oldest → newest).
  const byScenario = new Map<string, typeof runs>();
  for (const r of runs) {
    const k = r.meta?.scenarioId ?? r.name;
    byScenario.set(k, [...(byScenario.get(k) ?? []), r]);
  }
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-[16px] font-semibold">Load test runs</h2>
        <button
          type="button"
          disabled={picked.length < 2}
          onClick={() => useTabs.getState().open({ id: uid(), kind: 'compare', runIds: picked })}
          className="rounded-md bg-accent px-3 py-1 text-accent-foreground disabled:opacity-40"
        >
          Compare selected ({picked.length})
        </button>
      </div>
      {[...byScenario.entries()].map(([k, list]) => {
        const ordered = [...list].reverse();
        return (
          <ChartCard key={k} title={list[0]!.name} subtitle={`${list.length} runs`} className="mb-3">
            {ordered.length > 1 && (
              <div className="mb-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div>
                  <div className="text-[11px] text-muted-foreground">p95 latency trend</div>
                  <LineChart height={120} x={ordered.map((_, i) => i + 1)} xFormat={(v) => `#${v}`} yFormat={formatMs} series={[{ name: 'p95', color: SERIES[1]!, values: ordered.map((r) => r.summary.latency.p95) }]} />
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">throughput trend (req/s)</div>
                  <LineChart height={120} x={ordered.map((_, i) => i + 1)} xFormat={(v) => `#${v}`} series={[{ name: 'req/s', color: SERIES[0]!, values: ordered.map((r) => r.summary.rps) }]} />
                </div>
              </div>
            )}
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                  <th className="w-6" />
                  <th className="px-2 py-1 font-medium">Started</th>
                  <th className="px-2 py-1 font-medium">Verdict</th>
                  <th className="px-2 py-1 text-right font-medium">Duration</th>
                  <th className="px-2 py-1 text-right font-medium">VUs</th>
                  <th className="px-2 py-1 text-right font-medium">Req/s</th>
                  <th className="px-2 py-1 text-right font-medium">p95</th>
                  <th className="px-2 py-1 text-right font-medium">Errors</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-b border-border hover:bg-surface-hover" onClick={() => useTabs.getState().open({ id: uid(), kind: 'loadRun', runId: r.id })}>
                    <td className="px-1" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} className="accent-[var(--accent)]" />
                    </td>
                    <td className="px-2 py-1">{new Date(r.startedAt).toLocaleString()}</td>
                    <td className="px-2 py-1">
                      <Badge tone={r.summary.verdict === 'passed' ? 'success' : 'danger'}>{r.summary.verdict}</Badge>
                    </td>
                    <td className="px-2 py-1 text-right">{formatDuration(r.summary.durationS)}</td>
                    <td className="px-2 py-1 text-right font-mono">{r.summary.vusMax}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatNum(r.summary.rps, 1)}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatMs(r.summary.latency.p95)}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatPct(r.summary.errorRate)}</td>
                    <td className="px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-danger"
                        onClick={() =>
                          confirmAction('Delete run', 'Delete this run?', async () => {
                            await api.remove('loadRuns', r.id);
                            useRuns.getState().refresh();
                          })
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ChartCard>
        );
      })}
      {!runs.length && <Empty title="No runs yet">Open a scenario and press Run test.</Empty>}
    </div>
  );
}
