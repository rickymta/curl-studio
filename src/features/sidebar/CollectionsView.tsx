import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  Layers,
  MoreHorizontal,
  Play,
  Plus,
  Settings2,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';

import { cn, ContextMenuWrap, Dropdown, Empty, IconButton, type MenuItem } from '@/components/ui';
import { isFolder, itemProtocol, methodColor, PROTOCOL_LABEL, uid } from '@/lib/postman';
import type { PmItem } from '@/lib/types';
import { useTabs } from '@/stores/tabs';
import { useUi } from '@/stores/ui';
import { createCollection, useWorkspace } from '@/stores/workspace';

import {
  addFolder,
  addItem,
  confirmAction,
  copyAsCurl,
  deleteItem,
  duplicateCollection,
  duplicateItem,
  exportCollectionFile,
  makeItem,
  moveItem,
  type NewKind,
  promptText,
  renameItem,
} from '../actions';
import { scenarioFromCollection } from '../load/scenario';

const NEW_KINDS: { kind: NewKind; label: string }[] = [
  { kind: 'http', label: 'HTTP request' },
  { kind: 'graphql', label: 'GraphQL request' },
  { kind: 'ws', label: 'WebSocket' },
  { kind: 'sse', label: 'Server-Sent Events' },
  { kind: 'grpc', label: 'gRPC' },
  { kind: 'mqtt', label: 'MQTT' },
];

function addMenu(collectionId: string, parentId: string | null): MenuItem[] {
  return [
    ...NEW_KINDS.map((k) => ({
      label: `Add ${k.label}`,
      icon: <Plus className="size-3.5" />,
      onSelect: () => addItem(collectionId, parentId, makeItem(k.kind)),
    })),
    { label: 'Add folder', icon: <FolderPlus className="size-3.5" />, onSelect: () => addFolder(collectionId, parentId) },
  ];
}

function matches(it: PmItem, q: string): boolean {
  if (!q) return true;
  const url = typeof it.request?.url === 'string' ? it.request.url : (it.request?.url?.raw ?? '');
  if (it.name.toLowerCase().includes(q) || url.toLowerCase().includes(q)) return true;
  return (it.item ?? []).some((c) => matches(c, q));
}

const DRAG = 'application/x-curlstudio-item';

