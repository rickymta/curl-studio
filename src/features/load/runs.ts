import { create } from 'zustand';

import { api } from '@/lib/ipc';
import type { RunRecord } from '@/lib/load/types';

export type RunMeta = Omit<RunRecord, 'timeline'>;

interface State {
  runs: RunMeta[];
  /** Run ids currently executing (live dashboards). */
  live: string[];
  refresh: () => Promise<void>;
  setLive: (id: string, on: boolean) => void;
}

export const useRuns = create<State>((set) => ({
  runs: [],
  live: [],
  refresh: async () => {
    try {
      const list = await api.list<RunMeta>('loadRuns', ['timeline', 'scenario']);
      const runs = list.map((x) => x.doc).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      set({ runs });
    } catch (e) {
      console.error(e);
    }
  },
  setLive: (id, on) => set((s) => ({ live: on ? [...new Set([...s.live, id])] : s.live.filter((x) => x !== id) })),
}));
