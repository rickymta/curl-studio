import { describe, expect, it } from 'vitest';

import { extractorsFromScript } from './scriptExtract';

describe('extractorsFromScript', () => {
  it('turns alias-based JSON setters into JSONPath extractors', () => {
    const code = `
      pm.test('status 200', () => pm.response.to.have.status(200));
      const j = pm.response.json();
      pm.environment.set('token', j.token);
      pm.environment.set("userId", j.user.id);
      const d = pm.response.json().data;
      pm.collectionVariables.set('first', d.items[0]["sku-code"]);
    `;
    expect(extractorsFromScript(code)).toEqual([
      { var: 'token', source: 'jsonpath', path: '$.token' },
      { var: 'userId', source: 'jsonpath', path: '$.user.id' },
      { var: 'first', source: 'jsonpath', path: "$.data.items[0]['sku-code']" },
    ]);
  });

  it('handles direct body, headers, cookies, status and legacy setters', () => {
    const code = `
      pm.collectionVariables.set('productId', pm.response.json().id);
      pm.globals.set('loc', pm.response.headers.get('Location'));
      postman.setEnvironmentVariable('sid', pm.cookies.get("session"));
      pm.variables.set('code', String(pm.response.code));
      pm.environment.set('raw', JSON.parse(responseBody).a.b);
    `;
    expect(extractorsFromScript(code)).toEqual([
      { var: 'productId', source: 'jsonpath', path: '$.id' },
      { var: 'loc', source: 'header', path: 'Location' },
      { var: 'sid', source: 'cookie', path: 'session' },
      { var: 'code', source: 'status' },
      { var: 'raw', source: 'jsonpath', path: '$.a.b' },
    ]);
  });

  it('ignores computed values it cannot map', () => {
    expect(extractorsFromScript("pm.environment.set('x', Date.now());\npm.environment.set('y', j.a + 1);")).toEqual([]);
  });
});
