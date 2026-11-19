import { CircleHelp, Gauge, Globe2, Keyboard, ListChecks, Minus, PanelBottom, Plus, SquareTerminal, ZoomIn } from 'lucide-react';

import { cn } from '@/components/ui';
import { useRuns } from '@/features/load/runs';
import { toggleTerminal } from '@/features/terminal/runtime';
import { useTerminal } from '@/features/terminal/store';
import { uid } from '@/lib/postman';
import { useActivity } from '@/stores/activity';
import { useConsole } from '@/stores/console';
import { useTabs } from '@/stores/tabs';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

import { setZoom, zoomBy } from './appearance';

function Item({ label, onClick, active, children, className }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn('flex h-full items-center gap-1.5 px-1.5 hover:text-foreground', active && 'text-foreground', className)}
    >
      {children}
    </button>
  );
}

/** Bottom status bar (GitStudio style): context on the left, windows and zoom on the right. */
export function StatusBar() {
  const envId = useWorkspace((s) => s.activeEnv);
  const envName = useWorkspace((s) => (s.activeEnv ? s.environments[s.activeEnv]?.name : null));
  const zoom = useWorkspace((s) => s.settings.zoom);
  const live = useRuns((s) => s.live.length);
  const consoleOpen = useConsole((s) => s.open);
  const termOpen = useTerminal((s) => s.visible);
  const failures = useActivity((s) => s.items.filter((i) => i.status === 'failed' && Date.now() - i.at < 10 * 60_000).length);
  const show = useUi.getState().show;

  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-1 border-t border-border bg-surface px-2 text-[12px] text-muted-foreground select-none">
      <Item label={envId ? `Environment: ${envName} (click to edit)` : 'No environment selected'} onClick={() => envId && useTabs.getState().open({ id: uid(), kind: 'environment', envId })}>
        <Globe2 className="size-3.5" />
        <span className="max-w-48 truncate">{envName ?? 'No environment'}</span>
      </Item>
      {live > 0 && (
        <Item label="Load tests running" onClick={() => useUi.getState().setSidebar('load')} className="text-success">
          <Gauge className="size-3.5" />
          {live} running
        </Item>
      )}
      <Item label="Console (Ctrl+Alt+C)" onClick={() => useConsole.getState().toggle()} active={consoleOpen}>
        <PanelBottom className="size-3.5" />
        Console
      </Item>
      <Item label="Terminal (Ctrl+`)" onClick={toggleTerminal} active={termOpen}>
        <SquareTerminal className="size-3.5" />
        Terminal
      </Item>
      <div className="flex-1" />
      <Item label="Activity Logs (Ctrl+Shift+L)" onClick={() => show({ kind: 'activity' })}>
        <ListChecks className="size-3.5" />
        {failures > 0 && <span className="rounded-full bg-danger-soft px-1.5 text-[10.5px] font-semibold text-danger tabular-nums">{failures}</span>}
      </Item>
      <Item label="Keyboard Shortcuts (Ctrl+/)" onClick={() => show({ kind: 'shortcuts' })}>
        <Keyboard className="size-3.5" />
      </Item>
      <span className="flex h-full items-center gap-1 px-1">
        <button type="button" aria-label="Zoom out (Ctrl+-)" title="Zoom out (Ctrl+-)" onClick={() => zoomBy(-0.1)} className="hover:text-foreground">
          <Minus className="size-3" />
        </button>
        <button type="button" title="Reset zoom (Ctrl+0)" onClick={() => setZoom(1)} className="flex items-center gap-1 tabular-nums hover:text-foreground">
          <ZoomIn className="size-3.5" />
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" aria-label="Zoom in (Ctrl++)" title="Zoom in (Ctrl++)" onClick={() => zoomBy(0.1)} className="hover:text-foreground">
          <Plus className="size-3" />
        </button>
      </span>
      <Item label="Help & Support (F1)" onClick={() => show({ kind: 'help' })}>
        <CircleHelp className="size-3.5" />
        Help
      </Item>
      <button type="button" title="About CurlStudio" onClick={() => show({ kind: 'help', tab: 'about' })} className="flex h-full items-center gap-1.5 px-1.5 font-mono text-[11.5px] hover:text-foreground">
        <span
          aria-hidden="true"
          className="size-4 shrink-0 bg-current"
          style={{ mask: 'url(/statusbar-icon.svg) center / contain no-repeat', WebkitMask: 'url(/statusbar-icon.svg) center / contain no-repeat' }}
        />
        CurlStudio {__APP_VERSION__}
      </button>
    </footer>
  );
}
