import { create } from 'zustand';

import type { ConsoleEntry } from '@/lib/types';

interface State {
  entries: ConsoleEntry[];
  open: boolean;
  push: (e: Omit<ConsoleEntry, 'id' | 'ts'>) => void;
  clear: () => void;
  toggle: (v?: boolean) => void;
}

let seq = 0;

export const useConsole = create<State>((set) => ({
  entries: [],
  open: false,
  push: (e) =>
    set((s) => ({ entries: [...s.entries.slice(-999), { ...e, id: ++seq, ts: Date.now() }] })),
  clear: () => set({ entries: [] }),
  toggle: (v) => set((s) => ({ open: v ?? !s.open })),
}));

export function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a, null, 2);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}
