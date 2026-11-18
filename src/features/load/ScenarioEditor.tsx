import { ArrowDown, ArrowUp, Bug, ChevronDown, ChevronRight, FileUp, Play, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ChartCard, fmtClock, LineChart } from '@/components/charts';
import { Badge, Button, Checkbox, cn, Empty, Field, IconButton, Input, Select, Spinner, Tabs } from '@/components/ui';
import { formatDuration, formatMs } from '@/lib/format';
import { api } from '@/lib/ipc';
import type { DebugStep, Extractor, Profile, Rule, ScenarioDoc, ScenarioStep, Stage, Threshold } from '@/lib/load/types';
import { pickTextFiles } from '@/lib/native';
import { findItem, flattenRequests, itemProtocol, methodColor } from '@/lib/postman';
import { errText, toast } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

import { defaultChecks, plannedDuration, PRESETS, profileCurve, stepFromItem, toEngineScenario } from './scenario';
import { startScenario } from './start';

type Section = 'requests' | 'profile' | 'thresholds' | 'data' | 'options' | 'debug';

const num = (v: string, d = 0) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : d);

const RULE_SOURCES = [
  { value: 'status', label: 'Status code' },
  { value: 'duration', label: 'Response time (ms)' },
  { value: 'size', label: 'Body size (bytes)' },
  { value: 'body', label: 'Body text' },
  { value: 'jsonpath', label: 'JSON path' },
  { value: 'header', label: 'Header' },
  { value: 'regex', label: 'Regex (body)' },
];
const OPS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'in', label: 'in (list / range)' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'not contains' },
  { value: 'matches', label: 'matches regex' },
  { value: 'exists', label: 'exists' },
  { value: 'notExists', label: 'not exists' },
];
const METRICS = [
  { value: 'http_req_duration', label: 'http_req_duration (ms)' },
  { value: 'http_req_waiting', label: 'http_req_waiting – TTFB (ms)' },
  { value: 'http_req_failed', label: 'http_req_failed (rate 0–1)' },
  { value: 'checks', label: 'checks (pass rate 0–1)' },
  { value: 'http_reqs', label: 'http_reqs (count / rate)' },
  { value: 'iteration_duration', label: 'iteration_duration (ms)' },
  { value: 'iterations', label: 'iterations (count / rate)' },
  { value: 'data_received', label: 'data_received (bytes / rate)' },
  { value: 'apdex', label: 'apdex (0–1)' },
  { value: 'dropped_iterations', label: 'dropped_iterations (count)' },
];
const STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'p(99.9)', 'rate', 'count', 'value'];

function RuleRow({ r, onChange, onRemove }: { r: Rule; onChange: (r: Rule) => void; onRemove: () => void }) {
  const needsPath = ['jsonpath', 'header', 'regex'].includes(r.source);
  const needsValue = !['exists', 'notExists'].includes(r.op);
  return (
    <div className="flex items-center gap-1.5">
      <input type="checkbox" checked={r.enabled !== false} onChange={(e) => onChange({ ...r, enabled: e.target.checked })} className="accent-[var(--accent)]" />
      <Select value={r.source} onChange={(v) => onChange({ ...r, source: v as Rule['source'] })} options={RULE_SOURCES} className="h-7 w-36 text-[12px]" />
      {needsPath && <Input value={r.path ?? ''} onChange={(e) => onChange({ ...r, path: e.target.value })} placeholder={r.source === 'jsonpath' ? '$.data.id' : r.source === 'header' ? 'Content-Type' : '"id":(\\d+)'} className="h-7 w-44 font-mono text-[12px]" />}
      <Select value={r.op} onChange={(v) => onChange({ ...r, op: v })} options={OPS} className="h-7 w-32 text-[12px]" />
      {needsValue && <Input value={r.value ?? ''} onChange={(e) => onChange({ ...r, value: e.target.value })} placeholder={r.source === 'status' ? '200 or 200-299' : 'value'} className="h-7 w-32 font-mono text-[12px]" />}
      <Input value={r.name ?? ''} onChange={(e) => onChange({ ...r, name: e.target.value })} placeholder="Name (optional)" className="h-7 min-w-0 flex-1 text-[12px]" />
      <IconButton label="Remove" onClick={onRemove}>
        <X className="size-3.5" />
      </IconButton>
    </div>
  );
}

