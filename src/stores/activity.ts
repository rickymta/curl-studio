import { create } from 'zustand';

import { api } from '@/lib/ipc';
import type { ActivityStats } from '@/lib/types';

/** Where an entry is shown in the Activity Logs window. */
export type ActivityCategory = 'request' | 'load' | 'app';

/** One line of the Activity Logs window (as in GitStudio). */
export interface Activity {
  id: number;
  cat: ActivityCategory;
  label: string;
  status: 'started' | 'finished' | 'failed' | 'info';
  at: number;
  /** Duration, when finished/failed. */
  ms?: number;
  /** Extra line, e.g. the URL or the error text. */
  detail?: string;
}

const MAX = 5000;
let next = 1;

// Writes are batched into activity.jsonl.
let pending: Omit<Activity, 'id'>[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  timer = null;
  const batch = pending;
  pending = [];
  if (batch.length)
    api
      .activityAppend(batch)
      .then((stats) => useActivity.setState({ stats }))
      .catch(() => undefined);
}

interface ActivityStore {
  items: Activity[];
  stats: ActivityStats | null;
  log: (e: Omit<Activity, 'id' | 'at'>) => void;
  /** Log "started"; the returned function logs "finished"/"failed" with the duration. */
  begin: (
    cat: ActivityCategory,
    label: string,
    detail?: string,
  ) => (error?: string | null, result?: string) => void;
  clear: () => void;
}

export const useActivity = create<ActivityStore>((set, get) => ({
  items: [],
  stats: null,
  log: (e) => {
    const at = Date.now();
    const item: Activity = { ...e, id: next++, at };
    pending.push({ ...e, at });
    timer ??= setTimeout(flush, 500);
    set((s) => ({ items: [...s.items.slice(-(MAX - 1)), item] }));
  },
  begin: (cat, label, detail) => {
    const start = performance.now();
    get().log({ cat, label, detail, status: 'started' });
    return (error, result) =>
      get().log({
        cat,
        label,
        status: error ? 'failed' : 'finished',
        ms: Math.round(performance.now() - start),
        detail: error ?? result ?? detail,
      });
  },
  clear: () => {
    pending = [];
    set({ items: [] });
    api
      .activityClear()
      .then((stats) => set({ stats }))
      .catch(() => undefined);
  },
}));

/** Read activity.jsonl at startup (older than 30 days is dropped there). */
export async function loadActivity() {
  try {
    const loaded = await api.activityLoad();
    const items = (loaded.entries as Omit<Activity, 'id'>[])
      .filter((e) => e && typeof e.at === 'number' && typeof e.label === 'string')
      .map((e) => ({ ...e, cat: e.cat ?? 'app', id: next++ }));
    useActivity.setState((s) => ({
      items: [...items, ...s.items].slice(-MAX),
      stats: loaded.stats,
    }));
  } catch {
    /* no backend yet: start empty */
  }
}

export const logActivity = (e: Omit<Activity, 'id' | 'at'>) => useActivity.getState().log(e);
export const beginActivity = (cat: ActivityCategory, label: string, detail?: string) =>
  useActivity.getState().begin(cat, label, detail);
