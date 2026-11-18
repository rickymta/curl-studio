import { create } from 'zustand';

import { api } from '@/lib/ipc';
import type { SessionMessage } from '@/lib/types';

interface Live {
  sessionId: string | null;
  state: 'idle' | 'connecting' | 'open' | 'closed';
  messages: SessionMessage[];
  seq: number;
  error?: string;
}

interface State {
  byTab: Record<string, Live>;
  start: (tabId: string, connect: () => Promise<string>) => Promise<void>;
  send: (tabId: string, cmd: Record<string, unknown>) => Promise<void>;
  close: (tabId: string) => Promise<void>;
  clear: (tabId: string) => void;
}

const empty = (): Live => ({ sessionId: null, state: 'idle', messages: [], seq: 0 });

let timer: ReturnType<typeof setInterval> | null = null;

function ensurePoller() {
  if (timer) return;
  timer = setInterval(async () => {
    const { byTab } = useSessions.getState();
    const live = Object.entries(byTab).filter(([, l]) => l.sessionId && l.state !== 'closed' && l.state !== 'idle');
    if (!live.length) {
      clearInterval(timer!);
      timer = null;
      return;
    }
    await Promise.all(
      live.map(async ([tabId, l]) => {
        try {
          const r = await api.poll(l.sessionId!, l.seq);
          useSessions.setState((s) => {
            const cur = s.byTab[tabId];
            if (!cur || cur.sessionId !== l.sessionId) return s;
            const messages = r.messages.length ? [...cur.messages, ...r.messages].slice(-3000) : cur.messages;
            return { byTab: { ...s.byTab, [tabId]: { ...cur, state: r.state, seq: r.seq, messages } } };
          });
        } catch (e) {
          useSessions.setState((s) => ({ byTab: { ...s.byTab, [tabId]: { ...s.byTab[tabId]!, state: 'closed', error: String(e) } } }));
        }
      }),
    );
  }, 200);
}

export const useSessions = create<State>((set, get) => ({
  byTab: {},
  start: async (tabId, connect) => {
    const prev = get().byTab[tabId];
    if (prev?.sessionId) await api.closeSession(prev.sessionId).catch(() => undefined);
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...empty(), messages: prev?.messages ?? [], state: 'connecting' } } }));
    try {
      const id = await connect();
      set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...s.byTab[tabId]!, sessionId: id, seq: 0 } } }));
      ensurePoller();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((s) => ({
        byTab: {
          ...s.byTab,
          [tabId]: {
            ...s.byTab[tabId]!,
            state: 'closed',
            error: msg,
            messages: [...(s.byTab[tabId]?.messages ?? []), { seq: -1, ts: Date.now(), dir: 'error', kind: 'text', data: msg }],
          },
        },
      }));
    }
  },
  send: async (tabId, cmd) => {
    const l = get().byTab[tabId];
    if (!l?.sessionId) return;
    await api.command(l.sessionId, cmd);
  },
  close: async (tabId) => {
    const l = get().byTab[tabId];
    if (l?.sessionId) await api.command(l.sessionId, { op: 'close' }).catch(() => undefined);
  },
  clear: (tabId) => set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty()), messages: [] } } })),
}));

export const useLive = (tabId: string) => useSessions((s) => s.byTab[tabId] ?? null);
