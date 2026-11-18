import {
  Cookie,
  Download,
  Gauge,
  Globe2,
  History,
  Layers,
  Plus,
  Search,
  Settings as SettingsIcon,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge, Button, cn, ContextMenuWrap, Dropdown, Empty, IconButton, Select, Spinner } from '@/components/ui';
import { CompareTab, RunsListTab } from '@/features/load/CompareTab';
import { RunTab } from '@/features/load/RunTab';
import { ScenarioEditor } from '@/features/load/ScenarioEditor';
import { newScenario } from '@/features/load/scenario';
import { Dialogs } from '@/features/dialogs/Dialogs';
import { CollectionSettings, EnvironmentEditor } from '@/features/environments/EnvironmentEditor';
import { EnvironmentsView, HistoryView, LoadView, newEnvironmentPrompt } from '@/features/sidebar/OtherViews';
import { CollectionsView } from '@/features/sidebar/CollectionsView';
import { RunnerTab } from '@/features/runner/RunnerTab';
import { HttpEditor } from '@/features/request/HttpEditor';
import { GrpcEditor, MqttEditor, SseEditor, WsEditor } from '@/features/protocols/Editors';
import { newTab, promptText, type NewKind } from '@/features/actions';
import { itemProtocol, methodColor, PROTOCOL_LABEL, uid } from '@/lib/postman';
import { useConsole } from '@/stores/console';
import { syncTabsWithWorkspace, type Tab, useTabs } from '@/stores/tabs';
import { type SidebarView, useUi } from '@/stores/ui';
import { createCollection, useWorkspace } from '@/stores/workspace';
import { useRuns } from '@/features/load/runs';

const NEW_ITEMS: { kind: NewKind; label: string }[] = [
  { kind: 'http', label: 'HTTP Request' },
  { kind: 'graphql', label: 'GraphQL' },
  { kind: 'ws', label: 'WebSocket' },
  { kind: 'sse', label: 'Server-Sent Events' },
  { kind: 'grpc', label: 'gRPC' },
  { kind: 'mqtt', label: 'MQTT' },
];

function tabTitle(t: Tab): { title: string; badge?: React.ReactNode } {
  const ws = useWorkspace.getState();
  switch (t.kind) {
    case 'request': {
      const p = itemProtocol(t.draft);
      const m = (t.draft.request?.method ?? 'GET').toUpperCase();
      return {
        title: t.draft.name,
        badge: <span className={cn('font-mono text-[9.5px] font-bold', p === 'http' ? methodColor(m) : 'text-[oklch(0.72_0.12_300)]')}>{p === 'http' ? m : PROTOCOL_LABEL[p]}</span>,
      };
    }
    case 'environment':
      return { title: t.envId === 'globals' ? 'Globals' : (ws.environments[t.envId]?.name ?? 'Environment'), badge: <Globe2 className="size-3 text-muted-foreground" /> };
    case 'collection':
      return { title: ws.collections[t.collectionId]?.info.name ?? 'Collection', badge: <Layers className="size-3 text-accent" /> };
    case 'runner':
      return { title: `Run: ${ws.collections[t.collectionId]?.info.name ?? ''}`, badge: <span className="text-success">▶</span> };
    case 'scenario':
      return { title: ws.scenarios[t.scenarioId]?.name ?? 'Load test', badge: <Gauge className="size-3 text-accent" /> };
    case 'loadRun':
      return { title: `Report ${t.runId.slice(9, 15)}`, badge: <Gauge className="size-3 text-success" /> };
    case 'compare':
      return { title: `Compare ${t.runIds.length} runs`, badge: <Gauge className="size-3 text-muted-foreground" /> };
    case 'loadRuns':
      return { title: 'Load test runs', badge: <Gauge className="size-3 text-muted-foreground" /> };
  }
}

