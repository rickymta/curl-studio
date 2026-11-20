import { Download, Gauge, Search, Send, SquareTerminal, Trash2, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { cn, IconButton } from '@/components/ui';
import { confirmAction } from '@/features/actions';
import { saveText } from '@/lib/native';
import { type Activity, type ActivityCategory, useActivity } from '@/stores/activity';

import { SHORTCUTS } from './shortcuts';

/** Large window with a title bar (GitStudio style). */
function BigWindow({
  open,
  onClose,
  title,
  headerExtra,
  width,
  height,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  headerExtra?: ReactNode;
  width: string;
  height: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-autofocus]');
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
          className="fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
          style={{ width, height }}
        >
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-5">
            <Dialog.Title className="text-[16px] font-medium">{title}</Dialog.Title>
            <div className="ml-auto flex items-center gap-3">
              {headerExtra}
              <Dialog.Close asChild>
                <IconButton label="Close" className="size-7">
                  <X className="size-5" />
                </IconButton>
              </Dialog.Close>
            </div>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded border border-border bg-surface-muted px-1.5 font-sans text-[11.5px] font-medium whitespace-nowrap shadow-[inset_0_-1px_0_var(--border)]">
      {children}
    </kbd>
  );
}

function FilterBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <input
        data-autofocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            e.preventDefault();
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 w-56 rounded border border-border bg-background pr-7 pl-2 text-[12px] outline-none focus:border-accent"
      />
      <Search className="absolute top-1.5 right-2 size-3.5 text-muted-foreground" />
    </div>
  );
}

