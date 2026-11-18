/**
 * Postman script sandbox: `pm.*` (variables, request, response, test/expect, sendRequest,
 * execution), the legacy `postman.*` / `tests[]` API, chai, CryptoJS.
 */
import * as chai from 'chai';
import CryptoJS from 'crypto-js';

import type { KeyValue, PmBody, PmKV, PmRequest, RequestSpec, ResponseData, TestResult } from './types';
import { makeUrl, urlRaw } from './postman';
import { lookup, resolve, type Scopes, type VarMap } from './vars';

export interface ScriptContext {
  listen: 'prerequest' | 'test';
  scopes: Scopes;
  /** Mutable request; pre-request changes are what gets sent. */
  request: PmRequest;
  response?: ResponseData | null;
  info: { requestName: string; requestId: string; iteration: number; iterationCount: number };
  sendRequest: (spec: RequestSpec) => Promise<ResponseData>;
  buildForSend: (req: PmRequest) => RequestSpec;
  log: (level: 'log' | 'info' | 'warn' | 'error', args: unknown[]) => void;
  onNextRequest?: (name: string | null) => void;
}

export interface ScriptOutcome {
  tests: TestResult[];
  error?: string;
  skipRequest?: boolean;
  visualizer?: { template: string; data: unknown } | null;
}

// ---- response wrapper + chai plugin -----------------------------------------------------------

class PmHeaderList {
  constructor(private list: KeyValue[]) {}
  get(name: string) {
    return this.list.find((h) => h.key.toLowerCase() === String(name).toLowerCase())?.value;
  }
  has(name: string, value?: string) {
    const v = this.get(name);
    return value === undefined ? v !== undefined : v === value;
  }
  toObject() {
    return Object.fromEntries(this.list.map((h) => [h.key, h.value]));
  }
  all() {
    return this.list.map((h) => ({ ...h }));
  }
  each(fn: (h: KeyValue) => void) {
    this.list.forEach(fn);
  }
  count() {
    return this.list.length;
  }
  toJSON() {
    return this.all();
  }
}

function decodeBody(r: ResponseData): string {
  if (r.bodyEncoding !== 'base64') return r.body;
  try {
    return atob(r.body);
  } catch {
    return '';
  }
}

export class PmResponse {
  code: number;
  status: string;
  headers: PmHeaderList;
  responseTime: number;
  responseSize: number;
  private _text: string;
  cookies: { get: (n: string) => string | undefined; has: (n: string) => boolean; toObject: () => VarMap };
  constructor(r: ResponseData) {
    this.code = r.status;
    this.status = r.statusText;
    this.headers = new PmHeaderList(r.headers);
    this.responseTime = Math.round(r.timings.totalMs);
    this.responseSize = r.size;
    this._text = decodeBody(r);
    const jar: VarMap = {};
    for (const h of r.headers) {
      if (h.key.toLowerCase() !== 'set-cookie') continue;
      const [kv] = h.value.split(';');
      const eq = kv!.indexOf('=');
      if (eq > 0) jar[kv!.slice(0, eq).trim()] = kv!.slice(eq + 1).trim();
    }
    this.cookies = { get: (n) => jar[n], has: (n) => n in jar, toObject: () => ({ ...jar }) };
  }
  text() {
    return this._text;
  }
  json(): unknown {
    return JSON.parse(this._text);
  }
  reason() {
    return this.status;
  }
  get to() {
    return chai.expect(this).to;
  }
}

