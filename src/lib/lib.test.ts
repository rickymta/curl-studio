import { describe, expect, it } from 'vitest';

import { buildSpec } from './build';
import { LANGUAGES } from './codegen';
import { parseCurl, toCurl, tokenize } from './curl';
import { detectImport, exportCollection, exportCollectionV20, makeUrl, parseQuery, pathVariables, withQuery } from './postman';
import { runScript } from './sandbox';
import type { PmCollection, PmKV, ResponseData, Settings } from './types';
import { emptyScopes, resolve } from './vars';

const settings: Settings = {
  theme: 'dark',
  timeoutMs: 30000,
  followRedirects: true,
  maxRedirects: 10,
  verifyTls: true,
  proxy: '',
  http1Only: false,
  cookies: true,
  maxBodyMb: 50,
  historyLimit: 100,
  autoSave: true,
  discardUnsavedOnClose: false,
  zoom: 1,
  brightnessDark: 100,
  brightnessLight: 100,
  terminalShell: 'auto',
  terminalCwd: '',
  fontSize: 13,
};

const v21: PmCollection = {
  info: { _postman_id: 'abc-123', name: 'Demo', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [{ key: 'base', value: 'https://api.test' }],
  item: [
    {
      name: 'Users',
      item: [
        {
          name: 'Get user',
          request: {
            method: 'GET',
            header: [{ key: 'Accept', value: 'application/json' }, { key: 'X-Off', value: '1', disabled: true }],
            url: { raw: '{{base}}/users/:id?expand=true', variable: [{ key: 'id', value: '42' }] },
          },
        },
        {
          name: 'Create',
          request: {
            method: 'POST',
            auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] },
            url: '{{base}}/users',
            body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
          },
        },
      ],
    },
  ],
};

describe('postman import/export', () => {
  it('detects and round-trips v2.1', () => {
    const d = detectImport(JSON.parse(JSON.stringify(v21)));
    expect(d.type).toBe('collection');
    if (d.type !== 'collection') return;
    expect(d.collection.item[0]!.item![0]!.id).toBeTruthy();
    const out = exportCollection(d.collection);
    expect(out.info.schema).toContain('v2.1.0');
    expect(out.item[0]!.item![1]!.request!.body!.raw).toBe('{"a":1}');
  });

  it('normalises v2.0 auth objects and string urls', () => {
    const v20 = JSON.parse(JSON.stringify(exportCollectionV20(v21)));
    expect(v20.auth.bearer.token).toBe('{{token}}');
    const d = detectImport(v20);
    if (d.type !== 'collection') throw new Error('expected collection');
    expect(Array.isArray(d.collection.auth!.bearer)).toBe(true);
    const create = d.collection.item[0]!.item![1]!;
    expect(typeof create.request!.url).toBe('object');
  });

  it('detects environments, globals and dumps', () => {
    expect(detectImport({ id: 'e', name: 'Dev', values: [{ key: 'a', value: '1', enabled: true }], _postman_variable_scope: 'environment' }).type).toBe('environment');
    expect(detectImport({ name: 'g', values: [], _postman_variable_scope: 'globals' }).type).toBe('globals');
    expect(detectImport({ collections: [v21], environments: [] }).type).toBe('dump');
  });

  it('converts v1 collections', () => {
    const d = detectImport({
      name: 'Old',
      order: ['r1'],
      folders: [],
      requests: [{ id: 'r1', name: 'One', method: 'POST', url: 'http://x/y', headers: 'A: b\n', dataMode: 'raw', rawModeData: 'hi', tests: 'tests["ok"] = true;' }],
    });
    if (d.type !== 'collection') throw new Error('expected collection');
    expect(d.collection.item[0]!.request!.header![0]).toEqual({ key: 'A', value: 'b' });
    expect(d.collection.item[0]!.event![0]!.listen).toBe('test');
  });

  it('handles url query and path variables', () => {
    expect(parseQuery('http://a/b?x=1&y&z=')).toEqual([{ key: 'x', value: '1' }, { key: 'y', value: '' }, { key: 'z', value: '' }]);
    expect(pathVariables('{{base}}/users/:id/posts/:postId?x=:no')).toEqual(['id', 'postId']);
    expect(withQuery('http://a/b?x=1', [{ key: 'x', value: '2' }, { key: 'q', value: 'v', disabled: true }])).toBe('http://a/b?x=2');
    const u = makeUrl('https://api.test:8443/v1/items?a=1');
    expect(u.host).toEqual(['api', 'test']);
    expect(u.port).toBe('8443');
    expect(u.path).toEqual(['v1', 'items']);
  });
});

