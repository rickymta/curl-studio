import { CheckCircle2, Copy, Download, Search, WrapText, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CodeEditor, type Lang } from '@/components/CodeEditor';
import { Badge, cn, Empty, IconButton, Select, Spinner, Tabs } from '@/components/ui';
import { formatBytes, formatMs, languageOf, prettyJson, prettyXml, statusTone } from '@/lib/format';
import { copyText, saveText, savePath } from '@/lib/native';
import { api } from '@/lib/ipc';
import type { ResponseData, TestResult } from '@/lib/types';
import type { ResponseState } from '@/stores/tabs';
import { errText, toast } from '@/stores/ui';

type View = 'body' | 'headers' | 'cookies' | 'tests' | 'timeline' | 'visualize';

function contentType(r: ResponseData) {
  return r.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
}

/** Tiny Handlebars subset for pm.visualizer: {{x}}, {{this.x}}, {{#each list}}…{{/each}}, {{#if x}}…{{/if}}. */
function renderTemplate(tpl: string, data: unknown): string {
  const get = (ctx: unknown, path: string): unknown => {
    if (path === 'this' || path === '.') return ctx;
    let cur: unknown = ctx;
    for (const p of path.replace(/^this\./, '').split('.')) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  };
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const render = (t: string, ctx: unknown): string =>
    t
      .replace(/\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, path: string, body: string) => {
        const list = get(ctx, path.trim());
        return Array.isArray(list) ? list.map((x) => render(body, x)).join('') : '';
      })
      .replace(/\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, path: string, body: string) => (get(ctx, path.trim()) ? render(body, ctx) : ''))
      .replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_, path: string) => String(get(ctx, path) ?? ''))
      .replace(/\{\{\s*([^}#/]+?)\s*\}\}/g, (_, path: string) => esc(get(ctx, path)));
  return render(tpl, data);
}

export function TestList({ tests, errors }: { tests: TestResult[]; errors?: string[] }) {
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const shown = tests.filter((t) => filter === 'all' || (filter === 'passed' ? t.passed : !t.passed));
  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      {!!errors?.length && (
        <div className="mb-3 space-y-1">
          {errors.map((e, i) => (
            <div key={i} className="rounded-md bg-danger-soft px-2.5 py-1.5 font-mono text-[12px] text-danger">
              {e}
            </div>
          ))}
        </div>
      )}
      <div className="mb-2 flex gap-1">
        {(['all', 'passed', 'failed'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={cn('rounded px-2 py-0.5 text-[12px] capitalize', filter === f ? 'bg-surface-hover' : 'text-muted-foreground')}>
            {f} ({f === 'all' ? tests.length : tests.filter((t) => (f === 'passed' ? t.passed : !t.passed)).length})
          </button>
        ))}
      </div>
      {shown.length === 0 && <div className="text-muted-foreground">No tests. Add some in the Tests tab.</div>}
      {shown.map((t, i) => (
        <div key={i} className="flex items-start gap-2 border-b border-border py-1.5">
          {t.skipped ? (
            <Badge>SKIP</Badge>
          ) : t.passed ? (
            <Badge tone="success">PASS</Badge>
          ) : (
            <Badge tone="danger">FAIL</Badge>
          )}
          <div className="min-w-0">
            <div>{t.name}</div>
            {t.error && <div className="font-mono text-[11.5px] text-danger">{t.error}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ r }: { r: ResponseData }) {
  const t = r.timings;
  const parts = [
    { label: 'Prepare', v: t.prepareMs, c: 'bg-muted-foreground' },
    { label: 'Waiting (TTFB: DNS, connect, TLS, server)', v: t.waitMs, c: 'bg-warning' },
    { label: 'Download', v: t.downloadMs, c: 'bg-success' },
  ];
  const total = Math.max(t.totalMs, 0.001);
  let acc = 0;
  return (
    <div className="space-y-4 overflow-auto p-3">
      <div className="space-y-1.5">
        {parts.map((p) => {
          const left = (acc / total) * 100;
          acc += p.v;
          return (
            <div key={p.label} className="flex items-center gap-3 text-[12px]">
              <span className="w-64 shrink-0 text-muted-foreground">{p.label}</span>
              <div className="relative h-3 flex-1 rounded bg-surface-muted">
                <div className={cn('absolute h-3 rounded', p.c)} style={{ left: `${left}%`, width: `${Math.max(0.5, (p.v / total) * 100)}%` }} />
              </div>
              <span className="w-20 text-right font-mono">{formatMs(p.v)}</span>
            </div>
          );
        })}
        <div className="flex justify-end gap-3 border-t border-border pt-1 text-[12px]">
          <span className="text-muted-foreground">Total</span>
          <span className="w-20 text-right font-mono font-semibold">{formatMs(t.totalMs)}</span>
        </div>
      </div>
      <div className="selectable space-y-1 font-mono text-[12px]">
        <div className="text-muted-foreground">
          {r.requestMethod} {r.requestUrl} {r.remoteAddr && `(${r.remoteAddr})`}
        </div>
        <div className="mt-2 font-sans text-[11px] font-semibold text-muted-foreground uppercase">Request headers sent</div>
        {r.requestHeaders.map((h, i) => (
          <div key={i}>
            <span className="text-accent">{h.key}</span>: {h.value}
          </div>
        ))}
        <div className="mt-2 font-sans text-[11px] font-semibold text-muted-foreground uppercase">Response</div>
        <div>
          {r.httpVersion} {r.status} {r.statusText}
        </div>
        {r.headers.map((h, i) => (
          <div key={i}>
            <span className="text-accent">{h.key}</span>: {h.value}
          </div>
        ))}
      </div>
    </div>
  );
}

function parseCookies(r: ResponseData) {
  return r.headers
    .filter((h) => h.key.toLowerCase() === 'set-cookie')
    .map((h) => {
      const [first, ...attrs] = h.value.split(';');
      const eq = first!.indexOf('=');
      const a: Record<string, string> = {};
      for (const x of attrs) {
        const [k, ...v] = x.trim().split('=');
        a[k!.toLowerCase()] = v.join('=') || 'true';
      }
      return { name: first!.slice(0, eq).trim(), value: first!.slice(eq + 1).trim(), ...a };
    });
}

export function ResponseView({ state, onCancel }: { state: ResponseState | undefined; onCancel?: () => void }) {
  const [view, setView] = useState<View>('body');
  const [mode, setMode] = useState<'pretty' | 'raw' | 'preview'>('pretty');
  const [wrap, setWrap] = useState(true);
  const [langOverride, setLangOverride] = useState<string>('auto');
  const r = state?.response ?? null;

  const ct = r ? contentType(r) : '';
  const isImage = ct.startsWith('image/');
  const isPdf = ct.includes('pdf');
  const text = (() => {
    if (!r) return '';
    if (r.bodyEncoding === 'base64') {
      if (isImage || isPdf) return '';
      try {
        return atob(r.body);
      } catch {
        return r.body;
      }
    }
    return r.body;
  })();
  const detected = r ? languageOf(ct, text) : 'text';
  const lang = (langOverride === 'auto' ? detected : langOverride) as Lang;
  const shown = useMemo(() => {
    if (mode !== 'pretty') return text;
    if (lang === 'json') return prettyJson(text);
    if (lang === 'xml') return prettyXml(text);
    return text;
  }, [text, lang, mode]);

  if (state?.loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="size-6" />
        <div>Sending request…</div>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-1 hover:bg-surface-hover">
            Cancel
          </button>
        )}
      </div>
    );
  }
  if (!state || (!r && !state.error)) {
    return (
      <Empty title="Response">
        Enter a URL and press <b>Send</b> (Ctrl+Enter). Responses, test results and timings appear here.
      </Empty>
    );
  }
  if (!r) {
    return (
      <div className="space-y-2 overflow-auto p-4">
        <div className="flex items-center gap-2 font-semibold text-danger">
          <XCircle className="size-4" /> Could not send request
        </div>
        <pre className="selectable rounded-md bg-danger-soft p-3 font-mono text-[12px] whitespace-pre-wrap text-danger">{state.error}</pre>
        {!!state.warnings?.length && <div className="text-[12px] text-warning">{state.warnings.join(' · ')}</div>}
        {!!state.scriptErrors?.length && <TestList tests={state.tests ?? []} errors={state.scriptErrors} />}
      </div>
    );
  }
  const tests = state.tests ?? [];
  const passed = tests.filter((t) => t.passed).length;
  const cookies = parseCookies(r);

  const saveBody = async () => {
    try {
      if (r.bodyEncoding === 'base64' || r.bodyTruncated) {
        const p = await savePath('response.bin');
        if (!p) return;
        if (r.bodyTruncated && state.sent) await api.download(p, state.sent);
        else await api.writeBase64(p, r.body);
      } else {
        const ext = lang === 'json' ? 'json' : lang === 'xml' ? 'xml' : lang === 'html' ? 'html' : 'txt';
        await saveText(`response.${ext}`, text);
      }
      toast('success', 'Response saved');
    } catch (e) {
      toast('error', errText(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={view}
        onChange={setView}
        items={[
          { id: 'body', label: 'Body' },
          { id: 'headers', label: 'Headers', badge: r.headers.length },
          { id: 'cookies', label: 'Cookies', badge: cookies.length },
          {
            id: 'tests',
            label: 'Test Results',
            badge: tests.length ? `${passed}/${tests.length}` : state.scriptErrors?.length ? '!' : undefined,
          },
          { id: 'timeline', label: 'Timeline' },
          ...(state.visualizer ? [{ id: 'visualize' as const, label: 'Visualize' }] : []),
        ]}
        right={
          <div className="flex items-center gap-3 text-[12px]">
            <span>
              Status <Badge tone={statusTone(r.status)}>{r.status} {r.statusText}</Badge>
            </span>
            <span title={`TTFB ${formatMs(r.timings.waitMs)} · download ${formatMs(r.timings.downloadMs)}`}>
              Time <b className="text-success">{formatMs(r.timings.totalMs)}</b>
            </span>
            <span title={`Headers ${formatBytes(r.headersSize)}`}>
              Size <b className="text-success">{formatBytes(r.size)}</b>
            </span>
            {tests.length > 0 && (
              <span className={passed === tests.length ? 'text-success' : 'text-danger'}>
                {passed === tests.length ? <CheckCircle2 className="inline size-3.5" /> : <XCircle className="inline size-3.5" />} {passed}/{tests.length}
              </span>
            )}
          </div>
        }
      />
      {!!state.warnings?.length && (
        <div className="border-b border-border bg-warning-soft px-3 py-1 text-[12px] text-warning">{state.warnings.join(' · ')}</div>
      )}
      <div className="min-h-0 flex-1">
        {view === 'body' && (
          <div className="flex h-full flex-col">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
              {(['pretty', 'raw', 'preview'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={cn('rounded px-2 py-0.5 text-[12px] capitalize', mode === m ? 'bg-surface-hover' : 'text-muted-foreground')}>
                  {m}
                </button>
              ))}
              {mode === 'pretty' && (
                <Select
                  value={langOverride}
                  onChange={setLangOverride}
                  className="ml-1 h-6 text-[12px]"
                  options={[
                    { value: 'auto', label: `Auto (${detected.toUpperCase()})` },
                    { value: 'json', label: 'JSON' },
                    { value: 'xml', label: 'XML' },
                    { value: 'html', label: 'HTML' },
                    { value: 'javascript', label: 'JavaScript' },
                    { value: 'text', label: 'Text' },
                  ]}
                />
              )}
              <div className="flex-1" />
              {r.bodyTruncated && <Badge tone="warning">Truncated — save to get the full body</Badge>}
              <IconButton label="Wrap lines" onClick={() => setWrap(!wrap)} className={wrap ? 'text-accent' : ''}>
                <WrapText className="size-3.5" />
              </IconButton>
              <IconButton label="Search (Ctrl+F in the editor)">
                <Search className="size-3.5" />
              </IconButton>
              <IconButton label="Copy" onClick={() => copyText(shown).then(() => toast('success', 'Copied'))}>
                <Copy className="size-3.5" />
              </IconButton>
              <IconButton label="Save response to file" onClick={saveBody}>
                <Download className="size-3.5" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1">
              {isImage ? (
                <div className="flex h-full items-center justify-center overflow-auto p-4">
                  <img src={`data:${ct};base64,${r.bodyEncoding === 'base64' ? r.body : btoa(r.body)}`} alt="response" className="max-h-full max-w-full" />
                </div>
              ) : isPdf && r.bodyEncoding === 'base64' ? (
                <iframe title="pdf" className="h-full w-full bg-white" src={`data:application/pdf;base64,${r.body}`} />
              ) : mode === 'preview' ? (
                <iframe title="preview" sandbox="" className="h-full w-full bg-white" srcDoc={lang === 'html' ? text : `<pre style="white-space:pre-wrap;font:12px monospace">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</pre>`} />
              ) : r.bodyEncoding === 'base64' && !text ? (
                <Empty title="Binary response">{formatBytes(r.size)} — use the download button to save it.</Empty>
              ) : (
                <CodeEditor value={shown} readOnly language={mode === 'raw' ? 'text' : lang} wrap={wrap} className="h-full" />
              )}
            </div>
          </div>
        )}
        {view === 'headers' && (
          <div className="selectable h-full overflow-auto p-2">
            <table className="w-full text-[12.5px]">
              <tbody>
                {r.headers.map((h, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="w-1/3 px-2 py-1 align-top font-medium">{h.key}</td>
                    <td className="px-2 py-1 font-mono break-all">{h.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === 'cookies' && (
          <div className="selectable h-full overflow-auto p-2">
            {cookies.length === 0 ? (
              <Empty title="No cookies">The response did not set cookies.</Empty>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground">
                    {['Name', 'Value', 'Domain', 'Path', 'Expires', 'HttpOnly', 'Secure'].map((h) => (
                      <th key={h} className="px-2 py-1 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cookies.map((c, i) => {
                    const x = c as Record<string, string>;
                    return (
                      <tr key={i} className="border-b border-border font-mono text-[12px]">
                        <td className="px-2 py-1">{c.name}</td>
                        <td className="max-w-xs truncate px-2 py-1">{c.value}</td>
                        <td className="px-2 py-1">{x.domain ?? ''}</td>
                        <td className="px-2 py-1">{x.path ?? ''}</td>
                        <td className="px-2 py-1">{x.expires ?? (x['max-age'] ? `${x['max-age']}s` : 'Session')}</td>
                        <td className="px-2 py-1">{x.httponly ? '✓' : ''}</td>
                        <td className="px-2 py-1">{x.secure ? '✓' : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {view === 'tests' && <TestList tests={tests} errors={state.scriptErrors} />}
        {view === 'timeline' && <Timeline r={r} />}
        {view === 'visualize' && state.visualizer && (
          <iframe title="visualizer" sandbox="allow-scripts" className="h-full w-full bg-white" srcDoc={renderTemplate(state.visualizer.template, state.visualizer.data)} />
        )}
      </div>
    </div>
  );
}