/** Minimal JSON-schema check (type, required, properties, items, enum, min/max). */
function schemaErrors(v: unknown, s: Record<string, unknown>, path = '$'): string[] {
  const errs: string[] = [];
  const t = s.type as string | string[] | undefined;
  const typeOf = (x: unknown) =>
    x === null ? 'null' : Array.isArray(x) ? 'array' : Number.isInteger(x) ? 'integer' : typeof x;
  if (t) {
    const ts = Array.isArray(t) ? t : [t];
    const actual = typeOf(v);
    const ok = ts.some((x) => x === actual || (x === 'number' && actual === 'integer'));
    if (!ok) errs.push(`${path} should be ${ts.join('|')} but is ${actual}`);
  }
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v)))
    errs.push(`${path} should be one of ${JSON.stringify(s.enum)}`);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const r of (s.required as string[]) ?? []) if (!(r in o)) errs.push(`${path}.${r} is required`);
    const props = (s.properties as Record<string, Record<string, unknown>>) ?? {};
    for (const [k, ps] of Object.entries(props)) if (k in o) errs.push(...schemaErrors(o[k], ps, `${path}.${k}`));
  }
  if (Array.isArray(v) && s.items && typeof s.items === 'object') {
    v.forEach((x, i) => errs.push(...schemaErrors(x, s.items as Record<string, unknown>, `${path}[${i}]`)));
  }
  if (typeof v === 'number') {
    if (typeof s.minimum === 'number' && v < s.minimum) errs.push(`${path} < minimum ${s.minimum}`);
    if (typeof s.maximum === 'number' && v > s.maximum) errs.push(`${path} > maximum ${s.maximum}`);
  }
  if (typeof v === 'string') {
    if (typeof s.minLength === 'number' && v.length < s.minLength) errs.push(`${path} shorter than ${s.minLength}`);
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(v)) errs.push(`${path} does not match ${s.pattern}`);
  }
  return errs;
}

