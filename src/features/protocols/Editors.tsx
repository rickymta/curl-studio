import { FileUp, Plug, PlugZap, Plus, RefreshCw, Save, Send, Trash2, X } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';

import { CodeEditor } from '@/components/CodeEditor';
import { KeyValueTable, VarInput } from '@/components/KeyValueTable';
import { Split } from '@/components/Split';
import { Badge, Button, Checkbox, cn, Field, IconButton, Input, Select, Spinner, Tabs } from '@/components/ui';
import { buildSpec } from '@/lib/build';
import { contextFor } from '@/lib/execute';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { pickFiles } from '@/lib/native';
import { makeUrl, urlRaw } from '@/lib/postman';
import type { GrpcMethod, GrpcSource, PmItem, ProtocolExt } from '@/lib/types';
import { lookup, resolve } from '@/lib/vars';
import { useTabs } from '@/stores/tabs';
import { errText, toast } from '@/stores/ui';

import { type RequestTabT, RequestHeader, useKnownVars } from '../request/common';
import { MessageLog } from './MessageLog';
import { useLive, useSessions } from './session';

function useResolver(tab: RequestTabT) {
  return (s: string) => {
    const ctx = contextFor(tab.collectionId, tab.itemId);
    return resolve(s, (n) => lookup(ctx.scopes, n));
  };
}

function ext(tab: RequestTabT): ProtocolExt {
  return tab.draft['x-curlstudio'] ?? { kind: 'ws' };
}

function useUpdate(tab: RequestTabT) {
  return (fn: (d: PmItem) => void) => useTabs.getState().updateDraft(tab.id, fn);
}

/** Puts inline elements into a translated sentence: `{0}`, `{1}`… mark where each node goes. */
function rich(text: string, ...nodes: ReactNode[]) {
  return text.split(/\{(\d)\}/).map((s, i) => (i % 2 ? <Fragment key={i}>{nodes[Number(s)]}</Fragment> : s));
}

function StateBadge({ state }: { state: string | undefined }) {
  if (state === 'open') return <Badge tone="success">{t('Connected')}</Badge>;
  if (state === 'connecting') return <Badge tone="warning">{t('Connecting…')}</Badge>;
  return <Badge>{t('Disconnected')}</Badge>;
}

function ConnectBar({
  tab,
  placeholder,
  onConnect,
  connectLabel = 'Connect',
}: {
  tab: RequestTabT;
  placeholder: string;
  onConnect: () => void;
  connectLabel?: string;
}) {
  const live = useLive(tab.id);
  const known = useKnownVars(tab.collectionId);
  const update = useUpdate(tab);
  const open = live?.state === 'open' || live?.state === 'connecting';
  return (
    <div className="flex shrink-0 gap-2 p-3">
      <div className="flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-border bg-background focus-within:border-accent">
        <VarInput
          value={urlRaw(tab.draft.request?.url)}
          known={known}
          placeholder={placeholder}
          onChange={(v) => update((d) => void ((d.request ??= {}).url = makeUrl(v, d.request.url)))}
          className="h-full"
          onKeyDown={(e) => e.key === 'Enter' && !open && onConnect()}
        />
        <div className="px-2">
          <StateBadge state={live?.state} />
        </div>
      </div>
      {open ? (
        <Button className="h-9 w-32" onClick={() => useSessions.getState().close(tab.id)}>
          <PlugZap className="size-4" /> {t('Disconnect')}
        </Button>
      ) : (
        <Button variant="primary" className="h-9 w-32" onClick={onConnect}>
          <Plug className="size-4" /> {t(connectLabel)}
        </Button>
      )}
    </div>
  );
}

// ---- WebSocket --------------------------------------------------------------------------------

