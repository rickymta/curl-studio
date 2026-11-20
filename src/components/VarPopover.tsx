import { ArrowRight, Eye, EyeOff, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  lookupVar,
  SCOPE_LABEL,
  SCOPE_LETTER,
  setVar,
  type VarScopeName,
} from '@/features/request/varScope';
import { t } from '@/lib/i18n';
import { DYNAMIC } from '@/lib/vars';
import { uid } from '@/lib/postman';
import { useTabs } from '@/stores/tabs';
import { useWorkspace } from '@/stores/workspace';

import { cn } from './ui';

export interface VarHover {
  name: string;
  rect: { left: number; top: number; bottom: number };
}

/**
 * Postman-style card under a hovered `{{variable}}`: shows where the value comes from and lets
 * the user change it in place (Enter or leaving the field saves, Esc reverts).
 */
export function VarPopover({
  hover,
  collectionId,
  onEnter,
  onLeave,
  onClose,
}: {
  hover: VarHover;
  collectionId: string | null;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  // Re-render when any scope changes so the card shows the live value.
  useWorkspace((s) => s.environments);
  useWorkspace((s) => s.collections);
  useWorkspace((s) => s.globals);
  useWorkspace((s) => s.activeEnv);
  const info = lookupVar(collectionId, hover.name);
  const [draft, setDraft] = useState(info.value);
  const [target, setTarget] = useState<VarScopeName>(info.scope ?? info.writable[0] ?? 'globals');
  const committed = useRef(info.value);
  const [reveal, setReveal] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: hover.rect.left, top: hover.rect.bottom + 4 });

  useEffect(() => {
    // Keep the card on screen.
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(hover.rect.left, window.innerWidth - w - 8));
    const top =
      hover.rect.bottom + 4 + h > window.innerHeight - 8
        ? hover.rect.top - h - 4
        : hover.rect.bottom + 4;
    setPos({ left, top });
  }, [hover.rect.left, hover.rect.top, hover.rect.bottom]);

  const commit = () => {
    if (info.dynamic) return;
    if (draft === committed.current && info.scope) return;
    if (!info.scope && draft === '') return;
    setVar(collectionId, info.scope ?? target, hover.name, draft);
    committed.current = draft;
  };

  const openSource = () => {
    const ws = useWorkspace.getState();
    const scope = info.scope ?? target;
    if (scope === 'environment' && ws.activeEnv)
      useTabs.getState().open({ id: uid(), kind: 'environment', envId: ws.activeEnv });
    else if (scope === 'collection' && collectionId)
      useTabs.getState().open({ id: uid(), kind: 'collection', collectionId });
    else useTabs.getState().open({ id: uid(), kind: 'environment', envId: 'globals' });
    onClose();
  };

  const scope = info.scope ?? target;
  const dyn = info.dynamic ? DYNAMIC[hover.name.slice(1)] : undefined;
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={t('Variable {name}', { name: hover.name })}
      data-var-popover
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[70] w-80 rounded-lg border border-border bg-surface p-2.5 text-[12.5px] shadow-2xl"
      style={pos}
    >
      {info.dynamic ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-medium">
            <Sparkles className="size-3.5 text-accent" /> {t('Dynamic variable')}
          </div>
          <div className="text-muted-foreground">
            {dyn
              ? t('A new value is generated for each request, e.g. {example}', { example: String(dyn()) })
              : t('Not a known dynamic variable.')}
          </div>
        </div>
      ) : (
        <>
          {info.scope === 'environment' || info.scope === 'globals' ? (
            <div className="mb-1 text-[11px] text-muted-foreground">{t('Current value')}</div>
          ) : null}
          <div className="relative">
            <input
              autoFocus={false}
              type={info.secret && !reveal ? 'password' : 'text'}
              value={draft}
              spellCheck={false}
              placeholder={t('Enter value')}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit();
                  onClose();
                } else if (e.key === 'Escape') {
                  setDraft(committed.current);
                  onClose();
                }
              }}
              className={cn(
                'h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-[12.5px] outline-none focus:border-accent',
                info.secret && 'pr-8',
              )}
            />
            {info.secret && (
              <button
                type="button"
                aria-label={reveal ? t('Hide value') : t('Show value')}
                title={reveal ? t('Hide value') : t('Show value')}
                onClick={() => setReveal(!reveal)}
                className="absolute top-1.5 right-2 text-muted-foreground hover:text-foreground"
              >
                {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            )}
          </div>
          {info.initial !== undefined && (
            <div className="mt-1.5 flex gap-2 text-[11.5px] text-muted-foreground">
              <span className="shrink-0">{t('Initial value')}</span>
              <span
                className="min-w-0 flex-1 truncate font-mono"
                title={info.secret && !reveal ? undefined : info.initial}
              >
                {info.secret && !reveal ? '••••••' : info.initial || t('(empty)')}
              </span>
              <button
                type="button"
                className="shrink-0 text-accent hover:underline"
                onClick={() => setDraft(info.initial ?? '')}
              >
                {t('Use')}
              </button>
            </div>
          )}
          {!info.scope && (
            <div className="mt-2 flex items-center gap-1.5 text-danger">
              <TriangleAlert className="size-3.5" /> {t('Unresolved variable — type a value to add it to:')}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded text-[10.5px] font-bold',
                info.scope
                  ? 'bg-success-soft text-success'
                  : 'bg-surface-muted text-muted-foreground',
              )}
            >
              {SCOPE_LETTER[scope]}
            </span>
            {info.scope || info.writable.length < 2 ? (
              <span>{t(SCOPE_LABEL[scope])}</span>
            ) : (
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as VarScopeName)}
                className="rounded border border-border bg-background px-1 py-0.5 text-[12px] outline-none"
                aria-label={t('Scope for the new variable')}
              >
                {info.writable.map((s) => (
                  <option key={s} value={s}>
                    {t(SCOPE_LABEL[s])}
                  </option>
                ))}
              </select>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={openSource}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              {t('Open {scope}', { scope: t(SCOPE_LABEL[scope]).toLowerCase() })} <ArrowRight className="size-3" />
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