function ExtractRow({ e, onChange, onRemove }: { e: Extractor; onChange: (e: Extractor) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Input value={e.var} onChange={(ev) => onChange({ ...e, var: ev.target.value })} placeholder="variable" className="h-7 w-32 font-mono text-[12px]" />
      <span className="text-muted-foreground">←</span>
      <Select
        value={e.source}
        onChange={(v) => onChange({ ...e, source: v as Extractor['source'] })}
        options={[
          { value: 'jsonpath', label: 'JSON path' },
          { value: 'header', label: 'Header' },
          { value: 'regex', label: 'Regex (group 1)' },
          { value: 'cookie', label: 'Set-Cookie' },
          { value: 'status', label: 'Status code' },
          { value: 'body', label: 'Whole body' },
        ]}
        className="h-7 w-32 text-[12px]"
      />
      {!['status', 'body'].includes(e.source) && <Input value={e.path ?? ''} onChange={(ev) => onChange({ ...e, path: ev.target.value })} placeholder="$.token" className="h-7 min-w-0 flex-1 font-mono text-[12px]" />}
      <Input value={e.default ?? ''} onChange={(ev) => onChange({ ...e, default: ev.target.value })} placeholder="default" className="h-7 w-24 text-[12px]" />
      <IconButton label="Remove" onClick={onRemove}>
        <X className="size-3.5" />
      </IconButton>
    </div>
  );
}

