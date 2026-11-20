/** Workspace actions shared by menus, toolbar and shortcuts. */
import { buildSpec } from '@/lib/build';
import { toCurl } from '@/lib/curl';
import { contextFor } from '@/lib/execute';
import { t } from '@/lib/i18n';
import { copyText, JSON_FILTER, pickTextFiles, saveText } from '@/lib/native';
import {
  clone,
  cloneWithNewIds,
  detectImport,
  exportCollection,
  exportCollectionV20,
  exportEnvironment,
  findItem,
  isFolder,
  newFolder,
  newRequest,
  uid,
} from '@/lib/postman';
import { slug } from '@/lib/format';
import { isCurl, parseCurl } from '@/lib/curl';
import type { PmCollection, PmItem, ProtocolExt } from '@/lib/types';
import { useTabs } from '@/stores/tabs';
import { type Dialog, errText, toast, useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

export type NewKind = 'http' | 'graphql' | 'ws' | 'sse' | 'grpc' | 'mqtt';

export function makeItem(kind: NewKind, name?: string): PmItem {
  switch (kind) {
    case 'graphql': {
      const it = newRequest(name ?? 'GraphQL Request', 'POST', '');
      it.request!.body = { mode: 'graphql', graphql: { query: 'query {\n  \n}', variables: '' } };
      return it;
    }
    case 'ws':
    case 'sse':
    case 'grpc':
    case 'mqtt': {
      const labels = { ws: 'WebSocket', sse: 'SSE Stream', grpc: 'gRPC Request', mqtt: 'MQTT Client' } as const;
      const url = { ws: 'wss://', sse: 'https://', grpc: 'localhost:50051', mqtt: 'mqtt://localhost:1883' }[kind];
      const it = newRequest(name ?? labels[kind], kind === 'grpc' ? 'POST' : 'GET', url);
      const ext: ProtocolExt = { kind };
      if (kind === 'ws') ext.ws = { messages: [] };
      if (kind === 'grpc') ext.grpc = { protoFiles: [], useReflection: true, message: '{}' };
      if (kind === 'mqtt') ext.mqtt = { topics: [{ topic: 'test/#', qos: 0 }], publishTopic: 'test/topic', publishQos: 0, cleanSession: true, keepAlive: 30 };
      it['x-curlstudio'] = ext;
      return it;
    }
    default:
      return newRequest(name ?? t('New Request'));
  }
}

export function newTab(kind: NewKind) {
  useTabs.getState().openDraft(makeItem(kind));
}

/** Insert into a collection (at root or inside folderId) and open it. */
export function addItem(collectionId: string, parentId: string | null, item: PmItem, open = true) {
  useWorkspace.getState().updateCollection(collectionId, (c) => {
    if (parentId) {
      const f = findItem(c.item, parentId);
      if (f && isFolder(f.item)) f.item.item!.push(item);
      else c.item.push(item);
    } else c.item.push(item);
  });
  if (open && !isFolder(item)) useTabs.getState().openItem(collectionId, item.id!);
}

export function promptText(title: string, label: string, value: string, onSubmit: (v: string) => void) {
  useUi.getState().show({ kind: 'prompt', title, label, value, onSubmit });
}

/** Ask before a destructive action. `returnTo` reopens the window the question came from. */
export function confirmAction(title: string, message: string, onConfirm: () => void, danger = true, confirmLabel = t('Delete'), returnTo?: Dialog) {
  useUi.getState().show({ kind: 'confirm', title, message, onConfirm, danger, confirmLabel, returnTo });
}

export function addFolder(collectionId: string, parentId: string | null) {
  promptText(t('New folder'), t('Folder name'), t('New Folder'), (name) => addItem(collectionId, parentId, newFolder(name), false));
}

export function renameItem(collectionId: string, itemId: string, current: string) {
  promptText(t('Rename'), t('Name'), current, (name) =>
    useWorkspace.getState().updateItem(collectionId, itemId, (it) => {
      it.name = name;
    }),
  );
}

export function duplicateItem(collectionId: string, itemId: string) {
  useWorkspace.getState().updateCollection(collectionId, (c) => {
    const f = findItem(c.item, itemId);
    if (!f) return;
    const copy = cloneWithNewIds(f.item);
    copy.name = t('{name} Copy', { name: f.item.name });
    f.siblings.splice(f.index + 1, 0, copy);
  });
}

export function deleteItem(collectionId: string, itemId: string, name: string) {
  confirmAction(t('Delete'), t('Delete "{name}"? This cannot be undone.', { name }), () =>
    useWorkspace.getState().updateCollection(collectionId, (c) => {
      const f = findItem(c.item, itemId);
      if (f) f.siblings.splice(f.index, 1);
    }),
  );
}

/** Move `itemId` into folder/collection root (`targetFolder` null) or before `beforeId`. */
export function moveItem(
  fromCollection: string,
  itemId: string,
  toCollection: string,
  target: { folderId: string | null; beforeId?: string | null },
) {
  const ws = useWorkspace.getState();
  const src = ws.collections[fromCollection];
  const found = src ? findItem(src.item, itemId) : null;
  if (!found) return;
  // No dropping a folder into itself.
  if (target.folderId) {
    const inSelf = findItem([found.item], target.folderId);
    if (inSelf) return;
  }
  const moving = clone(found.item);
  ws.updateCollection(fromCollection, (c) => {
    const f = findItem(c.item, itemId);
    if (f) f.siblings.splice(f.index, 1);
  });
  useWorkspace.getState().updateCollection(toCollection, (c) => {
    let list = c.item;
    if (target.folderId) {
      const f = findItem(c.item, target.folderId);
      if (f?.item.item) list = f.item.item;
    }
    if (target.beforeId) {
      const i = list.findIndex((x) => x.id === target.beforeId);
      if (i >= 0) {
        list.splice(i, 0, moving);
        return;
      }
    }
    list.push(moving);
  });
  // Re-point open tabs.
  if (fromCollection !== toCollection) {
    useTabs.setState((s) => ({
      tabs: s.tabs.map((t) => (t.kind === 'request' && t.itemId === itemId ? { ...t, collectionId: toCollection } : t)),
    }));
  }
}

// ---- import / export ------------------------------------------------------------------------

export function importJsonText(text: string): string[] {
  const out: string[] = [];
  const ws = useWorkspace.getState();
  if (isCurl(text)) {
    const item = parseCurl(text);
    useTabs.getState().openDraft(item);
    return [t('cURL request')];
  }
  const json = JSON.parse(text);
  const d = detectImport(json);
  switch (d.type) {
    case 'collection':
      ws.addCollection(d.collection);
      out.push(t('Collection "{name}"', { name: d.collection.info.name }));
      break;
    case 'environment':
      ws.addEnvironment(d.environment);
      out.push(t('Environment "{name}"', { name: d.environment.name }));
      break;
    case 'globals':
      ws.updateGlobals((g) => {
        for (const v of d.environment.values) {
          const e = g.values.find((x) => x.key === v.key);
          if (e) Object.assign(e, v);
          else g.values.push(v);
        }
      });
      out.push(t('{n} global variables', { n: d.environment.values.length }));
      break;
    case 'dump':
      for (const c of d.collections) ws.addCollection(c);
      for (const e of d.environments) ws.addEnvironment(e);
      out.push(t('{collections} collections, {environments} environments', { collections: d.collections.length, environments: d.environments.length }));
      break;
  }
  return out;
}

export async function importFiles() {
  try {
    const files = await pickTextFiles({
      title: t('Import Postman collections / environments'),
      multiple: true,
      filters: [{ name: t('Postman export'), extensions: ['json', 'postman_collection', 'postman_environment', 'txt', 'sh'] }],
    });
    const done: string[] = [];
    for (const f of files) {
      try {
        done.push(...importJsonText(f.text));
      } catch (e) {
        toast('error', `${f.name}: ${errText(e)}`);
      }
    }
    if (done.length) toast('success', t('Imported {list}', { list: done.join(', ') }));
  } catch (e) {
    toast('error', errText(e));
  }
}

export async function exportCollectionFile(id: string, version: '2.1' | '2.0' = '2.1') {
  const c = useWorkspace.getState().collections[id];
  if (!c) return;
  const data = version === '2.1' ? exportCollection(c) : exportCollectionV20(c);
  const ok = await saveText(`${slug(c.info.name)}.postman_collection.json`, JSON.stringify(data, null, '\t'), JSON_FILTER);
  if (ok) toast('success', t('Exported "{name}" (Postman v{version})', { name: c.info.name, version }));
}

export async function exportEnvironmentFile(id: string) {
  const ws = useWorkspace.getState();
  const env = id === 'globals' ? ws.globals : ws.environments[id];
  if (!env) return;
  const data = exportEnvironment(env, id === 'globals' ? 'globals' : 'environment');
  const name = id === 'globals' ? 'workspace.postman_globals.json' : `${slug(env.name)}.postman_environment.json`;
  const ok = await saveText(name, JSON.stringify(data, null, '\t'), JSON_FILTER);
  if (ok) toast('success', t('Exported "{name}"', { name: env.name }));
}

/** Postman-style full data dump (collections + environments + globals). */
export async function exportEverything() {
  const ws = useWorkspace.getState();
  const dump = {
    version: 1,
    collections: ws.order.map((id) => exportCollection(ws.collections[id]!)),
    environments: Object.values(ws.environments).map((e) => exportEnvironment(e)),
    globals: exportEnvironment(ws.globals, 'globals').values,
  };
  const ok = await saveText('curlstudio-backup.postman_dump.json', JSON.stringify(dump, null, '\t'), JSON_FILTER);
  if (ok) toast('success', t('Workspace exported'));
}

export function duplicateCollection(id: string) {
  const c = useWorkspace.getState().collections[id];
  if (!c) return;
  const copy: PmCollection = clone(c);
  copy.info._postman_id = uid();
  copy.info.name = t('{name} Copy', { name: c.info.name });
  copy.item = copy.item.map(cloneWithNewIds);
  useWorkspace.getState().addCollection(copy);
}

export async function copyAsCurl(collectionId: string | null, item: PmItem) {
  const ctx = contextFor(collectionId, item.id ?? null);
  const { spec } = buildSpec(item.request ?? {}, {
    collection: ctx.collection,
    parents: ctx.parents,
    scopes: ctx.scopes,
    settings: ctx.settings,
    behavior: item.protocolProfileBehavior,
  });
  await copyText(toCurl(spec));
  toast('success', t('cURL copied to clipboard'));
}
