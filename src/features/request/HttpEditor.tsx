import { ChevronDown, Send, Square } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { KeyValueTable, VarInput } from '@/components/KeyValueTable';
import { Split } from '@/components/Split';
import { Button, Checkbox, cn, Dropdown, Field, Input, Tabs } from '@/components/ui';
import { buildSpec, effectiveAuth } from '@/lib/build';
import { isCurl, parseCurl } from '@/lib/curl';
import { commitScopes, contextFor, execute } from '@/lib/execute';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { clone, makeUrl, METHODS, methodColor, parseQuery, pathVariables, scriptOf, setScript, uid, urlRaw, withQuery } from '@/lib/postman';
import type { PmItem, PmKV } from '@/lib/types';
import { useTabs } from '@/stores/tabs';
import { logActivity } from '@/stores/activity';
import { toast } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { type RequestTabT, RequestHeader, saveTab, useKnownVars } from './common';
import { ResponseView } from './ResponseView';
import { ScriptEditor } from './ScriptEditor';

type Section = 'params' | 'auth' | 'headers' | 'body' | 'pre' | 'tests' | 'settings';

export async function sendTab(tab: RequestTabT) {
  const set = useTabs.getState().setResponse;
  const requestId = uid();
  set(tab.id, { loading: true, requestId, error: null, response: null, tests: [], scriptErrors: [], warnings: [], startedAt: Date.now(), visualizer: null });
  const ctx = contextFor(tab.collectionId, tab.itemId);
  const before = clone(ctx.scopes);
  const started = performance.now();
  const res = await execute(tab.draft, ctx, { requestId });
  commitScopes(ctx, before);
  const method = res.spec?.method ?? (tab.draft.request?.method ?? 'GET').toUpperCase();
  const tests = res.tests ?? [];
  const failedTests = tests.filter((t) => !t.passed).length;
  logActivity({
    cat: 'request',
    label: `${method} ${tab.draft.name}`,
    status: res.error && res.error !== 'cancelled' ? 'failed' : 'finished',
    ms: Math.round(res.response?.timings.totalMs ?? performance.now() - started),
    detail: res.error
      ? `${res.spec?.url ?? ''} — ${res.error}`
      : `${res.spec?.url ?? ''} → ${res.response?.status ?? ''}${tests.length ? ` · tests ${tests.length - failedTests}/${tests.length}` : ''}`,
  });
  if (res.error === 'cancelled') {
    set(tab.id, { loading: false, error: t('Request cancelled'), response: null });
    return;
  }
  set(tab.id, {
    loading: false,
    response: res.response,
    error: res.skipped ? t('Request skipped by pm.execution.skipRequest()') : res.error,
    tests: res.tests,
    scriptErrors: res.scriptErrors,
    warnings: res.warnings,
    sent: res.spec,
    visualizer: res.visualizer ?? null,
  });
  if (res.spec) {
    useWorkspace.getState().pushHistory({
      method: res.spec.method,
      url: res.spec.url,
      status: res.response?.status ?? 0,
      timeMs: res.response?.timings.totalMs ?? null,
      item: clone(tab.draft),
    });
  }
}

function MethodPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <Dropdown
      items={[
        ...METHODS.map((m) => ({ label: m, onSelect: () => onChange(m) })),
        'sep' as const,
        {
          label: t('Custom…'),
          onSelect: () => {
            const m = window.prompt(t('Custom HTTP method'), value);
            if (m?.trim()) onChange(m.trim().toUpperCase());
          },
        },
      ]}
    >
      <button type="button" className={cn('flex h-full w-28 shrink-0 items-center justify-between gap-1 border-r border-border px-3 font-mono text-[12.5px] font-bold', methodColor(value))}>
        {value}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
    </Dropdown>
  );
}

