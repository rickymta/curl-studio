import { ContextMenu, Dialog, DropdownMenu } from 'radix-ui';
import { Loader2, X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { t } from '@/lib/i18n';


export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'default' | 'ghost' | 'danger';

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3',
        variant === 'primary' && 'bg-accent text-accent-foreground hover:brightness-110',
        variant === 'default' && 'border border-border bg-surface-muted hover:bg-surface-hover',
        variant === 'ghost' && 'hover:bg-surface-hover',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...rest}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cn('size-4 animate-spin', className)} />
);

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  // Full width unless the caller sets a width (w-32 and w-full are the same property, so both
  // would leave the result to CSS order).
  const sized = /(^|\s)(w-|min-w-0 flex-1)/.test(props.className ?? '');
  return (
    <input
      {...props}
      className={cn(
        'h-8 rounded-md border border-border bg-background px-2.5 outline-none placeholder:text-muted-foreground focus:border-accent',
        !sized && 'w-full',
        props.className,
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 outline-none placeholder:text-muted-foreground focus:border-accent',
        props.className,
      )}
    />
  );
}

// ---- menus --------------------------------------------------------------------------------------

export type MenuItem =
  | 'sep'
  | {
      label: string;
      icon?: ReactNode;
      onSelect?: () => void;
      danger?: boolean;
      disabled?: boolean;
      items?: MenuItem[];
    };

const itemCls =
  'flex h-7 cursor-default items-center gap-2 rounded px-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';
const contentCls =
  'z-50 min-w-48 rounded-md border border-border bg-surface p-1 text-[13px] shadow-xl';

function renderItems(items: MenuItem[], M: typeof ContextMenu | typeof DropdownMenu): ReactNode {
  return items.map((it, i) => {
    if (it === 'sep') return <M.Separator key={i} className="my-1 h-px bg-border" />;
    if (it.items) {
      return (
        <M.Sub key={i}>
          <M.SubTrigger className={itemCls}>
            <span className="w-4">{it.icon}</span>
            {it.label}
            <span className="ml-auto pl-4 text-muted-foreground">›</span>
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className={contentCls}>{renderItems(it.items, M)}</M.SubContent>
          </M.Portal>
        </M.Sub>
      );
    }
    return (
      <M.Item
        key={i}
        disabled={it.disabled}
        onSelect={it.onSelect}
        className={cn(itemCls, it.danger && 'text-danger')}
      >
        <span className="flex w-4 justify-center">{it.icon}</span>
        {it.label}
      </M.Item>
    );
  });
}

export function ContextMenuWrap({
  items,
  children,
}: {
  items: () => MenuItem[];
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={contentCls}
          // Menu items often open a dialog; don't pull focus back to the trigger over it.
          onCloseAutoFocus={(e) => e.preventDefault()}
          // React bubbles portal events to the trigger's ancestors (e.g. a tree row that toggles).
          onClick={(e) => e.stopPropagation()}
        >
          {renderItems(items(), ContextMenu)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function Dropdown({ items, children }: { items: MenuItem[]; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className={contentCls}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          {renderItems(items, DropdownMenu)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ---- modal --------------------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  width = 460,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border bg-surface p-5 shadow-2xl"
          style={{ width: `min(${width}px, calc(100vw - 32px))` }}
          aria-describedby={undefined}
          // Radix focuses the first tabbable element (the close button). Prefer an element marked
          // data-autofocus, then the first text field.
          onOpenAutoFocus={(e) => {
            const root = e.currentTarget as HTMLElement;
            const el =
              root.querySelector<HTMLElement>('[data-autofocus]') ??
              root.querySelector<HTMLElement>(
                'input:not([type=checkbox]):not([type=radio]):not([disabled]), textarea:not([disabled])',
              );
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description asChild>
                  <div className="mt-1 text-muted-foreground">{description}</div>
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label={t('Close')}>
                <X className="size-4" />
              </IconButton>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2 px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      <span className="flex-1">{children}</span>
      {right}
    </div>
  );
}


export function Select({
  value,
  onChange,
  options,
  className,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
  className?: string;
  title?: string;
}) {
  return (
    <select
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-8 rounded-md border border-border bg-background px-2 outline-none focus:border-accent',
        className,
      )}
    >
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  className,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2', className)} title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[var(--accent)]"
      />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
  right,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: ReactNode; badge?: ReactNode }[];
  className?: string;
  right?: ReactNode;
}) {
  return (
    <div className={cn('flex h-9 shrink-0 items-end gap-1 border-b border-border px-2', className)}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onChange(it.id)}
          className={cn(
            '-mb-px flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-[13px] whitespace-nowrap',
            value === it.id
              ? 'border-accent text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {it.label}
          {it.badge !== undefined && it.badge !== null && it.badge !== 0 && (
            <span className="rounded bg-surface-hover px-1 text-[10px] text-muted-foreground">
              {it.badge}
            </span>
          )}
        </button>
      ))}
      <div className="flex-1" />
      {right && <div className="flex h-8 items-center gap-1">{right}</div>}
    </div>
  );
}

export function Badge({
  tone = 'muted',
  children,
  className,
}: {
  tone?: 'success' | 'warning' | 'danger' | 'muted' | 'accent';
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium',
        tone === 'success' && 'bg-success-soft text-success',
        tone === 'warning' && 'bg-warning-soft text-warning',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'muted' && 'bg-surface-hover text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      {icon && <div className="opacity-60">{icon}</div>}
      <div className="font-medium text-foreground">{title}</div>
      {children && <div className="max-w-md text-[12px]">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