export function ShortcutsWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SHORTCUTS.map((g) => ({
      ...g,
      items: g.items.filter((i) => !needle || i.label.toLowerCase().includes(needle) || i.keys.some((k) => k.join('+').toLowerCase().includes(needle))),
    })).filter((g) => g.items.length > 0);
  }, [q]);
  return (
    <BigWindow
      open={open}
      onClose={onClose}
      width="min(760px, calc(100vw - 32px))"
      height="min(680px, calc(100vh - 64px))"
      title={
        <span className="flex items-center gap-3">
          Keyboard Shortcuts
          <span className="flex gap-1">
            <Key>Ctrl</Key>
            <Key>/</Key>
          </span>
        </span>
      }
      headerExtra={<FilterBox value={q} onChange={setQ} placeholder="Filter shortcuts" />}
    >
      <div className="min-h-0 flex-1 overflow-auto px-8 py-5">
        {groups.length === 0 && <div className="py-10 text-center text-muted-foreground">No shortcut matches “{q}”.</div>}
        {groups.map((g) => (
          <section key={g.title} className="mb-6">
            <h2 className="mb-2 border-b border-border pb-2 text-[17px] font-medium">{g.title}</h2>
            {g.items.map((i) => (
              <div key={i.label} className="flex min-h-9 items-center gap-4 py-1">
                <span className="flex-1 text-[13.5px]">{i.label}</span>
                <span className="flex w-80 flex-wrap items-center gap-1.5">
                  {i.keys.map((combo, n) => (
                    <span key={n} className="flex items-center gap-1">
                      {n > 0 && <span className="px-1 text-[12px] text-muted-foreground">or</span>}
                      {combo.map((k) => (
                        <Key key={k}>{k}</Key>
                      ))}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </BigWindow>
  );
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString();

const CATS: { id: ActivityCategory | 'all'; label: string; icon: ReactNode }[] = [
  { id: 'all', label: 'All', icon: null },
  { id: 'request', label: 'Requests', icon: <Send className="size-3.5" /> },
  { id: 'load', label: 'Load tests & runner', icon: <Gauge className="size-3.5" /> },
  { id: 'app', label: 'Application', icon: <SquareTerminal className="size-3.5" /> },
];

const asText = (items: Activity[]) =>
  items
    .map((i) => `${new Date(i.at).toISOString()}\t${i.cat}\t${i.status}\t${i.label}${i.ms !== undefined ? `\t${i.ms}ms` : ''}${i.detail ? `\t${i.detail}` : ''}`)
    .join('\n');

export function ActivityWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useActivity((s) => s.items);
  const stats = useActivity((s) => s.stats);
  const clear = useActivity((s) => s.clear);
  const [tab, setTab] = useState<ActivityCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const needle = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (tab === 'all' || i.cat === tab) &&
      (!failedOnly || i.status === 'failed') &&
      (!needle || i.label.toLowerCase().includes(needle) || (i.detail ?? '').toLowerCase().includes(needle)),
  );

  // Follow new lines while scrolled to the bottom.
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [shown.length, open]);

  return (
    <BigWindow
      open={open}
      onClose={onClose}
      width="calc(100vw - 96px)"
      height="calc(100vh - 96px)"
      title="Activity Logs"
      headerExtra={
        <>
          <FilterBox value={q} onChange={setQ} placeholder="Filter logs" />
          <IconButton label="Save as text file" className="size-7" onClick={() => saveText(`curlstudio-activity-${new Date().toISOString().slice(0, 10)}.log`, asText(shown), [{ name: 'Log', extensions: ['log', 'txt'] }])}>
            <Download className="size-4" />
          </IconButton>
          <IconButton
            label="Clear log"
            className="size-7"
            disabled={!items.length}
            onClick={() =>
              confirmAction(
                'Clear Activity Logs',
                'Delete every entry of the Activity Logs (also from activity.jsonl)? This cannot be undone.',
                clear,
                true,
                'Delete',
                { kind: 'activity' },
              )
            }
          >
            <Trash2 className="size-4" />
          </IconButton>
        </>
      }
    >
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-surface">
        {CATS.map((c) => {
          const n = c.id === 'all' ? items.length : items.filter((i) => i.cat === c.id).length;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setTab(c.id)}
              className={cn('flex h-full items-center gap-2 px-4 text-[13px]', tab === c.id ? 'bg-surface-hover font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {c.icon}
              {c.label}
              <span className="text-[11px] text-muted-foreground tabular-nums">{n}</span>
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 px-4 text-[12.5px] text-muted-foreground">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
          Failures only
        </label>
      </div>
      <div ref={box} className="selectable min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12px] leading-5">
        {shown.length === 0 && <div className="py-10 text-center font-sans text-muted-foreground">{items.length ? 'No entries match.' : 'Nothing logged yet.'}</div>}
        {shown.map((i, n) => (
          <div key={i.id}>
            {(n === 0 || day(shown[n - 1]!.at) !== day(i.at)) && <div className="mt-2 mb-1 font-sans text-[11px] font-semibold text-muted-foreground uppercase">{day(i.at)}</div>}
            <div className="flex gap-3">
              <span className="shrink-0 text-muted-foreground">{time(i.at)}</span>
              <span className={cn('min-w-0 flex-1 whitespace-pre-wrap', i.status === 'failed' && 'text-danger')}>
                {i.status === 'failed' ? '✕ ' : i.status === 'finished' ? '✓ ' : i.status === 'started' ? '… ' : '· '}
                {i.label}
                {i.status === 'started' && ': started'}
                {i.detail && <span className={cn('block break-all', i.status === 'failed' ? 'text-danger/80' : 'text-muted-foreground')}>{i.detail}</span>}
              </span>
              {i.ms !== undefined && <span className="shrink-0 text-accent tabular-nums">{i.ms >= 1000 ? `${(i.ms / 1000).toFixed(2)}s` : `${i.ms}ms`}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-surface px-4 text-[11.5px] text-muted-foreground">
        <span>
          {shown.length} of {items.length} entries
        </span>
        {stats && (
          <span className="min-w-0 truncate" title={stats.path}>
            · saved to activity.jsonl ({(stats.bytes / 1024).toFixed(0)} KB of {stats.maxBytes / 1024 / 1024} MB, {stats.retentionDays ? `kept ${stats.retentionDays} days` : 'kept forever'})
          </span>
        )}
      </div>
    </BigWindow>
  );
}
