import { Brush, Database, FolderOpen, Info, ListChecks, Settings as SettingsIcon, SquareTerminal, Trash2, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';

import { Button, Checkbox, cn, IconButton, Input, Select } from '@/components/ui';
import { exportEverything } from '@/features/actions';
import { systemFont } from '@/features/terminal/font';
import { api } from '@/lib/ipc';
import { pickFiles, revealPath } from '@/lib/native';
import type { Settings } from '@/lib/types';
import { useActivity } from '@/stores/activity';
import { type SettingsSection, useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

import { BRIGHTNESS_MAX, BRIGHTNESS_MIN, clampBrightness, clampZoom } from './appearance';
import { About } from './HelpDialog';

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SettingsIcon className="size-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Brush className="size-4" /> },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal className="size-4" /> },
  { id: 'data', label: 'Data & Logs', icon: <Database className="size-4" /> },
  { id: 'about', label: 'About', icon: <Info className="size-4" /> },
];

/** Settings are saved as you change them (as in GitStudio's Preferences). */
function useSettings(): [Settings, <K extends keyof Settings>(k: K, v: Settings[K]) => void] {
  const s = useWorkspace((x) => x.settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    const cur = useWorkspace.getState().settings;
    if (cur[k] !== v) useWorkspace.getState().saveSettings({ ...cur, [k]: v });
  };
  return [s, set];
}

function Row({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 border-b border-border py-3 last:border-0">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {help && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{help}</div>}
      </div>
      <div className="min-w-0 self-center">{children}</div>
    </div>
  );
}

/** Number field that saves when it loses focus or on Enter (no write per keystroke). */
function NumberField(props: { value: number; onSave: (v: number) => void; min?: number; max?: number }) {
  // Remount when the saved value changes elsewhere so the draft starts from it.
  return <NumberDraft key={props.value} {...props} />;
}

function NumberDraft({ value, onSave, min, max }: { value: number; onSave: (v: number) => void; min?: number; max?: number }) {
  const [v, setV] = useState(String(value));
  const commit = () => {
    let n = Number(v);
    if (!Number.isFinite(n) || v.trim() === '') return setV(String(value));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    onSave(n);
    setV(String(n));
  };
  return <Input type="number" className="w-40" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

function TextField(props: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  return <TextDraft key={props.value} {...props} />;
}

function TextDraft({ value, onSave, placeholder, className }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value);
  return <Input className={className} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === 'Enter' && onSave(v)} />;
}

