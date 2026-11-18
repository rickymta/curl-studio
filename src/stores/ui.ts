import { create } from 'zustand';

export type SidebarView = 'collections' | 'environments' | 'history' | 'load';

export type Dialog =
  | { kind: 'import'; initialText?: string }
  | { kind: 'export'; collectionId?: string; envId?: string }
  | { kind: 'code'; tabId: string }
  | { kind: 'cookies' }
  | { kind: 'settings' }
  | { kind: 'saveAs'; tabId: string }
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
  setSidebar: (sidebar) => set({ sidebar }),
  setSidebarWidth: (w) => {
    localStorage.setItem('curlstudio.sidebarWidth', String(w));
    set({ sidebarWidth: w });
  },
  show: (dialog) => set({ dialog }),
  toast: (kind, text) => {
    const id = ++n;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setFilter: (filter) => set({ filter }),
}));

export const toast = (kind: 'info' | 'success' | 'error', text: string) => useUi.getState().toast(kind, text);
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
