import { CheckCircle2, Download, FileUp, Play, Square, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';

import { ChartCard, HBars, SERIES } from '@/components/charts';
import { Badge, Button, Checkbox, cn, Empty, Field, Input, Select, Spinner } from '@/components/ui';
import { commitScopes, contextFor, execute } from '@/lib/execute';
import { formatMs, formatPct, slug } from '@/lib/format';
import { pickTextFiles, saveText } from '@/lib/native';
import { clone, findItem, flattenRequests, itemProtocol } from '@/lib/postman';
import type { PmItem, TestResult } from '@/lib/types';
import { errText, toast } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

import { parseDataFile } from '../load/ScenarioEditor';

interface Result {
  iteration: number;
  itemId: string;
  name: string;
  method: string;
  url: string;
  status: number | null;
  timeMs: number | null;
  size: number;
  tests: TestResult[];
  errors: string[];
}

function junit(name: string, results: Result[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const suites = results.map((r) => {
    const cases = r.tests.map((t) => (t.passed ? `      <testcase name="${esc(t.name)}" classname="${esc(r.name)}" />` : `      <testcase name="${esc(t.name)}" classname="${esc(r.name)}"><failure message="${esc(t.error ?? 'failed')}" /></testcase>`));
    for (const e of r.errors) cases.push(`      <testcase name="${esc(e)}" classname="${esc(r.name)}"><error message="${esc(e)}" /></testcase>`);
    const fails = r.tests.filter((t) => !t.passed).length + r.errors.length;
    return `    <testsuite name="${esc(r.name)} (iteration ${r.iteration + 1})" tests="${cases.length}" failures="${fails}" time="${((r.timeMs ?? 0) / 1000).toFixed(3)}">\n${cases.join('\n')}\n    </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${esc(name)}">\n${suites.join('\n')}\n</testsuites>\n`;
}

function htmlReport(name: string, results: Result[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const total = results.flatMap((r) => r.tests);
  const passed = total.filter((t) => t.passed).length;
  const rows = results
    .map(
      (r) => `<tr><td>${r.iteration + 1}</td><td><b>${esc(r.method)}</b> ${esc(r.name)}<div class="u">${esc(r.url)}</div></td><td>${r.status ?? 'ERR'}</td><td>${r.timeMs === null ? '–' : Math.round(r.timeMs)} ms</td><td>${r.tests
        .map((t) => `<div class="${t.passed ? 'ok' : 'ko'}">${t.passed ? '✓' : '✗'} ${esc(t.name)}${t.error ? ` — ${esc(t.error)}` : ''}</div>`)
        .join('')}${r.errors.map((e) => `<div class="ko">${esc(e)}</div>`).join('')}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} – run report</title><style>
body{font:13px system-ui,sans-serif;margin:24px;color:#222}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}.u{color:#777;font:11px monospace}.ok{color:#127a3a}.ko{color:#c0362c}.k{display:inline-block;margin-right:24px}.k b{font-size:20px;display:block}
</style></head><body><h1>${esc(name)}</h1><p>${new Date().toLocaleString()}</p>
<div><span class="k"><b>${results.length}</b>requests</span><span class="k"><b>${passed}/${total.length}</b>tests passed</span><span class="k"><b>${Math.round(results.reduce((a, r) => a + (r.timeMs ?? 0), 0) / Math.max(results.length, 1))} ms</b>avg response</span></div>
<table><thead><tr><th>#</th><th>Request</th><th>Status</th><th>Time</th><th>Tests</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function RunnerTab({ collectionId, folderId }: { collectionId: string; folderId?: string }) {
  const c = useWorkspace((s) => s.collections[collectionId]);
  const envs = useWorkspace((s) => s.environments);
  const activeEnv = useWorkspace((s) => s.activeEnv);
  const root: PmItem[] = c ? (folderId ? (findItem(c.item, folderId)?.item.item ?? []) : c.item) : [];
  const all = flattenRequests(root).filter((x) => ['http', 'graphql'].includes(itemProtocol(x.item)));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(all.map((x) => x.item.id!)));
  const [iterations, setIterations] = useState(1);
  const [delay, setDelay] = useState(0);
  const [envId, setEnvId] = useState<string>(activeEnv ?? '');
  const [data, setData] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [persist, setPersist] = useState(true);
  const [stopOnFail, setStopOnFail] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  if (!c) return <Empty title="Collection not found" />;
  const title = folderId ? (findItem(c.item, folderId)?.item.name ?? c.info.name) : c.info.name;

  const run = async () => {
    const list = all.filter((x) => selected.has(x.item.id!));
    if (!list.length) return;
    stop.current = false;
    setRunning(true);
    setResults([]);
    const ws = useWorkspace.getState();
    const prevEnv = ws.activeEnv;
    if ((envId || null) !== prevEnv) ws.setActiveEnv(envId || null);
    const iters = data ? Math.max(iterations, data.rows.length) : iterations;
    const base = contextFor(collectionId, null);
    const before = clone(base.scopes);
    try {
      for (let it = 0; it < iters && !stop.current; it++) {
        base.scopes.data = data ? { ...(data.rows[it % data.rows.length] ?? {}) } : {};
        let i = 0;
        let guard = 0;
        while (i < list.length && !stop.current && guard++ < 10_000) {
          const { item, parents } = list[i]!;
          const ctx = { ...base, parents };
          const res = await execute(item, ctx, { iteration: it, iterationCount: iters });
          base.scopes.local = {};
          const r: Result = {
            iteration: it,
            itemId: item.id!,
            name: item.name,
            method: res.spec?.method ?? item.request?.method ?? 'GET',
            url: res.spec?.url ?? '',
            status: res.response?.status ?? null,
            timeMs: res.response?.timings.totalMs ?? null,
            size: res.response?.size ?? 0,
            tests: res.tests,
            errors: [...(res.error ? [res.error] : []), ...res.scriptErrors, ...(res.skipped ? ['skipped'] : [])],
          };
          setResults((prev) => [...prev, r]);
          if (stopOnFail && (r.errors.length || r.tests.some((t) => !t.passed))) {
            stop.current = true;
            break;
          }
          if (res.nextRequest === null) break;
          if (typeof res.nextRequest === 'string') {
            const j = list.findIndex((x) => x.item.name === res.nextRequest);
            i = j >= 0 ? j : list.length;
          } else i++;
          if (delay > 0) await new Promise((r2) => setTimeout(r2, delay));
        }
      }
      if (persist) commitScopes(base, before);
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setRunning(false);
    }
  };

  const tests = results.flatMap((r) => r.tests);
  const passed = tests.filter((t) => t.passed).length;
  const failedReq = results.filter((r) => r.errors.length || r.tests.some((t) => !t.passed)).length;
  const avg = results.length ? results.reduce((a, r) => a + (r.timeMs ?? 0), 0) / results.length : 0;
  const perReq = all
    .map(({ item }) => {
      const rs = results.filter((r) => r.itemId === item.id && r.timeMs !== null);
      return { label: item.name, value: rs.length ? rs.reduce((a, r) => a + r.timeMs!, 0) / rs.length : 0 };
    })
    .filter((x) => x.value > 0);

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[380px] shrink-0 overflow-auto border-r border-border p-4">
        <h2 className="text-[15px] font-semibold">Run “{title}”</h2>
        <p className="mb-3 text-[12px] text-muted-foreground">Collection Runner: sequential requests with scripts, tests, data files and iterations (like Postman / Newman).</p>
        <div className="space-y-3">
          <Field label="Environment">
            <Select value={envId} onChange={setEnvId} options={[{ value: '', label: 'No environment' }, ...Object.values(envs).map((e) => ({ value: e.id, label: e.name }))]} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Iterations">
              <Input type="number" min={1} value={iterations} onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Delay (ms)">
              <Input type="number" min={0} value={delay} onChange={(e) => setDelay(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>
          <Field label="Data file" hint={data ? `${data.rows.length} rows → one iteration per row` : 'CSV or JSON, one iteration per row'}>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  const f = await pickTextFiles({ title: 'Data file', filters: [{ name: 'CSV / JSON', extensions: ['csv', 'json'] }] });
                  if (!f[0]) return;
                  try {
                    setData({ name: f[0].name, rows: parseDataFile(f[0].name, f[0].text) });
                  } catch (e) {
                    toast('error', errText(e));
                  }
                }}
              >
                <FileUp className="size-3.5" /> Select file
              </Button>
              {data && (
                <Button size="sm" variant="ghost" onClick={() => setData(null)}>
                  {data.name} ✕
                </Button>
              )}
            </div>
          </Field>
          <Checkbox checked={persist} onChange={setPersist} label="Keep variable values set by scripts" />
          <Checkbox checked={stopOnFail} onChange={setStopOnFail} label="Stop run on first failure" />
          <div>
            <div className="mb-1 flex items-center text-[12px] font-medium text-muted-foreground">
              <span className="flex-1">Requests ({selected.size}/{all.length})</span>
              <button type="button" className="text-accent" onClick={() => setSelected(selected.size === all.length ? new Set() : new Set(all.map((x) => x.item.id!)))}>
                {selected.size === all.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              {all.map(({ item, parents }) => (
                <label key={item.id} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[12px] hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id!)}
                    onChange={(e) => {
                      const s = new Set(selected);
                      if (e.target.checked) s.add(item.id!);
                      else s.delete(item.id!);
                      setSelected(s);
                    }}
                    className="accent-[var(--accent)]"
                  />
                  <b className="w-12 font-mono text-[10px]">{item.request?.method}</b>
                  <span className="truncate text-muted-foreground">{parents.map((p) => `${p.name} / `).join('')}</span>
                  <span className="truncate">{item.name}</span>
                </label>
              ))}
            </div>
          </div>
          {running ? (
            <Button className="w-full" onClick={() => (stop.current = true)}>
              <Square className="size-4" /> Stop
            </Button>
          ) : (
            <Button variant="primary" className="w-full" onClick={run} disabled={!selected.size}>
              <Play className="size-4" /> Run {title}
            </Button>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2">
          {running && <Spinner className="text-accent" />}
          <span>
            Requests <b>{results.length}</b>
          </span>
          <span>
            Tests <b className="text-success">{passed}</b> / <b className={passed < tests.length ? 'text-danger' : ''}>{tests.length}</b> {tests.length > 0 && `(${formatPct(passed / tests.length, 0)})`}
          </span>
          <span>
            Failed requests <b className={failedReq ? 'text-danger' : ''}>{failedReq}</b>
          </span>
          <span>
            Avg <b>{formatMs(avg)}</b>
          </span>
          <div className="flex-1" />
          <Button size="sm" disabled={!results.length} onClick={() => saveText(`${slug(title)}-run.html`, htmlReport(title, results), [{ name: 'HTML', extensions: ['html'] }])}>
            <Download className="size-3.5" /> HTML
          </Button>
          <Button size="sm" disabled={!results.length} onClick={() => saveText(`${slug(title)}-junit.xml`, junit(title, results), [{ name: 'XML', extensions: ['xml'] }])}>
            JUnit
          </Button>
          <Button size="sm" disabled={!results.length} onClick={() => saveText(`${slug(title)}-run.json`, JSON.stringify({ collection: title, timestamp: new Date().toISOString(), results }, null, 2), [{ name: 'JSON', extensions: ['json'] }])}>
            JSON
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!results.length && !running && <Empty title="No results yet">Configure the run on the left and press Run.</Empty>}
          {perReq.length > 1 && (
            <ChartCard title="Average response time by request" className="mb-3">
              <HBars items={perReq} format={formatMs} color={SERIES[0]} />
            </ChartCard>
          )}
          {results.map((r, i) => {
            const ok = !r.errors.length && r.tests.every((t) => t.passed);
            return (
              <div key={i} className="mb-1.5 rounded-md border border-border bg-surface px-3 py-2">
                <div className="flex items-center gap-2">
                  {ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}
                  <span className="text-[11px] text-muted-foreground">#{r.iteration + 1}</span>
                  <b className="font-mono text-[11px]">{r.method}</b>
                  <span className="font-medium">{r.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">{r.url}</span>
                  <Badge tone={r.status && r.status < 400 ? 'success' : 'danger'}>{r.status ?? 'ERR'}</Badge>
                  <span className="w-16 text-right text-[12px]">{formatMs(r.timeMs)}</span>
                </div>
                {(r.tests.length > 0 || r.errors.length > 0) && (
                  <div className="mt-1 ml-6 space-y-0.5 text-[12px]">
                    {r.tests.map((t, j) => (
                      <div key={j} className={cn(t.passed ? 'text-success' : 'text-danger')}>
                        {t.passed ? '✓' : '✗'} {t.name} {t.error && <span className="font-mono">— {t.error}</span>}
                      </div>
                    ))}
                    {r.errors.map((e, j) => (
                      <div key={j} className="font-mono text-danger">
                        {e}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
