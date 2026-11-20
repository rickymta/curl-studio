import { create } from 'zustand';

import { api } from '@/lib/ipc';
import { clone, ensureIds, findItem, newCollection, newEnvironment, safeId, uid } from '@/lib/postman';
import type { HistoryEntry, PmCollection, PmEnvironment, PmItem, Settings } from '@/lib/types';
import type { ScenarioDoc } from '@/lib/load/types';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  timeoutMs: 30000,
  followRedirects: true,
  maxRedirects: 10,
  verifyTls: true,
  proxy: '',
  http1Only: false,
  cookies: true,
  maxBodyMb: 50,
  historyLimit: 300,
  autoSave: true,
  discardUnsavedOnClose: false,
  zoom: 1,
  brightnessDark: 100,
  brightnessLight: 100,
  terminalShell: 'auto',
  terminalCwd: '',
  fontSize: 13,
  activityRetentionDays: 30,
  activityWarnMb: 5,
  activityMaxMb: 10,
  activityLoadLimit: 5000,
};

interface WorkspaceDoc {
  activeEnv: string | null;
  collectionOrder: string[];
}

interface State {
  loaded: boolean;
  error: string | null;
  collections: Record<string, PmCollection>;
  order: string[];
  environments: Record<string, PmEnvironment>;
  globals: PmEnvironment;
  activeEnv: string | null;
  history: HistoryEntry[];
  settings: Settings;
  scenarios: Record<string, ScenarioDoc>;

  load: () => Promise<void>;
  // collections
  addCollection: (c: PmCollection) => string;
  updateCollection: (id: string, fn: (c: PmCollection) => void) => void;
  removeCollection: (id: string) => Promise<void>;
  updateItem: (collectionId: string, itemId: string, fn: (it: PmItem) => void) => void;
  // environments
  addEnvironment: (e: PmEnvironment) => string;
  updateEnvironment: (id: string, fn: (e: PmEnvironment) => void) => void;
  removeEnvironment: (id: string) => Promise<void>;
  setActiveEnv: (id: string | null) => void;
  updateGlobals: (fn: (g: PmEnvironment) => void) => void;
  // history
  pushHistory: (h: Omit<HistoryEntry, 'id' | 'ts'>) => void;
  clearHistory: () => void;
  // settings
  saveSettings: (s: Settings) => void;
  // scenarios
  saveScenario: (s: ScenarioDoc) => void;
  removeScenario: (id: string) => Promise<void>;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
function debounce(key: string, fn: () => void, ms = 400) {
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fn();
    }, ms),
  );
}

const report = (e: unknown) => console.error('[workspace]', e);

