import type { KeyValue, RequestSpec } from '../types';

export interface Rule {
  name?: string;
  source: 'status' | 'duration' | 'size' | 'body' | 'jsonpath' | 'header' | 'regex';
  path?: string;
  op: string;
  value?: string;
  enabled?: boolean;
}

export interface Extractor {
  var: string;
  source: 'jsonpath' | 'header' | 'regex' | 'status' | 'body' | 'cookie';
  path?: string;
  default?: string;
}

/** Step as stored in a scenario document (links back to the collection item). */
export interface ScenarioStep {
  id: string;
  name: string;
  enabled: boolean;
  /** Source collection + item; the request is rebuilt from it at start time. */
  collectionId?: string;
  itemId?: string;
  /** Snapshot used when the source item no longer exists (or for ad-hoc steps). */
  request?: RequestSpec;
  checks: Rule[];
  extract: Extractor[];
  thinkMs: number;
}

/** Step as sent to the engine. */
export interface EngineStep {
  id: string;
  name: string;
  enabled: boolean;
  request: RequestSpec;
  checks: Rule[];
  extract: Extractor[];
  thinkMs: number;
}

export interface Stage {
  durationS: number;
  target: number;
}

export type Profile =
  | { executor: 'rampingVus'; startVus: number; stages: Stage[]; gracefulStopS: number }
  | {
      executor: 'arrivalRate';
      startRate: number;
      timeUnitS: number;
      stages: Stage[];
      preAllocatedVus: number;
      maxVus: number;
      gracefulStopS: number;
    }
  | { executor: 'iterations'; vus: number; iterations: number; maxDurationS: number };

export interface Threshold {
  metric: string;
  stat: string;
  op: string;
  value: number;
  step?: string | null;
  abortOnFail?: boolean;
  delayS?: number;
}

export interface LoadOptions {
  timeoutMs: number;
  verifyTls: boolean;
  followRedirects: boolean;
  http1Only: boolean;
  proxy: string;
  thinkMinMs: number;
  thinkMaxMs: number;
  apdexMs: number;
  expectedStatus: string;
  checksFailRequest: boolean;
  cookies: boolean;
  newConnectionPerIteration: boolean;
  maxBodyBytes: number;
}

export interface DataSet {
  name: string;
  rows: Record<string, string>[];
  mode: 'sequential' | 'random' | 'perVu';
}

/** Scenario as stored (loadScenarios/<id>.json). */
export interface ScenarioDoc {
  id: string;
  name: string;
  description?: string;
  /** k6 test type label: smoke, load, stress, spike, soak, breakpoint, custom. */
  testType: string;
  environmentId?: string | null;
  steps: ScenarioStep[];
  profile: Profile;
  thresholds: Threshold[];
  options: LoadOptions;
  data?: DataSet | null;
  updatedAt?: number;
}

/** Scenario as sent to the engine. */
export interface Scenario {
  name: string;
  steps: EngineStep[];
  profile: Profile;
  variables: KeyValue[];
  data?: DataSet | null;
  thresholds: Threshold[];
  options: LoadOptions;
}

export interface Stats {
  count: number;
  avg: number;
  min: number;
  max: number;
  stddev: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
}

export interface StepPoint {
  count: number;
  failures: number;
  avg: number;
  max: number;
}

export interface Point {
  t: number;
  vus: number;
  requests: number;
  failures: number;
  bytesIn: number;
  bytesOut: number;
  iterations: number;
  dropped: number;
  checksPass: number;
  checksFail: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  waitAvg: number;
  apdex: number | null;
  status: Record<string, number>;
  heat: number[];
  steps: Record<string, StepPoint>;
}

export interface StepSummary {
  id: string;
  name: string;
  method: string;
  url: string;
  count: number;
  failures: number;
  errorRate: number;
  rps: number;
  bytesIn: number;
  bytesOut: number;
  latency: Stats;
  waiting: Stats;
  status: Record<string, number>;
  apdex: number;
}

export interface ThresholdResult {
  metric: string;
  stat: string;
  op: string;
  value: number;
  step?: string | null;
  actual: number | null;
  pass: boolean;
  expression: string;
}

export interface Summary {
  durationS: number;
  requests: number;
  failures: number;
  errorRate: number;
  rps: number;
  peakRps: number;
  bytesIn: number;
  bytesOut: number;
  iterations: number;
  droppedIterations: number;
  vusMax: number;
  checksPass: number;
  checksFail: number;
  latency: Stats;
  waiting: Stats;
  iteration: Stats;
  apdex: { tMs: number; satisfied: number; tolerating: number; frustrated: number; score: number };
  status: Record<string, number>;
  steps: StepSummary[];
  checks: { step: string; name: string; pass: number; fail: number }[];
  errors: { step: string; message: string; count: number }[];
  distribution: { from: number; to: number; count: number }[];
  thresholds: ThresholdResult[];
  verdict: 'passed' | 'failed' | '';
}

export interface RunRecord {
  id: string;
  name: string;
  meta: {
    scenarioId?: string;
    environment?: string;
    testType?: string;
    notes?: string;
    tags?: string[];
  } | null;
  state: 'finished' | 'aborted' | string;
  reason: string | null;
  startedAt: string;
  endedAt: string;
  scenario: Scenario;
  summary: Summary;
  timeline: Point[];
  heatBoundsMs: number[];
}

export interface LiveStatus {
  state: string;
  done: boolean;
  run?: RunRecord;
  elapsedS?: number;
  plannedS?: number;
  vus?: number;
  points?: Point[];
  summary?: Summary;
  reason?: string | null;
  heatBoundsMs?: number[];
}

export interface DebugStep {
  step: string;
  name: string;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  size?: number;
  checks?: { name: string; pass: boolean }[];
  extracted?: Record<string, string | null>;
  unresolved: string[];
  expected?: boolean;
  body?: string;
  error?: string;
}
