import { type ReactNode, useRef, useState } from 'react';

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
        onPointerDown={onDown}
        className={cn(
          'shrink-0 bg-border transition-colors hover:bg-accent',
          vertical ? 'h-px cursor-row-resize py-[2px] bg-clip-content' : 'w-px cursor-col-resize px-[2px] bg-clip-content',
        )}
      />
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ flex: `${1 - ratio} 1 0` }}>
        {b}
      </div>
    </div>
  );
}
