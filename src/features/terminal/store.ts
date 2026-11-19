import { create } from 'zustand';

export interface TermSession {
  id: number;
  /** Shell display name, e.g. "PowerShell". */
  shell: string;
  exited: boolean;
}

interface TerminalStore {
  /** Whether the bottom terminal panel is shown. Sessions stay alive while it is hidden. */
  visible: boolean;
  sessions: TermSession[];
  active: number | null;
  setVisible: (v: boolean) => void;
  add: (s: TermSession) => void;
  remove: (id: number) => void;
  markExited: (id: number) => void;
  setActive: (id: number) => void;
}

export const useTerminal = create<TerminalStore>((set) => ({
  visible: false,
  sessions: [],
  active: null,
  setVisible: (visible) => set({ visible }),
  add: (s) => set((st) => ({ sessions: [...st.sessions, s], active: s.id })),
  remove: (id) =>
    set((st) => {
      const idx = st.sessions.findIndex((s) => s.id === id);
      const sessions = st.sessions.filter((s) => s.id !== id);
      const active = st.active === id ? (sessions[Math.min(idx, sessions.length - 1)]?.id ?? null) : st.active;
      return { sessions, active };
    }),
  markExited: (id) => set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, exited: true } : s)) })),
  setActive: (active) => set({ active }),
}));
