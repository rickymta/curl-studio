// Live terminal sessions (ported from GitStudio): one xterm instance per backend PTY, kept outside
// React so sessions survive the panel being hidden. Output is polled, which works in Tauri and in
// the browser dev bridge alike.

import { FitAddon } from '@xterm/addon-fit';
import { type ITheme, Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { api } from '@/lib/ipc';
import { logActivity } from '@/stores/activity';
import { errText, toast } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

import { systemFont } from './font';
import { useTerminal } from './store';

interface Live {
  term: Terminal;
  fit: FitAddon;
  /** Element xterm renders into; moved between panel mounts. */
  host: HTMLDivElement;
  opened: boolean;
  stopped: boolean;
  lastActivity: number;
  /** Cuts the current poll wait short (after the user types). */
  wake: (() => void) | null;
  /** Input not yet sent; writes go one at a time so fast typing/pastes keep their order. */
  outbox: string;
  writing: boolean;
}

/** Send queued input in order, coalescing whatever arrived while the last write was in flight. */
function send(id: number, l: Live) {
  if (l.writing || !l.outbox) return;
  const data = l.outbox;
  l.outbox = '';
  l.writing = true;
  api
    .terminalWrite(id, data)
    .catch(() => undefined)
    .finally(() => {
      l.writing = false;
      l.wake?.();
      send(id, l);
    });
}

function enqueue(id: number, data: string) {
  const l = live.get(id);
  if (!l) return;
  l.outbox += data;
  l.lastActivity = Date.now();
  send(id, l);
}

const live = new Map<number, Live>();

const FAST_MS = 40;
const IDLE_MS = 250;
const HIDDEN_MS = 1000;
const ACTIVE_WINDOW_MS = 1500;

// ---- theme ---------------------------------------------------------------------------------------

let ctx: CanvasRenderingContext2D | null = null;

/** Resolves any CSS colour (the tokens are oklch) to rgba(), which xterm understands. */
function toRgba(color: string): string | undefined {
  if (!color) return undefined;
  ctx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return color;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

function theme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => toRgba(css.getPropertyValue(name).trim());
  return {
    background: v('--background'),
    foreground: v('--foreground'),
    cursor: v('--accent'),
    cursorAccent: v('--background'),
    selectionBackground: v('--selection'),
  };
}

let themeWatch: MutationObserver | null = null;

/** Re-themes every terminal when the `.dark` class on <html> flips. */
function watchTheme() {
  if (themeWatch) return;
  themeWatch = new MutationObserver(() => {
    const th = theme();
    for (const l of live.values()) l.term.options.theme = th;
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

// ---- polling -------------------------------------------------------------------------------------

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isShown(id: number): boolean {
  const st = useTerminal.getState();
  return st.visible && st.active === id;
}

function delay(id: number, l: Live): number {
  if (!isShown(id)) return HIDDEN_MS;
  return Date.now() - l.lastActivity < ACTIVE_WINDOW_MS ? FAST_MS : IDLE_MS;
}

async function pump(id: number) {
  for (;;) {
    const l = live.get(id);
    if (!l || l.stopped) return;
    const entry: Live = l;
    let exited: boolean;
    try {
      const out = await api.terminalRead(id);
      if (out.data) {
        l.term.write(decode(out.data));
        l.lastActivity = Date.now();
      }
      exited = out.exited;
    } catch {
      exited = true;
    }
    if (l.stopped) return;
    if (exited) {
      l.stopped = true;
      l.term.write('\r\n\x1b[2m[Process exited]\x1b[0m\r\n');
      useTerminal.getState().markExited(id);
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, delay(id, l));
      function done() {
        clearTimeout(timer);
        entry.wake = null;
        resolve();
      }
      l.wake = done;
    });
  }
}

// ---- sessions ------------------------------------------------------------------------------------

const isToggleKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && (e.code === 'Backquote' || e.key === '`');

/** Start a shell (Settings → Terminal picks which one and where). Resolves to the session id. */
export async function openSession(): Promise<number | null> {
  const { terminalShell, terminalCwd } = useWorkspace.getState().settings;
  const font = systemFont();
  let opened;
  try {
    opened = await api.terminalOpen({ cwd: terminalCwd || null, cols: 80, rows: 24, shell: terminalShell || 'auto' });
  } catch (e) {
    toast('error', `Could not start the terminal: ${errText(e)}`);
    return null;
  }
  const { id } = opened;
  logActivity({ cat: 'app', label: `Terminal started (${opened.shell})`, status: 'info', detail: terminalCwd || undefined });
  watchTheme();
  const term = new Terminal({ ...(await font), cursorBlink: true, scrollback: 5000, theme: theme() });
  const fit = new FitAddon();
  term.loadAddon(fit);

  const host = document.createElement('div');
  host.style.width = '100%';
  host.style.height = '100%';
  // Keep app-wide shortcuts (Ctrl+W, Ctrl+T, …) from firing while typing in the shell; only
  // the panel toggle reaches the window.
  host.addEventListener('keydown', (e) => {
    if (!isToggleKey(e)) e.stopPropagation();
  });

  term.attachCustomKeyEventHandler((e) => {
    if (isToggleKey(e)) return false;
    if (e.type !== 'keydown') return true;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // Copy: Ctrl+Shift+C, or Ctrl+C with a selection (otherwise Ctrl+C interrupts).
    if (mod && key === 'c' && (e.shiftKey || term.hasSelection())) {
      void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined);
      term.clearSelection();
      e.preventDefault();
      return false;
    }
    // Paste: let the browser fire a paste event, which xterm forwards to the shell.
    if (mod && key === 'v') return false;
    return true;
  });

  const l: Live = { term, fit, host, opened: false, stopped: false, lastActivity: Date.now(), wake: null, outbox: '', writing: false };
  live.set(id, l);

  // Everything xterm emits goes to the PTY, including its answers to queries such as ConPTY's
  // cursor-position request (ESC[6n), without which Windows shells don't start.
  term.onData((data) => enqueue(id, data));
  term.onResize(({ cols, rows }) => {
    api.terminalResize(id, cols, rows).catch(() => undefined);
  });

  const st = useTerminal.getState();
  st.add({ id, shell: opened.shell, exited: false });
  st.setVisible(true);
  void pump(id);
  return id;
}

export function closeSession(id: number) {
  const l = live.get(id);
  if (l) {
    l.stopped = true;
    l.wake?.();
    l.term.dispose();
    l.host.remove();
    live.delete(id);
  }
  api.terminalClose(id).catch(() => undefined);
  const st = useTerminal.getState();
  st.remove(id);
  if (!useTerminal.getState().sessions.length) st.setVisible(false);
}

export function killAll() {
  for (const s of useTerminal.getState().sessions) closeSession(s.id);
}

/** Shows or hides the panel, starting a session if there is none. */
export function toggleTerminal() {
  const st = useTerminal.getState();
  if (st.visible) {
    st.setVisible(false);
    return;
  }
  if (st.sessions.length) st.setVisible(true);
  else void openSession();
}

/**
 * Type `command` into the active terminal (opening one if needed) without pressing Enter, so the
 * user can read or edit it first.
 */
export async function typeInTerminal(command: string) {
  const st = useTerminal.getState();
  let id = st.sessions.find((s) => s.id === st.active && !s.exited)?.id ?? null;
  const fresh = id === null;
  if (id === null) id = await openSession();
  if (id === null) return;
  useTerminal.getState().setActive(id);
  useTerminal.getState().setVisible(true);
  // A new shell needs a moment to print its prompt before typed input shows up after it.
  setTimeout(() => {
    enqueue(id, command);
    live.get(id)?.term.focus();
  }, fresh ? 900 : 0);
}

/** Shell family of the configured terminal, to pick the right cURL quoting. */
export function shellFamily(): 'powershell' | 'cmd' | 'bash' {
  const s = useWorkspace.getState().settings.terminalShell || 'auto';
  if (s === 'cmd') return 'cmd';
  if (s === 'gitbash') return 'bash';
  if (s === 'powershell' || s === 'pwsh' || s === 'auto') return navigator.userAgent.includes('Windows') ? 'powershell' : 'bash';
  return 'bash';
}

/** Mounts session `id` into `container`; returns a cleanup that detaches it again. */
export function attach(id: number, container: HTMLElement): () => void {
  const l = live.get(id);
  if (!l) return () => undefined;
  container.appendChild(l.host);
  if (!l.opened) {
    l.term.open(l.host);
    l.opened = true;
  }
  const refit = () => {
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      try {
        l.fit.fit();
      } catch {
        /* not measurable yet */
      }
    }
  };
  refit();
  l.term.focus();
  let frame = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refit);
  });
  ro.observe(container);
  l.wake?.();
  return () => {
    ro.disconnect();
    cancelAnimationFrame(frame);
    if (l.host.parentElement === container) container.removeChild(l.host);
  };
}
