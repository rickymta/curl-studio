// Load tests don't run JavaScript (as in k6/JMeter, correlation uses extractors). This reads the
// common Postman test-script patterns that save a value from the response and turns them into
// extractors, so a "Login → token" chain works in a load test without rewriting it:
//
//   const json = pm.response.json();  pm.environment.set('token', json.data.token);
//   pm.collectionVariables.set('id', pm.response.json().id);
//   pm.globals.set('loc', pm.response.headers.get('Location'));
//   postman.setEnvironmentVariable('sid', pm.cookies.get('session'));

import type { Extractor } from './types';

const SETTERS =
  /(?:pm\.(?:environment|globals|collectionVariables|variables)\.set|postman\.set(?:Environment|Global)Variable)\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([^;\n]+?)\s*\)\s*;?\s*(?:$|\n|\/\/)/gm;

/** `.a.b[0]["c-d"]` → `$.a.b[0]['c-d']`; null when it isn't a plain member path. */
function toJsonPath(rest: string): string | null {
  const r = rest.trim();
  if (!r) return '$';
  if (!/^(\.[A-Za-z_$][\w$]*|\[\d+\]|\[(['"])[^'"]*\2\])+$/.test(r)) return null;
  return `$${r.replace(/\["([^"]*)"\]/g, "['$1']")}`;
}

/** Strip `String(…)`, `Number(…)`, `(…)` and a trailing `.toString()`. */
function unwrap(expr: string): string {
  let e = expr.trim();
  for (;;) {
    const m = /^(?:String|Number|parseInt|parseFloat)?\s*\(([\s\S]*)\)$/.exec(e);
    if (m && m[1] !== undefined && !m[1].includes(',')) e = m[1].trim();
    else break;
  }
  return e.replace(/\.toString\(\)$/, '').trim();
}

export function extractorsFromScript(code: string): Extractor[] {
  if (!code.trim()) return [];
  // Names bound to the parsed body, with the path they point at.
  const aliases = new Map<string, string>();
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(pm\.response\.json\(\)|JSON\.parse\(\s*responseBody\s*\))([^;\n]*)/g)) {
    const path = toJsonPath(m[3] ?? '');
    if (path) aliases.set(m[1]!, path);
  }
  const out: Extractor[] = [];
  for (const m of code.matchAll(SETTERS)) {
    const name = m[2]!;
    const expr = unwrap(m[3]!);
    let ex: Extractor | null = null;
    let mm: RegExpExecArray | null;
    if ((mm = /^pm\.response\.json\(\)(.*)$/.exec(expr)) || (mm = /^JSON\.parse\(\s*responseBody\s*\)(.*)$/.exec(expr))) {
      const p = toJsonPath(mm[1] ?? '');
      if (p) ex = { var: name, source: 'jsonpath', path: p };
    } else if ((mm = /^pm\.response\.headers\.get\(\s*(['"])([^'"]+)\1\s*\)$/.exec(expr)) || (mm = /^postman\.getResponseHeader\(\s*(['"])([^'"]+)\1\s*\)$/.exec(expr))) {
      ex = { var: name, source: 'header', path: mm[2] };
    } else if ((mm = /^pm\.cookies\.get\(\s*(['"])([^'"]+)\1\s*\)$/.exec(expr))) {
      ex = { var: name, source: 'cookie', path: mm[2] };
    } else if (/^pm\.response\.(code|status)$/.test(expr) || expr === 'responseCode.code') {
      ex = { var: name, source: 'status' };
    } else if ((mm = /^([A-Za-z_$][\w$]*)(.*)$/.exec(expr)) && aliases.has(mm[1]!)) {
      const base = aliases.get(mm[1]!)!;
      const p = toJsonPath(mm[2] ?? '');
      if (p) ex = { var: name, source: 'jsonpath', path: base + p.slice(1) };
    }
    if (ex && !out.some((o) => o.var === ex.var)) out.push(ex);
  }
  return out;
}
