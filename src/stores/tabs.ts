import { create } from 'zustand';

import { t as tr } from '@/lib/i18n';
import { clone, findItem, newRequest, uid } from '@/lib/postman';
import type { PmItem, ResponseData, RequestSpec, TestResult } from '@/lib/types';

import { useWorkspace } from './workspace';

export type Tab =
  | {
      id: string;
      kind: 'request';
      collectionId: string | null;
      itemId: string | null;
      draft: PmItem;
      dirty: boolean;
    }
  | { id: string; kind: 'environment'; envId: string }
  | { id: string; kind: 'collection'; collectionId: string; folderId?: string }
  | { id: string; kind: 'runner'; collectionId: string; folderId?: string }
  | { id: string; kind: 'scenario'; scenarioId: string }
  | { id: string; kind: 'loadRun'; runId: string }
  | { id: string; kind: 'compare'; runIds: string[] }
  | { id: string; kind: 'loadRuns' };

export interface ResponseState {
  loading: boolean;
  requestId?: string;
  response?: ResponseData | null;
  error?: string | null;
  tests?: TestResult[];
  scriptErrors?: string[];
  warnings?: string[];
  sent?: RequestSpec | null;
  visualizer?: { template: string; data: unknown } | null;
  startedAt?: number;
  /** Loaded from the previous session (shown with a note). */
  restored?: boolean;
}

interface State {
  tabs: Tab[];
  active: string | null;
  /** Pinned tab ids: kept first, without a close button, skipped by “Close others/all”. */
  pinned: string[];
  togglePin: (id: string) => void;
  responses: Record<string, ResponseState>;
  open: (t: Tab) => void;
  openItem: (collectionId: string, itemId: string) => void;
  openDraft: (item?: PmItem) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  setActive: (id: string) => void;
  updateDraft: (id: string, fn: (it: PmItem) => void) => void;
  markSaved: (id: string, collectionId: string, itemId: string) => void;
  setResponse: (id: string, r: Partial<ResponseState>) => void;
  move: (from: number, to: number) => void;
}

const KEY = 'curlstudio.tabs.v1';

function restore(): { tabs: Tab[]; active: string | null; pinned: string[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { tabs: [], active: null, pinned: [] };
    const v = JSON.parse(raw) as { tabs: Tab[]; active: string | null; pinned?: string[] };
    const tabs = Array.isArray(v.tabs) ? v.tabs : [];
    return {
      tabs,
      active: v.active ?? null,
      pinned: (v.pinned ?? []).filter((id) => tabs.some((t) => t.id === id)),
    };
  } catch {
    return { tabs: [], active: null, pinned: [] };
  }
}

let pinnedNow: string[] = [];

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist(tabs: Tab[], active: string | null) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          tabs,
          active,
          pinned: pinnedNow.filter((id) => tabs.some((t) => t.id === id)),
        }),
      );
    } catch {
      /* storage full or blocked: tabs just won't survive a restart */
    }
  }, 300);
}

/** Identity used to avoid opening the same thing twice. */
function sameTarget(a: Tab, b: Tab): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'request':
      return !!a.itemId && a.itemId === (b as typeof a).itemId;
    case 'environment':
      return a.envId === (b as typeof a).envId;
    case 'collection':
      return (
        a.collectionId === (b as typeof a).collectionId && a.folderId === (b as typeof a).folderId
      );
    case 'runner':
      return (
        a.collectionId === (b as typeof a).collectionId && a.folderId === (b as typeof a).folderId
      );
    case 'scenario':
      return a.scenarioId === (b as typeof a).scenarioId;
    case 'loadRun':
      return a.runId === (b as typeof a).runId;
    case 'compare':
      return a.runIds.join() === (b as typeof a).runIds.join();
    case 'loadRuns':
      return true;
  }
}

const initial = restore();

// ---- last response per tab (kept across restarts, like Postman) ---------------------------------
const RESP_KEY = 'curlstudio.responses.v1';
/** Responses with a bigger body are not kept (they stay a click on Send away). */
const MAX_BODY = 1024 * 1024;
const MAX_TOTAL = 4 * 1024 * 1024;

function restoreResponses(tabIds: Set<string>): Record<string, ResponseState> {
  try {
    const v = JSON.parse(localStorage.getItem(RESP_KEY) ?? '{}') as Record<string, ResponseState>;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([id]) => tabIds.has(id))
        .map(([id, r]) => [id, { ...r, loading: false, restored: true }]),
    );
  } catch {
    return {};
  }
}