function StepCard({ step, index, total, onChange, onMove, onRemove }: { step: ScenarioStep; index: number; total: number; onChange: (s: ScenarioStep) => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const item = useWorkspace((s) => (step.collectionId && step.itemId ? findItem(s.collections[step.collectionId]?.item ?? [], step.itemId)?.item : null));
  const method = item?.request?.method ?? step.request?.method ?? 'GET';
  const url = item ? (typeof item.request?.url === 'string' ? item.request.url : (item.request?.url?.raw ?? '')) : (step.request?.url ?? '');
  return (
    <div className={cn('rounded-lg border border-border bg-surface', !step.enabled && 'opacity-60')}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <IconButton label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </IconButton>
        <span className="w-5 text-center text-[11px] text-muted-foreground">{index + 1}</span>
        <input type="checkbox" checked={step.enabled} onChange={(e) => onChange({ ...step, enabled: e.target.checked })} className="accent-[var(--accent)]" />
        <span className={cn('w-14 font-mono text-[10.5px] font-bold', methodColor(method))}>{method}</span>
        <input value={step.name} onChange={(e) => onChange({ ...step, name: e.target.value })} className="w-48 rounded bg-transparent px-1 font-medium outline-none hover:bg-surface-hover focus:bg-surface-hover" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground" title={url}>
          {url}
        </span>
        {!item && step.collectionId && <Badge tone="danger">source deleted</Badge>}
        <Badge>{step.checks.length} checks</Badge>
        {step.extract.length > 0 && <Badge tone="accent">{step.extract.length} extract</Badge>}
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Think time after this request">
          think
          <input type="number" value={step.thinkMs} min={0} onChange={(e) => onChange({ ...step, thinkMs: num(e.target.value) })} className="h-6 w-16 rounded border border-border bg-background px-1 text-[11.5px]" />
          ms
        </label>
        <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp className="size-3.5" />
        </IconButton>
        <IconButton label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
          <ArrowDown className="size-3.5" />
        </IconButton>
        <IconButton label="Remove step" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground uppercase">Checks / assertions</div>
            <div className="space-y-1">
              {step.checks.map((c, i) => (
                <RuleRow key={i} r={c} onChange={(r) => onChange({ ...step, checks: step.checks.map((x, j) => (j === i ? r : x)) })} onRemove={() => onChange({ ...step, checks: step.checks.filter((_, j) => j !== i) })} />
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...step, checks: [...step.checks, { source: 'status', op: 'eq', value: '200', enabled: true }] })}>
              <Plus className="size-3.5" /> Add check
            </Button>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground uppercase">Extract to variables (correlation)</div>
            <div className="space-y-1">
              {step.extract.map((e, i) => (
                <ExtractRow key={i} e={e} onChange={(x) => onChange({ ...step, extract: step.extract.map((y, j) => (j === i ? x : y)) })} onRemove={() => onChange({ ...step, extract: step.extract.filter((_, j) => j !== i) })} />
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...step, extract: [...step.extract, { var: '', source: 'jsonpath', path: '$.' }] })}>
              <Plus className="size-3.5" /> Add extractor
            </Button>
            <p className="text-[11px] text-muted-foreground">Extracted values are per virtual user and usable as <code>{'{{name}}'}</code> in later steps (tokens, ids).</p>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestPicker({ onAdd }: { onAdd: (steps: ScenarioStep[]) => void }) {
  const collections = useWorkspace((s) => s.collections);
  const order = useWorkspace((s) => s.order);
  const [cid, setCid] = useState(order[0] ?? '');
  const c = collections[cid];
  const reqs = useMemo(() => (c ? flattenRequests(c.item).filter((x) => ['http', 'graphql'].includes(itemProtocol(x.item))) : []), [c]);
  if (!order.length) return <div className="text-[12px] text-muted-foreground">No collections yet.</div>;
  return (
    <div className="rounded-lg border border-dashed border-border p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[12px] font-medium">Add requests from</span>
        <Select value={cid} onChange={setCid} options={order.map((id) => ({ value: id, label: collections[id]?.info.name ?? id }))} className="h-7 text-[12px]" />
        <Button size="sm" variant="ghost" onClick={() => onAdd(reqs.map((r) => stepFromItem(cid, r.item)))}>
          Add all ({reqs.length})
        </Button>
      </div>
      <div className="max-h-48 overflow-auto">
        {reqs.map(({ item, parents }) => (
          <button key={item.id} type="button" onClick={() => onAdd([stepFromItem(cid, item)])} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-surface-hover">
            <Plus className="size-3 text-accent" />
            <span className={cn('w-12 font-mono text-[10px] font-bold', methodColor(item.request?.method ?? 'GET'))}>{item.request?.method ?? 'GET'}</span>
            <span className="text-muted-foreground">{parents.map((p) => `${p.name} / `).join('')}</span>
            {item.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfileEditor({ p, onChange }: { p: Profile; onChange: (p: Profile) => void }) {
  const curve = profileCurve(p);
  const stages = p.executor === 'iterations' ? [] : p.stages;
  const setStages = (s: Stage[]) => p.executor !== 'iterations' && onChange({ ...p, stages: s });
  const dur = plannedDuration(p);
  const unit = p.executor === 'arrivalRate' ? `iterations / ${p.timeUnitS === 1 ? 's' : `${p.timeUnitS}s`}` : 'VUs';
  const peak = Math.max(...curve.map((c) => c.v));
  // Step the curve per second for the preview.
  const xs: number[] = [];
  const ys: number[] = [];
  const step = Math.max(1, Math.ceil(dur / 300));
  for (let t = 0; t <= dur; t += step) {
    xs.push(t);
    let v = curve[0]?.v ?? 0;
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1]!;
      const b = curve[i]!;
      if (t <= b.t) {
        v = b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
        break;
      }
      v = b.v;
    }
    ys.push(v);
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <Field label="Executor">
          <Select
            value={p.executor}
            onChange={(v) => {
              if (v === 'rampingVus') onChange({ executor: 'rampingVus', startVus: 0, stages: stages.length ? stages : [{ durationS: 60, target: 10 }], gracefulStopS: 30 });
              if (v === 'arrivalRate') onChange({ executor: 'arrivalRate', startRate: 10, timeUnitS: 1, stages: stages.length ? stages : [{ durationS: 60, target: 50 }], preAllocatedVus: 20, maxVus: 200, gracefulStopS: 30 });
              if (v === 'iterations') onChange({ executor: 'iterations', vus: 10, iterations: 100, maxDurationS: 600 });
            }}
            options={[
              { value: 'rampingVus', label: 'Virtual users (closed model) – ramping / constant VUs' },
              { value: 'arrivalRate', label: 'Arrival rate (open model) – iterations per second' },
              { value: 'iterations', label: 'Fixed iterations – threads × loops (JMeter)' },
            ]}
          />
        </Field>
        {p.executor === 'rampingVus' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start VUs">
              <Input type="number" value={p.startVus} onChange={(e) => onChange({ ...p, startVus: num(e.target.value) })} />
            </Field>
            <Field label="Graceful stop (s)" hint="Let running iterations finish">
              <Input type="number" value={p.gracefulStopS} onChange={(e) => onChange({ ...p, gracefulStopS: num(e.target.value, 30) })} />
            </Field>
          </div>
        )}
        {p.executor === 'arrivalRate' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start rate">
              <Input type="number" value={p.startRate} onChange={(e) => onChange({ ...p, startRate: num(e.target.value) })} />
            </Field>
            <Field label="Time unit (s)">
              <Input type="number" value={p.timeUnitS} onChange={(e) => onChange({ ...p, timeUnitS: num(e.target.value, 1) })} />
            </Field>
            <Field label="Pre-allocated VUs">
              <Input type="number" value={p.preAllocatedVus} onChange={(e) => onChange({ ...p, preAllocatedVus: num(e.target.value, 10) })} />
            </Field>
            <Field label="Max VUs" hint="Iterations are dropped when all are busy">
              <Input type="number" value={p.maxVus} onChange={(e) => onChange({ ...p, maxVus: num(e.target.value, 100) })} />
            </Field>
          </div>
        )}
        {p.executor === 'iterations' && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Virtual users (threads)">
              <Input type="number" value={p.vus} onChange={(e) => onChange({ ...p, vus: num(e.target.value, 1) })} />
            </Field>
            <Field label="Total iterations">
              <Input type="number" value={p.iterations} onChange={(e) => onChange({ ...p, iterations: num(e.target.value, 1) })} />
            </Field>
            <Field label="Max duration (s)">
              <Input type="number" value={p.maxDurationS} onChange={(e) => onChange({ ...p, maxDurationS: num(e.target.value, 600) })} />
            </Field>
          </div>
        )}
        {p.executor !== 'iterations' && (
          <div>
            <div className="mb-1 text-[12px] font-medium text-muted-foreground">Stages (linear ramp to target over duration)</div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="w-8 font-medium">#</th>
                  <th className="font-medium">Duration (s)</th>
                  <th className="font-medium">Target ({unit})</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {stages.map((s, i) => (
                  <tr key={i}>
                    <td className="text-muted-foreground">{i + 1}</td>
                    <td className="py-0.5 pr-2">
                      <Input type="number" value={s.durationS} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, durationS: num(e.target.value) } : x)))} className="h-7" />
                    </td>
                    <td className="py-0.5 pr-2">
                      <Input type="number" value={s.target} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, target: num(e.target.value) } : x)))} className="h-7" />
                    </td>
                    <td>
                      <IconButton label="Remove stage" disabled={stages.length < 2} onClick={() => setStages(stages.filter((_, j) => j !== i))}>
                        <X className="size-3.5" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button size="sm" variant="ghost" onClick={() => setStages([...stages, { durationS: 30, target: stages[stages.length - 1]?.target ?? 10 }])}>
              <Plus className="size-3.5" /> Add stage
            </Button>
          </div>
        )}
      </div>
      <ChartCard title="Planned load" subtitle={`${formatDuration(dur)} · peak ${peak} ${unit}`}>
        <LineChart x={xs} series={[{ name: unit, color: 'var(--series-7)', values: ys, area: true }]} xFormat={fmtClock} height={220} />
      </ChartCard>
    </div>
  );
}

