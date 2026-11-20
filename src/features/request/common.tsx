import { Code2, Save } from 'lucide-react';
import { useMemo } from 'react';

import { Badge, Button, cn, IconButton } from '@/components/ui';
import { contextFor } from '@/lib/execute';
import { t } from '@/lib/i18n';
import { findItem, PROTOCOL_LABEL, itemProtocol } from '@/lib/postman';
import type { PmItem } from '@/lib/types';
import { flatten } from '@/lib/vars';
import { type Tab, useTabs } from '@/stores/tabs';
import { toast, useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

export type RequestTabT = Extract<Tab, { kind: 'request' }>;

/** Names of every variable that resolves to a non-empty value for this request (for highlighting: green, the rest red). */
export function useKnownVars(collectionId: string | null): Set<string> {
  const collections = useWorkspace((s) => s.collections);
  const environments = useWorkspace((s) => s.environments);
  const globals = useWorkspace((s) => s.globals);
  const activeEnv = useWorkspace((s) => s.activeEnv);
  return useMemo(() => {
    const ctx = contextFor(collectionId, null);
    return new Set(
      Object.entries(flatten(ctx.scopes))
        .filter(([, v]) => v !== '')
        .map(([k]) => k),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, collections, environments, globals, activeEnv]);
}

export function saveTab(tab: RequestTabT) {
  if (!tab.collectionId || !tab.itemId) {
    useUi.getState().show({ kind: 'saveAs', tabId: tab.id });
    return;
  }
  const ws = useWorkspace.getState();
  const c = ws.collections[tab.collectionId];
  if (!c || !findItem(c.item, tab.itemId)) {
    useUi.getState().show({ kind: 'saveAs', tabId: tab.id });
    return;
  }
  ws.updateItem(tab.collectionId, tab.itemId, (it) => {
    const id = it.id;
    for (const k of Object.keys(it)) delete (it as unknown as Record<string, unknown>)[k];
    Object.assign(it, JSON.parse(JSON.stringify(tab.draft)), { id });
  });
  useTabs.getState().markSaved(tab.id, tab.collectionId, tab.itemId);
  toast('success', t('Saved'));
}

export function RequestHeader({ tab, extra }: { tab: RequestTabT; extra?: React.ReactNode }) {
  const c = useWorkspace((s) => (tab.collectionId ? s.collections[tab.collectionId] : null));
  const path = useMemo(() => {
    if (!c || !tab.itemId) return [] as string[];
    const f = findItem(c.item, tab.itemId);
    return [c.info.name, ...(f?.parents.map((p) => p.name) ?? [])];
  }, [c, tab.itemId]);
  const proto = itemProtocol(tab.draft);
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <Badge tone="accent">{PROTOCOL_LABEL[proto]}</Badge>
      <div className="flex min-w-0 items-center gap-1 text-[12.5px]">
        {path.map((p, i) => (
          <span key={i} className="truncate text-muted-foreground">
            {p} /
          </span>
        ))}
        <input
          value={tab.draft.name}
          onChange={(e) => useTabs.getState().updateDraft(tab.id, (d: PmItem) => void (d.name = e.target.value))}
          className="min-w-24 rounded px-1 font-medium outline-none hover:bg-surface-hover focus:bg-surface-hover"
          style={{ width: `${Math.max(8, tab.draft.name.length + 2)}ch` }}
        />
        {!tab.collectionId && <Badge>{t('Unsaved')}</Badge>}
      </div>
      <div className="flex-1" />
      {extra}
      {(proto === 'http' || proto === 'graphql') && (
        <IconButton label={t('Code snippet / cURL')} onClick={() => useUi.getState().show({ kind: 'code', tabId: tab.id })}>
          <Code2 className="size-4" />
        </IconButton>
      )}
      <Button size="sm" onClick={() => saveTab(tab)} className={cn(tab.dirty && 'border-accent text-accent')}>
        <Save className="size-3.5" /> {t('Save')}
      </Button>
    </div>
  );
}