export function WsEditor({ tab }: { tab: RequestTabT }) {
  const [section, setSection] = useState<'message' | 'headers' | 'settings' | 'saved'>('message');
  const [message, setMessage] = useState('{\n  "hello": "world"\n}');
  const [binary, setBinary] = useState(false);
  const live = useLive(tab.id);
  const known = useKnownVars(tab.collectionId);
  const update = useUpdate(tab);
  const r = useResolver(tab);
  const e = ext(tab);
  const saved = e.ws?.messages ?? [];
  const connect = () =>
    useSessions.getState().start(tab.id, () =>
      api.wsConnect({
        url: r(urlRaw(tab.draft.request?.url)),
        headers: (tab.draft.request?.header ?? []).filter((h) => !h.disabled && h.key).map((h) => ({ key: r(h.key), value: r(h.value ?? '') })),
        protocols: (e.ws?.protocols ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        verifyTls: tab.draft.protocolProfileBehavior?.strictSSL !== false,
      }),
    );
  const send = () => useSessions.getState().send(tab.id, { op: 'send', data: r(message), binary }).catch((err) => toast('error', errText(err)));
  const top = (
    <div className="flex h-full min-h-0 flex-col">
      <ConnectBar tab={tab} placeholder="wss://echo.websocket.org" onConnect={connect} />
      <Tabs
        value={section}
        onChange={setSection}
        items={[
          { id: 'message', label: t('Message') },
          { id: 'saved', label: t('Saved messages'), badge: saved.length || undefined },
          { id: 'headers', label: t('Headers'), badge: (tab.draft.request?.header ?? []).length || undefined },
          { id: 'settings', label: t('Settings') },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'message' && (
          <div className="flex h-full flex-col">
            <CodeEditor value={message} onChange={setMessage} language={binary ? 'text' : 'json'} variables={known} className="min-h-0 flex-1" onRun={send} />
            <div className="flex shrink-0 items-center gap-3 border-t border-border p-2">
              <Checkbox checked={binary} onChange={setBinary} label={t('Binary (base64)')} />
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const name = window.prompt(t('Message name'), t('Message {n}', { n: saved.length + 1 }));
                  if (name) update((d) => void ((d['x-curlstudio'] ??= { kind: 'ws' }).ws = { ...(d['x-curlstudio']!.ws ?? {}), messages: [...saved, { name, data: message }] }));
                }}
              >
                <Save className="size-3.5" /> {t('Save message')}
              </Button>
              <Button size="sm" variant="primary" disabled={live?.state !== 'open'} onClick={send}>
                <Send className="size-3.5" /> {t('Send')}
              </Button>
            </div>
          </div>
        )}
        {section === 'saved' && (
          <div className="p-2">
            {saved.length === 0 && <div className="p-4 text-center text-muted-foreground">{t('No saved messages.')}</div>}
            {saved.map((m, i) => (
              <div key={i} className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-hover">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => (setMessage(m.data), setSection('message'))}>
                  <div className="font-medium">{m.name}</div>
                  <div className="truncate font-mono text-[11.5px] text-muted-foreground">{m.data}</div>
                </button>
                <IconButton label={t('Send')} disabled={live?.state !== 'open'} onClick={() => useSessions.getState().send(tab.id, { op: 'send', data: r(m.data) })}>
                  <Send className="size-3.5" />
                </IconButton>
                <IconButton label={t('Delete')} onClick={() => update((d) => void (d['x-curlstudio']!.ws!.messages = saved.filter((_, j) => j !== i)))}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        {section === 'headers' && <KeyValueTable rows={tab.draft.request?.header ?? []} known={known} onChange={(rows) => update((d) => void ((d.request ??= {}).header = rows))} />}
        {section === 'settings' && (
          <div className="grid max-w-lg gap-3 p-4">
            <Field label="Subprotocols" hint={t('Comma separated, sent as Sec-WebSocket-Protocol')}>
              <Input value={e.ws?.protocols ?? ''} onChange={(ev) => update((d) => void ((d['x-curlstudio'] ??= { kind: 'ws' }).ws = { ...(d['x-curlstudio']!.ws ?? {}), protocols: ev.target.value }))} />
            </Field>
            <Checkbox
              checked={tab.draft.protocolProfileBehavior?.strictSSL !== false}
              onChange={(v) => update((d) => void (d.protocolProfileBehavior = { ...(d.protocolProfileBehavior ?? {}), strictSSL: v }))}
              label={t('Verify TLS certificates')}
            />
            <Button size="sm" className="w-32" disabled={live?.state !== 'open'} onClick={() => useSessions.getState().send(tab.id, { op: 'ping' })}>
              {t('Send ping')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <RequestHeader tab={tab} />
      <Split id="proto" a={top} b={<MessageLog messages={live?.messages ?? []} onClear={() => useSessions.getState().clear(tab.id)} />} initial={0.45} className="min-h-0 flex-1" />
    </div>
  );
}

// ---- SSE --------------------------------------------------------------------------------------

export function SseEditor({ tab }: { tab: RequestTabT }) {
  const live = useLive(tab.id);
  const known = useKnownVars(tab.collectionId);
  const update = useUpdate(tab);
  const connect = () => {
    const ctx = contextFor(tab.collectionId, tab.itemId);
    const { spec } = buildSpec(tab.draft.request ?? {}, { collection: ctx.collection, parents: ctx.parents, scopes: ctx.scopes, settings: ctx.settings, behavior: tab.draft.protocolProfileBehavior });
    return useSessions.getState().start(tab.id, () => api.sseConnect(spec));
  };
  const top = (
    <div className="flex h-full min-h-0 flex-col">
      <ConnectBar tab={tab} placeholder="https://example.com/events" onConnect={connect} />
      <div className="px-3 text-[11px] font-semibold text-muted-foreground uppercase">{t('Headers')}</div>
      <div className="min-h-0 flex-1 overflow-auto">
        <KeyValueTable rows={tab.draft.request?.header ?? []} known={known} onChange={(rows) => update((d) => void ((d.request ??= {}).header = rows))} />
        <p className="px-3 text-[11.5px] text-muted-foreground">{t('Auth from the request, folder or collection applies.')} <code>Accept: text/event-stream</code> {t('is added automatically.')}</p>
      </div>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <RequestHeader tab={tab} />
      <Split id="proto" a={top} b={<MessageLog messages={live?.messages ?? []} onClear={() => useSessions.getState().clear(tab.id)} />} initial={0.35} className="min-h-0 flex-1" />
    </div>
  );
}

// ---- MQTT -------------------------------------------------------------------------------------

export function MqttEditor({ tab }: { tab: RequestTabT }) {
  const [section, setSection] = useState<'publish' | 'subscriptions' | 'connection'>('publish');
  const [payload, setPayload] = useState('{\n  "temperature": 21.5\n}');
  const live = useLive(tab.id);
  const known = useKnownVars(tab.collectionId);
  const update = useUpdate(tab);
  const r = useResolver(tab);
  const m = ext(tab).mqtt ?? {};
  const setM = (patch: Partial<NonNullable<ProtocolExt['mqtt']>>) => update((d) => void ((d['x-curlstudio'] ??= { kind: 'mqtt' }).mqtt = { ...(d['x-curlstudio']!.mqtt ?? {}), ...patch }));
  const topics = m.topics ?? [];
  const isOpen = live?.state === 'open';
  const connect = async () => {
    await useSessions.getState().start(tab.id, () =>
      api.mqttConnect({
        url: r(urlRaw(tab.draft.request?.url)),
        clientId: r(m.clientId ?? ''),
        username: r(m.username ?? ''),
        password: r(m.password ?? ''),
        keepAliveS: m.keepAlive ?? 30,
        cleanSession: m.cleanSession !== false,
        verifyTls: tab.draft.protocolProfileBehavior?.strictSSL !== false,
        willTopic: m.will?.topic ?? '',
        willPayload: m.will?.payload ?? '',
        willQos: m.will?.qos ?? 0,
        willRetain: m.will?.retain ?? false,
      }),
    );
    // Subscribe to saved topics once connected.
    setTimeout(() => {
      for (const t of topics) if (t.topic) useSessions.getState().send(tab.id, { op: 'subscribe', topic: r(t.topic), qos: t.qos }).catch(() => undefined);
    }, 600);
  };
  const top = (
    <div className="flex h-full min-h-0 flex-col">
      <ConnectBar tab={tab} placeholder="mqtt://broker.hivemq.com:1883" onConnect={connect} />
      <Tabs
        value={section}
        onChange={setSection}
        items={[
          { id: 'publish', label: 'Publish' },
          { id: 'subscriptions', label: 'Subscriptions', badge: topics.length || undefined },
          { id: 'connection', label: t('Connection') },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'publish' && (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-2 p-2">
              <Input value={m.publishTopic ?? ''} placeholder="Topic" onChange={(e) => setM({ publishTopic: e.target.value })} className="flex-1 font-mono" />
              <Select value={String(m.publishQos ?? 0)} onChange={(v) => setM({ publishQos: Number(v) })} options={['0', '1', '2'].map((q) => ({ value: q, label: `QoS ${q}` }))} />
              <Checkbox checked={!!m.retain} onChange={(v) => setM({ retain: v })} label="Retain" />
            </div>
            <CodeEditor value={payload} onChange={setPayload} language="json" variables={known} className="min-h-0 flex-1 border-t border-border" />
            <div className="flex shrink-0 justify-end border-t border-border p-2">
              <Button
                size="sm"
                variant="primary"
                disabled={!isOpen || !m.publishTopic}
                onClick={() => useSessions.getState().send(tab.id, { op: 'publish', topic: r(m.publishTopic ?? ''), qos: m.publishQos ?? 0, retain: !!m.retain, data: r(payload) })}
              >
                <Send className="size-3.5" /> Publish
              </Button>
            </div>
          </div>
        )}
        {section === 'subscriptions' && (
          <div className="space-y-1 p-3">
            {topics.map((tp, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={tp.topic} onChange={(e) => setM({ topics: topics.map((x, j) => (j === i ? { ...x, topic: e.target.value } : x)) })} className="flex-1 font-mono" placeholder="sensors/#" />
                <Select value={String(tp.qos)} onChange={(v) => setM({ topics: topics.map((x, j) => (j === i ? { ...x, qos: Number(v) } : x)) })} options={['0', '1', '2'].map((q) => ({ value: q, label: `QoS ${q}` }))} />
                <Button size="sm" disabled={!isOpen} onClick={() => useSessions.getState().send(tab.id, { op: 'subscribe', topic: r(tp.topic), qos: tp.qos })}>
                  Subscribe
                </Button>
                <Button size="sm" variant="ghost" disabled={!isOpen} onClick={() => useSessions.getState().send(tab.id, { op: 'unsubscribe', topic: r(tp.topic) })}>
                  Unsubscribe
                </Button>
                <IconButton label={t('Remove')} onClick={() => setM({ topics: topics.filter((_, j) => j !== i) })}>
                  <X className="size-3.5" />
                </IconButton>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setM({ topics: [...topics, { topic: '', qos: 0 }] })}>
              <Plus className="size-3.5" /> {t('Add topic')}
            </Button>
            <p className="text-[11.5px] text-muted-foreground">{rich(t('Saved topics are subscribed automatically on connect. Wildcards {0} and {1} are supported.'), <code>+</code>, <code>#</code>)}</p>
          </div>
        )}
        {section === 'connection' && (
          <div className="grid max-w-2xl grid-cols-2 gap-3 p-4">
            <Field label="Client ID" hint={t('Empty = random')}>
              <Input value={m.clientId ?? ''} onChange={(e) => setM({ clientId: e.target.value })} />
            </Field>
            <Field label="Keep alive (s)">
              <Input type="number" value={String(m.keepAlive ?? 30)} onChange={(e) => setM({ keepAlive: Number(e.target.value) || 30 })} />
            </Field>
            <Field label={t('Username')}>
              <Input value={m.username ?? ''} onChange={(e) => setM({ username: e.target.value })} />
            </Field>
            <Field label={t('Password')}>
              <Input type="password" value={m.password ?? ''} onChange={(e) => setM({ password: e.target.value })} />
            </Field>
            <Checkbox checked={m.cleanSession !== false} onChange={(v) => setM({ cleanSession: v })} label="Clean session" />
            <Checkbox
              checked={tab.draft.protocolProfileBehavior?.strictSSL !== false}
              onChange={(v) => update((d) => void (d.protocolProfileBehavior = { ...(d.protocolProfileBehavior ?? {}), strictSSL: v }))}
              label={t('Verify TLS (mqtts://)')}
            />
            <div className="col-span-2 mt-2 text-[12px] font-semibold">Last Will</div>
            <Field label="Topic">
              <Input value={m.will?.topic ?? ''} onChange={(e) => setM({ will: { qos: 0, retain: false, payload: '', ...m.will, topic: e.target.value } })} />
            </Field>
            <Field label="Payload">
              <Input value={m.will?.payload ?? ''} onChange={(e) => setM({ will: { qos: 0, retain: false, topic: '', ...m.will, payload: e.target.value } })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <RequestHeader tab={tab} />
      <Split id="proto" a={top} b={<MessageLog messages={live?.messages ?? []} onClear={() => useSessions.getState().clear(tab.id)} />} initial={0.45} className="min-h-0 flex-1" />
    </div>
  );
}

// ---- gRPC -------------------------------------------------------------------------------------

const sources = new Map<string, GrpcSource>();

export function GrpcEditor({ tab }: { tab: RequestTabT }) {
  const [section, setSection] = useState<'message' | 'metadata' | 'definition'>('message');
  const [src, setSrc] = useState<GrpcSource | null>(() => sources.get(tab.id) ?? null);
  const [busy, setBusy] = useState(false);
  const live = useLive(tab.id);
  const known = useKnownVars(tab.collectionId);
  const update = useUpdate(tab);
  const r = useResolver(tab);
  const g = ext(tab).grpc ?? {};
  const setG = (patch: Partial<NonNullable<ProtocolExt['grpc']>>) => update((d) => void ((d['x-curlstudio'] ??= { kind: 'grpc' }).grpc = { ...(d['x-curlstudio']!.grpc ?? {}), ...patch }));
  const url = urlRaw(tab.draft.request?.url);
  const metadata = () => (tab.draft.request?.header ?? []).filter((h) => !h.disabled && h.key).map((h) => ({ key: r(h.key), value: r(h.value ?? '') }));
  const methods: GrpcMethod[] = src?.services.flatMap((s) => s.methods) ?? [];
  const method = methods.find((m) => m.path === g.method);
  const streamingClient = !!method?.clientStreaming;

  const load = async (): Promise<GrpcSource | null> => {
    setBusy(true);
    try {
      const s = g.useReflection !== false ? await api.grpcReflect({ url: r(url), tls: g.tls, metadata: metadata() }) : await api.grpcLoad(g.protoFiles ?? [], g.includes ?? []);
      sources.set(tab.id, s);
      setSrc(s);
      const all = s.services.flatMap((x) => x.methods);
      if (!g.method && all[0]) setG({ method: all[0].path, message: JSON.stringify(all[0].template, null, 2) });
      toast('success', t('{n} methods loaded', { n: all.length }));
      return s;
    } catch (e) {
      toast('error', errText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const invoke = async () => {
    let s = src;
    if (!s) s = await load();
    if (!s || !g.method) return;
    const msgText = r(g.message ?? '{}');
    // Allow a JSON array of messages for client streaming.
    let messages = [msgText];
    try {
      const parsed = JSON.parse(msgText);
      if (Array.isArray(parsed) && streamingClient) messages = parsed.map((x) => JSON.stringify(x));
    } catch {
      /* invalid JSON → backend reports it */
    }
    await useSessions.getState().start(tab.id, () =>
      api.grpcInvoke({
        sourceId: s!.sourceId,
        method: g.method!,
        url: r(url),
        tls: g.tls,
        metadata: metadata(),
        timeoutMs: 30000,
        messages,
        keepOpen: streamingClient,
      }),
    );
  };

  const top = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-2 p-3">
        <div className="flex h-9 min-w-0 flex-[2] items-center overflow-hidden rounded-md border border-border bg-background focus-within:border-accent">
          <VarInput value={url} known={known} placeholder="localhost:50051 or https://grpc.example.com" onChange={(v) => update((d) => void ((d.request ??= {}).url = makeUrl(v, d.request.url)))} className="h-full" />
          <label className="flex shrink-0 items-center gap-1 px-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={!!g.tls} onChange={(e) => setG({ tls: e.target.checked })} className="accent-[var(--accent)]" /> TLS
          </label>
        </div>
        <select
          value={g.method ?? ''}
          onChange={(e) => {
            const m = methods.find((x) => x.path === e.target.value);
            setG({ method: e.target.value, ...(m ? { message: JSON.stringify(m.template, null, 2) } : {}) });
          }}
          className="h-9 min-w-0 flex-[2] rounded-md border border-border bg-background px-2 font-mono text-[12px] outline-none"
        >
          <option value="">{methods.length ? t('Select a method') : t('Load services first →')}</option>
          {src?.services.map((s) => (
            <optgroup key={s.name} label={s.name}>
              {s.methods.map((m) => (
                <option key={m.path} value={m.path}>
                  {m.name} {m.clientStreaming && m.serverStreaming ? '(bidi stream)' : m.clientStreaming ? '(client stream)' : m.serverStreaming ? '(server stream)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
          {!src && g.method && <option value={g.method}>{g.method}</option>}
        </select>
        <Button className="h-9" onClick={load} disabled={busy} title={t('Load services (reflection or .proto)')}>
          {busy ? <Spinner /> : <RefreshCw className="size-4" />}
        </Button>
        {live?.state === 'open' || live?.state === 'connecting' ? (
          <Button className="h-9 w-28" onClick={() => useSessions.getState().close(tab.id)}>
            <X className="size-4" /> {t('Cancel')}
          </Button>
        ) : (
          <Button variant="primary" className="h-9 w-28" onClick={invoke} disabled={busy}>
            <Send className="size-4" /> {t('Invoke')}
          </Button>
        )}
      </div>
      <Tabs
        value={section}
        onChange={setSection}
        items={[
          { id: 'message', label: t('Message') },
          { id: 'metadata', label: 'Metadata', badge: (tab.draft.request?.header ?? []).length || undefined },
          { id: 'definition', label: t('Service definition') },
        ]}
        right={method && <span className="font-mono text-[11px] text-muted-foreground">{method.inputType} → {method.outputType}</span>}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'message' && (
          <div className="flex h-full flex-col">
            <CodeEditor value={g.message ?? '{}'} onChange={(v) => setG({ message: v })} language="json" variables={known} className="min-h-0 flex-1" onRun={invoke} />
            {streamingClient && (
              <div className="flex shrink-0 items-center gap-2 border-t border-border p-2 text-[12px]">
                <span className="text-muted-foreground">{t('Client streaming: Invoke sends the editor content (a JSON array = several messages) and keeps the stream open.')}</span>
                <div className="flex-1" />
                <Button size="sm" disabled={live?.state !== 'open'} onClick={() => useSessions.getState().send(tab.id, { op: 'send', data: r(g.message ?? '{}') })}>
                  {t('Send message')}
                </Button>
                <Button size="sm" disabled={live?.state !== 'open'} onClick={() => useSessions.getState().send(tab.id, { op: 'end' })}>
                  {t('End stream')}
                </Button>
              </div>
            )}
          </div>
        )}
        {section === 'metadata' && <KeyValueTable rows={tab.draft.request?.header ?? []} known={known} onChange={(rows) => update((d) => void ((d.request ??= {}).header = rows))} keyPlaceholder={t('Key (use -bin suffix for binary)')} />}
        {section === 'definition' && (
          <div className="grid max-w-2xl gap-3 p-4">
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={g.useReflection !== false} onChange={() => setG({ useReflection: true })} className="accent-[var(--accent)]" /> {t('Server reflection')}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={g.useReflection === false} onChange={() => setG({ useReflection: false })} className="accent-[var(--accent)]" /> {t('.proto files')}
              </label>
            </div>
            {g.useReflection === false && (
              <>
                <div className="space-y-1">
                  {(g.protoFiles ?? []).map((f, i) => (
                    <div key={i} className="flex items-center gap-2 font-mono text-[12px]">
                      <span className="min-w-0 flex-1 truncate">{f}</span>
                      <IconButton label={t('Remove')} onClick={() => setG({ protoFiles: (g.protoFiles ?? []).filter((_, j) => j !== i) })}>
                        <X className="size-3.5" />
                      </IconButton>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      const p = await pickFiles({ title: t('Select .proto files'), multiple: true, filters: [{ name: 'Protocol Buffers', extensions: ['proto'] }] });
                      if (p.length) setG({ protoFiles: [...new Set([...(g.protoFiles ?? []), ...p])] });
                    }}
                  >
                    <FileUp className="size-3.5" /> {t('Add .proto files')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const p = await pickFiles({ title: t('Import path (include directory)'), directory: true });
                      if (p.length) setG({ includes: [...new Set([...(g.includes ?? []), ...p])] });
                    }}
                  >
                    {t('Add import path')}
                  </Button>
                </div>
                {(g.includes ?? []).length > 0 && <div className="font-mono text-[11.5px] text-muted-foreground">{t('Import paths: {paths}', { paths: (g.includes ?? []).join('; ') })}</div>}
              </>
            )}
            <p className="text-[11.5px] text-muted-foreground">
              {rich(t('Compiled in-process (no {0} needed); well-known types are built in. Use {1} / plain host for plaintext and enable TLS for secure endpoints.'), <code>protoc</code>, <code>http://</code>)}
            </p>
            {method && (
              <div className={cn('rounded-md border border-border p-2 font-mono text-[12px]')}>
                <div>rpc {method.name}({method.clientStreaming ? 'stream ' : ''}{method.inputType}) returns ({method.serverStreaming ? 'stream ' : ''}{method.outputType})</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <RequestHeader tab={tab} />
      <Split id="proto" a={top} b={<MessageLog messages={live?.messages ?? []} onClear={() => useSessions.getState().clear(tab.id)} />} initial={0.5} className="min-h-0 flex-1" />
    </div>
  );
}