function ThresholdEditor({ list, steps, onChange }: { list: Threshold[]; steps: ScenarioStep[]; onChange: (l: Threshold[]) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">Pass/fail criteria (k6 thresholds / JMeter SLA). The run verdict is FAILED if any threshold fails; “abort” stops the test early.</p>
      {list.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <Select value={t.metric} onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, metric: v } : x)))} options={METRICS} className="h-7 w-64 text-[12px]" />
          <Select value={t.step ?? ''} onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, step: v || null } : x)))} options={[{ value: '', label: 'All requests' }, ...steps.map((s) => ({ value: s.id, label: s.name }))]} className="h-7 w-40 text-[12px]" />
          <Select value={t.stat} onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, stat: v } : x)))} options={STATS} className="h-7 w-24 text-[12px]" />
          <Select value={t.op} onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, op: v } : x)))} options={['<', '<=', '>', '>=', '==', '!=']} className="h-7 w-16 text-[12px]" />
          <Input type="number" value={t.value} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, value: num(e.target.value) } : x)))} className="h-7 w-28" />
          <Checkbox checked={!!t.abortOnFail} onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, abortOnFail: v } : x)))} label="abort on fail" className="text-[12px]" />
          {t.abortOnFail && (
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              after
              <input type="number" value={t.delayS ?? 0} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, delayS: num(e.target.value) } : x)))} className="h-7 w-14 rounded border border-border bg-background px-1" />s
            </label>
          )}
          <IconButton label="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...list, { metric: 'http_req_duration', stat: 'p(95)', op: '<', value: 500 }])}>
        <Plus className="size-3.5" /> Add threshold
      </Button>
    </div>
  );
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      cur.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(cell);
      rows.push(cur);
      cur = [];
      cell = '';
    } else cell += c;
  }
  if (cell || cur.length) {
    cur.push(cell);
    rows.push(cur);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

export function parseDataFile(name: string, text: string): Record<string, string>[] {
  if (name.toLowerCase().endsWith('.json')) {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) throw new Error('JSON data file must be an array of objects');
    return v.map((o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, typeof x === 'string' ? x : JSON.stringify(x)])));
  }
  return parseCsv(text);
}

