/** Postman request + scopes + inherited auth → backend RequestSpec. */
import { t } from './i18n';
import { authAttrs, makeUrl, urlRaw } from './postman';
import type {
  KeyValue,
  PmAuth,
  PmCollection,
  PmItem,
  PmRequest,
  RequestOptions,
  RequestSpec,
  Settings,
  SpecAuth,
  SpecBody,
} from './types';
import { lookup, resolve, type Scopes } from './vars';

export interface BuildContext {
  collection?: PmCollection | null;
  /** Folders from the root down to the item's parent. */
  parents: PmItem[];
  scopes: Scopes;
  settings: Settings;
  /** Item-level protocolProfileBehavior. */
  behavior?: Record<string, unknown>;
  /** Load-test mode: leave these names and dynamic variables for the engine (per VU). */
  keep?: Set<string>;
}

export const RAW_CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  text: 'text/plain',
  javascript: 'application/javascript',
};

/** Effective auth: request → nearest folder → collection (Postman "inherit auth from parent"). */
export function effectiveAuth(
  req: PmRequest | undefined,
  parents: PmItem[],
  collection?: PmCollection | null,
): { auth: PmAuth | null; source: string } {
  const own = req?.auth;
  if (own && own.type !== 'inherit') return { auth: own.type === 'noauth' ? null : own, source: 'request' };
  if (own === null) return { auth: null, source: 'request' };
  for (let i = parents.length - 1; i >= 0; i--) {
    const a = parents[i]!.auth;
    if (a && a.type !== 'inherit') return { auth: a.type === 'noauth' ? null : a, source: parents[i]!.name };
    if (a === null) return { auth: null, source: parents[i]!.name };
  }
  const c = collection?.auth;
  if (c && c.type !== 'inherit' && c.type !== 'noauth') return { auth: c, source: 'collection' };
  return { auth: null, source: 'none' };
}

export function requestOptions(settings: Settings, behavior?: Record<string, unknown>): RequestOptions {
  const b = behavior ?? {};
  return {
    timeoutMs: Number(b.requestTimeout ?? settings.timeoutMs) || settings.timeoutMs,
    followRedirects: b.followRedirects === undefined ? settings.followRedirects : Boolean(b.followRedirects),
    maxRedirects: Number(b.maxRedirects ?? settings.maxRedirects) || 10,
    verifyTls: b.strictSSL === undefined ? settings.verifyTls : Boolean(b.strictSSL),
    proxy: settings.proxy,
    http1Only: settings.http1Only,
    cookies: b.disableCookies ? false : settings.cookies,
    maxBodyBytes: Math.max(1, settings.maxBodyMb) * 1024 * 1024,
  };
}

function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

/** Replace `:name` path segments with values. */
function applyPathVars(raw: string, vars: { key: string; value?: string }[] | undefined, r: (s: string) => string) {
  if (!vars?.length) return raw;
  const [beforeQ, ...rest] = raw.split('?');
  const replaced = (beforeQ ?? '').replace(/\/:([A-Za-z0-9_.-]+)(?=\/|$)/g, (whole, name: string) => {
    const v = vars.find((x) => x.key === name);
    return v && (v.value ?? '') !== '' ? `/${r(v.value ?? '')}` : whole;
  });
  return rest.length ? `${replaced}?${rest.join('?')}` : replaced;
}

function hasHeader(h: KeyValue[], name: string) {
  return h.some((x) => x.key.toLowerCase() === name.toLowerCase());
}