export function HttpEditor({ tab }: { tab: RequestTabT }) {
  const [section, setSection] = useState<Section>(() => (tab.draft.request?.body?.mode === 'graphql' ? 'body' : 'params'));
  const state = useTabs((s) => s.responses[tab.id]);
  const known = useKnownVars(tab.collectionId);
  const req = tab.draft.request ?? {};
  const raw = urlRaw(req.url);
  const update = useCallback((fn: (it: PmItem) => void) => useTabs.getState().updateDraft(tab.id, fn), [tab.id]);
  const method = (req.method ?? 'GET').toUpperCase();

  const setUrl = (v: string) =>
    update((d) => {
      d.request ??= {};
      d.request.url = makeUrl(v, d.request.url);
    });
  const urlObj = typeof req.url === 'object' && req.url ? req.url : makeUrl(raw);
  const queryRows: PmKV[] = urlObj.query ?? parseQuery(raw);
  const pathVars = pathVariables(raw);

  const send = () => (state?.loading ? undefined : sendTab(tab));
  const cancel = () => state?.requestId && api.cancel(state.requestId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTabs.getState().active !== tab.id) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        send();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveTab(useTabs.getState().tabs.find((t) => t.id === tab.id) as RequestTabT);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ctx = contextFor(tab.collectionId, tab.itemId);
  const inherited = effectiveAuth({ auth: undefined }, ctx.parents, ctx.collection);
  const headerCount = (req.header ?? []).filter((h) => !h.disabled && h.key).length;
  const pre = scriptOf(tab.draft.event, 'prerequest');
  const tests = scriptOf(tab.draft.event, 'test');
  const behavior = tab.draft.protocolProfileBehavior ?? {};
  const setBehavior = (k: string, v: unknown) =>
    update((d) => {
      d.protocolProfileBehavior = { ...(d.protocolProfileBehavior ?? {}), [k]: v };
      if (v === undefined) delete d.protocolProfileBehavior[k];
    });

  const buildIntrospection = () => {
    const c = contextFor(tab.collectionId, tab.itemId);
    return buildSpec(tab.draft.request ?? {}, { collection: c.collection, parents: c.parents, scopes: c.scopes, settings: c.settings }).spec;
  };

  const top = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-2 p-3">
        <div className="flex h-9 min-w-0 flex-1 items-stretch overflow-hidden rounded-md border border-border bg-background focus-within:border-accent">
          <MethodPicker value={method} onChange={(m) => update((d) => void ((d.request ??= {}).method = m))} />
          <VarInput
            value={raw}
            known={known}
            onChange={setUrl}
            placeholder={t('Enter URL or paste a cURL command')}
            className="h-full"
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              if (isCurl(text)) {
                e.preventDefault();
                try {
                  const item = parseCurl(text);
                  update((d) => {
                    d.request = item.request;
                    if (item.protocolProfileBehavior) d.protocolProfileBehavior = item.protocolProfileBehavior;
                  });
                  toast('success', t('cURL imported into this request'));
                } catch (err) {
                  toast('error', String(err));
                }
              }
            }}
          />
        </div>
        {state?.loading ? (
          <Button variant="default" className="h-9 w-28" onClick={cancel}>
            <Square className="size-3.5" /> {t('Cancel')}
          </Button>
        ) : (
          <Button variant="primary" className="h-9 w-28" onClick={send}>
            <Send className="size-3.5" /> {t('Send')}
          </Button>
        )}
      </div>
      <Tabs
        value={section}
        onChange={setSection}
        items={[
          { id: 'params', label: t('Params'), badge: queryRows.filter((q) => !q.disabled).length + pathVars.length || undefined },
          { id: 'auth', label: 'Authorization' },
          { id: 'headers', label: t('Headers'), badge: headerCount || undefined },
          { id: 'body', label: t('Body'), badge: req.body?.mode && req.body.mode !== 'none' ? '●' : undefined },
          { id: 'pre', label: 'Pre-request Script', badge: pre.trim() ? '●' : undefined },
          { id: 'tests', label: t('Tests'), badge: tests.trim() ? '●' : undefined },
          { id: 'settings', label: t('Settings') },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'params' && (
          <>
            <div className="px-3 pt-2 text-[11px] font-semibold text-muted-foreground uppercase">Query Params</div>
            <KeyValueTable
              rows={queryRows}
              known={known}
              onChange={(rows) =>
                update((d) => {
                  d.request ??= {};
                  const u = makeUrl(withQuery(raw, rows), d.request.url);
                  u.query = rows;
                  d.request.url = u;
                })
              }
            />
            {pathVars.length > 0 && (
              <>
                <div className="px-3 pt-2 text-[11px] font-semibold text-muted-foreground uppercase">{t('Path Variables')}</div>
                <KeyValueTable
                  rows={pathVars.map((n) => urlObj.variable?.find((v) => v.key === n) ?? { key: n, value: '' })}
                  known={known}
                  readOnlyKeys
                  onChange={(rows) =>
                    update((d) => {
                      d.request ??= {};
                      const u = makeUrl(raw, d.request.url);
                      u.variable = rows.filter((r) => pathVars.includes(r.key));
                      d.request.url = u;
                    })
                  }
                />
              </>
            )}
          </>
        )}
        {section === 'auth' && (
          <AuthEditor
            auth={req.auth}
            known={known}
            scopes={ctx.scopes}
            inheritedFrom={inherited.auth ? `${inherited.source} (${inherited.auth.type})` : t('parent (no auth)')}
            onChange={(a) =>
              update((d) => {
                d.request ??= {};
                if (a === undefined) delete d.request.auth;
                else d.request.auth = a;
              })
            }
          />
        )}
        {section === 'headers' && (
          <>
            <KeyValueTable rows={req.header ?? []} known={known} onChange={(rows) => update((d) => void ((d.request ??= {}).header = rows))} />
            <p className="px-3 text-[11.5px] text-muted-foreground">
              {t('Added automatically when absent:')} <code>User-Agent</code>, <code>Accept-Encoding</code>, <code>Content-Type</code> {t('(from the body type) and auth headers.')}
            </p>
          </>
        )}
        {section === 'body' && (
          <BodyEditor body={req.body} known={known} onChange={(b) => update((d) => void ((d.request ??= {}).body = b))} buildIntrospection={buildIntrospection} />
        )}
        {section === 'pre' && <ScriptEditor listen="prerequest" value={pre} known={known} onChange={(v) => update((d) => void (d.event = setScript(d.event, 'prerequest', v)))} />}
        {section === 'tests' && <ScriptEditor listen="test" value={tests} known={known} onChange={(v) => update((d) => void (d.event = setScript(d.event, 'test', v)))} />}
        {section === 'settings' && (
          <div className="grid max-w-xl gap-3 p-4">
            <Checkbox checked={behavior.followRedirects !== false} onChange={(v) => setBehavior('followRedirects', v ? undefined : false)} label={t('Automatically follow redirects')} />
            <Field label={t('Maximum number of redirects')}>
              <Input type="number" value={String(behavior.maxRedirects ?? '')} placeholder="10" onChange={(e) => setBehavior('maxRedirects', e.target.value ? Number(e.target.value) : undefined)} />
            </Field>
            <Checkbox checked={behavior.strictSSL !== false} onChange={(v) => setBehavior('strictSSL', v ? undefined : false)} label={t('Enable SSL certificate verification')} />
            <Checkbox checked={!behavior.disableCookies} onChange={(v) => setBehavior('disableCookies', v ? undefined : true)} label={t('Use the cookie jar (send and store cookies)')} />
            <Field label={t('Request timeout (ms)')} hint={t('Empty = global setting')}>
              <Input type="number" value={String(behavior.requestTimeout ?? '')} placeholder="30000" onChange={(e) => setBehavior('requestTimeout', e.target.value ? Number(e.target.value) : undefined)} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RequestHeader tab={tab} />
      <Split id="request" a={top} b={<ResponseView state={state} onCancel={cancel} />} initial={0.48} className="min-h-0 flex-1" />
    </div>
  );
}
