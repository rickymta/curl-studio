/** Send a request the way Postman does: scripts (collection → folders → request), variables, tests. */
import { buildSpec } from './build';
import { api } from './ipc';
import { clone, findItem, scriptOf } from './postman';
import { runScript } from './sandbox';
import type { PmCollection, PmEnvValue, PmEnvironment, PmItem, PmKV, PmRequest, RequestSpec, ResponseData, Settings, TestResult } from './types';
import { emptyScopes, envToMap, kvToMap, type Scopes, type VarMap } from './vars';
import { formatArgs, useConsole } from '@/stores/console';
import { useWorkspace } from '@/stores/workspace';

export interface ExecContext {
  collection: PmCollection | null;
  collectionId: string | null;
  parents: PmItem[];
  scopes: Scopes;
  settings: Settings;
}

export function contextFor(collectionId: string | null, itemId: string | null): ExecContext {
  const ws = useWorkspace.getState();
  const collection = collectionId ? (ws.collections[collectionId] ?? null) : null;
  const parents = collection && itemId ? (findItem(collection.item, itemId)?.parents ?? []) : [];
  const env = ws.activeEnv ? ws.environments[ws.activeEnv] : null;
  const scopes = emptyScopes();
  scopes.globals = envToMap(ws.globals);
  scopes.collection = kvToMap(collection?.variable);
  scopes.environment = envToMap(env);
  return { collection, collectionId, parents, scopes, settings: ws.settings };
}

/** Scripts of a kind from collection, each folder, then the item. */
export function scriptChain(ctx: ExecContext, item: PmItem, listen: 'prerequest' | 'test'): { where: string; code: string }[] {
  const out: { where: string; code: string }[] = [];
  const c = scriptOf(ctx.collection?.event, listen);
  if (c.trim()) out.push({ where: ctx.collection?.info.name ?? 'collection', code: c });
  for (const p of ctx.parents) {
    const f = scriptOf(p.event, listen);
    if (f.trim()) out.push({ where: p.name, code: f });
  }
  const own = scriptOf(item.event, listen);
  if (own.trim()) out.push({ where: item.name, code: own });
  return out;
}

function applyMapToEnv(values: PmEnvValue[], before: VarMap, after: VarMap): PmEnvValue[] {
  const out = values.map((v) => ({ ...v }));
  for (const [k, v] of Object.entries(after)) {
    if (before[k] === v) continue;
    const existing = out.find((x) => x.key === k);
    if (existing) {
      existing.value = v;
      delete existing.currentValue;
      existing.enabled = true;
    } else out.push({ key: k, value: v, type: 'default', enabled: true });
  }
  for (const k of Object.keys(before)) {
    if (!(k in after)) {
      const i = out.findIndex((x) => x.key === k);
      if (i >= 0) out.splice(i, 1);
    }
  }
  return out;
}

