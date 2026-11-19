import { create } from 'zustand';

import { logActivity } from './activity';

export type SidebarView = 'collections' | 'environments' | 'history' | 'load';
export type SettingsSection = 'general' | 'appearance' | 'terminal' | 'data' | 'about';

export type Dialog =
  | { kind: 'import'; initialText?: string }
  | { kind: 'export'; collectionId?: string; envId?: string }
  | { kind: 'code'; tabId: string }
  | { kind: 'cookies' }
  | { kind: 'settings'; section?: SettingsSection }
  | { kind: 'shortcuts' }
  | { kind: 'activity' }
  | { kind: 'help'; tab?: 'contact' | 'about' }
  | { kind: 'saveAs'; tabId: string; then?: () => void }
  | { kind: 'unsaved'; tabIds: string[] }
  | { kind: 'prompt'; title: string; label: string; value: string; onSubmit: (v: string) => void }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      danger?: boolean;
      confirmLabel?: string;
      onConfirm: () => void;
    }
  | null;

interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

interface State {
  sidebar: SidebarView;
  sidebarWidth: number;
  dialog: Dialog;
  toasts: Toast[];
  filter: string;
  sidebarHidden: boolean;
  toggleSidebar: () => void;
  /** Expanded collections/folders in the sidebar tree (survives searches and restarts). */
  expanded: Record<string, boolean>;
  setExpanded: (id: string, open: boolean) => void;
  setSidebar: (v: SidebarView) => void;
  setSidebarWidth: (w: number) => void;
  show: (d: Dialog) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismiss: (id: number) => void;
  setFilter: (f: string) => void;
}

let n = 0;

export const useUi = create<State>((set) => ({
  sidebar: 'collections',
  sidebarWidth: Number(localStorage.getItem('curlstudio.sidebarWidth')) || 300,
  dialog: null,
  toasts: [],
  filter: '',
  sidebarHidden: localStorage.getItem('curlstudio.sidebarHidden') === '1',
  toggleSidebar: () =>
    set((s) => {
      try {
        localStorage.setItem('curlstudio.sidebarHidden', s.sidebarHidden ? '0' : '1');
      } catch {
        /* not persisted */
      }
      return { sidebarHidden: !s.sidebarHidden };
    }),
  expanded: (() => {
    try {
      return JSON.parse(localStorage.getItem('curlstudio.expanded') ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  })(),
  setExpanded: (id, open) =>
    set((s) => {
      const expanded = { ...s.expanded };
      if (open) expanded[id] = true;
      else delete expanded[id];
      try {
        localStorage.setItem('curlstudio.expanded', JSON.stringify(expanded));
      } catch {
        /* not persisted */
      }
      return { expanded };
    }),
  setSidebar: (sidebar) => set({ sidebar }),
  setSidebarWidth: (w) => {
    localStorage.setItem('curlstudio.sidebarWidth', String(w));
    set({ sidebarWidth: w });
  },
  show: (dialog) => set({ dialog }),
  toast: (kind, text) => {
    // Every error shown to the user is also kept in the Activity Logs.
    if (kind === 'error') logActivity({ cat: 'app', label: text, status: 'failed' });
    else if (kind === 'success') logActivity({ cat: 'app', label: text, status: 'info' });
    const id = ++n;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setFilter: (filter) => set({ filter }),
}));

export const toast = (kind: 'info' | 'success' | 'error', text: string) => useUi.getState().toast(kind, text);
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
