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
      /** Dialog to go back to afterwards (the window the question was asked from). */
      returnTo?: Dialog;
    }
  | null;

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  /** Runs on click; the toast closes afterwards. */
  run: () => void;
}

export interface ToastSpec {
  kind: ToastKind;
  text: string;
  /** Smaller second block, e.g. the error message. */
  detail?: string;
  /** Buttons under the text. */
  actions?: ToastAction[];
}

export interface Toast extends ToastSpec {
  id: number;
  /** Auto-hide delay in ms; the toast's progress bar runs for this long (paused on hover). */
  duration: number;
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
  toast: (kind: ToastKind, text: string, detail?: string) => void;
  notify: (spec: ToastSpec) => void;
  dismiss: (id: number) => void;
  setFilter: (f: string) => void;
}

let n = 0;

export const useUi = create<State>((set, get) => ({
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
  toast: (kind, text, detail) => get().notify({ kind, text, detail }),
  notify: ({ kind, text, detail, actions }) => {
    // Everything the user was told (except plain hints) is also kept in the Activity Logs.
    if (kind !== 'info')
      logActivity({
        cat: 'app',
        label: text,
        detail,
        status: kind === 'error' ? 'failed' : 'info',
      });
    const id = ++n;
    // Errors, warnings and toasts with buttons stay longer; long details get more reading time.
    const base =
      kind === 'error' || kind === 'warning' || actions?.length
        ? 9000
        : kind === 'success'
          ? 4000
          : 5000;
    const duration = base + Math.min(6000, (detail?.length ?? 0) * 30);
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text, detail, actions, duration }] }));
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setFilter: (filter) => set({ filter }),
}));

export const toast = (kind: ToastKind, text: string, detail?: string) =>
  useUi.getState().toast(kind, text, detail);
/** A toast with action buttons. */
export const notify = (spec: ToastSpec) => useUi.getState().notify(spec);
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