function applyMapToKv(list: PmKV[] | undefined, before: VarMap, after: VarMap): PmKV[] {
  const out = (list ?? []).map((v) => ({ ...v }));
  for (const [k, v] of Object.entries(after)) {
    if (before[k] === v) continue;
    const e = out.find((x) => x.key === k);
    if (e) e.value = v;
    else out.push({ key: k, value: v, type: 'string' });
  }
  for (const k of Object.keys(before)) if (!(k in after)) {
    const i = out.findIndex((x) => x.key === k);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

/** Persist variable changes made by scripts. */
export function commitScopes(ctx: ExecContext, before: Scopes) {
  const ws = useWorkspace.getState();
  const s = ctx.scopes;
  if (JSON.stringify(before.globals) !== JSON.stringify(s.globals)) {
    ws.updateGlobals((g) => {
      g.values = applyMapToEnv(g.values, before.globals, s.globals);
    });
  }
  if (ws.activeEnv && JSON.stringify(before.environment) !== JSON.stringify(s.environment)) {
    ws.updateEnvironment(ws.activeEnv, (e: PmEnvironment) => {
      e.values = applyMapToEnv(e.values, before.environment, s.environment);
    });
  }
  if (ctx.collectionId && JSON.stringify(before.collection) !== JSON.stringify(s.collection)) {
    ws.updateCollection(ctx.collectionId, (c) => {
      c.variable = applyMapToKv(c.variable, before.collection, s.collection);
    });
  }
}

const log = (level: 'log' | 'info' | 'warn' | 'error', args: unknown[]) =>
  useConsole.getState().push({ level, text: formatArgs(args) });

export interface ExecResult {
  spec: RequestSpec | null;
  response: ResponseData | null;
  error: string | null;
  tests: TestResult[];
  scriptErrors: string[];
  warnings: string[];
  skipped: boolean;
  nextRequest?: string | null;
  visualizer?: { template: string; data: unknown } | null;
}

/**
 * Full Postman pipeline for one item. `iteration` info and `data` are used by the runner.
 * The caller decides whether to commit variable changes (`commitScopes`).
 */
export async function execute(
  item: PmItem,
  ctx: ExecContext,
  opts: { requestId?: string; iteration?: number; iterationCount?: number; runScripts?: boolean } = {},
): Promise<ExecResult> {
  const req: PmRequest = clone(item.request ?? { method: 'GET', url: '' });
  const scriptErrors: string[] = [];
  const tests: TestResult[] = [];
  let next: string | null | undefined;
  let skipped = false;
  let visualizer: ExecResult['visualizer'] = null;
  const info = {
    requestName: item.name,
    requestId: item.id ?? '',
    iteration: opts.iteration ?? 0,
    iterationCount: opts.iterationCount ?? 1,
  };
  const buildForSend = (r: PmRequest) =>
    buildSpec(r, { collection: ctx.collection, parents: [], scopes: ctx.scopes, settings: ctx.settings }).spec;
  const sendRequest = async (spec: RequestSpec) => {
    log('info', [`pm.sendRequest ${spec.method} ${spec.url}`]);
    return api.send(spec);
  };
  const runScripts = opts.runScripts !== false;

  if (runScripts) {
    for (const s of scriptChain(ctx, item, 'prerequest')) {
      const out = await runScript(s.code, {
        listen: 'prerequest',
        scopes: ctx.scopes,
        request: req,
        info,
        sendRequest,
        buildForSend,
        log,
        onNextRequest: (n) => (next = n),
      });
      tests.push(...out.tests);
      if (out.error) scriptErrors.push(`Pre-request (${s.where}): ${out.error}`);
      if (out.skipRequest) skipped = true;
    }
  }
  if (skipped) {
    return { spec: null, response: null, error: null, tests, scriptErrors, warnings: [], skipped, nextRequest: next };
  }
  const { spec, warnings } = buildSpec(req, {
    collection: ctx.collection,
    parents: ctx.parents,
    scopes: ctx.scopes,
    settings: ctx.settings,
    behavior: item.protocolProfileBehavior,
  });
  let response: ResponseData | null = null;
  let error: string | null = null;
  try {
    response = await api.send(spec, opts.requestId);
    useConsole.getState().push({
      level: 'request',
      text: `${spec.method} ${spec.url} → ${response.status} ${response.statusText} (${Math.round(response.timings.totalMs)} ms)`,
      detail: { request: { ...spec, headers: response.requestHeaders }, response: { status: response.status, headers: response.headers, body: response.body.slice(0, 5000) } },
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    useConsole.getState().push({ level: 'error', text: `${spec.method} ${spec.url} → ${error}` });
  }
  if (response && runScripts) {
    for (const s of scriptChain(ctx, item, 'test')) {
      const out = await runScript(s.code, {
        listen: 'test',
        scopes: ctx.scopes,
        request: req,
        response,
        info,
        sendRequest,
        buildForSend,
        log,
        onNextRequest: (n) => (next = n),
      });
      tests.push(...out.tests);
      if (out.error) scriptErrors.push(`Tests (${s.where}): ${out.error}`);
      if (out.visualizer) visualizer = out.visualizer;
    }
  }
  return { spec, response, error, tests, scriptErrors, warnings, skipped, nextRequest: next, visualizer };
}
