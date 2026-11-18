import { FileUp, Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { pickFiles } from '@/lib/native';
import type { PmFormParam, PmKV } from '@/lib/types';

import { cn, IconButton } from './ui';

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
              <span key={i} className={ok ? 'text-accent' : 'text-danger'}>
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
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className={cn(
          'relative h-full w-full bg-transparent px-2 text-transparent caret-[var(--foreground)] outline-none placeholder:text-muted-foreground selection:bg-selection selection:text-foreground',
          mono && 'font-mono text-[12.5px]',
        )}
      />
    </div>
  );
}

type Row = PmKV & Partial<PmFormParam>;

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
            <col className="w-[32%]" />
            {files && <col className="w-20" />}
            <col />
            {description && <col className="w-[22%]" />}
            <col className="w-8" />
          </colgroup>
          <thead>
            <tr className="bg-surface-muted text-left text-[11px] text-muted-foreground">
              <th className={cell} />
              <th className={cn(cell, 'px-2 font-medium')}>{keyPlaceholder}</th>
              {files && <th className={cn(cell, 'px-2 font-medium')}>Type</th>}
              <th className={cn(cell, 'px-2 font-medium')}>{valuePlaceholder}</th>
              {description && <th className={cn(cell, 'px-2 font-medium')}>Description</th>}
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
