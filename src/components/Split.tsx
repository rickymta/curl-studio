import { type ReactNode, useRef, useState } from 'react';

import { t } from '@/lib/i18n';

import { cn } from './ui';

/** Two panes with a draggable divider. `id` persists the ratio. */
export function Split({
  a,
  b,
  vertical = true,
  id,
  initial = 0.5,
  min = 0.15,
  className,
}: {
  a: ReactNode;
  b: ReactNode;
  vertical?: boolean;
  id?: string;
  initial?: number;
  min?: number;
  className?: string;
}) {
  const key = id ? `curlstudio.split.${id}` : null;
  const [ratio, setRatio] = useState(() => {
    const v = key ? Number(localStorage.getItem(key)) : NaN;
    return Number.isFinite(v) && v > 0 && v < 1 ? v : initial;
  });
  const box = useRef<HTMLDivElement>(null);
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const r = vertical ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width;
      const v = Math.min(1 - min, Math.max(min, r));
      setRatio(v);
      if (key) localStorage.setItem(key, String(v));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div ref={box} className={cn('flex min-h-0 min-w-0', vertical ? 'flex-col' : 'flex-row', className)}>
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ flex: `${ratio} 1 0` }}>
        {a}
      </div>
      <div
        role="separator"
        aria-orientation={vertical ? 'horizontal' : 'vertical'}
        aria-label={t('Resize panes')}
        title={t('Drag to resize · double-click to reset')}
        onPointerDown={onDown}
        onDoubleClick={() => {
          setRatio(initial);
          if (key) localStorage.removeItem(key);
        }}
        className={cn('group relative z-10 shrink-0', vertical ? 'h-px cursor-row-resize' : 'w-px cursor-col-resize')}
      >
        {/* 1px line, 7px grab area */}
        <div className={cn('absolute bg-border transition-colors group-hover:bg-accent', vertical ? 'inset-x-0 -top-[3px] h-[7px] bg-clip-content py-[3px]' : 'inset-y-0 -left-[3px] w-[7px] bg-clip-content px-[3px]')} />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ flex: `${1 - ratio} 1 0` }}>
        {b}
      </div>
    </div>
  );
}
