import { FileUp, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useVarCollection } from '@/features/request/varScope';
import { pickFiles } from '@/lib/native';
import type { PmFormParam, PmKV } from '@/lib/types';

import { cn, IconButton } from './ui';
import { type VarHover, VarPopover } from './VarPopover';

/** Single-line input that highlights `{{variables}}` (green = known, red = unknown). */
export function VarInput({
  value,
  onChange,
  placeholder,
  className,
  known,
  onKeyDown,
  onPaste,
  autoFocus,
  mono = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  known?: Set<string> | null;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onPaste?: React.ClipboardEventHandler<HTMLInputElement>;
  autoFocus?: boolean;
  mono?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const collectionId = useVarCollection();
  const [hover, setHover] = useState<VarHover | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );
  const keep = () => clearTimeout(hideTimer.current);
  const leave = () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      // Keep the card while its field is being edited.
      if (document.activeElement?.closest('[data-var-popover]')) return;
      setHover(null);
    }, 250);
  };
  /** Which `{{var}}` span (if any) is under the pointer. */
  const onMove = (e: React.MouseEvent) => {
    const spans = mirror.current?.querySelectorAll<HTMLElement>('[data-var]') ?? [];
    for (const el of spans) {
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) {
        keep();
        const name = el.dataset.var!;
        if (hover?.name === name) return;
        clearTimeout(showTimer.current);
        showTimer.current = setTimeout(() => setHover({ name, rect: { left: r.left, top: r.top, bottom: r.bottom } }), hover ? 0 : 300);
        return;
      }
    }
    clearTimeout(showTimer.current);
    if (hover) leave();
  };
  const sync = () => {
    if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft;
  };
  useLayoutEffect(sync, [value]);
  const parts = value.split(/(\{\{[^{}]+\}\})/g);
  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <div
        ref={mirror}
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 overflow-hidden px-2 leading-[inherit] whitespace-pre',
          mono && 'font-mono text-[12.5px]',
        )}
        style={{ lineHeight: 'inherit', display: 'flex', alignItems: 'center' }}
      >
        <span>
          {parts.map((p, i) => {
            if (!/^\{\{[^{}]+\}\}$/.test(p)) return <span key={i}>{p}</span>;
            const name = p.slice(2, -2).trim();
            const ok = !known || name.startsWith('$') || known.has(name);
            return (
              <span key={i} data-var={name} className={ok ? 'text-accent' : 'rounded-sm text-danger outline-1 -outline-offset-1 outline-danger/60'}>
                {p}
              </span>
            );
          })}
        </span>
      </div>
      <input
        ref={input}
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
        onKeyUp={sync}
        onMouseMove={onMove}
        onMouseLeave={leave}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className={cn(
          'relative h-full w-full bg-transparent px-2 text-transparent caret-[var(--foreground)] outline-none placeholder:text-muted-foreground selection:bg-selection selection:text-foreground',
          mono && 'font-mono text-[12.5px]',
        )}
      />
      {hover && <VarPopover key={hover.name} hover={hover} collectionId={collectionId} onEnter={keep} onLeave={leave} onClose={() => setHover(null)} />}
    </div>
  );
}

type Row = PmKV & Partial<PmFormParam>;

type ColKey = 'key' | 'type' | 'desc';
const COLS_KEY = 'curlstudio.kvColumns';
const DEFAULT_COLS: Record<ColKey, number> = { key: 30, type: 9, desc: 24 };

function loadCols(): Record<ColKey, number> {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') as Partial<Record<ColKey, number>> | null;
    return { ...DEFAULT_COLS, ...(v ?? {}) };
  } catch {
    return DEFAULT_COLS;
  }
}