function TabStrip() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  useWorkspace((s) => s.collections);
  useWorkspace((s) => s.scenarios);
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-border bg-surface-muted">
      {tabs.map((t, i) => {
        const { title, badge } = tabTitle(t);
        const dirty = t.kind === 'request' && t.dirty;
        return (
          <ContextMenuWrap
            key={t.id}
            items={() => [
              { label: 'Close', onSelect: () => useTabs.getState().close(t.id) },
              { label: 'Close others', onSelect: () => useTabs.getState().closeOthers(t.id) },
              { label: 'Close all', onSelect: () => useTabs.setState({ tabs: [], active: null }) },
              ...(t.kind === 'request' ? [{ label: 'Duplicate tab', onSelect: () => useTabs.getState().openDraft({ ...JSON.parse(JSON.stringify(t.draft)), id: uid(), name: `${t.draft.name} Copy` }) }] : []),
            ]}
          >
            <div
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null && drag !== i) useTabs.getState().move(drag, i);
                setDrag(null);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  useTabs.getState().close(t.id);
                }
              }}
              onClick={() => useTabs.getState().setActive(t.id)}
              className={cn(
                'group flex h-9 max-w-56 min-w-32 cursor-pointer items-center gap-1.5 border-r border-border px-2.5 text-[12.5px]',
                t.id === active ? 'border-t-2 border-t-accent bg-background' : 'text-muted-foreground hover:bg-surface-hover',
              )}
            >
              {badge}
              <span className="min-w-0 flex-1 truncate">{title}</span>
              {dirty && <span className="size-1.5 rounded-full bg-accent group-hover:hidden" />}
              <button
                type="button"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  useTabs.getState().close(t.id);
                }}
                className={cn('rounded p-0.5 hover:bg-surface-hover', dirty ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100')}
              >
                <X className="size-3" />
              </button>
            </div>
          </ContextMenuWrap>
        );
      })}
      <Dropdown items={NEW_ITEMS.map((n) => ({ label: n.label, onSelect: () => newTab(n.kind) }))}>
        <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground" title="New tab">
          <Plus className="size-4" />
        </button>
      </Dropdown>
    </div>
  );
}

