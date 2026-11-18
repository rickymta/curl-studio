import { CheckCircle2, Copy, Download, Edit3, Gauge, Globe2, History, MoreHorizontal, Play, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge, cn, ContextMenuWrap, Dropdown, Empty, IconButton, type MenuItem } from '@/components/ui';
import { formatDuration, formatMs, relTime, statusTone } from '@/lib/format';
import { api } from '@/lib/ipc';
import type { RunRecord } from '@/lib/load/types';
import { clone, methodColor, newEnvironment, uid } from '@/lib/postman';
import { useTabs } from '@/stores/tabs';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

import { confirmAction, exportEnvironmentFile, promptText } from '../actions';
import { newScenario } from '../load/scenario';
import { useRuns } from '../load/runs';

export function EnvironmentsView() {
  const envs = useWorkspace((s) => s.environments);
  const active = useWorkspace((s) => s.activeEnv);
  const filter = useUi((s) => s.filter).trim().toLowerCase();
  const list = Object.values(envs)
    .filter((e) => !filter || e.name.toLowerCase().includes(filter))
    .sort((a, b) => a.name.localeCompare(b.name));
  const open = (envId: string) => useTabs.getState().open({ id: uid(), kind: 'environment', envId });
  return (
    <div className="py-1">
      <div
        onClick={() => open('globals')}
        className="flex h-8 cursor-pointer items-center gap-2 px-3 hover:bg-surface-hover"
      >
        <Globe2 className="size-3.5 text-muted-foreground" />
        <span className="flex-1">Globals</span>
      </div>
      <div className="my-1 h-px bg-border" />
      {list.length === 0 && (
        <Empty title="No environments">
          Environments hold variables like <code>{'{{baseUrl}}'}</code>. Import a Postman environment or create one.
        </Empty>
      )}
      {list.map((e) => {
        const menu: MenuItem[] = [
          { label: active === e.id ? 'Deactivate' : 'Set active', onSelect: () => useWorkspace.getState().setActiveEnv(active === e.id ? null : e.id) },
          {
            label: 'Rename',
            icon: <Edit3 className="size-3.5" />,
            onSelect: () => promptText('Rename environment', 'Name', e.name, (n) => useWorkspace.getState().updateEnvironment(e.id, (x) => void (x.name = n))),
          },
          {
            label: 'Duplicate',
            icon: <Copy className="size-3.5" />,
            onSelect: () => useWorkspace.getState().addEnvironment({ ...clone(e), id: uid(), name: `${e.name} Copy` }),
          },
          { label: 'Export (Postman)', icon: <Download className="size-3.5" />, onSelect: () => exportEnvironmentFile(e.id) },
          'sep',
          {
            label: 'Delete',
            icon: <Trash2 className="size-3.5" />,
            danger: true,
            onSelect: () => confirmAction('Delete environment', `Delete "${e.name}"?`, () => useWorkspace.getState().removeEnvironment(e.id)),
          },
        ];
        return (
          <ContextMenuWrap key={e.id} items={() => menu}>
            <div onClick={() => open(e.id)} className="group flex h-8 cursor-pointer items-center gap-2 px-3 hover:bg-surface-hover">
              <button
                type="button"
                title={active === e.id ? 'Active environment' : 'Set active'}
                onClick={(ev) => {
                  ev.stopPropagation();
                  useWorkspace.getState().setActiveEnv(active === e.id ? null : e.id);
                }}
                className={cn('size-3 shrink-0 rounded-full border', active === e.id ? 'border-success bg-success' : 'border-muted-foreground')}
              />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className="text-[11px] text-muted-foreground">{e.values.length}</span>
              <Dropdown items={menu}>
                <IconButton label="More" onClick={(ev) => ev.stopPropagation()} className="opacity-0 group-hover:opacity-100">
                  <MoreHorizontal className="size-3.5" />
                </IconButton>
              </Dropdown>
            </div>
          </ContextMenuWrap>
        );
      })}
    </div>
  );
}

export function newEnvironmentPrompt() {
  promptText('New environment', 'Name', 'Development', (n) => {
    const id = useWorkspace.getState().addEnvironment(newEnvironment(n));
    useTabs.getState().open({ id: uid(), kind: 'environment', envId: id });
  });
}

