/** Scenario documents: creation from collections, presets (k6 test types), engine conversion. */
import { buildSpec } from '@/lib/build';
import { contextFor } from '@/lib/execute';
import type { EngineStep, LoadOptions, Profile, Scenario, ScenarioDoc, ScenarioStep, Threshold } from '@/lib/load/types';
import { extractorsFromScript } from '@/lib/load/scriptExtract';
import { plural, t } from '@/lib/i18n';
import { findItem, flattenRequests, itemProtocol, scriptOf, uid } from '@/lib/postman';
import type { PmItem } from '@/lib/types';
import { flatten } from '@/lib/vars';
import { useTabs } from '@/stores/tabs';
import { toast } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

export const DEFAULT_OPTIONS: LoadOptions = {
  timeoutMs: 30000,
  verifyTls: true,
  followRedirects: true,
  http1Only: false,
  proxy: '',
  thinkMinMs: 0,
  thinkMaxMs: 0,
  apdexMs: 500,
  expectedStatus: '200-399',
  checksFailRequest: false,
  cookies: true,
  newConnectionPerIteration: false,
  maxBodyBytes: 2 * 1024 * 1024,
};

export interface Preset {
  id: string;
  label: string;
  description: string;
  profile: Profile;
  thresholds: Threshold[];
}

const T = (metric: string, stat: string, op: string, value: number, abortOnFail = false): Threshold => ({
  metric,
  stat,
  op,
  value,
  abortOnFail,
  delayS: abortOnFail ? 10 : 0,
});

/** Test types from the k6 / Grafana guide, plus JMeter's classic thread group. */
export const PRESETS: Preset[] = [
  {
    id: 'smoke',
    label: 'Smoke',
    description: '1–2 VUs for 30 s: does the script work and is the baseline sane?',
    profile: { executor: 'rampingVus', startVus: 1, stages: [{ durationS: 30, target: 1 }], gracefulStopS: 10 },
    thresholds: [T('http_req_failed', 'rate', '<', 0.01), T('http_req_duration', 'p(95)', '<', 1000)],
  },
  {
    id: 'load',
    label: 'Average load',
    description: 'Ramp to typical traffic, hold, ramp down.',
    profile: {
      executor: 'rampingVus',
      startVus: 0,
      stages: [
        { durationS: 60, target: 20 },
        { durationS: 300, target: 20 },
        { durationS: 30, target: 0 },
      ],
      gracefulStopS: 30,
    },
    thresholds: [T('http_req_failed', 'rate', '<', 0.01), T('http_req_duration', 'p(95)', '<', 500), T('checks', 'rate', '>', 0.99)],
  },
  {
    id: 'stress',
    label: 'Stress',
    description: 'Push well above normal in steps to see where it degrades.',
    profile: {
      executor: 'rampingVus',
      startVus: 0,
      stages: [
        { durationS: 60, target: 50 },
        { durationS: 120, target: 50 },
        { durationS: 60, target: 100 },
        { durationS: 120, target: 100 },
        { durationS: 60, target: 0 },
      ],
      gracefulStopS: 30,
    },
    thresholds: [T('http_req_failed', 'rate', '<', 0.05), T('http_req_duration', 'p(99)', '<', 2000)],
  },
  {
    id: 'spike',
    label: 'Spike',
    description: 'Sudden burst to a very high load and back.',
    profile: {
      executor: 'rampingVus',
      startVus: 0,
      stages: [
        { durationS: 10, target: 5 },
        { durationS: 10, target: 200 },
        { durationS: 60, target: 200 },
        { durationS: 10, target: 5 },
        { durationS: 30, target: 5 },
      ],
      gracefulStopS: 30,
    },
    thresholds: [T('http_req_failed', 'rate', '<', 0.1)],
  },
  {
    id: 'soak',
    label: 'Soak',
    description: 'Average load for a long time to find leaks and drift.',
    profile: {
      executor: 'rampingVus',
      startVus: 0,
      stages: [
        { durationS: 120, target: 20 },
        { durationS: 3600, target: 20 },
        { durationS: 120, target: 0 },
      ],
      gracefulStopS: 60,
    },
    thresholds: [T('http_req_failed', 'rate', '<', 0.01), T('http_req_duration', 'p(95)', '<', 500)],
  },
  {
    id: 'breakpoint',
    label: 'Breakpoint',
    description: 'Open model: raise the arrival rate until it breaks (aborts on failure).',
    profile: {
      executor: 'arrivalRate',
      startRate: 5,
      timeUnitS: 1,
      stages: [{ durationS: 600, target: 500 }],
      preAllocatedVus: 20,
      maxVus: 1000,
      gracefulStopS: 30,
    },
    thresholds: [T('http_req_failed', 'rate', '<', 0.05, true), T('http_req_duration', 'p(95)', '<', 2000, true)],
  },
  {
    id: 'constant-rate',
    label: 'Constant RPS',
    description: 'Fixed iterations per second regardless of latency (k6 constant-arrival-rate).',
    profile: {
      executor: 'arrivalRate',
      startRate: 50,
      timeUnitS: 1,
      stages: [{ durationS: 120, target: 50 }],
      preAllocatedVus: 20,
      maxVus: 200,
      gracefulStopS: 30,
    },
    thresholds: [T('dropped_iterations', 'count', '==', 0), T('http_req_duration', 'p(95)', '<', 500)],
  },
  {
    id: 'jmeter',
    label: 'Thread group',
    description: 'JMeter style: N threads × M loops (shared iterations).',
    profile: { executor: 'iterations', vus: 10, iterations: 1000, maxDurationS: 600 },
    thresholds: [T('http_req_failed', 'rate', '<', 0.01)],
  },
];