function TabContent() {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.active));
  if (!tab) {
    return (
      <Empty icon={<SquareTerminal className="size-10" />} title="CurlStudio">
        <div className="mt-2 grid grid-cols-3 gap-2">
          {NEW_ITEMS.map((n) => (
            <Button key={n.kind} onClick={() => newTab(n.kind)}>
              {n.label}
            </Button>
          ))}
        </div>
        <div className="mt-4 text-[12px]">
          Ctrl+T new request · Ctrl+Enter send · Ctrl+S save · Ctrl+W close tab · Ctrl+` console
        </div>
      </Empty>
    );
  }
  switch (tab.kind) {
    case 'request': {
      const p = itemProtocol(tab.draft);
      if (p === 'ws') return <WsEditor key={tab.id} tab={tab} />;
      if (p === 'sse') return <SseEditor key={tab.id} tab={tab} />;
      if (p === 'mqtt') return <MqttEditor key={tab.id} tab={tab} />;
      if (p === 'grpc') return <GrpcEditor key={tab.id} tab={tab} />;
      return <HttpEditor key={tab.id} tab={tab} />;
    }
    case 'environment':
      return <EnvironmentEditor key={tab.id} envId={tab.envId} />;
    case 'collection':
      return <CollectionSettings key={tab.id} collectionId={tab.collectionId} folderId={tab.folderId} />;
    case 'runner':
      return <RunnerTab key={tab.id} collectionId={tab.collectionId} folderId={tab.folderId} />;
    case 'scenario':
      return <ScenarioEditor key={tab.id} scenarioId={tab.scenarioId} />;
    case 'loadRun':
      return <RunTab key={tab.id} runId={tab.runId} />;
    case 'compare':
      return <CompareTab key={tab.id} runIds={tab.runIds} />;
    case 'loadRuns':
      return <RunsListTab key={tab.id} />;
  }
}

const VIEWS: { id: SidebarView; label: string; icon: React.ReactNode }[] = [
  { id: 'collections', label: 'Collections', icon: <Layers className="size-4.5" /> },
  { id: 'environments', label: 'Environments', icon: <Globe2 className="size-4.5" /> },
  { id: 'history', label: 'History', icon: <History className="size-4.5" /> },
  { id: 'load', label: 'Load tests', icon: <Gauge className="size-4.5" /> },
];

function Sidebar() {
  const view = useUi((s) => s.sidebar);
  const width = useUi((s) => s.sidebarWidth);
  const filter = useUi((s) => s.filter);
  const live = useRuns((s) => s.live.length);
  const onResize = (e: React.PointerEvent) => {
    const start = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => useUi.getState().setSidebarWidth(Math.min(560, Math.max(200, w0 + ev.clientX - start)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const action = () => {
    if (view === 'collections') promptText('New collection', 'Name', 'My Collection', (n) => createCollection(n));
    else if (view === 'environments') newEnvironmentPrompt();
    else if (view === 'load') {
      const sc = newScenario('New load test');
      useWorkspace.getState().saveScenario(sc);
      useTabs.getState().open({ id: uid(), kind: 'scenario', scenarioId: sc.id });
    }
  };
  return (
    <div className="flex shrink-0">
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-border bg-surface-muted py-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            title={v.label}
            onClick={() => useUi.getState().setSidebar(v.id)}
            className={cn('relative flex w-12 flex-col items-center gap-0.5 rounded-md py-1.5 text-[9.5px]', view === v.id ? 'bg-background text-accent' : 'text-muted-foreground hover:text-foreground')}
          >
            {v.icon}
            {v.label.split(' ')[0]}
            {v.id === 'load' && live > 0 && <span className="absolute top-1 right-2 size-2 animate-pulse rounded-full bg-success" />}
          </button>
        ))}
      </nav>
      <aside className="flex min-h-0 flex-col border-r border-border bg-surface" style={{ width }}>
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
          {view !== 'history' && (
            <IconButton label="New" onClick={action}>
              <Plus className="size-4" />
            </IconButton>
          )}
          <div className="flex h-7 flex-1 items-center gap-1 rounded-md border border-border bg-background px-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input value={filter} onChange={(e) => useUi.getState().setFilter(e.target.value)} placeholder="Search" className="w-full bg-transparent text-[12px] outline-none" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {view === 'collections' && <CollectionsView />}
          {view === 'environments' && <EnvironmentsView />}
          {view === 'history' && <HistoryView />}
          {view === 'load' && <LoadView />}
        </div>
      </aside>
      <div onPointerDown={onResize} className="w-1 shrink-0 cursor-col-resize hover:bg-accent" />
    </div>
  );
}

function ConsolePanel() {
  const open = useConsole((s) => s.open);
  const entries = useConsole((s) => s.entries);
  const [sel, setSel] = useState<number | null>(null);
  if (!open) return null;
  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-border bg-surface">
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        <span className="text-[12px] font-semibold">Console</span>
        <Badge>{entries.length}</Badge>
        <div className="flex-1" />
        <IconButton label="Clear" onClick={() => useConsole.getState().clear()}>
          <Trash2 className="size-3.5" />
        </IconButton>
        <IconButton label="Close" onClick={() => useConsole.getState().toggle(false)}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      <div className="selectable min-h-0 flex-1 overflow-auto font-mono text-[12px]">
        {entries.map((e) => (
          <div key={e.id} className="border-b border-border px-3 py-0.5">
            <div className={cn('flex cursor-pointer gap-2', e.level === 'error' && 'text-danger', e.level === 'warn' && 'text-warning', e.level === 'request' && 'text-accent')} onClick={() => setSel(sel === e.id ? null : e.id)}>
              <span className="shrink-0 text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className="whitespace-pre-wrap">{e.text}</span>
            </div>
            {sel === e.id && e.detail !== undefined && <pre className="my-1 max-h-60 overflow-auto rounded bg-surface-muted p-2 whitespace-pre-wrap">{JSON.stringify(e.detail, null, 2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="fixed right-4 bottom-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => useUi.getState().dismiss(t.id)}
          className={cn(
            'max-w-md cursor-pointer rounded-md border px-3 py-2 text-[12.5px] shadow-lg',
            t.kind === 'error' ? 'border-danger bg-danger-soft text-danger' : t.kind === 'success' ? 'border-success bg-success-soft text-success' : 'border-border bg-surface',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

function EnvPicker() {
  const envs = useWorkspace((s) => s.environments);
  const active = useWorkspace((s) => s.activeEnv);
  return (
    <div className="flex items-center gap-1">
      <Select
        title="Active environment"
        value={active ?? ''}
        onChange={(v) => useWorkspace.getState().setActiveEnv(v || null)}
        options={[{ value: '', label: 'No environment' }, ...Object.values(envs).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ value: e.id, label: e.name }))]}
        className="h-7 w-52 text-[12px]"
      />
      <IconButton label="Edit environment" disabled={!active} onClick={() => active && useTabs.getState().open({ id: uid(), kind: 'environment', envId: active })}>
        <Globe2 className="size-4" />
      </IconButton>
    </div>
  );
}

export function App() {
  const loaded = useWorkspace((s) => s.loaded);
  const error = useWorkspace((s) => s.error);
  const theme = useWorkspace((s) => s.settings.theme);

  useEffect(() => {
    useWorkspace.getState().load();
    useRuns.getState().refresh();
    return useWorkspace.subscribe(() => syncTabsWithWorkspace());
  }, []);

  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 't') {
        e.preventDefault();
        newTab('http');
      } else if (k === 'w') {
        e.preventDefault();
        const a = useTabs.getState().active;
        if (a) useTabs.getState().close(a);
      } else if (k === '`') {
        e.preventDefault();
        useConsole.getState().toggle();
      } else if (k === 'o') {
        e.preventDefault();
        useUi.getState().show({ kind: 'import' });
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const { tabs, active } = useTabs.getState();
        const i = tabs.findIndex((t) => t.id === active);
        const n = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        if (n) useTabs.getState().setActive(n.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <img src="/icon.svg" alt="" className="size-6" />
        <span className="font-semibold">CurlStudio</span>
        <Dropdown
          items={[
            ...NEW_ITEMS.map((n) => ({ label: n.label, onSelect: () => newTab(n.kind) })),
            'sep' as const,
            { label: 'Collection', onSelect: () => promptText('New collection', 'Name', 'My Collection', (n) => createCollection(n)) },
            { label: 'Environment', onSelect: () => newEnvironmentPrompt() },
            {
              label: 'Load test',
              onSelect: () => {
                const sc = newScenario('New load test');
                useWorkspace.getState().saveScenario(sc);
                useTabs.getState().open({ id: uid(), kind: 'scenario', scenarioId: sc.id });
              },
            },
          ]}
        >
          <Button size="sm" variant="primary" className="ml-3">
            <Plus className="size-3.5" /> New
          </Button>
        </Dropdown>
        <Button size="sm" onClick={() => useUi.getState().show({ kind: 'import' })}>
          <Download className="size-3.5" /> Import
        </Button>
        {error && <span className="text-[12px] text-danger">{error}</span>}
        <div className="flex-1" />
        <EnvPicker />
        <IconButton label="Cookies" onClick={() => useUi.getState().show({ kind: 'cookies' })}>
          <Cookie className="size-4" />
        </IconButton>
        <IconButton label="Console (Ctrl+`)" onClick={() => useConsole.getState().toggle()}>
          <SquareTerminal className="size-4" />
        </IconButton>
        <IconButton label="Settings" onClick={() => useUi.getState().show({ kind: 'settings' })}>
          <SettingsIcon className="size-4" />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <TabStrip />
          <div className="min-h-0 flex-1">
            <TabContent />
          </div>
          <ConsolePanel />
        </main>
      </div>
      <Dialogs />
      <Toasts />
    </div>
  );
}