export function buildSpec(req: PmRequest, ctx: BuildContext): { spec: RequestSpec; warnings: string[] } {
  const warnings: string[] = [];
  const keep = ctx.keep;
  const r = (s: string | undefined) =>
    resolve(s ?? '', (n) => (keep?.has(n) ? undefined : lookup(ctx.scopes, n)), { dynamic: !keep });
  const method = (req.method || 'GET').toUpperCase();
  const urlObj = typeof req.url === 'object' && req.url ? req.url : makeUrl(urlRaw(req.url));
  let url = r(applyPathVars(urlRaw(req.url), urlObj.variable, r)).trim();
  if (url && !url.startsWith('{{') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;

  const headers: KeyValue[] = (req.header ?? [])
    .filter((h) => !h.disabled && h.key)
    .map((h) => ({ key: r(h.key), value: r(h.value) }));

  // ---- body ----
  let body: SpecBody = { mode: 'none' };
  const b = req.body;
  if (b && !b.disabled && b.mode && b.mode !== 'none' && method !== 'HEAD') {
    switch (b?.mode) {
      case 'raw': {
        body = { mode: 'raw', raw: r(b.raw) };
        const lang = b.options?.raw?.language ?? 'text';
        if (!hasHeader(headers, 'content-type') && RAW_CONTENT_TYPES[lang]) {
          headers.push({ key: 'Content-Type', value: RAW_CONTENT_TYPES[lang]! });
        }
        break;
      }
      case 'urlencoded':
        body = {
          mode: 'urlencoded',
          fields: (b.urlencoded ?? []).filter((f) => !f.disabled && f.key).map((f) => ({ key: r(f.key), value: r(f.value) })),
        };
        break;
      case 'formdata':
        body = {
          mode: 'formdata',
          fields: (b.formdata ?? [])
            .filter((f) => !f.disabled && f.key)
            .map((f) => ({
              key: r(f.key),
              value: r(f.value),
              type: f.type === 'file' ? 'file' : 'text',
              src: f.type === 'file' ? (Array.isArray(f.src) ? f.src : f.src ? [f.src] : []) : [],
              contentType: f.contentType || undefined,
            })),
        };
        break;
      case 'file':
        body = { mode: 'binary', path: b.file?.src ?? '' };
        if (b.file?.content !== undefined && !b.file.src) body = { mode: 'raw', raw: b.file.content };
        break;
      case 'graphql': {
        let variables: unknown = undefined;
        const vtext = r(b.graphql?.variables ?? '').trim();
        if (vtext) {
          try {
            variables = JSON.parse(vtext);
          } catch {
            warnings.push(t('GraphQL variables are not valid JSON; sent as null'));
            variables = null;
          }
        }
        body = { mode: 'raw', raw: JSON.stringify({ query: r(b.graphql?.query ?? ''), variables }) };
        if (!hasHeader(headers, 'content-type')) headers.push({ key: 'Content-Type', value: 'application/json' });
        break;
      }
      default:
        break;
    }
  }

  // ---- auth ----
  let auth: SpecAuth = { type: 'none' };
  const { auth: eff } = effectiveAuth(req, ctx.parents, ctx.collection);
  if (eff) {
    const a = Object.fromEntries(Object.entries(authAttrs(eff)).map(([k, v]) => [k, r(v)]));
    switch (eff.type) {
      case 'basic':
        if (keep && /\{\{/.test(`${a.username}${a.password}`))
          warnings.push(t('Basic auth uses per-VU variables; they are encoded with the values at start time'));
        if (!hasHeader(headers, 'authorization'))
          headers.push({ key: 'Authorization', value: `Basic ${b64(`${a.username ?? ''}:${a.password ?? ''}`)}` });
        break;
      case 'bearer':
        if (!hasHeader(headers, 'authorization') && a.token)
          headers.push({ key: 'Authorization', value: `Bearer ${a.token}` });
        break;
      case 'apikey': {
        const key = a.key || 'x-api-key';
        if (a.in === 'query') {
          url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(a.value ?? '')}`;
        } else if (!hasHeader(headers, key)) headers.push({ key, value: a.value ?? '' });
        break;
      }
      case 'oauth2': {
        const token = a.accessToken ?? '';
        if (!token) {
          warnings.push(t('OAuth 2.0: no access token yet (use "Get New Access Token")'));
          break;
        }
        if (a.addTokenTo === 'queryParams') {
          url += `${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
        } else if (!hasHeader(headers, 'authorization')) {
          const prefix = a.headerPrefix === undefined || a.headerPrefix === '' ? 'Bearer' : a.headerPrefix;
          headers.push({ key: 'Authorization', value: `${prefix} ${token}`.trim() });
        }
        break;
      }
      case 'digest':
        auth = { type: 'digest', username: a.username ?? '', password: a.password ?? '' };
        break;
      case 'awsv4':
        auth = {
          type: 'awsv4',
          accessKey: a.accessKey ?? '',
          secretKey: a.secretKey ?? '',
          region: a.region || 'us-east-1',
          service: a.service || 'execute-api',
          sessionToken: a.sessionToken ?? '',
        };
        break;
      case 'jwt':
        warnings.push(t('JWT Bearer generation is not supported; set a Bearer token instead'));
        break;
      default:
        warnings.push(t('Auth type "{type}" is not supported and was ignored', { type: String(eff.type) }));
    }
  }

  const unresolved = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(/\{\{([^{}]+)\}\}/g)) unresolved.add(m[1]!.trim());
  };
  if (!keep) {
    scan(url);
    headers.forEach((h) => scan(h.value));
    if (unresolved.size) warnings.push(t('Unresolved variables: {names}', { names: [...unresolved].join(', ') }));
  }

  return {
    spec: {
      method,
      url,
      headers,
      body,
      auth,
      options: requestOptions(ctx.settings, ctx.behavior),
    },
    warnings,
  };
}
