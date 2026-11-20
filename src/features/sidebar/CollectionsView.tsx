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
import { useEffect, useState } from 'react';

import { cn, ContextMenuWrap, Dropdown, Empty, IconButton, type MenuItem } from '@/components/ui';
import { t } from '@/lib/i18n';
import { findItem, isFolder, itemProtocol, methodColor, PROTOCOL_LABEL, uid } from '@/lib/postman';
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
      label: t('Add {kind}', { kind: t(k.label) }),
      icon: <Plus className="size-3.5" />,
      onSelect: () => addItem(collectionId, parentId, makeItem(k.kind)),
    })),
    {
      label: t('Add folder'),
      icon: <FolderPlus className="size-3.5" />,
      onSelect: () => addFolder(collectionId, parentId),
    },
  ];
}

function matches(it: PmItem, q: string): boolean {
  if (!q) return true;
  const url = typeof it.request?.url === 'string' ? it.request.url : (it.request?.url?.raw ?? '');
  if (it.name.toLowerCase().includes(q) || url.toLowerCase().includes(q)) return true;
  return (it.item ?? []).some((c) => matches(c, q));
}

const DRAG = 'application/x-curlstudio-item';

/** Name with the search match marked. */
function Hl({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-warning/30 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** "+" shown on hover: same choices as the context menu's add entries. */
function QuickAdd({
  collectionId,
  parentId,
  onAdded,
}: {
  collectionId: string;
  parentId: string | null;
  onAdded: () => void;
}) {
  const items = addMenu(collectionId, parentId).map((m) =>
    m === 'sep'
      ? m
      : {
          ...m,
          onSelect: () => {
            m.onSelect?.();
            onAdded();
          },
        },
  );
  return (
    <Dropdown items={items}>
      <IconButton
        label={t('Add request or folder')}
        onClick={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Plus className="size-3.5" />
      </IconButton>
    </Dropdown>
  );
}

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
  const open = useUi((s) => !!s.expanded[item.id ?? '']);
  const setOpen = (v: boolean) => item.id && useUi.getState().setExpanded(item.id, v);
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
            label: t('Run folder'),
            icon: <Play className="size-3.5" />,
            onSelect: () =>
              useTabs
                .getState()
                .open({ id: uid(), kind: 'runner', collectionId, folderId: item.id }),
          },
          {
            label: t('Load test folder'),
            icon: <Gauge className="size-3.5" />,
            onSelect: () => scenarioFromCollection(collectionId, item.id!),
          },
          {
            label: t('Edit folder'),
            icon: <Settings2 className="size-3.5" />,
            onSelect: () =>
              useTabs
                .getState()
                .open({ id: uid(), kind: 'collection', collectionId, folderId: item.id }),
          },
        ]
      : [
          { label: t('Open'), onSelect: () => useTabs.getState().openItem(collectionId, item.id!) },
          {
            label: t('Copy as cURL'),
            icon: <Terminal className="size-3.5" />,
            onSelect: () => copyAsCurl(collectionId, item),
          },
          {
            label: t('Load test this request'),
            icon: <Gauge className="size-3.5" />,
            onSelect: () => scenarioFromCollection(collectionId, null, [item.id!]),
            disabled: proto !== 'http' && proto !== 'graphql',
          },
        ]),
    'sep',
    {
      label: t('Rename'),
      icon: <Edit3 className="size-3.5" />,
      onSelect: () => renameItem(collectionId, item.id!, item.name),
    },
    {
      label: t('Duplicate'),
      icon: <Copy className="size-3.5" />,
      onSelect: () => duplicateItem(collectionId, item.id!),
    },
    {
      label: t('Delete'),
      icon: <Trash2 className="size-3.5" />,
      danger: true,
      onSelect: () => deleteItem(collectionId, item.id!, item.name),
    },
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
            if (over === 'into' && folder)
              moveItem(src.collectionId, src.itemId, collectionId, { folderId: item.id! });
            else
              moveItem(src.collectionId, src.itemId, collectionId, {
                folderId: parent,
                beforeId: item.id,
              });
          }}
          onClick={() =>
            folder ? setOpen(!open) : useTabs.getState().openItem(collectionId, item.id!)
          }
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={folder ? open || !!filter : undefined}
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          data-tree-row
          data-item-id={item.id}
          data-depth={depth}
          className={cn(
            'group flex h-7 cursor-pointer items-center gap-1.5 pr-1 text-[12.5px] outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset',
            active && 'bg-selection hover:bg-selection',
            over === 'into' && 'outline-1 outline-accent outline-dashed',
            over === 'before' && 'border-t-2 border-accent',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {folder ? (
            <>
              {open || filter ? (
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              {open ? (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </>
          ) : proto === 'http' ? (
            <span
              className={cn(
                'w-11 shrink-0 text-right font-mono text-[10px] font-bold',
                methodColor(method),
              )}
            >
              {method.length > 6 ? method.slice(0, 5) : method}
            </span>
          ) : (
            <span className="w-11 shrink-0 text-right font-mono text-[10px] font-bold text-[oklch(0.72_0.12_300)]">
              {PROTOCOL_LABEL[proto]}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate" title={item.name}>
            <Hl text={item.name} q={filter} />
          </span>
          {folder && (
            <QuickAdd
              collectionId={collectionId}
              parentId={item.id!}
              onAdded={() => setOpen(true)}
            />
          )}
          <Dropdown items={menu()}>
            <IconButton
              label={t('More')}
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </Dropdown>
        </div>
      </ContextMenuWrap>
      {folder &&
        (open || !!filter) &&
        item.item!.map((c) => (
          <ItemRow
            key={c.id}
            collectionId={collectionId}
            item={c}
            depth={depth + 1}
            filter={filter && item.name.toLowerCase().includes(filter) ? '' : filter}
          />
        ))}
    </>
  );
}

function CollectionNode({ id, filter }: { id: string; filter: string }) {
  const c = useWorkspace((s) => s.collections[id]);
  const open = useUi((s) => !!s.expanded[id]);
  const setOpen = (v: boolean) => useUi.getState().setExpanded(id, v);
  const [over, setOver] = useState(false);
  if (!c) return null;
  if (
    filter &&
    !c.info.name.toLowerCase().includes(filter) &&
    !c.item.some((i) => matches(i, filter))
  )
    return null;
  const menu = (): MenuItem[] => [
    ...addMenu(id, null),
    'sep',
    {
      label: t('Run collection'),
      icon: <Play className="size-3.5" />,
      onSelect: () => useTabs.getState().open({ id: uid(), kind: 'runner', collectionId: id }),
    },
    {
      label: t('Load test collection'),
      icon: <Gauge className="size-3.5" />,
      onSelect: () => scenarioFromCollection(id, null),
    },
    {
      label: t('Edit (auth, scripts, variables)'),
      icon: <Settings2 className="size-3.5" />,
      onSelect: () => useTabs.getState().open({ id: uid(), kind: 'collection', collectionId: id }),
    },
    'sep',
    {
      label: t('Export'),
      icon: <Download className="size-3.5" />,
      items: [
        {
          label: t('Collection v2.1 (recommended)'),
          onSelect: () => exportCollectionFile(id, '2.1'),
        },
        { label: t('Collection v2.0'), onSelect: () => exportCollectionFile(id, '2.0') },
      ],
    },
    {
      label: t('Rename'),
      icon: <Edit3 className="size-3.5" />,
      onSelect: () =>
        promptText(t('Rename collection'), t('Name'), c.info.name, (n) =>
          useWorkspace.getState().updateCollection(id, (x) => void (x.info.name = n)),
        ),
    },
    {
      label: t('Duplicate'),
      icon: <Copy className="size-3.5" />,
      onSelect: () => duplicateCollection(id),
    },
    {
      label: t('Delete'),
      icon: <Trash2 className="size-3.5" />,
      danger: true,
      onSelect: () =>
        confirmAction(
          t('Delete collection'),
          t('Delete "{name}" and all its requests?', { name: c.info.name }),
          () => useWorkspace.getState().removeCollection(id),
        ),
    },
  ];
  return (
    <div>
      <ContextMenuWrap items={menu}>
        <div
          onClick={() => setOpen(!open)}
          role="treeitem"
          aria-level={1}
          aria-expanded={open || !!filter}
          tabIndex={-1}
          data-tree-row
          data-item-id={id}
          data-depth={0}
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
          className={cn(
            'group flex h-8 cursor-pointer items-center gap-1.5 px-2 font-medium outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset',
            over && 'outline-1 outline-accent outline-dashed',
          )}
        >
          {open || filter ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
          <Layers className="size-3.5 text-accent" />
          <span className="min-w-0 flex-1 truncate" title={c.info.name}>
            <Hl text={c.info.name} q={filter} />
          </span>
          <QuickAdd collectionId={id} parentId={null} onAdded={() => setOpen(true)} />
          <Dropdown items={menu()}>
            <IconButton
              label={t('More')}
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </Dropdown>
        </div>
      </ContextMenuWrap>
      {(open || !!filter) && (
        <div>
          {c.item.length === 0 && (
            <div className="py-1 pl-9 text-[12px] text-muted-foreground">
              {t('Empty.')}{' '}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => addItem(id, null, makeItem('http'))}
              >
                {t('Add a request')}
              </button>
            </div>
          )}
          {c.item.map((it) => (
            <ItemRow
              key={it.id}
              collectionId={id}
              item={it}
              depth={1}
              filter={filter && c.info.name.toLowerCase().includes(filter) ? '' : filter}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function collectionMatches(id: string, q: string): boolean {
  const c = useWorkspace.getState().collections[id];
  return !!c && (c.info.name.toLowerCase().includes(q) || c.item.some((i) => matches(i, q)));
}

/** Expand the collection and folders above an item and scroll it into view. */
export function revealItem(collectionId: string, itemId: string, explicit = false) {
  const c = useWorkspace.getState().collections[collectionId];
  const f = c ? findItem(c.item, itemId) : null;
  if (!f) return;
  const ui = useUi.getState();
  // Only an explicit “Reveal in sidebar” switches the sidebar to Collections.
  if (explicit && ui.sidebar !== 'collections') ui.setSidebar('collections');
  if (explicit && ui.sidebarHidden) ui.toggleSidebar();
  ui.setExpanded(collectionId, true);
  for (const p of f.parents) if (p.id) ui.setExpanded(p.id, true);
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(`[data-tree-row][data-item-id="${itemId}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    if (explicit) row?.focus();
  });
}

/** Arrow keys move between rows, Right/Left expand/collapse, Enter opens (WAI-ARIA tree). */
function onTreeKey(e: React.KeyboardEvent<HTMLDivElement>) {
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-tree-row]'));
  const cur = document.activeElement as HTMLElement | null;
  const i = cur ? rows.indexOf(cur) : -1;
  const go = (j: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
    if (r) {
      e.preventDefault();
      r.focus();
      r.scrollIntoView({ block: 'nearest' });
    }
  };
  if (e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowUp') go(i < 0 ? 0 : i - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(rows.length - 1);
  else if (!cur || i < 0) return;
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    cur.click();
  } else if (e.key === 'ArrowRight') {
    if (cur.getAttribute('aria-expanded') === 'false') {
      e.preventDefault();
      cur.click();
    } else if (cur.getAttribute('aria-expanded') === 'true') go(i + 1);
  } else if (e.key === 'ArrowLeft') {
    if (cur.getAttribute('aria-expanded') === 'true') {
      e.preventDefault();
      cur.click();
    } else {
      // Jump to the parent row.
      const depth = Number(cur.dataset.depth ?? 0);
      for (let j = i - 1; j >= 0; j--) {
        if (Number(rows[j]!.dataset.depth ?? 0) < depth) return go(j);
      }
    }
  }
}

export function CollectionsView() {
  // Follow the active request tab in the tree (expand its folders, scroll to it).
  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === s.active));
  const revealKey =
    activeTab?.kind === 'request' && activeTab.collectionId && activeTab.itemId
      ? `${activeTab.collectionId}/${activeTab.itemId}`
      : null;
  useEffect(() => {
    if (!revealKey) return;
    const [cid, iid] = revealKey.split('/') as [string, string];
    revealItem(cid, iid);
  }, [revealKey]);
  useWorkspace((s) => s.collections);
  const order = useWorkspace((s) => s.order);
  const filter = useUi((s) => s.filter)
    .trim()
    .toLowerCase();
  if (!order.length) {
    return (
      <Empty icon={<Layers className="size-8" />} title={t('No collections yet')}>
        {t(
          'Create one, or import a Postman collection (v2.0 / v2.1), environment, data dump or a cURL command.',
        )}
        <div className="mt-3 flex justify-center gap-2">
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() =>
              promptText(t('New collection'), t('Name'), t('My Collection'), (n) =>
                createCollection(n),
              )
            }
          >
            {t('New collection')}
          </button>
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => useUi.getState().show({ kind: 'import' })}
          >
            {t('Import')}
          </button>
        </div>
      </Empty>
    );
  }
  return (
    <div className="py-1" role="tree" aria-label={t('Collections')} onKeyDown={onTreeKey}>
      {order.map((id) => (
        <CollectionNode key={id} id={id} filter={filter} />
      ))}
      {filter && !order.some((id) => collectionMatches(id, filter)) && (
        <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
          {t('No requests or folders match “{filter}”.', { filter })}
        </div>
      )}
    </div>
  );
}
