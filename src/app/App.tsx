import {
  Cookie,
  Download,
  Gauge,
  Globe2,
  History,
  Layers,
  Moon,
  Check,
  ChevronDown,
  PanelLeftClose,
  Pin,
  PinOff,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  SquareTerminal,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  Badge,
  Button,
  cn,
  ContextMenuWrap,
  Dropdown,
  Empty,
  IconButton,
  type MenuItem,
  Select,
  Spinner,
} from '@/components/ui';
import { CompareTab, RunsListTab } from '@/features/load/CompareTab';
import { RunTab } from '@/features/load/RunTab';
import { ScenarioEditor } from '@/features/load/ScenarioEditor';
import { newScenario } from '@/features/load/scenario';
import { Dialogs } from '@/features/dialogs/Dialogs';
import { CollectionSettings, EnvironmentEditor } from '@/features/environments/EnvironmentEditor';
import {
  EnvironmentsView,
  HistoryView,
  LoadView,
  newEnvironmentPrompt,
} from '@/features/sidebar/OtherViews';
import { CollectionsView, revealItem } from '@/features/sidebar/CollectionsView';
import { RunnerTab } from '@/features/runner/RunnerTab';
import { HttpEditor } from '@/features/request/HttpEditor';
import { GrpcEditor, MqttEditor, SseEditor, WsEditor } from '@/features/protocols/Editors';
import { newTab, promptText, type NewKind } from '@/features/actions';
import { closeAll, closeOthers, closeSaved, closeTab } from '@/features/tabs/close';
import { VarCollection } from '@/features/request/varScope';
import { t as tr, useLang, useLangStore } from '@/lib/i18n';
import { itemProtocol, methodColor, PROTOCOL_LABEL, uid } from '@/lib/postman';
import { useConsole } from '@/stores/console';
import { syncTabsWithWorkspace, type Tab, useTabs } from '@/stores/tabs';
import { notify, type SidebarView, toast, useUi } from '@/stores/ui';
import { createCollection, useWorkspace } from '@/stores/workspace';
import { useRuns } from '@/features/load/runs';
import { applyBrightness, applyZoom, setZoom, zoomBy } from '@/features/shell/appearance';
import { LanguagePicker } from '@/features/shell/LanguagePicker';
import { StatusBar } from '@/features/shell/StatusBar';
import { Toasts } from '@/features/shell/Toasts';
import { TerminalPanel } from '@/features/terminal/TerminalPanel';
import { toggleTerminal } from '@/features/terminal/runtime';
import { loadActivity, logActivity } from '@/stores/activity';

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
        badge: (
          <span
            className={cn(
              'font-mono text-[9.5px] font-bold',
              p === 'http' ? methodColor(m) : 'text-[oklch(0.72_0.12_300)]',
            )}
          >
            {p === 'http' ? m : PROTOCOL_LABEL[p]}
          </span>
        ),
      };
    }
    case 'environment':
      return {
        title:
          t.envId === 'globals'
            ? tr('Globals')
            : (ws.environments[t.envId]?.name ?? tr('Environment')),
        badge: <Globe2 className="size-3 text-muted-foreground" />,
      };
    case 'collection':
      return {
        title: ws.collections[t.collectionId]?.info.name ?? tr('Collection'),
        badge: <Layers className="size-3 text-accent" />,
      };
    case 'runner':
      return {
        title: tr('Run: {name}', { name: ws.collections[t.collectionId]?.info.name ?? '' }),
        badge: <span className="text-success">▶</span>,
      };
    case 'scenario':
      return {
        title: ws.scenarios[t.scenarioId]?.name ?? tr('Load test'),
        badge: <Gauge className="size-3 text-accent" />,
      };
    case 'loadRun':
      return {
        title: tr('Report {id}', { id: t.runId.slice(9, 15) }),
        badge: <Gauge className="size-3 text-success" />,
      };
    case 'compare':
      return {
        title: tr('Compare {n} runs', { n: t.runIds.length }),
        badge: <Gauge className="size-3 text-muted-foreground" />,
      };
    case 'loadRuns':
      return {
        title: tr('Load test runs'),
        badge: <Gauge className="size-3 text-muted-foreground" />,
      };
  }
}