/** Drag handle on a header cell's right edge; widths are % of the table, shared by every table. */
function ColResizer({ col, widths, setWidths, invert = false }: { col: ColKey; widths: Record<ColKey, number>; setWidths: (w: Record<ColKey, number>) => void; invert?: boolean }) {
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const table = (e.currentTarget as HTMLElement).closest('table');
    if (!table) return;
    const total = table.getBoundingClientRect().width;
    const x0 = e.clientX;
    const w0 = widths[col];
    let last = widths;
    const move = (ev: PointerEvent) => {
      const d = ((ev.clientX - x0) / total) * 100 * (invert ? -1 : 1);
      last = { ...widths, [col]: Math.min(60, Math.max(6, w0 + d)) };
      setWidths(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      try {
        localStorage.setItem(COLS_KEY, JSON.stringify(last));
      } catch {
        /* not persisted */
      }
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={onDown}
      onDoubleClick={() => {
        const next = { ...widths, [col]: DEFAULT_COLS[col] };
        setWidths(next);
        localStorage.setItem(COLS_KEY, JSON.stringify(next));
      }}
      className={cn('absolute top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/60', invert ? '-left-[3px]' : '-right-[3px]')}
    />
  );
}

export function KeyValueTable({
  rows,
  onChange,
  known,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  files = false,
  description = true,
  readOnlyKeys = false,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  known?: Set<string> | null;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  files?: boolean;
  description?: boolean;
  readOnlyKeys?: boolean;
}) {
  const [bulk, setBulk] = useState(false);
  const [widths, setWidths] = useState(loadCols);
  const [bulkText, setBulkText] = useState('');
  const update = (i: number, patch: Partial<Row>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const add = (patch: Partial<Row>) => onChange([...rows, { key: '', value: '', ...patch }]);
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const desc = (r: Row) => (typeof r.description === 'string' ? r.description : (r.description?.content ?? ''));

  const toBulk = () => {
    setBulkText(rows.map((r) => `${r.disabled ? '//' : ''}${r.key}:${r.value ?? ''}`).join('\n'));
    setBulk(true);
  };
  const fromBulk = () => {
    const next: Row[] = bulkText
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const disabled = l.startsWith('//');
        const line = disabled ? l.slice(2) : l;
        const i = line.indexOf(':');
        return i < 0 ? { key: line.trim(), value: '', disabled } : { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim(), disabled };
      });
    onChange(next);
    setBulk(false);
  };

  if (bulk) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={Math.max(6, rows.length + 2)}
          spellCheck={false}
          className="selectable w-full rounded-md border border-border bg-background p-2 font-mono text-[12.5px] outline-none focus:border-accent"
          placeholder="key:value — one per line, prefix with // to disable"
        />
        <div className="flex justify-end">
          <button type="button" onClick={fromBulk} className="text-[12px] text-accent hover:underline">
            Key-Value Edit
          </button>
        </div>
      </div>
    );
  }

  const cell = 'h-8 border-b border-r border-border';
  return (
    <div className="p-2">
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full table-fixed border-collapse text-[12.5px]">
          <colgroup>
            <col className="w-8" />
            <col style={{ width: `${widths.key}%` }} />
            {files && <col style={{ width: `${widths.type}%` }} />}
            <col />
            {description && <col style={{ width: `${widths.desc}%` }} />}
            <col className="w-8" />
          </colgroup>
          <thead>
            <tr className="bg-surface-muted text-left text-[11px] text-muted-foreground">
              <th className={cell} />
              <th className={cn(cell, 'relative px-2 font-medium')}>
                {keyPlaceholder}
                <ColResizer col="key" widths={widths} setWidths={setWidths} />
              </th>
              {files && (
                <th className={cn(cell, 'relative px-2 font-medium')}>
                  Type
                  <ColResizer col="type" widths={widths} setWidths={setWidths} />
                </th>
              )}
              <th className={cn(cell, 'relative px-2 font-medium')}>{valuePlaceholder}</th>
              {description && (
                <th className={cn(cell, 'relative px-2 font-medium')}>
                  <ColResizer col="desc" widths={widths} setWidths={setWidths} invert />
                  Description
                </th>
              )}
              <th className={cn(cell, 'border-r-0')}>
                <button type="button" onClick={toBulk} className="px-1 text-[10px] text-accent hover:underline" title="Bulk edit">
                  Bulk
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows, null].map((r, i) => {
              const ghost = r === null;
              const row = r ?? { key: '', value: '' };
              const isFile = row.type === 'file';
              const srcs = Array.isArray(row.src) ? row.src : row.src ? [row.src] : [];
              return (
                <tr key={i} className={cn('group', row.disabled && 'opacity-50')}>
                  <td className={cn(cell, 'text-center')}>
                    {!ghost && (
                      <input
                        type="checkbox"
                        checked={!row.disabled}
                        onChange={(e) => update(i, { disabled: !e.target.checked })}
                        className="size-3.5 accent-[var(--accent)]"
                      />
                    )}
                  </td>
                  <td className={cell}>
                    <VarInput
                      value={row.key}
                      known={known}
                      placeholder={ghost ? keyPlaceholder : ''}
                      onChange={(v) => (ghost ? add({ key: v }) : !readOnlyKeys && update(i, { key: v }))}
                      className="h-full"
                    />
                  </td>
                  {files && (
                    <td className={cell}>
                      <select
                        value={isFile ? 'file' : 'text'}
                        onChange={(e) =>
                          ghost
                            ? add({ type: e.target.value })
                            : update(i, { type: e.target.value, ...(e.target.value === 'file' ? { value: undefined } : { src: undefined }) })
                        }
                        className="h-full w-full bg-transparent px-1 text-[12px] outline-none"
                      >
                        <option value="text">Text</option>
                        <option value="file">File</option>
                      </select>
                    </td>
                  )}
                  <td className={cell}>
                    {isFile ? (
                      <div className="flex h-full items-center gap-1 px-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={srcs.join('\n')}>
                          {srcs.length ? srcs.map((s) => s.split(/[\\/]/).pop()).join(', ') : <span className="text-muted-foreground">No file</span>}
                        </span>
                        <IconButton
                          label="Select files"
                          onClick={async () => {
                            const p = await pickFiles({ title: 'Select files', multiple: true });
                            if (p.length) update(i, { src: p.length === 1 ? p[0] : p });
                          }}
                        >
                          <FileUp className="size-3.5" />
                        </IconButton>
                      </div>
                    ) : (
                      <VarInput
                        value={row.value ?? ''}
                        known={known}
                        placeholder={ghost ? valuePlaceholder : ''}
                        onChange={(v) => (ghost ? add({ value: v }) : update(i, { value: v }))}
                        className="h-full"
                      />
                    )}
                  </td>
                  {description && (
                    <td className={cell}>
                      <input
                        value={desc(row)}
                        placeholder={ghost ? 'Description' : ''}
                        onChange={(e) => (ghost ? add({ description: e.target.value }) : update(i, { description: e.target.value }))}
                        className="h-full w-full bg-transparent px-2 text-[12px] outline-none placeholder:text-muted-foreground"
                      />
                    </td>
                  )}
                  <td className={cn(cell, 'border-r-0 text-center')}>
                    {!ghost && (
                      <IconButton label="Delete" onClick={() => remove(i)} className="opacity-0 group-hover:opacity-100">
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
    </div>
  );
}