let pluginInstalled = false;
function installChaiPlugin() {
  if (pluginInstalled) return;
  pluginInstalled = true;
  chai.use((c, utils) => {
    const A = c.Assertion;
    const resp = (a: object) => utils.flag(a, 'object') as unknown;
    const isResp = (x: unknown): x is PmResponse => x instanceof PmResponse;
    A.addMethod('status', function (this: object, expected: number | string) {
      const r = resp(this);
      if (!isResp(r)) throw new Error('expected a response for .status()');
      const ok = typeof expected === 'number' ? r.code === expected : r.status === expected;
      (this as unknown as Chai.AssertionStatic & { assert: (...a: unknown[]) => void }).assert(
        ok,
        `expected response to have status ${typeof expected === 'number' ? 'code' : 'reason'} #{exp} but got #{act}`,
        `expected response to not have status #{exp}`,
        expected,
        typeof expected === 'number' ? r.code : r.status,
      );
    });
    A.addMethod('header', function (this: object, name: string, value?: string) {
      const r = resp(this);
      if (!isResp(r)) throw new Error('expected a response for .header()');
      const v = r.headers.get(name);
      const ok = value === undefined ? v !== undefined : v === value;
      (this as unknown as { assert: (...a: unknown[]) => void }).assert(
        ok,
        value === undefined ? `expected response to have header ${name}` : `expected header ${name} to be #{exp} but got #{act}`,
        `expected response to not have header ${name}`,
        value,
        v,
      );
    });
    A.addMethod('body', function (this: object, expected?: string | object) {
      const r = resp(this);
      if (!isResp(r)) throw new Error('expected a response for .body()');
      let ok: boolean;
      if (expected === undefined) ok = r.text().length > 0;
      else if (typeof expected === 'string') ok = r.text() === expected;
      else ok = JSON.stringify(safeJson(r)) === JSON.stringify(expected);
      (this as unknown as { assert: (...a: unknown[]) => void }).assert(ok, 'expected response body to match', 'expected response body to not match', expected, r.text().slice(0, 200));
    });
    A.addMethod('jsonBody', function (this: object, path?: string, value?: unknown) {
      const r = resp(this);
      if (!isResp(r)) throw new Error('expected a response for .jsonBody()');
      const j = safeJson(r);
      let ok = j !== undefined;
      if (ok && path !== undefined) {
        const got = getPath(j, path);
        ok = arguments.length > 1 ? JSON.stringify(got) === JSON.stringify(value) : got !== undefined;
      }
      (this as unknown as { assert: (...a: unknown[]) => void }).assert(ok, `expected response to have JSON body${path ? ` at ${path}` : ''}`, 'expected response to not have JSON body', value, path ? getPath(j, path) : j);
    });
    A.addMethod('jsonSchema', function (this: object, schema: Record<string, unknown>) {
      const r = resp(this);
      const v = isResp(r) ? safeJson(r) : r;
      const errs = schemaErrors(v, schema);
      (this as unknown as { assert: (...a: unknown[]) => void }).assert(errs.length === 0, `expected data to satisfy schema: ${errs.slice(0, 3).join('; ')}`, 'expected data to not satisfy schema');
    });
    A.addMethod('responseTime', function (this: object) {
      // used as .to.have.responseTime.below(x) in some scripts → return chainable number
      const r = resp(this);
      utils.flag(this, 'object', isResp(r) ? r.responseTime : r);
    });
    const range = (name: string, lo: number, hi: number) =>
      A.addProperty(name, function (this: object) {
        const r = resp(this);
        if (!isResp(r)) throw new Error(`expected a response for .${name}`);
        (this as unknown as { assert: (...a: unknown[]) => void }).assert(
          r.code >= lo && r.code <= hi,
          `expected response code to be ${name} (${lo}-${hi}) but got #{act}`,
          `expected response code to not be ${name}`,
          undefined,
          r.code,
        );
      });
    range('info', 100, 199);
    range('success', 200, 299);
    range('redirection', 300, 399);
    range('clientError', 400, 499);
    range('serverError', 500, 599);
    range('error', 400, 599);
    const code = (name: string, n: number) =>
      A.addProperty(name, function (this: object) {
        const r = resp(this);
        if (!isResp(r)) throw new Error(`expected a response for .${name}`);
        (this as unknown as { assert: (...a: unknown[]) => void }).assert(r.code === n, `expected response code to be ${n} but got #{act}`, `expected response code to not be ${n}`, n, r.code);
      });
    code('accepted', 202);
    code('badRequest', 400);
    code('unauthorized', 401);
    code('forbidden', 403);
    code('notFound', 404);
    code('rateLimited', 429);
    A.overwriteProperty('ok', (orig: () => void) =>
      function (this: object) {
        const r = resp(this);
        if (isResp(r)) {
          (this as unknown as { assert: (...a: unknown[]) => void }).assert(r.code === 200, 'expected response code to be 200 but got #{act}', 'expected response code to not be 200', 200, r.code);
        } else orig.call(this);
      },
    );
    const fmt = (name: string, test: (ct: string, r: PmResponse) => boolean) =>
      A.overwriteProperty(name, (orig: (() => void) | undefined) =>
        function (this: object) {
          const r = resp(this);
          if (isResp(r)) {
            const ct = r.headers.get('content-type') ?? '';
            (this as unknown as { assert: (...a: unknown[]) => void }).assert(test(ct, r), `expected response to be ${name}`, `expected response to not be ${name}`);
          } else if (orig) orig.call(this);
        },
      );
    fmt('json', (_ct, r) => safeJson(r) !== undefined);
    fmt('html', (ct) => ct.includes('html'));
    fmt('xml', (ct) => ct.includes('xml'));
    A.addProperty('withBody', function (this: object) {
      const r = resp(this);
      if (isResp(r)) (this as unknown as { assert: (...a: unknown[]) => void }).assert(r.text().length > 0, 'expected response to have a body', 'expected response to not have a body');
    });
  });
}

