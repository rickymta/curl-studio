import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui';
import { type Toast, useUi } from '@/stores/ui';

const TOAST_STYLE = {
  error: { color: 'var(--danger)', Icon: XCircle },
  success: { color: 'var(--success)', Icon: CheckCircle2 },
  warning: { color: 'var(--warning)', Icon: AlertTriangle },
  info: { color: 'var(--accent)', Icon: Info },
} as const;

const GAP = 8;
/** How much of each older toast peeks out above the front one while collapsed. */
const PEEK = 10;
const MAX_PEEK = 2;

/**
 * Notifications above the status bar, stacked like a deck (as in GitStudio): the newest in
 * front, older ones peeking out behind it. Hovering the stack fans it out into a list and pauses
 * every timer; each toast hides itself when its progress bar runs out.
 */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  const [hover, setHover] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const expanded = hover && toasts.length > 0;

  const newestFirst = [...toasts].reverse();
  const h = (id: number) => heights[id] ?? 0;
  const front = newestFirst[0];
  const offsets: number[] = [];
  let acc = 0;
  for (const toast of newestFirst) {
    offsets.push(acc);
    acc += h(toast.id) + GAP;
  }
  const height = expanded
    ? Math.max(0, acc - GAP)
    : front
      ? h(front.id) + PEEK * Math.min(newestFirst.length - 1, MAX_PEEK)
      : 0;

  return (
    <div
      aria-live="polite"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="fixed right-4 bottom-9 z-[60] w-[400px] max-w-[calc(100vw-32px)] transition-[height] duration-200"
      style={{ height, pointerEvents: toasts.length ? 'auto' : 'none' }}
    >
      {newestFirst.map((toast, i) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          index={i}
          expanded={expanded}
          offset={offsets[i]!}
          frontHeight={front ? h(front.id) : 0}
          onHeight={(px) => setHeights((m) => (m[toast.id] === px ? m : { ...m, [toast.id]: px }))}
          onDone={() => {
            dismiss(toast.id);
            setHeights((m) => {
              const rest = { ...m };
              delete rest[toast.id];
              return rest;
            });
          }}
        />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  index,
  expanded,
  offset,
  frontHeight,
  onHeight,
  onDone,
}: {
  toast: Toast;
  index: number;
  expanded: boolean;
  offset: number;
  frontHeight: number;
  onHeight: (px: number) => void;
  onDone: () => void;
}) {
  const { color, Icon } = TOAST_STYLE[toast.kind];
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const report = () => onHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const behind = !expanded && index > 0;
  const hidden = !expanded && index > MAX_PEEK;
  const transform = expanded
    ? `translateY(-${offset}px)`
    : `translateY(-${PEEK * Math.min(index, MAX_PEEK)}px) scale(${1 - 0.05 * Math.min(index, MAX_PEEK + 1)})`;

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-hidden={hidden || undefined}
      className="group absolute inset-x-0 bottom-0 origin-bottom overflow-hidden rounded-lg border shadow-2xl transition-[transform,opacity,height] duration-200 ease-out"
      style={{
        zIndex: 100 - index,
        transform,
        opacity: hidden ? 0 : 1,
        // Collapsed, cards behind take the front card's height so only their top edge shows.
        height: behind && frontHeight ? frontHeight : undefined,
        pointerEvents: hidden ? 'none' : undefined,
        borderColor: `color-mix(in oklch, ${color} 55%, var(--border))`,
        background: `color-mix(in oklch, ${color} 13%, var(--surface))`,
      }}
    >
      <div
        ref={inner}
        className="toast-in transition-opacity duration-200"
        style={{ opacity: behind ? 0 : 1 }}
      >
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
        <div className="flex gap-3 py-2.5 pr-2.5 pl-4">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full"
            style={{ background: `color-mix(in oklch, ${color} 25%, transparent)`, color }}
          >
            <Icon className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="selectable text-[13px] leading-5 font-medium break-words">
              {toast.text}
            </div>
            {toast.detail && (
              <pre className="selectable mt-1 max-h-40 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap text-muted-foreground">
                {toast.detail}
              </pre>
            )}
            {toast.actions?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {toast.actions.map((a, i) => (
                  <Button
                    key={a.label}
                    size="sm"
                    variant={i === 0 ? 'primary' : 'default'}
                    onClick={() => {
                      a.run();
                      onDone();
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDone}
            className="flex size-6 shrink-0 items-center justify-center self-start rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div
          className="h-[3px] w-full"
          style={{ background: `color-mix(in oklch, ${color} 18%, transparent)` }}
        >
          <div
            className="toast-progress h-full origin-left group-focus-within:[animation-play-state:paused]"
            style={{
              background: color,
              animationDuration: `${toast.duration}ms`,
              // Hovering the stack pauses every toast, not only the one under the pointer.
              animationPlayState: expanded ? 'paused' : undefined,
            }}
            onAnimationEnd={onDone}
          />
        </div>
      </div>
    </div>
  );
}