function ItemRow({
  collectionId,
  item,
  depth,
  filter,
}: {
  collectionId: string;
  item: PmItem;
  depth: number;
  filter: string;
}) {
  const [open, setOpen] = useState(depth < 1 || !!filter);
  const [over, setOver] = useState<'into' | 'before' | null>(null);
  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === s.active));
  const folder = isFolder(item);
  const active = activeTab?.kind === 'request' && activeTab.itemId === item.id;
  if (!matches(item, filter)) return null;
  const proto = itemProtocol(item);
  const menu = (): MenuItem[] => [
    ...(folder
      ? [
          ...addMenu(collectionId, item.id!),
          'sep' as const,
          {
            label: 'Run folder',
            icon: <Play className="size-3.5" />,
            onSelect: () => useTabs.getState().open({ id: uid(), kind: 'runner', collectionId, folderId: item.id }),
          },
          {
            label: 'Load test folder',
            icon: <Gauge className="size-3.5" />,
            onSelect: () => scenarioFromCollection(collectionId, item.id!),
          },
          {
            label: 'Edit folder',
            icon: <Settings2 className="size-3.5" />,
            onSelect: () => useTabs.getState().open({ id: uid(), kind: 'collection', collectionId, folderId: item.id }),
          },
        ]
      : [
          { label: 'Open', onSelect: () => useTabs.getState().openItem(collectionId, item.id!) },
          { label: 'Copy as cURL', icon: <Terminal className="size-3.5" />, onSelect: () => copyAsCurl(collectionId, item) },
          {
            label: 'Load test this request',
            icon: <Gauge className="size-3.5" />,
            onSelect: () => scenarioFromCollection(collectionId, null, [item.id!]),
            disabled: proto !== 'http' && proto !== 'graphql',
          },
        ]),
    'sep',
    { label: 'Rename', icon: <Edit3 className="size-3.5" />, onSelect: () => renameItem(collectionId, item.id!, item.name) },
    { label: 'Duplicate', icon: <Copy className="size-3.5" />, onSelect: () => duplicateItem(collectionId, item.id!) },
    { label: 'Delete', icon: <Trash2 className="size-3.5" />, danger: true, onSelect: () => deleteItem(collectionId, item.id!, item.name) },
  ];
  const method = (item.request?.method ?? 'GET').toUpperCase();
  return (
    <>
      <ContextMenuWrap items={menu}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG, JSON.stringify({ collectionId, itemId: item.id }));
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG)) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setOver(folder && e.clientY > r.top + r.height * 0.35 ? 'into' : 'before');
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            setOver(null);
            const raw = e.dataTransfer.getData(DRAG);
            if (!raw) return;
            e.preventDefault();
            const src = JSON.parse(raw) as { collectionId: string; itemId: string };
            if (src.itemId === item.id) return;
            const ws = useWorkspace.getState();
            const parent = (() => {
              const c = ws.collections[collectionId];
              if (!c) return null;
              let found: string | null = null;
              const visit = (list: PmItem[], p: string | null) => {
                for (const x of list) {
                  if (x.id === item.id) found = p;
                  if (x.item) visit(x.item, x.id!);
                }
              };
              visit(c.item, null);
              return found;
            })();
            if (over === 'into' && folder) moveItem(src.collectionId, src.itemId, collectionId, { folderId: item.id! });
            else moveItem(src.collectionId, src.itemId, collectionId, { folderId: parent, beforeId: item.id });
          }}
          onClick={() => (folder ? setOpen(!open) : useTabs.getState().openItem(collectionId, item.id!))}
          className={cn(
            'group flex h-7 cursor-pointer items-center gap-1.5 pr-1 text-[12.5px] hover:bg-surface-hover',
            active && 'bg-selection hover:bg-selection',
            over === 'into' && 'outline-1 outline-accent outline-dashed',
            over === 'before' && 'border-t-2 border-accent',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {folder ? (
            <>
              {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
              {open ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
            </>
          ) : proto === 'http' ? (
            <span className={cn('w-11 shrink-0 text-right font-mono text-[10px] font-bold', methodColor(method))}>
              {method.length > 6 ? method.slice(0, 5) : method}
            </span>
          ) : (
            <span className="w-11 shrink-0 text-right font-mono text-[10px] font-bold text-[oklch(0.72_0.12_300)]">
              {PROTOCOL_LABEL[proto]}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          <Dropdown items={menu()}>
            <IconButton label="More" onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100">
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </Dropdown>
        </div>
      </ContextMenuWrap>
      {folder && open && item.item!.map((c) => <ItemRow key={c.id} collectionId={collectionId} item={c} depth={depth + 1} filter={filter} />)}
    </>
  );
}

function CollectionNode({ id, filter }: { id: string; filter: string }) {
  const c = useWorkspace((s) => s.collections[id]);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  if (!c) return null;
  if (filter && !c.info.name.toLowerCase().includes(filter) && !c.item.some((i) => matches(i, filter))) return null;
  const menu = (): MenuItem[] => [
    ...addMenu(id, null),
    'sep',
    { label: 'Run collection', icon: <Play className="size-3.5" />, onSelect: () => useTabs.getState().open({ id: uid(), kind: 'runner', collectionId: id }) },
    { label: 'Load test collection', icon: <Gauge className="size-3.5" />, onSelect: () => scenarioFromCollection(id, null) },
    { label: 'Edit (auth, scripts, variables)', icon: <Settings2 className="size-3.5" />, onSelect: () => useTabs.getState().open({ id: uid(), kind: 'collection', collectionId: id }) },
    'sep',
    {
      label: 'Export',
      icon: <Download className="size-3.5" />,
      items: [
        { label: 'Collection v2.1 (recommended)', onSelect: () => exportCollectionFile(id, '2.1') },
        { label: 'Collection v2.0', onSelect: () => exportCollectionFile(id, '2.0') },
      ],
    },
    {
      label: 'Rename',
      icon: <Edit3 className="size-3.5" />,
      onSelect: () => promptText('Rename collection', 'Name', c.info.name, (n) => useWorkspace.getState().updateCollection(id, (x) => void (x.info.name = n))),
    },
    { label: 'Duplicate', icon: <Copy className="size-3.5" />, onSelect: () => duplicateCollection(id) },
    {
      label: 'Delete',
      icon: <Trash2 className="size-3.5" />,
      danger: true,
      onSelect: () => confirmAction('Delete collection', `Delete "${c.info.name}" and all its requests?`, () => useWorkspace.getState().removeCollection(id)),
    },
  ];
  return (
    <div>
      <ContextMenuWrap items={menu}>
        <div
          onClick={() => setOpen(!open)}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG)) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            setOver(false);
            const raw = e.dataTransfer.getData(DRAG);
            if (!raw) return;
            const src = JSON.parse(raw) as { collectionId: string; itemId: string };
            moveItem(src.collectionId, src.itemId, id, { folderId: null });
            setOpen(true);
          }}
          className={cn('group flex h-8 cursor-pointer items-center gap-1.5 px-2 font-medium hover:bg-surface-hover', over && 'outline-1 outline-accent outline-dashed')}
        >
          {open || filter ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
          <Layers className="size-3.5 text-accent" />
          <span className="min-w-0 flex-1 truncate">{c.info.name}</span>
          <Dropdown items={menu()}>
            <IconButton label="More" onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100">
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </Dropdown>
        </div>
      </ContextMenuWrap>
      {(open || !!filter) && (
        <div>
          {c.item.length === 0 && (
            <div className="py-1 pl-9 text-[12px] text-muted-foreground">
              Empty.{' '}
              <button type="button" className="text-accent hover:underline" onClick={() => addItem(id, null, makeItem('http'))}>
                Add a request
              </button>
            </div>
          )}
          {c.item.map((it) => (
            <ItemRow key={it.id} collectionId={id} item={it} depth={1} filter={filter} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CollectionsView() {
  const order = useWorkspace((s) => s.order);
  const filter = useUi((s) => s.filter).trim().toLowerCase();
  if (!order.length) {
    return (
      <Empty icon={<Layers className="size-8" />} title="No collections yet">
        Create one, or import a Postman collection (v2.0 / v2.1), environment, data dump or a cURL command.
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" className="text-accent hover:underline" onClick={() => promptText('New collection', 'Name', 'My Collection', (n) => createCollection(n))}>
            New collection
          </button>
          <button type="button" className="text-accent hover:underline" onClick={() => useUi.getState().show({ kind: 'import' })}>
            Import
          </button>
        </div>
      </Empty>
    );
  }
  return (
    <div className="py-1">
      {order.map((id) => (
        <CollectionNode key={id} id={id} filter={filter} />
      ))}
    </div>
  );
}