function safeJson(r: PmResponse): unknown {
  try {
    return r.json();
  } catch {
    return undefined;
  }
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// ---- variable scope objects -------------------------------------------------------------------

function scopeApi(map: VarMap, scopes: Scopes, onChange?: () => void) {
  return {
    get: (k: string) => map[k],
    set: (k: string, v: unknown) => {
      map[k] = typeof v === 'string' ? v : v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      onChange?.();
    },
    unset: (k: string) => {
      delete map[k];
      onChange?.();
    },
    has: (k: string) => Object.prototype.hasOwnProperty.call(map, k),
    clear: () => {
      for (const k of Object.keys(map)) delete map[k];
      onChange?.();
    },
    toObject: () => ({ ...map }),
    values: () => ({ ...map }),
    replaceIn: (s: string) => resolve(s, (n) => lookup(scopes, n)),
    name: '',
  };
}

// ---- request wrapper ----------------------------------------------------------------------------

function propertyList(list: PmKV[], onChange: () => void) {
  return {
    add(h: PmKV | string) {
      if (typeof h === 'string') {
        const i = h.indexOf(':');
        list.push({ key: h.slice(0, i).trim(), value: h.slice(i + 1).trim() });
      } else list.push({ key: h.key, value: String(h.value ?? '') });
      onChange();
    },
    upsert(h: PmKV) {
      const x = list.find((y) => y.key.toLowerCase() === h.key.toLowerCase());
      if (x) x.value = String(h.value ?? '');
      else list.push({ key: h.key, value: String(h.value ?? '') });
      onChange();
    },
    remove(key: string | ((h: PmKV) => boolean)) {
      for (let i = list.length - 1; i >= 0; i--) {
        const h = list[i]!;
        if (typeof key === 'function' ? key(h) : h.key.toLowerCase() === key.toLowerCase()) list.splice(i, 1);
      }
      onChange();
    },
    get: (key: string) => list.find((h) => !h.disabled && h.key.toLowerCase() === key.toLowerCase())?.value,
    has: (key: string) => list.some((h) => !h.disabled && h.key.toLowerCase() === key.toLowerCase()),
    toObject: () => Object.fromEntries(list.filter((h) => !h.disabled).map((h) => [h.key, h.value ?? ''])),
    all: () => list.filter((h) => !h.disabled),
    each: (fn: (h: PmKV) => void) => list.filter((h) => !h.disabled).forEach(fn),
    count: () => list.filter((h) => !h.disabled).length,
  };
}

function requestApi(req: PmRequest) {
  req.header ??= [];
  const urlObj = () => (typeof req.url === 'object' && req.url ? req.url : (req.url = makeUrl(urlRaw(req.url))));
  const syncQuery = () => {
    const u = urlObj();
    const base = u.raw.split('?')[0] ?? '';
    const q = (u.query ?? []).filter((x) => !x.disabled).map((x) => (x.value ? `${x.key}=${x.value}` : x.key)).join('&');
    u.raw = q ? `${base}?${q}` : base;
  };
  const url = {
    toString: () => urlRaw(req.url),
    getHost: () => {
      const h = urlObj().host;
      return Array.isArray(h) ? h.join('.') : (h ?? '');
    },
    getPath: () => '/' + ((urlObj().path as string[] | undefined) ?? []).join('/'),
    getQueryString: () => urlRaw(req.url).split('?')[1] ?? '',
    update: (raw: string) => {
      req.url = makeUrl(raw, req.url);
    },
    get query() {
      const u = urlObj();
      u.query ??= [];
      return propertyList(u.query, syncQuery);
    },
    get variables() {
      const u = urlObj();
      u.variable ??= [];
      return propertyList(u.variable, () => undefined);
    },
  };
  return {
    get url() {
      return url;
    },
    set url(v: string | { toString(): string }) {
      req.url = makeUrl(String(v), req.url);
    },
    get method() {
      return req.method ?? 'GET';
    },
    set method(m: string) {
      req.method = m.toUpperCase();
    },
    headers: propertyList(req.header, () => undefined),
    get body(): PmBody & { toString(): string; update(v: string | PmBody): void } {
      const b = req.body ?? { mode: 'none' };
      return {
        ...b,
        toString: () => (b.mode === 'raw' ? (b.raw ?? '') : b.mode === 'graphql' ? JSON.stringify(b.graphql) : ''),
        update: (v: string | PmBody) => {
          req.body = typeof v === 'string' ? { ...(req.body ?? {}), mode: 'raw', raw: v } : v;
        },
      };
    },
    set body(v: PmBody & { toString(): string; update(v: string | PmBody): void }) {
      req.body = v;
    },
    get auth() {
      return req.auth;
    },
    addHeader: (h: PmKV) => req.header!.push(h),
    removeHeader: (k: string) => (req.header = req.header!.filter((h) => h.key.toLowerCase() !== k.toLowerCase())),
    toJSON: () => req,
  };
}

/** Normalise the argument of pm.sendRequest into a Postman request. */
function toPmRequest(arg: unknown): PmRequest {
  if (typeof arg === 'string') return { method: 'GET', header: [], url: makeUrl(arg) };
  const o = (arg ?? {}) as Record<string, unknown>;
  let header: PmKV[] = [];
  if (Array.isArray(o.header)) header = o.header as PmKV[];
  else if (o.header && typeof o.header === 'object')
    header = Object.entries(o.header as Record<string, unknown>).map(([key, value]) => ({ key, value: String(value) }));
  else if (typeof o.header === 'string') {
    const [k, ...v] = o.header.split(':');
    header = [{ key: k!.trim(), value: v.join(':').trim() }];
  }
  const body = o.body as PmBody | undefined;
  return {
    method: String(o.method ?? 'GET').toUpperCase(),
    header,
    url: makeUrl(typeof o.url === 'string' ? o.url : urlRaw(o.url as PmRequest['url'])),
    body,
  };
}

// ---- runner -------------------------------------------------------------------------------------

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

const REQUIRE: Record<string, unknown> = {
  'crypto-js': CryptoJS,
  chai,
};

export async function runScript(code: string, ctx: ScriptContext): Promise<ScriptOutcome> {
  installChaiPlugin();
  const tests: TestResult[] = [];
  const pending: Promise<unknown>[] = [];
  let skip = false;
  let visualizer: ScriptOutcome['visualizer'] = null;
  const s = ctx.scopes;
  const response = ctx.response ? new PmResponse(ctx.response) : null;

  const test = (name: string, fn?: () => unknown) => {
    if (typeof fn !== 'function') {
      tests.push({ name, passed: false, skipped: true });
      return;
    }
    const record = (err?: unknown) =>
      tests.push({ name, passed: !err, error: err ? (err instanceof Error ? err.message : String(err)) : undefined });
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        pending.push((r as Promise<unknown>).then(() => record(), (e) => record(e)));
      } else record();
    } catch (e) {
      record(e);
    }
  };
  (test as unknown as { skip: (n: string) => void }).skip = (name: string) => tests.push({ name, passed: false, skipped: true });

  const sendRequest = (req: unknown, cb?: (err: unknown, res: PmResponse | null) => void) => {
    const p = (async () => {
      try {
        const spec = ctx.buildForSend(toPmRequest(req));
        const r = await ctx.sendRequest(spec);
        const wrapped = new PmResponse(r);
        cb?.(null, wrapped);
        return wrapped;
      } catch (e) {
        cb?.(e, null);
        if (!cb) throw e;
        return null;
      }
    })();
    pending.push(p.catch(() => undefined));
    return p;
  };

  const variables = {
    ...scopeApi(s.local, s),
    get: (k: string) => lookup(s, k),
    has: (k: string) => lookup(s, k) !== undefined,
    toObject: () => ({ ...s.globals, ...s.collection, ...s.environment, ...s.data, ...s.local }),
  };
  const iterationData = {
    get: (k: string) => s.data[k],
    has: (k: string) => k in s.data,
    toObject: () => ({ ...s.data }),
    toJSON: () => ({ ...s.data }),
    unset: (k: string) => delete s.data[k],
  };
  const consoleApi = {
    log: (...a: unknown[]) => ctx.log('log', a),
    info: (...a: unknown[]) => ctx.log('info', a),
    warn: (...a: unknown[]) => ctx.log('warn', a),
    error: (...a: unknown[]) => ctx.log('error', a),
    debug: (...a: unknown[]) => ctx.log('log', a),
  };
  const setNext = (name: string | null) => ctx.onNextRequest?.(name);
  const pm = {
    info: { eventName: ctx.listen, ...ctx.info },
    environment: { ...scopeApi(s.environment, s), name: 'environment' },
    globals: scopeApi(s.globals, s),
    collectionVariables: scopeApi(s.collection, s),
    variables,
    iterationData,
    request: requestApi(ctx.request),
    response,
    test,
    expect: chai.expect,
    sendRequest,
    execution: {
      setNextRequest: setNext,
      skipRequest: () => {
        skip = true;
      },
      location: [ctx.info.requestName],
    },
    setNextRequest: setNext,
    visualizer: {
      set: (template: string, data: unknown) => {
        visualizer = { template, data };
      },
      clear: () => {
        visualizer = null;
      },
    },
    cookies: response?.cookies ?? { get: () => undefined, has: () => false, toObject: () => ({}) },
    require: (name: string) => {
      if (name in REQUIRE) return REQUIRE[name];
      throw new Error(`Module "${name}" is not available in the CurlStudio sandbox`);
    },
  };
  const legacyTests: Record<string, unknown> = {};
  const postman = {
    setEnvironmentVariable: (k: string, v: unknown) => pm.environment.set(k, v),
    getEnvironmentVariable: (k: string) => pm.environment.get(k),
    clearEnvironmentVariable: (k: string) => pm.environment.unset(k),
    clearEnvironmentVariables: () => pm.environment.clear(),
    setGlobalVariable: (k: string, v: unknown) => pm.globals.set(k, v),
    getGlobalVariable: (k: string) => pm.globals.get(k),
    clearGlobalVariable: (k: string) => pm.globals.unset(k),
    getResponseHeader: (k: string) => response?.headers.get(k),
    getResponseCookie: (k: string) => (response?.cookies.get(k) ? { name: k, value: response.cookies.get(k) } : null),
    setNextRequest: setNext,
  };
  const legacy = {
    responseBody: response?.text() ?? '',
    responseCode: response ? { code: response.code, name: response.status, detail: response.status } : undefined,
    responseTime: response?.responseTime ?? 0,
    responseHeaders: response ? response.headers.toObject() : {},
    environment: { ...s.environment },
    globals: { ...s.globals },
    data: { ...s.data },
    iteration: ctx.info.iteration,
    request: {
      url: urlRaw(ctx.request.url),
      method: ctx.request.method,
      headers: Object.fromEntries((ctx.request.header ?? []).map((h) => [h.key, h.value])),
      data: ctx.request.body?.raw ?? '',
    },
  };

  let error: string | undefined;
  try {
    const fn = new AsyncFunction(
      'pm', 'postman', 'console', 'tests', 'require', 'CryptoJS', 'chai',
      'responseBody', 'responseCode', 'responseTime', 'responseHeaders', 'environment', 'globals', 'data', 'iteration', 'request',
      'xml2Json', 'atob', 'btoa',
      code,
    );
    await fn(
      pm, postman, consoleApi, legacyTests, pm.require, CryptoJS, chai,
      legacy.responseBody, legacy.responseCode, legacy.responseTime, legacy.responseHeaders, legacy.environment, legacy.globals, legacy.data, legacy.iteration, legacy.request,
      xml2Json, (x: string) => atob(x), (x: string) => btoa(x),
    );
    // Give sendRequest callbacks / async tests up to 30 s.
    if (pending.length) {
      await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, 30_000))]);
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  for (const [name, v] of Object.entries(legacyTests)) tests.push({ name, passed: Boolean(v) });
  return { tests, error, skipRequest: skip, visualizer };
}

/** Postman's legacy xml2Json helper (attributes under `$`). */
export function xml2Json(xml: string): unknown {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const conv = (n: Element): unknown => {
    const obj: Record<string, unknown> = {};
    if (n.attributes.length) obj.$ = Object.fromEntries([...n.attributes].map((a) => [a.name, a.value]));
    const kids = [...n.children];
    if (!kids.length) {
      const t = n.textContent ?? '';
      return n.attributes.length ? { ...obj, _: t } : t;
    }
    for (const k of kids) {
      const v = conv(k);
      if (k.tagName in obj) {
        const cur = obj[k.tagName];
        obj[k.tagName] = Array.isArray(cur) ? [...cur, v] : [cur, v];
      } else obj[k.tagName] = v;
    }
    return obj;
  };
  const root = doc.documentElement;
  return { [root.tagName]: conv(root) };
}