let respTimer: ReturnType<typeof setTimeout> | null = null;
function persistResponses(all: Record<string, ResponseState>) {
  if (respTimer) clearTimeout(respTimer);
  respTimer = setTimeout(() => {
    const out: Record<string, ResponseState> = {};
    let total = 0;
    // Newest first, so the cap drops the oldest.
    const entries = Object.entries(all)
      .filter(([, r]) => !r.loading && (r.response || r.error))
      .sort(([, a], [, b]) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    for (const [id, r] of entries) {
      if (r.response && r.response.body.length > MAX_BODY) continue;
      const keep: ResponseState = {
        loading: false,
        response: r.response,
        error: r.error,
        tests: r.tests,
        scriptErrors: r.scriptErrors,
        warnings: r.warnings,
        sent: r.sent,
        startedAt: r.startedAt,
      };
      const size = JSON.stringify(keep).length;
      if (total + size > MAX_TOTAL) continue;
      total += size;
      out[id] = keep;
    }
    try {
      localStorage.setItem(RESP_KEY, JSON.stringify(out));
    } catch {
      /* storage full: responses just won't survive a restart */
    }
  }, 500);
}

export const useTabs = create<State>((set, get) => ({
  tabs: initial.tabs,
  active: initial.active,
  pinned: (pinnedNow = initial.pinned),
  togglePin: (id) => {
    set((s) => {
      const pinned = s.pinned.includes(id) ? s.pinned.filter((x) => x !== id) : [...s.pinned, id];
      pinnedNow = pinned;
      // Pinned tabs first, in pin order; the rest keep their order.
      const tabs = [
        ...pinned.map((p) => s.tabs.find((t) => t.id === p)!).filter(Boolean),
        ...s.tabs.filter((t) => !pinned.includes(t.id)),
      ];
      return { pinned, tabs };
    });
    persist(get().tabs, get().active);
  },
  responses: restoreResponses(new Set(initial.tabs.map((t) => t.id))),

  open: (t) => {
    const existing = get().tabs.find((x) => sameTarget(x, t));
    if (existing) {
      set({ active: existing.id });
    } else {
      set((s) => ({ tabs: [...s.tabs, t], active: t.id }));
    }
    persist(get().tabs, get().active);
  },
  openItem: (collectionId, itemId) => {
    const c = useWorkspace.getState().collections[collectionId];
    const f = c ? findItem(c.item, itemId) : null;
    if (!f) return;
    get().open({
      id: uid(),
      kind: 'request',
      collectionId,
      itemId,
      draft: clone(f.item),
      dirty: false,
    });
  },
  openDraft: (item) => {
    get().open({
      id: uid(),
      kind: 'request',
      collectionId: null,
      itemId: null,
      draft: item ?? newRequest(tr('Untitled Request')),
      dirty: false,
    });
  },
  close: (id) => {
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const responses = { ...s.responses };
      delete responses[id];
      persistResponses(responses);
      if (s.pinned.includes(id)) pinnedNow = s.pinned.filter((x) => x !== id);
      let active = s.active;
      if (active === id) active = tabs[Math.min(i, tabs.length - 1)]?.id ?? null;
      return { tabs, active, responses, pinned: pinnedNow };
    });
    persist(get().tabs, get().active);
  },
  closeOthers: (id) => {
    set((s) => ({ tabs: s.tabs.filter((t) => t.id === id), active: id }));
    persist(get().tabs, get().active);
  },
  setActive: (id) => {
    set({ active: id });
    persist(get().tabs, id);
  },
  updateDraft: (id, fn) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id || t.kind !== 'request') return t;
        const draft = clone(t.draft);
        fn(draft);
        return { ...t, draft, dirty: true };
      }),
    }));
    persist(get().tabs, get().active);
  },
  markSaved: (id, collectionId, itemId) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.kind === 'request' ? { ...t, collectionId, itemId, dirty: false } : t,
      ),
    }));
    persist(get().tabs, get().active);
  },
  setResponse: (id, r) => {
    set((s) => ({
      responses: {
        ...s.responses,
        [id]: { ...(s.responses[id] ?? { loading: false }), ...r, restored: false },
      },
    }));
    if (!r.loading) persistResponses(get().responses);
  },
  move: (from, to) => {
    set((s) => {
      const tabs = [...s.tabs];
      const [t] = tabs.splice(from, 1);
      if (t) tabs.splice(to, 0, t);
      return { tabs };
    });
    persist(get().tabs, get().active);
  },
}));

/** Keep open drafts in sync when an item changes elsewhere (rename, delete). */
export function syncTabsWithWorkspace() {
  const ws = useWorkspace.getState();
  const { tabs } = useTabs.getState();
  let changed = false;
  const next = tabs.flatMap((t): Tab[] => {
    if (t.kind === 'request' && t.collectionId && t.itemId) {
      const c = ws.collections[t.collectionId];
      const f = c ? findItem(c.item, t.itemId) : null;
      if (!f) {
        changed = true;
        return t.dirty ? [{ ...t, collectionId: null, itemId: null }] : [];
      }
      if (!t.dirty && JSON.stringify(f.item) !== JSON.stringify(t.draft)) {
        changed = true;
        return [{ ...t, draft: clone(f.item) }];
      }
    }
    if (t.kind === 'environment' && t.envId !== 'globals' && !ws.environments[t.envId]) {
      changed = true;
      return [];
    }
    if ((t.kind === 'collection' || t.kind === 'runner') && !ws.collections[t.collectionId]) {
      changed = true;
      return [];
    }
    if (t.kind === 'scenario' && !ws.scenarios[t.scenarioId]) {
      changed = true;
      return [];
    }
    return [t];
  });
  if (changed) {
    const active = next.some((t) => t.id === useTabs.getState().active)
      ? useTabs.getState().active
      : (next[0]?.id ?? null);
    useTabs.setState({ tabs: next, active });
    persist(next, active);
  }
}