export function ScenarioEditor({ scenarioId }: { scenarioId: string }) {
  const doc = useWorkspace((s) => s.scenarios[scenarioId]);
  const envs = useWorkspace((s) => s.environments);
  const [section, setSection] = useState<Section>('requests');
  const [debug, setDebug] = useState<DebugStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (!doc) return <Empty title="Scenario not found" />;
  const save = (patch: Partial<ScenarioDoc>) => useWorkspace.getState().saveScenario({ ...doc, ...patch });
  const setSteps = (steps: ScenarioStep[]) => save({ steps });
  const runDebug = async () => {
    setBusy(true);
    setSection('debug');
    try {
      const { scenario } = toEngineScenario(doc);
      const r = await api.loadDebug(scenario);
      setDebug(r.steps);
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const dur = plannedDuration(doc.profile);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <input value={doc.name} onChange={(e) => save({ name: e.target.value })} className="min-w-48 flex-1 rounded px-1 text-[15px] font-semibold outline-none hover:bg-surface-hover focus:bg-surface-hover" />
        <Select
          title="Test type preset (k6 test types)"
          value={doc.testType}
          onChange={(v) => {
            const p = PRESETS.find((x) => x.id === v);
            if (p) save({ testType: v, profile: structuredClone(p.profile), thresholds: structuredClone(p.thresholds) });
            else save({ testType: v });
          }}
          options={[...PRESETS.map((p) => ({ value: p.id, label: `${p.label} test` })), { value: 'custom', label: 'Custom' }]}
          className="h-8 text-[12.5px]"
        />
        <Select
          title="Environment"
          value={doc.environmentId ?? ''}
          onChange={(v) => save({ environmentId: v || null })}
          options={[{ value: '', label: 'No environment' }, ...Object.values(envs).map((e) => ({ value: e.id, label: e.name }))]}
          className="h-8 text-[12.5px]"
        />
        <span className="text-[12px] text-muted-foreground">{formatDuration(dur)}</span>
        <Button onClick={runDebug} disabled={busy} title="Run one iteration with one VU and show each step">
          {busy ? <Spinner /> : <Bug className="size-4" />} Debug
        </Button>
        <Button variant="primary" onClick={() => startScenario(doc.id)} disabled={!doc.steps.some((s) => s.enabled)}>
          <Play className="size-4" /> Run test
        </Button>
      </div>
      <div className="shrink-0 px-4 pt-1 text-[11.5px] text-muted-foreground">{PRESETS.find((p) => p.id === doc.testType)?.description}</div>
      <Tabs
        value={section}
        onChange={setSection}
        items={[
          { id: 'requests', label: 'Requests', badge: doc.steps.length },
          { id: 'profile', label: 'Load profile' },
          { id: 'thresholds', label: 'Thresholds', badge: doc.thresholds.length || undefined },
          { id: 'data', label: 'Test data', badge: doc.data?.rows.length || undefined },
          { id: 'options', label: 'Options' },
          { id: 'debug', label: 'Debug', badge: debug ? debug.length : undefined },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {section === 'requests' && (
          <div className="space-y-2">
            <p className="text-[12px] text-muted-foreground">
              Each virtual user runs these requests in order, again and again (one pass = one iteration). Requests are taken live from your collections, with their auth, headers and body; variables come from the selected environment.
            </p>
            {doc.steps.map((s, i) => (
              <StepCard
                key={s.id}
                step={s}
                index={i}
                total={doc.steps.length}
                onChange={(n) => setSteps(doc.steps.map((x) => (x.id === s.id ? n : x)))}
                onMove={(d) => {
                  const a = [...doc.steps];
                  const [x] = a.splice(i, 1);
                  a.splice(i + d, 0, x!);
                  setSteps(a);
                }}
                onRemove={() => setSteps(doc.steps.filter((x) => x.id !== s.id))}
              />
            ))}
            <RequestPicker onAdd={(steps) => setSteps([...doc.steps, ...steps.map((s) => ({ ...s, checks: s.checks.length ? s.checks : defaultChecks() }))])} />
          </div>
        )}
        {section === 'profile' && <ProfileEditor p={doc.profile} onChange={(profile) => save({ profile, testType: 'custom' })} />}
        {section === 'thresholds' && <ThresholdEditor list={doc.thresholds} steps={doc.steps} onChange={(thresholds) => save({ thresholds })} />}
        {section === 'data' && (
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">CSV (header row) or JSON array. Columns become variables (<code>{'{{username}}'}</code>), like JMeter's CSV Data Set or a Postman data file.</p>
            <div className="flex items-center gap-2">
              <Button
                onClick={async () => {
                  const f = await pickTextFiles({ title: 'Data file', filters: [{ name: 'CSV / JSON', extensions: ['csv', 'json', 'txt'] }] });
                  if (!f[0]) return;
                  try {
                    const rows = parseDataFile(f[0].name, f[0].text);
                    save({ data: { name: f[0].name, rows, mode: doc.data?.mode ?? 'sequential' } });
                    toast('success', `${rows.length} rows loaded`);
                  } catch (e) {
                    toast('error', errText(e));
                  }
                }}
              >
                <FileUp className="size-4" /> Load CSV / JSON
              </Button>
              {doc.data && (
                <>
                  <Select
                    value={doc.data.mode}
                    onChange={(v) => save({ data: { ...doc.data!, mode: v as 'sequential' } })}
                    options={[
                      { value: 'sequential', label: 'Sequential (shared, wraps around)' },
                      { value: 'random', label: 'Random row each iteration' },
                      { value: 'perVu', label: 'One row per VU' },
                    ]}
                  />
                  <Button variant="ghost" onClick={() => save({ data: null })}>
                    Remove
                  </Button>
                </>
              )}
            </div>
            {doc.data && (
              <div className="overflow-auto rounded-md border border-border">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-surface-muted text-left">
                      {Object.keys(doc.data.rows[0] ?? {}).map((k) => (
                        <th key={k} className="px-2 py-1 font-mono">{`{{${k}}}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {doc.data.rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border font-mono">
                        {Object.values(r).map((v, j) => (
                          <td key={j} className="px-2 py-0.5">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {doc.data.rows.length > 50 && <div className="p-1 text-center text-[11px] text-muted-foreground">… {doc.data.rows.length - 50} more rows</div>}
              </div>
            )}
          </div>
        )}
        {section === 'options' && (
          <div className="grid max-w-3xl grid-cols-2 gap-3">
            <Field label="Request timeout (ms)">
              <Input type="number" value={doc.options.timeoutMs} onChange={(e) => save({ options: { ...doc.options, timeoutMs: num(e.target.value, 30000) } })} />
            </Field>
            <Field label="Apdex T (ms)" hint="Satisfied ≤ T, tolerating ≤ 4T">
              <Input type="number" value={doc.options.apdexMs} onChange={(e) => save({ options: { ...doc.options, apdexMs: num(e.target.value, 500) } })} />
            </Field>
            <Field label="Think time between iterations: min (ms)">
              <Input type="number" value={doc.options.thinkMinMs} onChange={(e) => save({ options: { ...doc.options, thinkMinMs: num(e.target.value) } })} />
            </Field>
            <Field label="… max (ms)" hint="Uniform random pause, like JMeter's Uniform Random Timer">
              <Input type="number" value={doc.options.thinkMaxMs} onChange={(e) => save({ options: { ...doc.options, thinkMaxMs: num(e.target.value) } })} />
            </Field>
            <Field label="Expected status codes" hint="Others count as failed requests, e.g. 200-399 or 200,201,404">
              <Input value={doc.options.expectedStatus} onChange={(e) => save({ options: { ...doc.options, expectedStatus: e.target.value } })} />
            </Field>
            <Field label="Proxy" hint="Empty = system proxy, none = direct">
              <Input value={doc.options.proxy} onChange={(e) => save({ options: { ...doc.options, proxy: e.target.value } })} />
            </Field>
            <Checkbox checked={doc.options.checksFailRequest} onChange={(v) => save({ options: { ...doc.options, checksFailRequest: v } })} label="Failed check marks the request as failed (JMeter assertions)" />
            <Checkbox checked={doc.options.cookies} onChange={(v) => save({ options: { ...doc.options, cookies: v } })} label="Cookie jar per virtual user" />
            <Checkbox checked={doc.options.newConnectionPerIteration} onChange={(v) => save({ options: { ...doc.options, newConnectionPerIteration: v } })} label="New connection every iteration (no keep-alive)" />
            <Checkbox checked={doc.options.verifyTls} onChange={(v) => save({ options: { ...doc.options, verifyTls: v } })} label="Verify TLS certificates" />
            <Checkbox checked={doc.options.followRedirects} onChange={(v) => save({ options: { ...doc.options, followRedirects: v } })} label="Follow redirects" />
            <Checkbox checked={doc.options.http1Only} onChange={(v) => save({ options: { ...doc.options, http1Only: v } })} label="Force HTTP/1.1" />
          </div>
        )}
        {section === 'debug' && (
          <div className="space-y-2">
            {busy && <Spinner />}
            {!debug && !busy && <Empty title="Debug run">Runs one iteration with a single VU and shows status, checks, extracted variables and unresolved variables for every step.</Empty>}
            {debug?.map((d, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {i + 1}. {d.name}
                  </span>
                  {d.error ? <Badge tone="danger">error</Badge> : <Badge tone={d.expected ? 'success' : 'danger'}>{d.status}</Badge>}
                  {d.durationMs !== undefined && <span className="text-[12px] text-muted-foreground">{formatMs(d.durationMs)}</span>}
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">
                    {d.method} {d.url}
                  </span>
                </div>
                {d.error && <div className="mt-1 font-mono text-[12px] text-danger">{d.error}</div>}
                {d.unresolved.length > 0 && <div className="mt-1 text-[12px] text-warning">Unresolved: {d.unresolved.join(', ')}</div>}
                {!!d.checks?.length && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {d.checks.map((c, j) => (
                      <Badge key={j} tone={c.pass ? 'success' : 'danger'}>
                        {c.pass ? '✓' : '✗'} {c.name}
                      </Badge>
                    ))}
                  </div>
                )}
                {d.extracted && Object.keys(d.extracted).length > 0 && (
                  <div className="mt-1 font-mono text-[12px]">
                    {Object.entries(d.extracted).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-accent">{k}</span> = {v === null ? <span className="text-danger">not found</span> : v}
                      </div>
                    ))}
                  </div>
                )}
                {d.body && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[12px] text-muted-foreground">Response body</summary>
                    <pre className="selectable mt-1 max-h-60 overflow-auto rounded bg-surface-muted p-2 font-mono text-[11.5px] whitespace-pre-wrap">{d.body}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
