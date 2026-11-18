/**
 * Postman collection v2.1 / environment helpers: import normalisation (v1, v2.0, v2.1),
 * tree operations, URL ⇄ query sync, auth attribute access.
 */
import type {
  PmAuth,
  PmAuthAttr,
  PmCollection,
  PmEnvironment,
  PmEvent,
  PmItem,
  PmKV,
  PmRequest,
  PmUrl,
} from './types';

export const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/** Store ids are restricted to [A-Za-z0-9_-]. */
export const safeId = (s: string | undefined): string => {
  const v = (s ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return v.length > 0 && v.length <= 128 ? v : uid();
};

export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export const isFolder = (it: PmItem): boolean => Array.isArray(it.item);

export function descText(d: PmItem['description']): string {
  if (!d) return '';
  return typeof d === 'string' ? d : (d.content ?? '');
}

// ---- URL ------------------------------------------------------------------------------------

export function urlRaw(u: PmRequest['url']): string {
  if (!u) return '';
  if (typeof u === 'string') return u;
  if (u.raw !== undefined) return u.raw;
  // Rebuild from parts (some exporters omit raw).
  const host = Array.isArray(u.host) ? u.host.join('.') : (u.host ?? '');
  const path = Array.isArray(u.path) ? u.path.join('/') : (u.path ?? '');
  const q = (u.query ?? [])
    .filter((x) => !x.disabled)
    .map((x) => (x.value === null || x.value === undefined ? x.key : `${x.key}=${x.value}`))
    .join('&');
  return `${u.protocol ? `${u.protocol}://` : ''}${host}${u.port ? `:${u.port}` : ''}${path ? `/${path}` : ''}${q ? `?${q}` : ''}`;
}

/** Split a raw URL into query params (keeps `{{vars}}` intact, no decoding). */
export function parseQuery(raw: string): PmKV[] {
  const hashLess = raw.split('#')[0] ?? '';
  const i = hashLess.indexOf('?');
  if (i < 0) return [];
  return hashLess
    .slice(i + 1)
    .split('&')
    .filter((p) => p.length > 0)
    .map((p) => {
      const eq = p.indexOf('=');
      return eq < 0 ? { key: p, value: '' } : { key: p.slice(0, eq), value: p.slice(eq + 1) };
    });
}

/** Path variables (`:id`) present in a raw URL. */
export function pathVariables(raw: string): string[] {
  const noQuery = raw.split('?')[0] ?? '';
  const withoutScheme = noQuery.replace(/^[a-z]+:\/\//i, '');
  const out: string[] = [];
  for (const seg of withoutScheme.split('/').slice(1)) {
    const m = /^:([A-Za-z0-9_.-]+)$/.exec(seg);
    if (m?.[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Build a Postman URL object from raw text, keeping disabled params and path variable values. */
export function makeUrl(raw: string, prev?: PmUrl | string): PmUrl {
  const old = typeof prev === 'object' && prev ? prev : undefined;
  const enabled = parseQuery(raw);
  const disabled = (old?.query ?? []).filter((q) => q.disabled);
  const query = [...enabled.map((q) => ({ ...q })), ...disabled];
  const names = pathVariables(raw);
  const variable = names.map((n) => old?.variable?.find((v) => v.key === n) ?? { key: n, value: '' });
  const url: PmUrl = { raw };
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(raw) ?? /^()([^/?#]*)([^?#]*)/.exec(raw);
  if (m) {
    if (m[1]) url.protocol = m[1];
    const hostPort = m[2] ?? '';
    const pm = /^(.*?)(?::(\d+|\{\{[^}]+\}\}))?$/.exec(hostPort);
    if (pm?.[1]) url.host = pm[1].split('.');
    if (pm?.[2]) url.port = pm[2];
    const path = (m[3] ?? '').replace(/^\//, '');
    if (path) url.path = path.split('/');
  }
  if (query.length) url.query = query;
  if (variable.length) url.variable = variable;
  return url;
}

/** Rewrite the query part of raw from a params list (enabled ones only). */
export function withQuery(raw: string, params: PmKV[]): string {
  const [beforeHash, hash] = raw.split('#') as [string, string | undefined];
  const base = beforeHash.split('?')[0] ?? '';
  const q = params
    .filter((p) => !p.disabled && (p.key !== '' || (p.value ?? '') !== ''))
    .map((p) => ((p.value ?? '') === '' && !rawHadEquals(raw, p.key) ? p.key : `${p.key}=${p.value ?? ''}`))
    .join('&');
  return `${base}${q ? `?${q}` : ''}${hash !== undefined ? `#${hash}` : ''}`;
}

function rawHadEquals(raw: string, key: string): boolean {
  return raw.includes(`${key}=`);
}

// ---- auth -----------------------------------------------------------------------------------

export function authAttrs(auth: PmAuth | null | undefined): Record<string, string> {
  if (!auth) return {};
  const v = auth[auth.type];
  const out: Record<string, string> = {};
  if (Array.isArray(v)) {
    for (const a of v) out[a.key] = a.value === undefined || a.value === null ? '' : String(a.value);
  } else if (v && typeof v === 'object') {
    // v2.0 style: { username: 'x', password: 'y' }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = String(val ?? '');
  }
  return out;
}

export function setAuthAttr(auth: PmAuth, key: string, value: string): PmAuth {
  const list: PmAuthAttr[] = Array.isArray(auth[auth.type])
    ? [...(auth[auth.type] as PmAuthAttr[])]
    : Object.entries(authAttrs(auth)).map(([k, v]) => ({ key: k, value: v, type: 'string' }));
  const i = list.findIndex((a) => a.key === key);
  if (i >= 0) list[i] = { ...list[i]!, value };
  else list.push({ key, value, type: 'string' });
  return { ...auth, [auth.type]: list };
}

// ---- scripts --------------------------------------------------------------------------------

export function scriptOf(events: PmEvent[] | undefined, listen: string): string {
  const e = events?.find((x) => x.listen === listen && !x.disabled);
  if (!e) return '';
  const exec = e.script?.exec;
  return Array.isArray(exec) ? exec.join('\n') : (exec ?? '');
}

export function setScript(events: PmEvent[] | undefined, listen: string, code: string): PmEvent[] {
  const list = (events ?? []).filter((e) => e.listen !== listen);
  if (code.trim()) {
    list.push({ listen, script: { type: 'text/javascript', exec: code.split('\n') } });
  }
  return list;
}

// ---- tree -----------------------------------------------------------------------------------

export function walk(items: PmItem[], fn: (it: PmItem, parents: PmItem[]) => void, parents: PmItem[] = []) {
  for (const it of items) {
    fn(it, parents);
    if (it.item) walk(it.item, fn, [...parents, it]);
  }
}

export function findItem(
  items: PmItem[],
  id: string,
): { item: PmItem; parents: PmItem[]; siblings: PmItem[]; index: number } | null {
  const stack: { list: PmItem[]; parents: PmItem[] }[] = [{ list: items, parents: [] }];
  while (stack.length) {
    const { list, parents } = stack.pop()!;
    for (let i = 0; i < list.length; i++) {
      const it = list[i]!;
      if (it.id === id) return { item: it, parents, siblings: list, index: i };
      if (it.item) stack.push({ list: it.item, parents: [...parents, it] });
    }
  }
  return null;
}

/** Give every item an id (Postman exports may lack them). Mutates. */
export function ensureIds(items: PmItem[]): void {
  const seen = new Set<string>();
  walk(items, (it) => {
    if (!it.id || seen.has(it.id)) it.id = uid();
    seen.add(it.id);
  });
}

/** Deep copy with fresh ids. */
export function cloneWithNewIds(it: PmItem): PmItem {
  const c = clone(it);
  c.id = uid();
  if (c.item) c.item = c.item.map(cloneWithNewIds);
  return c;
}

export function countRequests(items: PmItem[]): number {
  let n = 0;
  walk(items, (it) => {
    if (!isFolder(it)) n++;
  });
  return n;
}

export function flattenRequests(items: PmItem[]): { item: PmItem; parents: PmItem[] }[] {
  const out: { item: PmItem; parents: PmItem[] }[] = [];
  walk(items, (it, parents) => {
    if (!isFolder(it)) out.push({ item: it, parents });
  });
  return out;
}

// ---- factories ------------------------------------------------------------------------------

export function newRequest(name = 'New Request', method = 'GET', url = ''): PmItem {
  return {
    id: uid(),
    name,
    request: { method, header: [], url: makeUrl(url) },
    response: [],
  };
}

export function newFolder(name = 'New Folder'): PmItem {
  return { id: uid(), name, item: [] };
}

export function newCollection(name = 'New Collection'): PmCollection {
  return { info: { _postman_id: uid(), name, schema: SCHEMA_V21 }, item: [], variable: [] };
}

export function newEnvironment(name = 'New Environment'): PmEnvironment {
  return {
    id: uid(),
    name,
    values: [],
    _postman_variable_scope: 'environment',
  };
}

// ---- import normalisation -------------------------------------------------------------------

type Json = Record<string, unknown>;

function normAuth(a: unknown): PmAuth | null | undefined {
  if (a === null) return null;
  if (!a || typeof a !== 'object') return undefined;
  const auth = a as Json;
  const type = String(auth.type ?? 'noauth');
  const v = auth[type];
  if (v && !Array.isArray(v) && typeof v === 'object') {
    // v2.0 → v2.1: object → [{key, value, type}]
    return {
      type,
      [type]: Object.entries(v as Json).map(([key, value]) => ({ key, value, type: 'string' })),
    };
  }
  return auth as PmAuth;
}

function normRequest(r: unknown): PmRequest {
  if (typeof r === 'string') return { method: 'GET', header: [], url: makeUrl(r) };
  const req = (r ?? {}) as Json;
  const out: PmRequest = { ...(req as PmRequest) };
  out.method = String(req.method ?? 'GET').toUpperCase();
  const h = req.header;
  if (typeof h === 'string') {
    out.header = h
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf(':');
        return { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
      });
  } else {
    out.header = Array.isArray(h) ? (h as PmKV[]) : [];
  }
  out.url = typeof req.url === 'string' ? makeUrl(req.url) : req.url ? (req.url as PmUrl) : makeUrl('');
  if (typeof out.url === 'object' && out.url.raw === undefined) out.url.raw = urlRaw(out.url);
  const auth = normAuth(req.auth);
  if (auth !== undefined) out.auth = auth;
  else delete out.auth;
  return out;
}

function normItem(i: unknown): PmItem {
  const it = (i ?? {}) as Json;
  const out: PmItem = { ...(it as unknown as PmItem) };
  out.name = String(it.name ?? 'Untitled');
  if (Array.isArray(it.item)) {
    out.item = (it.item as unknown[]).map(normItem);
    delete out.request;
  } else {
    out.request = normRequest(it.request);
    if (!Array.isArray(out.response)) out.response = [];
  }
  const auth = normAuth(it.auth);
  if (auth !== undefined) out.auth = auth;
  return out;
}

/** Postman v1 (`requests` + `folders` + `order`) → v2.1. */
function fromV1(c: Json): PmCollection {
  const requests = new Map<string, Json>();
  for (const r of (c.requests as Json[]) ?? []) requests.set(String(r.id), r);
  const toItem = (r: Json): PmItem => {
    const headers = String(r.headers ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf(':');
        return { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
      });
    const req: PmRequest = { method: String(r.method ?? 'GET'), header: headers, url: makeUrl(String(r.url ?? '')) };
    const mode = String(r.dataMode ?? '');
    if (mode === 'raw') req.body = { mode: 'raw', raw: String(r.rawModeData ?? '') };
    else if (mode === 'params' || mode === 'urlencoded') {
      const data = ((r.data as Json[]) ?? []).map((d) => ({
        key: String(d.key ?? ''),
        value: String(d.value ?? ''),
        type: String(d.type ?? 'text'),
        disabled: d.enabled === false,
      }));
      req.body = mode === 'params' ? { mode: 'formdata', formdata: data } : { mode: 'urlencoded', urlencoded: data };
    }
    const ev: PmEvent[] = [];
    if (r.preRequestScript) ev.push({ listen: 'prerequest', script: { exec: String(r.preRequestScript).split('\n') } });
    if (r.tests) ev.push({ listen: 'test', script: { exec: String(r.tests).split('\n') } });
    return { id: uid(), name: String(r.name ?? r.url ?? 'Request'), request: req, response: [], event: ev.length ? ev : undefined };
  };
  const used = new Set<string>();
  const folders: PmItem[] = ((c.folders as Json[]) ?? []).map((f) => ({
    id: uid(),
    name: String(f.name ?? 'Folder'),
    item: ((f.order as string[]) ?? [])
      .map((id) => {
        used.add(id);
        const r = requests.get(id);
        return r ? toItem(r) : null;
      })
      .filter((x): x is PmItem => x !== null),
  }));
  const root = ((c.order as string[]) ?? [...requests.keys()].filter((k) => !used.has(k)))
    .map((id) => requests.get(id))
    .filter((r): r is Json => !!r)
    .map(toItem);
  return {
    info: { _postman_id: uid(), name: String(c.name ?? 'Imported'), schema: SCHEMA_V21, description: String(c.description ?? '') },
    item: [...folders, ...root],
  };
}

export type Detected =
  | { type: 'collection'; collection: PmCollection }
  | { type: 'environment'; environment: PmEnvironment }
  | { type: 'globals'; environment: PmEnvironment }
  | { type: 'dump'; collections: PmCollection[]; environments: PmEnvironment[] };

/** Recognise and normalise any Postman JSON export. */
export function detectImport(json: unknown): Detected {
  if (!json || typeof json !== 'object') throw new Error('Not a JSON object');
  const o = json as Json;
  // Postman data dump (Settings → Data → Export data).
  if (Array.isArray(o.collections) || (Array.isArray(o.environments) && !('values' in o))) {
    return {
      type: 'dump',
      collections: ((o.collections as unknown[]) ?? []).map((c) => normaliseCollection(c)),
      environments: ((o.environments as unknown[]) ?? []).map((e) => normaliseEnvironment(e)),
    };
  }
  if (Array.isArray(o.values) && ('_postman_variable_scope' in o || 'name' in o) && !('item' in o)) {
    const env = normaliseEnvironment(o);
    return o._postman_variable_scope === 'globals'
      ? { type: 'globals', environment: env }
      : { type: 'environment', environment: env };
  }
  if ('info' in o || 'item' in o || 'requests' in o) {
    return { type: 'collection', collection: normaliseCollection(o) };
  }
  // Postman API wrappers: { collection: {...} } / { environment: {...} }
  if (o.collection && typeof o.collection === 'object') return detectImport(o.collection);
  if (o.environment && typeof o.environment === 'object') return detectImport(o.environment);
  throw new Error('Unrecognised file: expected a Postman collection, environment or data dump');
}

export function normaliseCollection(c: unknown): PmCollection {
  const o = (c ?? {}) as Json;
  if (Array.isArray(o.requests) && !o.item) {
    const v1 = fromV1(o);
    ensureIds(v1.item);
    return v1;
  }
  const info = (o.info ?? {}) as Json;
  const out: PmCollection = {
    ...(o as unknown as PmCollection),
    info: {
      ...(info as PmCollection['info']),
      _postman_id: String(info._postman_id ?? uid()),
      name: String(info.name ?? o.name ?? 'Imported Collection'),
      schema: SCHEMA_V21,
    },
    item: ((o.item as unknown[]) ?? []).map(normItem),
  };
  const auth = normAuth(o.auth);
  if (auth !== undefined) out.auth = auth;
  ensureIds(out.item);
  return out;
}

export function normaliseEnvironment(e: unknown): PmEnvironment {
  const o = (e ?? {}) as Json;
  return {
    id: String(o.id ?? uid()),
    name: String(o.name ?? 'Imported Environment'),
    values: ((o.values as Json[]) ?? []).map((v) => ({
      key: String(v.key ?? ''),
      value: v.value === undefined || v.value === null ? '' : String(v.value),
      type: String(v.type ?? 'default'),
      enabled: v.enabled !== false,
    })),
    _postman_variable_scope: o._postman_variable_scope === 'globals' ? 'globals' : 'environment',
  };
}

// ---- export ---------------------------------------------------------------------------------

/** Collection exactly as Postman writes it (schema 2.1). */
export function exportCollection(c: PmCollection): PmCollection {
  const out = clone(c);
  out.info.schema = SCHEMA_V21;
  return out;
}

export function exportEnvironment(env: PmEnvironment, scope: 'environment' | 'globals' = 'environment') {
  return {
    id: env.id,
    name: env.name,
    values: env.values.map((v) => ({
      key: v.key,
      value: v.value,
      type: v.type ?? 'default',
      enabled: v.enabled !== false,
    })),
    _postman_variable_scope: scope,
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'CurlStudio/0.1.0',
  };
}

/** Postman v2.0 export: auth params as objects instead of arrays. */
export function exportCollectionV20(c: PmCollection): unknown {
  const out = clone(c) as unknown as Json;
  (out.info as Json).schema = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json';
  const fixAuth = (a: unknown) => {
    if (!a || typeof a !== 'object') return a;
    const auth = a as Json;
    const t = String(auth.type);
    const v = auth[t];
    if (Array.isArray(v)) {
      const obj: Json = {};
      for (const x of v as PmAuthAttr[]) obj[x.key] = x.value;
      return { ...auth, [t]: obj };
    }
    return auth;
  };
  const fixItems = (items: Json[]) => {
    for (const it of items) {
      if (it.auth) it.auth = fixAuth(it.auth);
      const req = it.request as Json | undefined;
      if (req?.auth) req.auth = fixAuth(req.auth);
      if (Array.isArray(it.item)) fixItems(it.item as Json[]);
    }
  };
  if (out.auth) out.auth = fixAuth(out.auth);
  fixItems(out.item as Json[]);
  return out;
}

export const METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'COPY',
  'LINK',
  'UNLINK',
  'PURGE',
  'LOCK',
  'UNLOCK',
  'PROPFIND',
  'VIEW',
  'TRACE',
  'CONNECT',
];

export function methodColor(m: string): string {
  switch (m.toUpperCase()) {
    case 'GET':
      return 'text-[oklch(0.72_0.15_150)]';
    case 'POST':
      return 'text-[oklch(0.78_0.14_80)]';
    case 'PUT':
      return 'text-[oklch(0.7_0.13_240)]';
    case 'PATCH':
      return 'text-[oklch(0.72_0.12_300)]';
    case 'DELETE':
      return 'text-[oklch(0.68_0.18_25)]';
    case 'HEAD':
    case 'OPTIONS':
      return 'text-[oklch(0.72_0.1_200)]';
    default:
      return 'text-muted-foreground';
  }
}

export const PROTOCOL_LABEL: Record<string, string> = {
  http: 'HTTP',
  graphql: 'GraphQL',
  ws: 'WS',
  sse: 'SSE',
  grpc: 'gRPC',
  mqtt: 'MQTT',
};

/** Which editor an item opens in. */
export function itemProtocol(it: PmItem): 'http' | 'graphql' | 'ws' | 'sse' | 'grpc' | 'mqtt' {
  const ext = it['x-curlstudio'];
  if (ext?.kind) return ext.kind;
  if (it.request?.body?.mode === 'graphql') return 'graphql';
  return 'http';
}