function Title({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-[18px] font-semibold">{children}</h2>;
}

function General() {
  const [s, set] = useSettings();
  return (
    <>
      <Title>General</Title>
      <Row label="Request timeout" help="Milliseconds; a request can override it in its Settings tab.">
        <NumberField value={s.timeoutMs} min={100} onSave={(v) => set('timeoutMs', v)} />
      </Row>
      <Row label="Redirects">
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox checked={s.followRedirects} onChange={(x) => set('followRedirects', x)} label="Follow redirects" />
          <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            max <NumberField value={s.maxRedirects} min={1} max={100} onSave={(v) => set('maxRedirects', v)} />
          </span>
        </div>
      </Row>
      <Row label="Proxy" help="Empty = system proxy · none = direct · http://host:port · socks5://…">
        <TextField className="w-full" value={s.proxy} onSave={(v) => set('proxy', v.trim())} placeholder="system proxy" />
      </Row>
      <Row label="Connection">
        <div className="flex flex-col gap-2">
          <Checkbox checked={s.verifyTls} onChange={(x) => set('verifyTls', x)} label="SSL certificate verification" />
          <Checkbox checked={s.cookies} onChange={(x) => set('cookies', x)} label="Use the cookie jar" />
          <Checkbox checked={s.http1Only} onChange={(x) => set('http1Only', x)} label="Force HTTP/1.1" />
        </div>
      </Row>
      <Row label="Largest response shown" help="Megabytes. Bigger bodies can still be saved to a file.">
        <NumberField value={s.maxBodyMb} min={1} max={2048} onSave={(v) => set('maxBodyMb', v)} />
      </Row>
      <Row label="History entries kept">
        <NumberField value={s.historyLimit} min={10} max={10000} onSave={(v) => set('historyLimit', v)} />
      </Row>
      <Row label="Closing tabs" help="When off, tabs with unsaved changes ask “Save changes?”.">
        <Checkbox checked={s.discardUnsavedOnClose} onChange={(x) => set('discardUnsavedOnClose', x)} label="Always discard unsaved changes when closing a tab" />
      </Row>
    </>
  );
}

function Brightness({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={BRIGHTNESS_MIN}
        max={BRIGHTNESS_MAX}
        step={5}
        value={value}
        onChange={(e) => onChange(clampBrightness(Number(e.target.value)))}
        className="w-64 accent-[var(--accent)]"
        aria-label="Brightness"
      />
      <span className="w-12 text-right font-mono text-[12px] tabular-nums">{value}%</span>
      {value !== 100 && (
        <Button size="sm" variant="ghost" onClick={() => onChange(100)}>
          Reset
        </Button>
      )}
    </div>
  );
}

function Appearance() {
  const [s, set] = useSettings();
  return (
    <>
      <Title>Appearance</Title>
      <Row label="Theme" help="System follows the operating system's light/dark setting.">
        <Select
          value={s.theme}
          onChange={(x) => set('theme', x as Settings['theme'])}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
          className="w-48"
        />
      </Row>
      <Row label="Brightness — dark theme" help="Dims or brightens the whole window while the dark theme is on.">
        <Brightness value={s.brightnessDark} onChange={(v) => set('brightnessDark', v)} />
      </Row>
      <Row label="Brightness — light theme" help="Each theme keeps its own value.">
        <Brightness value={s.brightnessLight} onChange={(v) => set('brightnessLight', v)} />
      </Row>
      <Row label="Zoom" help="Ctrl + / Ctrl − / Ctrl 0 anywhere, or the status bar.">
        <Select
          value={String(s.zoom)}
          onChange={(v) => set('zoom', clampZoom(Number(v)))}
          options={[0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2].map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%` }))
            .concat([0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2].includes(s.zoom) ? [] : [{ value: String(s.zoom), label: `${Math.round(s.zoom * 100)}%` }])}
          className="w-48"
        />
      </Row>
      <Row label="Editor font size" help="Body, script and response editors (pixels).">
        <Select value={String(s.fontSize)} onChange={(v) => set('fontSize', Number(v))} options={[11, 12, 13, 14, 15, 16, 18].map((n) => ({ value: String(n), label: `${n} px` }))} className="w-48" />
      </Row>
    </>
  );
}

function TerminalPrefs() {
  const [s, set] = useSettings();
  const [font, setFont] = useState<string>('…');
  useEffect(() => {
    systemFont()
      .then((f) => setFont(`${f.fontFamily.split(',')[0]} · ${f.fontSize}px`))
      .catch(() => setFont('default'));
  }, [s.terminalShell]);
  return (
    <>
      <Title>Terminal</Title>
      <Row label="Shell" help="Used for new sessions of the in-app terminal (Ctrl+`).">
        <Select
          value={s.terminalShell}
          onChange={(v) => set('terminalShell', v)}
          options={[
            { value: 'auto', label: 'Automatic (PowerShell on Windows, $SHELL elsewhere)' },
            { value: 'powershell', label: 'Windows PowerShell' },
            { value: 'pwsh', label: 'PowerShell 7 (pwsh)' },
            { value: 'cmd', label: 'Command Prompt' },
            { value: 'gitbash', label: 'Git Bash' },
          ]}
          className="w-80"
        />
      </Row>
      <Row label="Start in folder" help="Empty = your home folder.">
        <div className="flex gap-2">
          <TextField className="min-w-0 flex-1 font-mono" value={s.terminalCwd} onSave={(v) => set('terminalCwd', v.trim())} placeholder="home folder" />
          <Button
            onClick={async () => {
              const [p] = await pickFiles({ title: 'Folder new terminals start in', directory: true });
              if (p) set('terminalCwd', p);
            }}
          >
            Browse
          </Button>
        </div>
      </Row>
      <Row label="Font" help="Taken from your Windows Terminal profile when there is one, so prompt icons render.">
        <span className="font-mono text-[12.5px]">{font}</span>
      </Row>
    </>
  );
}

function DataPrefs() {
  const [dataDir, setDataDir] = useState('');
  const stats = useActivity((s) => s.stats);
  const entries = useActivity((s) => s.items.length);
  const history = useWorkspace((s) => s.history.length);
  useEffect(() => {
    api.info().then((i) => setDataDir(i.dataDir)).catch(() => undefined);
  }, []);
  return (
    <>
      <Title>Data & Logs</Title>
      <Row label="Workspace folder" help="Collections (Postman v2.1 files), environments, load runs, settings.">
        <div className="flex items-center gap-2">
          <span className="selectable min-w-0 flex-1 truncate font-mono text-[12px]" title={dataDir}>
            {dataDir || '…'}
          </span>
          <Button size="sm" onClick={() => revealPath(dataDir)}>
            <FolderOpen className="size-3.5" /> Open
          </Button>
        </div>
      </Row>
      <Row label="Backup" help="Every collection, environment and globals in one Postman data dump.">
        <Button size="sm" onClick={exportEverything}>
          Export all (Postman dump)
        </Button>
      </Row>
      <Row label="Activity Logs" help={stats ? `activity.jsonl · ${(stats.bytes / 1024).toFixed(0)} KB · kept ${stats.retentionDays} days, at most ${stats.maxBytes / 1024 / 1024} MB` : 'activity.jsonl in the workspace folder'}>
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-muted-foreground">{entries} entries</span>
          <Button size="sm" onClick={() => useUi.getState().show({ kind: 'activity' })}>
            <ListChecks className="size-3.5" /> Open
          </Button>
          <Button size="sm" variant="ghost" onClick={() => useActivity.getState().clear()}>
            <Trash2 className="size-3.5" /> Clear
          </Button>
        </div>
      </Row>
      <Row label="Request history">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-muted-foreground">{history} entries</span>
          <Button size="sm" variant="ghost" onClick={() => useWorkspace.getState().clearHistory()}>
            <Trash2 className="size-3.5" /> Clear
          </Button>
        </div>
      </Row>
    </>
  );
}

export function SettingsDialog({ section: initial = 'general' }: { section?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initial);
  const close = () => useUi.getState().show(null);
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
          style={{ width: 'min(920px, calc(100vw - 32px))', height: 'min(640px, calc(100vh - 48px))' }}
        >
          <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border bg-surface p-2">
            <Dialog.Title className="px-2 pt-1 pb-3 text-[16px] font-semibold">Settings</Dialog.Title>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? 'page' : undefined}
                className={cn('flex h-8 items-center gap-2 rounded-md px-2 text-[13px]', section === s.id ? 'bg-surface-hover font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
            <div className="mt-auto px-2 text-[11px] text-muted-foreground">Changes are saved automatically.</div>
          </nav>
          <div className="relative min-w-0 flex-1 overflow-auto px-6 py-5">
            <Dialog.Close asChild>
              <IconButton label="Close" className="absolute top-3 right-3 size-7">
                <X className="size-5" />
              </IconButton>
            </Dialog.Close>
            {section === 'general' && <General />}
            {section === 'appearance' && <Appearance />}
            {section === 'terminal' && <TerminalPrefs />}
            {section === 'data' && <DataPrefs />}
            {section === 'about' && (
              <>
                <Title>About</Title>
                <About />
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
