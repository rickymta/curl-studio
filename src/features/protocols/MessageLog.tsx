import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, Info, Search, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge, cn, IconButton } from '@/components/ui';
import { prettyJson } from '@/lib/format';
import { t } from '@/lib/i18n';
import type { SessionMessage } from '@/lib/types';

function time(ts: number) {
  const d = new Date(ts);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function Row({ m }: { m: SessionMessage }) {
  const [open, setOpen] = useState(false);
  const meta = m.meta ?? {};
  const label = (meta.topic as string) ?? (meta.event as string) ?? '';
  const icon =
    m.dir === 'in' ? <ArrowDownLeft className="size-3.5 text-success" /> : m.dir === 'out' ? <ArrowUpRight className="size-3.5 text-accent" /> : m.dir === 'error' ? <TriangleAlert className="size-3.5 text-danger" /> : <Info className="size-3.5 text-muted-foreground" />;
  const long = m.data.length > 160 || m.data.includes('\n');
  return (
    <div className={cn('border-b border-border px-2 py-1 text-[12px]', m.dir === 'error' && 'bg-danger-soft/40')}>
      <div className="flex cursor-pointer items-center gap-2" onClick={() => setOpen(!open)}>
        {long || Object.keys(meta).length ? open ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" /> : <span className="w-3" />}
        {icon}
        {label && <Badge tone="accent">{label}</Badge>}
        {m.kind !== 'text' && m.kind !== 'message' && m.kind !== 'event' && <Badge>{m.kind}</Badge>}
        <span className={cn('min-w-0 flex-1 truncate font-mono', m.dir === 'info' && 'text-muted-foreground', m.dir === 'error' && 'text-danger')}>{m.data.replace(/\s+/g, ' ')}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{time(m.ts)}</span>
      </div>
      {open && (
        <div className="selectable mt-1 ml-5 space-y-1">
          <pre className="max-h-96 overflow-auto rounded bg-surface-muted p-2 font-mono text-[12px] whitespace-pre-wrap">{prettyJson(m.data)}</pre>
          {Object.keys(meta).length > 0 && <pre className="overflow-auto rounded bg-surface-muted p-2 font-mono text-[11px] text-muted-foreground">{JSON.stringify(meta, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

export function MessageLog({ messages, onClear }: { messages: SessionMessage[]; onClear: () => void }) {
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all');
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const shown = useMemo(
    () => messages.filter((m) => (dir === 'all' || m.dir === dir) && (!q || m.data.toLowerCase().includes(q.toLowerCase()) || JSON.stringify(m.meta ?? {}).toLowerCase().includes(q.toLowerCase()))),
    [messages, q, dir],
  );
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown.length]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="text-[12px] font-semibold">{t('Messages')}</span>
        <Badge>{messages.length}</Badge>
        {(['all', 'in', 'out'] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDir(d)} className={cn('rounded px-1.5 text-[12px]', dir === d ? 'bg-surface-hover' : 'text-muted-foreground')}>
            {d === 'all' ? t('All') : d === 'in' ? t('Received') : t('Sent')}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex h-6 items-center gap-1 rounded border border-border px-1.5">
          <Search className="size-3 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search')} className="w-36 bg-transparent text-[12px] outline-none" />
        </div>
        <IconButton label={t('Clear messages')} onClick={onClear}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      <div
        ref={box}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {shown.length === 0 && <div className="p-6 text-center text-muted-foreground">{t('No messages')}</div>}
        {shown.map((m, i) => (
          <Row key={`${m.seq}-${i}`} m={m} />
        ))}
      </div>
    </div>
  );
}