export const useWorkspace = create<State>((set, get) => {
  const saveWorkspaceDoc = () =>
    debounce('workspace', () => {
      const s = get();
      const doc: WorkspaceDoc = { activeEnv: s.activeEnv, collectionOrder: s.order };
      api.putDoc('workspace', doc).catch(report);
    });
  const saveCollection = (id: string) =>
    debounce(`c:${id}`, () => {
      const c = get().collections[id];
      if (c) api.put('collections', id, c).catch(report);
    });
  const saveEnv = (id: string) =>
    debounce(`e:${id}`, () => {
      const e = get().environments[id];
      if (e) api.put('environments', id, e).catch(report);
    });

  return {
    loaded: false,
    error: null,
    collections: {},
    order: [],
    environments: {},
    globals: { id: 'globals', name: 'Globals', values: [], _postman_variable_scope: 'globals' },
    activeEnv: null,
    history: [],
    settings: DEFAULT_SETTINGS,
    scenarios: {},

    load: async () => {
      try {
        const [cols, envs, globals, ws, history, settings, scenarios] = await Promise.all([
          api.list<PmCollection>('collections'),
          api.list<PmEnvironment>('environments'),
          api.getDoc<PmEnvironment>('globals'),
          api.getDoc<WorkspaceDoc>('workspace'),
          api.getDoc<HistoryEntry[]>('history'),
          api.getDoc<Settings>('settings'),
          api.list<ScenarioDoc>('loadScenarios'),
        ]);
        const collections: Record<string, PmCollection> = {};
        for (const { id, doc } of cols) {
          ensureIds(doc.item ?? (doc.item = []));
          collections[id] = doc;
        }
        const environments: Record<string, PmEnvironment> = {};
        for (const { id, doc } of envs) environments[id] = { ...doc, id };
        const known = Object.keys(collections);
        const order = [
          ...(ws?.collectionOrder ?? []).filter((x) => known.includes(x)),
          ...known
            .filter((x) => !(ws?.collectionOrder ?? []).includes(x))
            .sort((a, b) => collections[a]!.info.name.localeCompare(collections[b]!.info.name)),
        ];
        const sc: Record<string, ScenarioDoc> = {};
        for (const { id, doc } of scenarios) sc[id] = { ...doc, id };
        set({
          loaded: true,
          collections,
          order,
          environments,
          globals: globals ?? get().globals,
          activeEnv: ws?.activeEnv && environments[ws.activeEnv] ? ws.activeEnv : null,
          history: Array.isArray(history) ? history : [],
          settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
          scenarios: sc,
        });
      } catch (e) {
        set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
      }
    },

    addCollection: (c) => {
      const id = safeId(c.info._postman_id);
      const col = clone(c);
      col.info._postman_id = col.info._postman_id ?? id;
      ensureIds(col.item);
      // Re-importing the same collection replaces it (Postman asks; we keep the newest).
      set((s) => ({
        collections: { ...s.collections, [id]: col },
        order: s.order.includes(id) ? s.order : [...s.order, id],
      }));
      api.put('collections', id, col).catch(report);
      saveWorkspaceDoc();
      return id;
    },
    updateCollection: (id, fn) => {
      const cur = get().collections[id];
      if (!cur) return;
      const next = clone(cur);
      fn(next);
      set((s) => ({ collections: { ...s.collections, [id]: next } }));
      saveCollection(id);
    },
    removeCollection: async (id) => {
      set((s) => {
        const collections = { ...s.collections };
        delete collections[id];
        return { collections, order: s.order.filter((x) => x !== id) };
      });
      await api.remove('collections', id);
      saveWorkspaceDoc();
    },
    updateItem: (collectionId, itemId, fn) =>
      get().updateCollection(collectionId, (c) => {
        const f = findItem(c.item, itemId);
        if (f) fn(f.item);
      }),

    addEnvironment: (e) => {
      const id = safeId(e.id);
      const env = { ...clone(e), id };
      set((s) => ({ environments: { ...s.environments, [id]: env } }));
      api.put('environments', id, env).catch(report);
      return id;
    },
    updateEnvironment: (id, fn) => {
      const cur = get().environments[id];
      if (!cur) return;
      const next = clone(cur);
      fn(next);
      set((s) => ({ environments: { ...s.environments, [id]: next } }));
      saveEnv(id);
    },
    removeEnvironment: async (id) => {
      set((s) => {
        const environments = { ...s.environments };
        delete environments[id];
        return { environments, activeEnv: s.activeEnv === id ? null : s.activeEnv };
      });
      await api.remove('environments', id);
      saveWorkspaceDoc();
    },
    setActiveEnv: (id) => {
      set({ activeEnv: id });
      saveWorkspaceDoc();
    },
    updateGlobals: (fn) => {
      const next = clone(get().globals);
      fn(next);
      set({ globals: next });
      debounce('globals', () => api.putDoc('globals', get().globals).catch(report));
    },

    pushHistory: (h) => {
      const entry: HistoryEntry = { ...h, id: uid(), ts: Date.now() };
      set((s) => ({ history: [entry, ...s.history].slice(0, s.settings.historyLimit) }));
      debounce('history', () => api.putDoc('history', get().history).catch(report), 1000);
    },
    clearHistory: () => {
      set({ history: [] });
      api.putDoc('history', []).catch(report);
    },

    saveSettings: (settings) => {
      set({ settings });
      api.putDoc('settings', settings).catch(report);
    },

    saveScenario: (sc) => {
      const doc = { ...sc, updatedAt: Date.now() };
      set((s) => ({ scenarios: { ...s.scenarios, [sc.id]: doc } }));
      debounce(`s:${sc.id}`, () => api.put('loadScenarios', sc.id, get().scenarios[sc.id]).catch(report));
    },
    removeScenario: async (id) => {
      set((s) => {
        const scenarios = { ...s.scenarios };
        delete scenarios[id];
        return { scenarios };
      });
      await api.remove('loadScenarios', id);
    },
  };
});

export function createCollection(name: string): string {
  return useWorkspace.getState().addCollection(newCollection(name));
}

export function createEnvironment(name: string): string {
  return useWorkspace.getState().addEnvironment(newEnvironment(name));
}

/** Active environment object (or null). */
export function activeEnvironment(): PmEnvironment | null {
  const s = useWorkspace.getState();
  return s.activeEnv ? (s.environments[s.activeEnv] ?? null) : null;
}
