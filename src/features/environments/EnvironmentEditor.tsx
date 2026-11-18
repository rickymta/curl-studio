import { Download, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button, cn, Empty, IconButton, Tabs } from '@/components/ui';
import { CodeEditor } from '@/components/CodeEditor';
import { KeyValueTable } from '@/components/KeyValueTable';
import { scriptOf, setScript } from '@/lib/postman';
import type { PmEnvValue, PmKV } from '@/lib/types';
import { useWorkspace } from '@/stores/workspace';

import { exportEnvironmentFile } from '../actions';
import { AuthEditor } from '../request/AuthEditor';
import { ScriptEditor } from '../request/ScriptEditor';

export function EnvironmentEditor({ envId }: { envId: string }) {
  const env = useWorkspace((s) => (envId === 'globals' ? s.globals : s.environments[envId]));
  const active = useWorkspace((s) => s.activeEnv === envId);
  const [show, setShow] = useState<Record<number, boolean>>({});
  const [q, setQ] = useState('');
  if (!env) return <Empty title="Environment not found" />;
  const update = (fn: (values: PmEnvValue[]) => PmEnvValue[]) => {
    if (envId === 'globals') useWorkspace.getState().updateGlobals((g) => void (g.values = fn(g.values)));
    else useWorkspace.getState().updateEnvironment(envId, (e) => void (e.values = fn(e.values)));
  };
  const rows = [...env.values, null];
  const cell = 'h-8 border-b border-r border-border';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        {envId === 'globals' ? (
          <h2 className="text-[15px] font-semibold">Globals</h2>
        ) : (
          <input
            value={env.name}
            onChange={(e) => useWorkspace.getState().updateEnvironment(envId, (x) => void (x.name = e.target.value))}
            className="rounded px-1 text-[15px] font-semibold outline-none hover:bg-surface-hover focus:bg-surface-hover"
          />
        )}
        {envId !== 'globals' && (
          <Button size="sm" variant={active ? 'primary' : 'default'} onClick={() => useWorkspace.getState().setActiveEnv(active ? null : envId)}>
            {active ? 'Active' : 'Set active'}
          </Button>
        )}
        <div className="flex-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter variables" className="h-7 w-48 rounded-md border border-border bg-background px-2 text-[12px] outline-none" />
        <Button size="sm" onClick={() => exportEnvironmentFile(envId)}>
          <Download className="size-3.5" /> Export
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full table-fixed border-collapse text-[12.5px]">
            <colgroup>
              <col className="w-8" />
              <col className="w-[30%]" />
              <col className="w-24" />
              <col />
              <col className="w-16" />
            </colgroup>
            <thead>
              <tr className="bg-surface-muted text-left text-[11px] text-muted-foreground">
                <th className={cell} />
                <th className={cn(cell, 'px-2 font-medium')}>Variable</th>
                <th className={cn(cell, 'px-2 font-medium')}>Type</th>
                <th className={cn(cell, 'px-2 font-medium')}>Value</th>
                <th className={cn(cell, 'border-r-0')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => {
                if (v && q && !v.key.toLowerCase().includes(q.toLowerCase())) return null;
                const ghost = v === null;
                const row = v ?? { key: '', value: '', type: 'default', enabled: true };
                const secret = row.type === 'secret' && !show[i];
                const set = (patch: Partial<PmEnvValue>) =>
                  ghost ? update((vals) => [...vals, { key: '', value: '', type: 'default', enabled: true, ...patch }]) : update((vals) => vals.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={i} className={cn('group', row.enabled === false && 'opacity-50')}>
                    <td className={cn(cell, 'text-center')}>
                      {!ghost && <input type="checkbox" checked={row.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} className="accent-[var(--accent)]" />}
                    </td>
                    <td className={cell}>
                      <input value={row.key} placeholder={ghost ? 'Add new variable' : ''} onChange={(e) => set({ key: e.target.value })} className="h-full w-full bg-transparent px-2 font-mono outline-none" />
                    </td>
                    <td className={cell}>
                      <select value={row.type ?? 'default'} onChange={(e) => set({ type: e.target.value })} className="h-full w-full bg-transparent px-1 text-[12px] outline-none">
                        <option value="default">default</option>
                        <option value="secret">secret</option>
                      </select>
                    </td>
                    <td className={cell}>
                      <div className="flex h-full items-center">
                        <input type={secret ? 'password' : 'text'} value={row.value} onChange={(e) => set({ value: e.target.value })} className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono outline-none" />
                        {row.type === 'secret' && !ghost && (
                          <IconButton label={show[i] ? 'Hide' : 'Show'} onClick={() => setShow({ ...show, [i]: !show[i] })}>
                            {show[i] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                          </IconButton>
                        )}
                      </div>
                    </td>
                    <td className={cn(cell, 'border-r-0 text-center')}>
                      {!ghost && (
                        <IconButton label="Delete" onClick={() => update((vals) => vals.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100">
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Use as <code>{'{{variable}}'}</code> in URLs, headers, bodies and auth. Scripts can change them with <code>pm.environment.set()</code>. Exported files use the Postman environment format.
        </p>
      </div>
    </div>
  );
}

export function CollectionSettings({ collectionId, folderId }: { collectionId: string; folderId?: string }) {
  const c = useWorkspace((s) => s.collections[collectionId]);
  const [section, setSection] = useState<'overview' | 'auth' | 'pre' | 'tests' | 'variables'>('overview');
  if (!c) return <Empty title="Collection not found" />;
  const ws = useWorkspace.getState();
  const folder = folderId ? (() => {
    const stack = [...c.item];
    while (stack.length) {
      const it = stack.pop()!;
      if (it.id === folderId) return it;
      if (it.item) stack.push(...it.item);
    }
    return null;
  })() : null;
  if (folderId && !folder) return <Empty title="Folder not found" />;
  const target = folder ?? c;
  const name = folder ? folder.name : c.info.name;
  const desc = folder ? folder.description : c.info.description;
  const descText = typeof desc === 'string' ? desc : (desc?.content ?? '');
  const mutate = (fn: (t: typeof target) => void) =>
    ws.updateCollection(collectionId, (col) => {
      if (!folderId) return fn(col);
      const stack = [...col.item];
      while (stack.length) {
        const it = stack.pop()!;
        if (it.id === folderId) return fn(it);
        if (it.item) stack.push(...it.item);
      }
    });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <input
          value={name}
          onChange={(e) => mutate((t) => void ('info' in t ? (t.info.name = e.target.value) : ((t as { name: string }).name = e.target.value)))}
          className="rounded px-1 text-[15px] font-semibold outline-none hover:bg-surface-hover focus:bg-surface-hover"
        />
        <span className="text-[12px] text-muted-foreground">{folder ? 'Folder' : 'Collection'} settings</span>
      </div>
      <Tabs
        value={section}
        onChange={setSection}
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'auth', label: 'Authorization' },
          { id: 'pre', label: 'Pre-request Script' },
          { id: 'tests', label: 'Tests' },
          ...(folder ? [] : [{ id: 'variables' as const, label: 'Variables', badge: c.variable?.length || undefined }]),
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'overview' && (
          <div className="flex h-full flex-col p-3">
            <div className="mb-1 text-[12px] text-muted-foreground">Description (Markdown)</div>
            <CodeEditor
              value={descText}
              onChange={(v) => mutate((t) => void ('info' in t ? (t.info.description = v) : ((t as { description?: string }).description = v)))}
              className="min-h-0 flex-1 rounded-md border border-border"
              wrap
              lineNumbers={false}
            />
          </div>
        )}
        {section === 'auth' && (
          <AuthEditor
            auth={target.auth}
            allowInherit={!!folder}
            onChange={(a) =>
              mutate((t) => {
                if (a === undefined) delete t.auth;
                else t.auth = a;
              })
            }
          />
        )}
        {section === 'pre' && <ScriptEditor listen="prerequest" value={scriptOf(target.event, 'prerequest')} onChange={(v) => mutate((t) => void (t.event = setScript(t.event, 'prerequest', v)))} />}
        {section === 'tests' && <ScriptEditor listen="test" value={scriptOf(target.event, 'test')} onChange={(v) => mutate((t) => void (t.event = setScript(t.event, 'test', v)))} />}
        {section === 'variables' && !folder && (
          <KeyValueTable rows={c.variable ?? []} onChange={(rows: PmKV[]) => ws.updateCollection(collectionId, (col) => void (col.variable = rows))} keyPlaceholder="Variable" valuePlaceholder="Value" />
        )}
      </div>
    </div>
  );
}