function TabStrip() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const pinned = useTabs((s) => s.pinned);
  useWorkspace((s) => s.collections);
  useWorkspace((s) => s.scenarios);
  const [drag, setDrag] = useState<number | null>(null);
  // Keep the active tab visible when many tabs overflow the strip.
  useEffect(() => {
    if (active)
      document
        .querySelector(`[data-tab-id="${active}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);
  return (
    <div className="flex h-9 shrink-0 items-end border-b border-border bg-surface-muted">
      <div
        className="flex h-9 min-w-0 items-end overflow-x-auto"
        role="tablist"
        aria-label={tr('Open tabs')}
      >
        {tabs.map((t, i) => {
          const { title, badge } = tabTitle(t);
          const dirty = t.kind === 'request' && t.dirty;
          const isPinned = pinned.includes(t.id);
          return (
            <ContextMenuWrap
              key={t.id}
              items={() => [
                {
                  label: isPinned ? tr('Unpin tab') : tr('Pin tab'),
                  icon: isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />,
                  onSelect: () => useTabs.getState().togglePin(t.id),
                },
                'sep',
                ...(t.kind === 'request' && t.collectionId && t.itemId
                  ? [
                      {
                        label: tr('Reveal in sidebar'),
                        onSelect: () => revealItem(t.collectionId!, t.itemId!, true),
                      },
                      'sep' as const,
                    ]
                  : []),
                { label: tr('Close'), onSelect: () => closeTab(t.id) },
                { label: tr('Close others'), onSelect: () => closeOthers(t.id) },
                { label: tr('Close saved tabs'), onSelect: () => closeSaved() },
                { label: tr('Close all'), onSelect: () => closeAll() },
                ...(t.kind === 'request'
                  ? [
                      {
                        label: tr('Duplicate tab'),
                        onSelect: () =>
                          useTabs.getState().openDraft({
                            ...JSON.parse(JSON.stringify(t.draft)),
                            id: uid(),
                            name: tr('{name} Copy', { name: t.draft.name }),
                          }),
                      },
                    ]
                  : []),
              ]}
            >
              <div
                data-tab-id={t.id}
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
                    closeTab(t.id);
                  }
                }}
                onClick={() => useTabs.getState().setActive(t.id)}
                role="tab"
                aria-selected={t.id === active}
                title={dirty ? tr('{title} — unsaved changes', { title }) : title}
                className={cn(
                  'group flex h-9 cursor-pointer items-center gap-1.5 border-r border-border px-2.5 text-[12.5px]',
                  isPinned ? 'max-w-40 min-w-0' : 'max-w-56 min-w-32',
                  t.id === active
                    ? 'border-t-2 border-t-accent bg-background'
                    : 'text-muted-foreground hover:bg-surface-hover',
                )}
              >
                {isPinned && (
                  <Pin className="size-3 shrink-0 text-muted-foreground" aria-label={tr('Pinned')} />
                )}
                {badge}
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {dirty && (
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full bg-accent',
                      !isPinned && 'group-hover:hidden',
                    )}
                  />
                )}
                {!isPinned && (
                  <button
                    type="button"
                    aria-label={tr('Close tab')}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                    className={cn(
                      'rounded p-0.5 hover:bg-surface-hover',
                      dirty ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </ContextMenuWrap>
          );
        })}
      </div>
      <Dropdown
        items={NEW_ITEMS.map((n) => ({ label: tr(n.label), onSelect: () => newTab(n.kind) }))}
      >
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          title={tr('New tab')}
        >
          <Plus className="size-4" />
        </button>
      </Dropdown>
      <div className="flex-1" />
      {tabs.length > 0 && (
        <Dropdown
          items={[
            ...tabs.map((t) => {
              const { title } = tabTitle(t);
              const dirty = t.kind === 'request' && t.dirty;
              return {
                label: `${pinned.includes(t.id) ? '📌 ' : ''}${title}${dirty ? ' ●' : ''}`,
                icon: t.id === active ? <Check className="size-3.5" /> : undefined,
                onSelect: () => useTabs.getState().setActive(t.id),
              };
            }),
            'sep' as const,
            { label: tr('Close saved tabs'), onSelect: () => closeSaved() },
            { label: tr('Close all tabs'), onSelect: () => closeAll() },
          ]}
        >
          <button
            type="button"
            title={tr('All open tabs ({n})', { n: tabs.length })}
            aria-label={tr('All open tabs')}
            className="flex h-9 shrink-0 items-center gap-1 border-l border-border px-2 text-[12px] text-muted-foreground hover:text-foreground"
          >
            {tabs.length}
            <ChevronDown className="size-3.5" />
          </button>
        </Dropdown>
      )}
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
              {tr(n.label)}
            </Button>
          ))}
        </div>
        <div className="mt-4 text-[12px]">
          {tr(
            'Ctrl+T new request · Ctrl+Enter send · Ctrl+S save · Ctrl+W close tab · Ctrl+` terminal · Ctrl+/ all shortcuts',
          )}
        </div>
      </Empty>
    );
  }
  switch (tab.kind) {
    case 'request': {
      const p = itemProtocol(tab.draft);
      const editor =
        p === 'ws' ? (
          <WsEditor key={tab.id} tab={tab} />
        ) : p === 'sse' ? (
          <SseEditor key={tab.id} tab={tab} />
        ) : p === 'mqtt' ? (
          <MqttEditor key={tab.id} tab={tab} />
        ) : p === 'grpc' ? (
          <GrpcEditor key={tab.id} tab={tab} />
        ) : (
          <HttpEditor key={tab.id} tab={tab} />
        );
      return <VarCollection.Provider value={tab.collectionId}>{editor}</VarCollection.Provider>;
    }
    case 'environment':
      return <EnvironmentEditor key={tab.id} envId={tab.envId} />;
    case 'collection':
      return (
        <CollectionSettings key={tab.id} collectionId={tab.collectionId} folderId={tab.folderId} />
      );
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

/** Short labels under the sidebar icons (first word of the view label). */
const VIEW_SHORT: Record<SidebarView, string> = {
  collections: 'Collections',
  environments: 'Environments',
  history: 'History',
  load: 'Load',
};

const SEARCH_PLACEHOLDER: Record<SidebarView, string> = {
  collections: 'Search collections (Ctrl+K)',
  environments: 'Search environments (Ctrl+K)',
  history: 'Search history (Ctrl+K)',
  load: 'Search load tests (Ctrl+K)',
};

function Sidebar() {
  const view = useUi((s) => s.sidebar);
  const width = useUi((s) => s.sidebarWidth);
  const filter = useUi((s) => s.filter);
  const live = useRuns((s) => s.live.length);
  const hidden = useUi((s) => s.sidebarHidden);
  const onResize = (e: React.PointerEvent) => {
    const start = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) =>
      useUi.getState().setSidebarWidth(Math.min(560, Math.max(200, w0 + ev.clientX - start)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const newLoadTest = () => {
    const sc = newScenario(tr('New load test'));
    useWorkspace.getState().saveScenario(sc);
    useTabs.getState().open({ id: uid(), kind: 'scenario', scenarioId: sc.id });
  };
  const addItems: MenuItem[] =
    view === 'collections'
      ? [
          {
            label: tr('New collection'),
            onSelect: () =>
              promptText(tr('New collection'), tr('Name'), tr('My Collection'), (n) =>
                createCollection(n),
              ),
          },
          'sep',
          ...NEW_ITEMS.map((n) => ({
            label: tr('New {kind}', { kind: tr(n.label) }),
            onSelect: () => newTab(n.kind),
          })),
          'sep',
          { label: tr('Import…'), onSelect: () => useUi.getState().show({ kind: 'import' }) },
        ]
      : view === 'environments'
        ? [
            { label: tr('New environment'), onSelect: () => newEnvironmentPrompt() },
            {
              label: tr('Import environment…'),
              onSelect: () => useUi.getState().show({ kind: 'import' }),
            },
          ]
        : [{ label: tr('New load test'), onSelect: newLoadTest }];
  return (
    <div className="flex shrink-0">
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-border bg-surface-muted py-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            title={tr(v.label)}
            onClick={() => {
              if (useUi.getState().sidebarHidden) useUi.getState().toggleSidebar();
              else if (view === v.id) return useUi.getState().toggleSidebar();
              useUi.getState().setSidebar(v.id);
            }}
            className={cn(
              'relative flex w-12 flex-col items-center gap-0.5 rounded-md py-1.5 text-[9.5px]',
              view === v.id
                ? 'bg-background text-accent'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v.icon}
            {tr(VIEW_SHORT[v.id])}
            {v.id === 'load' && live > 0 && (
              <span className="absolute top-1 right-2 size-2 animate-pulse rounded-full bg-success" />
            )}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          title={hidden ? tr('Show sidebar (Ctrl+\\)') : tr('Hide sidebar (Ctrl+\\)')}
          onClick={() => useUi.getState().toggleSidebar()}
          className="flex w-12 justify-center rounded-md py-1.5 text-muted-foreground hover:text-foreground"
        >
          {hidden ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </nav>
      {!hidden && (
        <>
          <aside
            className="flex min-h-0 flex-col border-r border-border bg-surface"
            style={{ width }}
          >
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
              <div className="flex h-7 flex-1 items-center gap-1 rounded-md border border-border bg-background px-2 focus-within:border-accent">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  id="sidebar-search"
                  value={filter}
                  onChange={(e) => useUi.getState().setFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') useUi.getState().setFilter('');
                  }}
                  placeholder={tr(SEARCH_PLACEHOLDER[view])}
                  aria-label={tr('Search sidebar')}
                  className="w-full min-w-0 bg-transparent text-[12px] outline-none"
                />
                {filter && (
                  <button
                    type="button"
                    aria-label={tr('Clear search')}
                    onClick={() => useUi.getState().setFilter('')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {view !== 'history' && (
                <Dropdown items={addItems}>
                  <IconButton label={tr('New…')}>
                    <Plus className="size-4" />
                  </IconButton>
                </Dropdown>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {view === 'collections' && <CollectionsView />}
              {view === 'environments' && <EnvironmentsView />}
              {view === 'history' && <HistoryView />}
              {view === 'load' && <LoadView />}
            </div>
          </aside>
          <div
            onPointerDown={onResize}
            className="w-1 shrink-0 cursor-col-resize hover:bg-accent"
          />
        </>
      )}
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
        <span className="text-[12px] font-semibold">{tr('Console')}</span>
        <Badge>{entries.length}</Badge>
        <div className="flex-1" />
        <IconButton label={tr('Clear')} onClick={() => useConsole.getState().clear()}>
          <Trash2 className="size-3.5" />
        </IconButton>
        <IconButton label={tr('Close')} onClick={() => useConsole.getState().toggle(false)}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      <div className="selectable min-h-0 flex-1 overflow-auto font-mono text-[12px]">
        {entries.map((e) => (
          <div key={e.id} className="border-b border-border px-3 py-0.5">
            <div
              className={cn(
                'flex cursor-pointer gap-2',
                e.level === 'error' && 'text-danger',
                e.level === 'warn' && 'text-warning',
                e.level === 'request' && 'text-accent',
              )}
              onClick={() => setSel(sel === e.id ? null : e.id)}
            >
              <span className="shrink-0 text-muted-foreground">
                {new Date(e.ts).toLocaleTimeString()}
              </span>
              <span className="whitespace-pre-wrap">{e.text}</span>
            </div>
            {sel === e.id && e.detail !== undefined && (
              <pre className="my-1 max-h-60 overflow-auto rounded bg-surface-muted p-2 whitespace-pre-wrap">
                {JSON.stringify(e.detail, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EnvPicker() {
  const envs = useWorkspace((s) => s.environments);
  const active = useWorkspace((s) => s.activeEnv);
  return (
    <div className="flex items-center gap-1">
      <Select
        title={tr('Active environment')}
        value={active ?? ''}
        onChange={(v) => useWorkspace.getState().setActiveEnv(v || null)}
        options={[
          { value: '', label: tr('No environment') },
          ...Object.values(envs)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((e) => ({ value: e.id, label: e.name })),
        ]}
        className="h-7 w-52 text-[12px]"
      />
      <IconButton
        label={tr('Edit environment')}
        disabled={!active}
        onClick={() =>
          active && useTabs.getState().open({ id: uid(), kind: 'environment', envId: active })
        }
      >
        <Globe2 className="size-4" />
      </IconButton>
    </div>
  );
}

let startLogged = false;

/** Re-read collections, environments, settings and load runs from the workspace folder. */
async function reloadWorkspace() {
  await Promise.all([useWorkspace.getState().load(), useRuns.getState().refresh()]);
  const error = useWorkspace.getState().error;
  if (error) toast('error', tr('Could not reload the workspace'), error);
  else toast('success', tr('Workspace reloaded from disk'));
}

/** Dark / light from the title bar (Settings → Appearance also offers "System"). */
function ThemeToggle() {
  const theme = useWorkspace((s) => s.settings.theme);
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <IconButton
      label={dark ? tr('Switch to light theme') : tr('Switch to dark theme')}
      onClick={() => {
        const ws = useWorkspace.getState();
        ws.saveSettings({ ...ws.settings, theme: dark ? 'light' : 'dark' });
      }}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}

export function App() {
  const loaded = useWorkspace((s) => s.loaded);
  const lang = useLang();
  const langChosen = useLangStore((s) => s.chosen);
  const error = useWorkspace((s) => s.error);
  const theme = useWorkspace((s) => s.settings.theme);
  const zoom = useWorkspace((s) => s.settings.zoom);
  const fontSize = useWorkspace((s) => s.settings.fontSize);
  const brightDark = useWorkspace((s) => s.settings.brightnessDark);
  const brightLight = useWorkspace((s) => s.settings.brightnessLight);

  useEffect(() => {
    useWorkspace.getState().load();
    useRuns.getState().refresh();
    // Once per page load (StrictMode runs effects twice in development).
    if (!startLogged) {
      startLogged = true;
      void loadActivity().then((stats) => {
        logActivity({ cat: 'app', label: `CurlStudio ${__APP_VERSION__} started`, status: 'info' });
        if (stats && stats.level !== 'ok')
          notify({
            kind: stats.level === 'full' ? 'error' : 'warning',
            text: tr('Activity Logs file is {size} MB', {
              size: (stats.bytes / 1024 / 1024).toFixed(1),
            }),
            detail:
              stats.level === 'full'
                ? tr('It reached its maximum size: the oldest entries are being dropped.')
                : tr('Lower the retention period or clear it in Settings → Data & Logs.'),
            actions: [
              {
                label: tr('Open settings'),
                run: () => useUi.getState().show({ kind: 'settings', section: 'data' }),
              },
            ],
          });
      });
    }
    return useWorkspace.subscribe(() => syncTabsWithWorkspace());
  }, []);

  useEffect(() => applyZoom(zoom ?? 1), [zoom]);
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-font', `${fontSize || 13}px`);
  }, [fontSize]);

  useEffect(() => {
    const apply = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
      applyBrightness((dark ? brightDark : brightLight) ?? 100);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, brightDark, brightLight]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUi.getState();
      if (e.key === 'F1') {
        e.preventDefault();
        ui.show({ kind: 'help' });
        return;
      }
      // F5 / Ctrl+R would reload the webview and drop every unsaved tab: re-read the workspace
      // folder instead (files changed outside the app, e.g. by Git or Postman).
      if (e.key === 'F5' || (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        if (!e.repeat) void reloadWorkspace();
        return;
      }
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Backquote' || e.key === '`') {
        e.preventDefault();
        toggleTerminal();
        return;
      }
      if (k === '=' || k === '+') {
        e.preventDefault();
        zoomBy(0.1);
        return;
      }
      if (k === '-' || k === '_') {
        e.preventDefault();
        zoomBy(-0.1);
        return;
      }
      if (k === '0' && !e.shiftKey) {
        e.preventDefault();
        setZoom(1);
        return;
      }
      if (k === '/' && !e.shiftKey) {
        e.preventDefault();
        ui.show(ui.dialog?.kind === 'shortcuts' ? null : { kind: 'shortcuts' });
        return;
      }
      if (k === 'l' && e.shiftKey) {
        e.preventDefault();
        ui.show(ui.dialog?.kind === 'activity' ? null : { kind: 'activity' });
        return;
      }
      if (k === 'c' && e.altKey) {
        e.preventDefault();
        useConsole.getState().toggle();
        return;
      }
      if (k === ',') {
        e.preventDefault();
        ui.show({ kind: 'settings' });
        return;
      }
      if (k === '\\') {
        e.preventDefault();
        ui.toggleSidebar();
        return;
      }
      if (k === 't') {
        e.preventDefault();
        newTab('http');
      } else if (k === 'w') {
        e.preventDefault();
        const a = useTabs.getState().active;
        if (a) closeTab(a);
      } else if (k === 'k') {
        e.preventDefault();
        document.getElementById('sidebar-search')?.focus();
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
  // First launch: pick a language before anything else.
  if (!langChosen) return <LanguagePicker />;
  return (
    // Re-keyed on language change so every component re-renders its text.
    <div key={lang} className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <img src="/icon.svg" alt="" className="size-6" />
        <span className="font-semibold">CurlStudio</span>
        <Dropdown
          items={[
            ...NEW_ITEMS.map((n) => ({ label: tr(n.label), onSelect: () => newTab(n.kind) })),
            'sep' as const,
            {
              label: tr('Collection'),
              onSelect: () =>
                promptText(tr('New collection'), tr('Name'), tr('My Collection'), (n) =>
                  createCollection(n),
                ),
            },
            { label: tr('Environment'), onSelect: () => newEnvironmentPrompt() },
            {
              label: tr('Load test'),
              onSelect: () => {
                const sc = newScenario(tr('New load test'));
                useWorkspace.getState().saveScenario(sc);
                useTabs.getState().open({ id: uid(), kind: 'scenario', scenarioId: sc.id });
              },
            },
          ]}
        >
          <Button size="sm" variant="primary" className="ml-3">
            <Plus className="size-3.5" /> {tr('New')}
          </Button>
        </Dropdown>
        <Button size="sm" onClick={() => useUi.getState().show({ kind: 'import' })}>
          <Download className="size-3.5" /> {tr('Import')}
        </Button>
        {error && <span className="text-[12px] text-danger">{error}</span>}
        <div className="flex-1" />
        <EnvPicker />
        <IconButton label={tr('Cookies')} onClick={() => useUi.getState().show({ kind: 'cookies' })}>
          <Cookie className="size-4" />
        </IconButton>
        <IconButton label={tr('Console (Ctrl+Alt+C)')} onClick={() => useConsole.getState().toggle()}>
          <SquareTerminal className="size-4" />
        </IconButton>
        <ThemeToggle />
        <IconButton
          label={tr('Settings (Ctrl+,)')}
          onClick={() => useUi.getState().show({ kind: 'settings' })}
        >
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
          <TerminalPanel />
        </main>
      </div>
      <StatusBar />
      <Dialogs />
      <Toasts />
    </div>
  );
}