describe('variables and build', () => {
  it('resolves scopes by precedence and nested refs', () => {
    const s = emptyScopes();
    s.globals = { a: 'g', host: 'h.test' };
    s.environment = { a: 'e', base: 'https://{{host}}' };
    s.local = { a: 'l' };
    expect(resolve('{{a}} {{base}} {{missing}}', (n) => s.local[n] ?? s.environment[n] ?? s.globals[n])).toBe('l https://h.test {{missing}}');
    expect(resolve('{{$guid}}', () => undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('builds a spec with inherited auth, path vars and disabled headers', () => {
    const d = detectImport(JSON.parse(JSON.stringify(v21)));
    if (d.type !== 'collection') throw new Error();
    const c = d.collection;
    const folder = c.item[0]!;
    const scopes = emptyScopes();
    scopes.collection = { base: 'https://api.test' };
    scopes.environment = { token: 'T0K' };
    const { spec, warnings } = buildSpec(folder.item![0]!.request!, { collection: c, parents: [folder], scopes, settings });
    expect(spec.url).toBe('https://api.test/users/42?expand=true');
    expect(spec.headers).toContainEqual({ key: 'Authorization', value: 'Bearer T0K' });
    expect(spec.headers.find((h) => h.key === 'X-Off')).toBeUndefined();
    expect(warnings).toEqual([]);
    const create = buildSpec(folder.item![1]!.request!, { collection: c, parents: [folder], scopes, settings }).spec;
    expect(create.headers).toContainEqual({ key: 'Authorization', value: `Basic ${btoa('u:p')}` });
    expect(create.headers).toContainEqual({ key: 'Content-Type', value: 'application/json' });
  });

  it('keeps per-VU variables for the load engine', () => {
    const scopes = emptyScopes();
    scopes.environment = { base: 'https://x', token: 'env' };
    const { spec } = buildSpec(
      { method: 'GET', url: makeUrl('{{base}}/a?id={{$randomInt}}'), header: [{ key: 'Authorization', value: 'Bearer {{token}}' }] },
      { parents: [], scopes, settings, keep: new Set(['token']) },
    );
    expect(spec.url).toBe('https://x/a?id={{$randomInt}}');
    expect(spec.headers[0]!.value).toBe('Bearer {{token}}');
  });
});

describe('curl', () => {
  it('tokenizes quotes and continuations', () => {
    expect(tokenize(`curl -H 'A: b c' \\\n  "http://x" --data $'a\\nb'`)).toEqual(['curl', '-H', 'A: b c', 'http://x', '--data', 'a\nb']);
  });

  it('parses a typical Chrome "copy as cURL"', () => {
    const it2 = parseCurl(`curl 'https://api.test/v1/items?x=1' -X PUT -H 'content-type: application/json' -H 'authorization: Bearer abc' --data-raw '{"name":"n"}' --compressed -k`);
    const r = it2.request!;
    expect(r.method).toBe('PUT');
    expect(r.body!.mode).toBe('raw');
    expect(r.body!.options!.raw!.language).toBe('json');
    expect(r.header!.find((h) => h.key === 'authorization')!.value).toBe('Bearer abc');
    expect(it2.protocolProfileBehavior!.strictSSL).toBe(false);
  });

  it('parses forms, basic auth and -G', () => {
    const f = parseCurl(`curl -u me:pw -F 'file=@/tmp/a.png' -F name=x https://up.test`);
    expect(f.request!.method).toBe('POST');
    expect(f.request!.auth!.type).toBe('basic');
    expect(f.request!.body!.formdata![0]).toMatchObject({ key: 'file', type: 'file', src: '/tmp/a.png' });
    const g = parseCurl(`curl -G https://s.test/search -d q=abc -d n=5`);
    expect(g.request!.method).toBe('GET');
    expect(typeof g.request!.url === 'object' && g.request!.url.raw).toBe('https://s.test/search?q=abc&n=5');
    const u = parseCurl(`curl https://f.test -d 'a=1&b=two'`);
    expect(u.request!.body!.mode).toBe('urlencoded');
  });

  it('round-trips through toCurl and every code generator', () => {
    const spec = buildSpec(parseCurl(`curl -X PATCH https://a.test/x -H 'X-K: v' --data-raw $'{"k":"it\\'s"}'`).request!, { parents: [], scopes: emptyScopes(), settings }).spec;
    const back = parseCurl(toCurl(spec, 'bash', false));
    expect(back.request!.method).toBe('PATCH');
    expect(back.request!.body!.raw).toBe(`{"k":"it's"}`);
    for (const l of LANGUAGES) expect(l.gen(spec).length).toBeGreaterThan(10);
  });
});

describe('sandbox', () => {
  const response: ResponseData = {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    url: 'http://x',
    headers: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Set-Cookie', value: 'sid=1; Path=/' }],
    body: '{"token":"abc","items":[1,2]}',
    bodyEncoding: 'utf8',
    bodyTruncated: false,
    size: 30,
    headersSize: 10,
    timings: { prepareMs: 0, waitMs: 10, downloadMs: 1, totalMs: 12 },
    remoteAddr: null,
    requestHeaders: [],
    requestMethod: 'GET',
    requestUrl: 'http://x',
  };
  const ctx = (listen: 'prerequest' | 'test') => ({
    listen,
    scopes: emptyScopes(),
    request: { method: 'GET', header: [] as PmKV[], url: makeUrl('http://x/a?b=1') },
    response,
    info: { requestName: 'r', requestId: '1', iteration: 0, iterationCount: 1 },
    sendRequest: async () => response,
    buildForSend: () => buildSpec({ method: 'GET', url: 'http://x' }, { parents: [], scopes: emptyScopes(), settings }).spec,
    log: () => undefined,
  });

  it('runs pm tests, chai and Postman assertions', async () => {
    const c = ctx('test');
    const out = await runScript(
      `
      pm.test("status", () => pm.response.to.have.status(200));
      pm.test("ok", () => pm.response.to.be.ok);
      pm.test("json", () => { pm.expect(pm.response.json().items).to.have.lengthOf(2); });
      pm.test("header", () => pm.response.to.have.header("content-type"));
      pm.test("fail", () => pm.expect(1).to.equal(2));
      pm.test("schema", () => pm.response.to.have.jsonSchema({ type: "object", required: ["token"] }));
      pm.environment.set("token", pm.response.json().token);
      tests["legacy"] = responseCode.code === 200;
      pm.test("cookie", () => pm.expect(pm.cookies.get("sid")).to.eql("1"));
      `,
      c,
    );
    expect(out.error).toBeUndefined();
    const byName = Object.fromEntries(out.tests.map((t) => [t.name, t.passed]));
    expect(byName).toMatchObject({ status: true, ok: true, json: true, header: true, fail: false, schema: true, legacy: true, cookie: true });
    expect(c.scopes.environment.token).toBe('abc');
  });

  it('lets pre-request scripts change the request and use CryptoJS + sendRequest', async () => {
    const c = ctx('prerequest');
    const out = await runScript(
      `
      pm.request.headers.add({ key: "X-Sig", value: CryptoJS.SHA256("a").toString() });
      pm.request.url.query.add({ key: "c", value: "3" });
      pm.sendRequest("http://x", (err, res) => { pm.variables.set("got", res.json().token); });
      `,
      c,
    );
    expect(out.error).toBeUndefined();
    expect(c.request.header!.find((h) => h.key === 'X-Sig')!.value).toHaveLength(64);
    expect(typeof c.request.url === 'object' && c.request.url.raw).toBe('http://x/a?b=1&c=3');
    expect(c.scopes.local.got).toBe('abc');
  });

  it('reports script errors', async () => {
    const out = await runScript('undefinedFn();', ctx('test'));
    expect(out.error).toMatch(/ReferenceError/);
  });
});