export function HistoryView() {
  const history = useWorkspace((s) => s.history);
  const filter = useUi((s) => s.filter).trim().toLowerCase();
  const groups = useMemo(() => {
    const out: { day: string; items: typeof history }[] = [];
    for (const h of history) {
      if (filter && !h.url.toLowerCase().includes(filter) && !h.method.toLowerCase().includes(filter)) continue;
      const day = new Date(h.ts).toDateString();
      const g = out.find((x) => x.day === day);
      if (g) g.items.push(h);
      else out.push({ day, items: [h] });
    }
    return out;
  }, [history, filter]);
  if (!history.length) return <Empty icon={<History className="size-8" />} title="No history yet">Requests you send appear here.</Empty>;
  return (
    <div className="py-1">
      <div className="flex justify-end px-2 pb-1">
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-danger"
          onClick={() => confirmAction('Clear history', 'Remove every history entry?', () => useWorkspace.getState().clearHistory(), true, 'Clear')}
        >
          Clear all
        </button>
      </div>
      {groups.map((g) => (
        <div key={g.day}>
          <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground">{g.day === new Date().toDateString() ? 'Today' : g.day}</div>
          {g.items.map((h) => (
            <div
              key={h.id}
              onClick={() => useTabs.getState().openDraft({ ...clone(h.item), id: uid() })}
              className="flex h-7 cursor-pointer items-center gap-2 px-3 text-[12px] hover:bg-surface-hover"
              title={h.url}
            >
              <span className={cn('w-12 shrink-0 font-mono text-[10px] font-bold', methodColor(h.method))}>{h.method}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{h.url}</span>
              {h.status !== null && <Badge tone={statusTone(h.status)}>{h.status || 'ERR'}</Badge>}
              <span className="w-12 text-right text-[11px] text-muted-foreground">{formatMs(h.timeMs)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function LoadView() {
  const scenarios = useWorkspace((s) => s.scenarios);
  const runs = useRuns((s) => s.runs);
  const [picked, setPicked] = useState<string[]>([]);
  const filter = useUi((s) => s.filter).trim().toLowerCase();
  useEffect(() => {
    useRuns.getState().refresh();
  }, []);
  const list = Object.values(scenarios)
    .filter((s) => !filter || s.name.toLowerCase().includes(filter))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const openScenario = (id: string) => useTabs.getState().open({ id: uid(), kind: 'scenario', scenarioId: id });
  return (
    <div className="flex flex-col py-1">
      <div className="flex items-center px-3 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <span className="flex-1">Scenarios</span>
        <IconButton
          label="New scenario"
          onClick={() => {
            const sc = newScenario('New load test');
            useWorkspace.getState().saveScenario(sc);
            openScenario(sc.id);
          }}
        >
          <Plus className="size-3.5" />
        </IconButton>
      </div>
      {list.length === 0 && (
        <div className="px-3 pb-2 text-[12px] text-muted-foreground">
          Right-click a collection, folder or request → <b>Load test</b>, or create an empty scenario.
        </div>
      )}
      {list.map((s) => (
        <ContextMenuWrap
          key={s.id}
          items={() => [
            { label: 'Open', onSelect: () => openScenario(s.id) },
            {
              label: 'Duplicate',
              icon: <Copy className="size-3.5" />,
              onSelect: () => useWorkspace.getState().saveScenario({ ...clone(s), id: uid(), name: `${s.name} Copy` }),
            },
            'sep',
            {
              label: 'Delete',
              icon: <Trash2 className="size-3.5" />,
              danger: true,
              onSelect: () => confirmAction('Delete scenario', `Delete "${s.name}"? Its past runs are kept.`, () => useWorkspace.getState().removeScenario(s.id)),
            },
          ]}
        >
          <div onClick={() => openScenario(s.id)} className="flex h-8 cursor-pointer items-center gap-2 px-3 hover:bg-surface-hover">
            <Gauge className="size-3.5 text-accent" />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-[11px] text-muted-foreground">{s.steps.length} req</span>
          </div>
        </ContextMenuWrap>
      ))}
      <div className="mt-3 flex items-center gap-1 px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <span className="flex-1">Runs</span>
        {picked.length >= 2 && (
          <button
            type="button"
            className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground normal-case"
            onClick={() => useTabs.getState().open({ id: uid(), kind: 'compare', runIds: picked })}
          >
            Compare {picked.length}
          </button>
        )}
        <button type="button" className="text-[10px] normal-case hover:text-foreground" onClick={() => useTabs.getState().open({ id: uid(), kind: 'loadRuns' })}>
          All
        </button>
      </div>
      {runs.length === 0 && <div className="px-3 text-[12px] text-muted-foreground">No runs yet.</div>}
      {runs.slice(0, 50).map((r) => (
        <RunRow
          key={r.id}
          run={r}
          picked={picked.includes(r.id)}
          onPick={(v) => setPicked((p) => (v ? [...p, r.id].slice(-4) : p.filter((x) => x !== r.id)))}
        />
      ))}
    </div>
  );
}

function RunRow({ run, picked, onPick }: { run: Omit<RunRecord, 'timeline'>; picked: boolean; onPick: (v: boolean) => void }) {
  const passed = run.summary?.verdict === 'passed';
  return (
    <ContextMenuWrap
      items={() => [
        { label: 'Open report', onSelect: () => useTabs.getState().open({ id: uid(), kind: 'loadRun', runId: run.id }) },
        {
          label: 'Delete run',
          icon: <Trash2 className="size-3.5" />,
          danger: true,
          onSelect: () =>
            confirmAction('Delete run', `Delete run ${run.id}?`, async () => {
              await api.remove('loadRuns', run.id);
              useRuns.getState().refresh();
            }),
        },
      ]}
    >
      <div
        onClick={() => useTabs.getState().open({ id: uid(), kind: 'loadRun', runId: run.id })}
        className="group flex h-9 cursor-pointer items-center gap-2 px-3 hover:bg-surface-hover"
      >
        <input
          type="checkbox"
          checked={picked}
          title="Select to compare"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onPick(e.target.checked)}
          className="size-3.5 accent-[var(--accent)]"
        />
        {passed ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : <XCircle className="size-3.5 shrink-0 text-danger" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px]">{run.name}</div>
          <div className="truncate text-[10.5px] text-muted-foreground">
            {relTime(Date.parse(run.startedAt))} · {formatDuration(run.summary?.durationS ?? 0)} · {Math.round(run.summary?.rps ?? 0)} rps
          </div>
        </div>
        <Play className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </div>
    </ContextMenuWrap>
  );
}