export function defaultChecks(): ScenarioStep['checks'] {
  return [{ source: 'status', op: 'in', value: '200-299', enabled: true, name: 'status is 2xx' }];
}

export function newScenario(name: string, steps: ScenarioStep[] = []): ScenarioDoc {
  const p = PRESETS[0]!;
  return {
    id: uid(),
    name,
    testType: p.id,
    environmentId: useWorkspace.getState().activeEnv,
    steps,
    profile: structuredClone(p.profile),
    thresholds: structuredClone(p.thresholds),
    options: { ...DEFAULT_OPTIONS },
    data: null,
  };
}

export function stepFromItem(collectionId: string, item: PmItem): ScenarioStep {
  return {
    id: uid(),
    name: item.name,
    enabled: true,
    collectionId,
    itemId: item.id,
    checks: defaultChecks(),
    // Values the request's test script saves (token, ids) become extractors, since load tests
    // don't run scripts.
    extract: extractorsFromScript(scriptOf(item.event, 'test')),
    thinkMs: 0,
  };
}

/** Create a scenario from a collection, folder or explicit item ids and open it. */
export function scenarioFromCollection(collectionId: string, folderId: string | null, itemIds?: string[]) {
  const ws = useWorkspace.getState();
  const c = ws.collections[collectionId];
  if (!c) return;
  let items: PmItem[];
  if (itemIds) {
    items = itemIds.map((id) => findItem(c.item, id)?.item).filter((x): x is PmItem => !!x);
  } else {
    const root = folderId ? (findItem(c.item, folderId)?.item.item ?? []) : c.item;
    items = flattenRequests(root).map((x) => x.item);
  }
  const http = items.filter((it) => ['http', 'graphql'].includes(itemProtocol(it)));
  if (!http.length) {
    toast('error', t('No HTTP/GraphQL requests to load test'));
    return;
  }
  const name = itemIds?.length === 1 ? `${http[0]!.name} – load test` : `${folderId ? (findItem(c.item, folderId)?.item.name ?? c.info.name) : c.info.name} – load test`;
  const sc = newScenario(name, http.map((it) => stepFromItem(collectionId, it)));
  ws.saveScenario(sc);
  const converted = sc.steps.reduce((n, st) => n + st.extract.length, 0);
  if (converted) toast('info', t(plural(converted, "{n} variable saved by test scripts turned into extractors (load tests don't run scripts)", "{n} variables saved by test scripts turned into extractors (load tests don't run scripts)"), { n: converted }));
  useTabs.getState().open({ id: uid(), kind: 'scenario', scenarioId: sc.id });
}

/**
 * Resolve every step's request from its source item (auth inheritance, body) and the selected
 * environment. Variables stay as `{{x}}` where the engine must resolve them per VU (data rows,
 * extracted values, dynamic variables).
 */
export function toEngineScenario(doc: ScenarioDoc): { scenario: Scenario; problems: string[] } {
  const ws = useWorkspace.getState();
  const problems: string[] = [];
  const steps: EngineStep[] = [];
  let variables: Record<string, string> = {};
  // Names the engine must resolve per VU: extracted values and data-file columns.
  const keep = new Set<string>([
    ...doc.steps.flatMap((s) => s.extract.map((e) => e.var).filter(Boolean)),
    ...Object.keys(doc.data?.rows[0] ?? {}),
  ]);
  for (const st of doc.steps) {
    let item: PmItem | null = null;
    if (st.collectionId && st.itemId) {
      const c = ws.collections[st.collectionId];
      item = c ? (findItem(c.item, st.itemId)?.item ?? null) : null;
    }
    let request = st.request;
    if (item) {
      const ctx = contextFor(st.collectionId ?? null, st.itemId ?? null);
      if (doc.environmentId !== undefined) {
        const env = doc.environmentId ? ws.environments[doc.environmentId] : null;
        ctx.scopes.environment = {};
        for (const v of env?.values ?? []) if (v.enabled !== false && v.key) ctx.scopes.environment[v.key] = v.value;
      }
      variables = { ...variables, ...flatten(ctx.scopes) };
      const built = buildSpec(item.request ?? {}, {
        collection: ctx.collection,
        parents: ctx.parents,
        scopes: ctx.scopes,
        keep,
        settings: ctx.settings,
        behavior: item.protocolProfileBehavior,
      });
      request = built.spec;
    } else if (!request) {
      problems.push(t('Step "{name}": its source request was deleted', { name: st.name }));
      continue;
    }
    steps.push({
      id: st.id,
      name: st.name,
      enabled: st.enabled,
      request: request!,
      checks: st.checks.filter((c) => c.enabled !== false),
      extract: st.extract.filter((e) => e.var),
      thinkMs: st.thinkMs,
    });
  }
  return {
    scenario: {
      name: doc.name,
      steps,
      profile: doc.profile,
      variables: Object.entries(variables).map(([key, value]) => ({ key, value })),
      data: doc.data ?? null,
      thresholds: doc.thresholds,
      options: doc.options,
    },
    problems,
  };
}

/** Planned VU (or rate) curve for the profile preview chart. */
export function profileCurve(p: Profile): { t: number; v: number }[] {
  if (p.executor === 'iterations') return [{ t: 0, v: p.vus }, { t: p.maxDurationS, v: p.vus }];
  const start = p.executor === 'rampingVus' ? p.startVus : p.startRate;
  const pts = [{ t: 0, v: start }];
  let t = 0;
  for (const s of p.stages) {
    t += s.durationS;
    pts.push({ t, v: s.target });
  }
  return pts;
}

export function plannedDuration(p: Profile): number {
  return p.executor === 'iterations' ? p.maxDurationS : p.stages.reduce((a, s) => a + s.durationS, 0);
}
