/** Postman variable scopes and `{{var}}` / `{{$dynamic}}` substitution. */
import type { PmEnvironment, PmKV } from './types';

export type VarMap = Record<string, string>;

/** Scopes from lowest to highest precedence (Postman: global < collection < environment < data < local). */
export interface Scopes {
  globals: VarMap;
  collection: VarMap;
  environment: VarMap;
  data: VarMap;
  local: VarMap;
}

export const emptyScopes = (): Scopes => ({
  globals: {},
  collection: {},
  environment: {},
  data: {},
  local: {},
});

export function envToMap(env: PmEnvironment | null | undefined): VarMap {
  const out: VarMap = {};
  for (const v of env?.values ?? []) {
    if (v.enabled === false || !v.key) continue;
    out[v.key] = v.currentValue ?? v.value ?? '';
  }
  return out;
}

export function kvToMap(list: PmKV[] | undefined): VarMap {
  const out: VarMap = {};
  for (const v of list ?? []) {
    if (v.disabled || !v.key) continue;
    out[v.key] = v.value === undefined || v.value === null ? '' : String(v.value);
  }
  return out;
}

export function lookup(s: Scopes, name: string): string | undefined {
  for (const m of [s.local, s.data, s.environment, s.collection, s.globals]) {
    if (Object.prototype.hasOwnProperty.call(m, name)) return m[name];
  }
  return undefined;
}

export function scopeOf(s: Scopes, name: string): keyof Scopes | null {
  for (const k of ['local', 'data', 'environment', 'collection', 'globals'] as const) {
    if (Object.prototype.hasOwnProperty.call(s[k], name)) return k;
  }
  return null;
}

export function flatten(s: Scopes): VarMap {
  return { ...s.globals, ...s.collection, ...s.environment, ...s.data, ...s.local };
}

const FIRST = ['Ava', 'Liam', 'Mia', 'Noah', 'Emma', 'Lucas', 'Lan', 'Minh', 'Sofia', 'Kai', 'Hana', 'Leo'];
const LAST = ['Nguyen', 'Smith', 'Tran', 'Garcia', 'Kim', 'Le', 'Brown', 'Pham', 'Ito'];
const WORDS = ['alpha', 'bravo', 'cobalt', 'delta', 'ember', 'falcon', 'glacier', 'harbor', 'indigo', 'jade'];
const DOMAINS = ['example.com', 'example.net', 'example.org', 'test.dev'];
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
const rint = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/** Postman dynamic variables (a practical subset of the faker-backed list). */
export const DYNAMIC: Record<string, () => string> = {
  guid: uuid,
  randomUUID: uuid,
  timestamp: () => String(Math.floor(Date.now() / 1000)),
  isoTimestamp: () => new Date().toISOString(),
  randomInt: () => String(rint(0, 1000)),
  randomBoolean: () => String(Math.random() < 0.5),
  randomFirstName: () => pick(FIRST),
  randomLastName: () => pick(LAST),
  randomFullName: () => `${pick(FIRST)} ${pick(LAST)}`,
  randomUserName: () => `${pick(FIRST).toLowerCase()}${rint(10, 9999)}`,
  randomEmail: () => `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}@${pick(DOMAINS)}`,
  randomExampleEmail: () => `${pick(FIRST).toLowerCase()}@example.com`,
  randomPassword: () => Math.random().toString(36).slice(2, 12),
  randomWord: () => pick(WORDS),
  randomWords: () => [pick(WORDS), pick(WORDS), pick(WORDS)].join(' '),
  randomNoun: () => pick(WORDS),
  randomAdjective: () => pick(['quick', 'bright', 'calm', 'bold', 'eager']),
  randomColor: () => pick(['red', 'green', 'blue', 'orange', 'purple', 'teal']),
  randomHexColor: () => `#${rint(0, 0xffffff).toString(16).padStart(6, '0')}`,
  randomIP: () => `${rint(1, 254)}.${rint(0, 255)}.${rint(0, 255)}.${rint(1, 254)}`,
  randomIPV6: () => Array.from({ length: 8 }, () => rint(0, 0xffff).toString(16)).join(':'),
  randomMACAddress: () => Array.from({ length: 6 }, () => rint(0, 255).toString(16).padStart(2, '0')).join(':'),
  randomPhoneNumber: () => `${rint(200, 999)}-${rint(100, 999)}-${String(rint(0, 9999)).padStart(4, '0')}`,
  randomPrice: () => (Math.random() * 1000).toFixed(2),
  randomAlphaNumeric: () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rint(0, 35)]!,
  randomUrl: () => `https://${pick(WORDS)}.${pick(DOMAINS)}`,
  randomDomainName: () => `${pick(WORDS)}.${pick(DOMAINS)}`,
  randomCity: () => pick(['Hanoi', 'Tokyo', 'Berlin', 'Lima', 'Oslo']),
  randomCountry: () => pick(['Vietnam', 'Japan', 'Germany', 'Peru', 'Norway']),
  randomCountryCode: () => pick(['VN', 'JP', 'DE', 'PE', 'NO']),
  randomStreetAddress: () => `${rint(1, 999)} ${pick(WORDS)} Street`,
  randomCompanyName: () => `${pick(WORDS)} Labs`,
  randomJobTitle: () => pick(['Engineer', 'Designer', 'Manager', 'Analyst']),
  randomDateFuture: () => new Date(Date.now() + rint(1, 365) * 864e5).toISOString(),
  randomDatePast: () => new Date(Date.now() - rint(1, 365) * 864e5).toISOString(),
  randomDateRecent: () => new Date(Date.now() - rint(1, 7) * 864e5).toISOString(),
  randomLoremWord: () => pick(['lorem', 'ipsum', 'dolor', 'sit', 'amet']),
  randomLoremSentence: () => 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  randomLoremParagraph: () =>
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  randomCurrencyCode: () => pick(['USD', 'EUR', 'VND', 'JPY']),
  randomLocale: () => pick(['en', 'vi', 'ja', 'de']),
};

const VAR_RE = /\{\{([^{}]+?)\}\}/g;

/** Substitute variables; unknown ones stay as-is. Nested references resolve up to 5 levels. */
export function resolve(
  input: string,
  get: (name: string) => string | undefined,
  opts: { dynamic?: boolean } = {},
): string {
  if (!input || !input.includes('{{')) return input;
  let cur = input;
  for (let pass = 0; pass < 5; pass++) {
    const next = cur.replace(VAR_RE, (whole, rawName: string) => {
      const name = rawName.trim();
      if (name.startsWith('$')) {
        if (opts.dynamic === false) return whole;
        const f = DYNAMIC[name.slice(1)];
        return f ? f() : whole;
      }
      const v = get(name);
      return v === undefined ? whole : v;
    });
    if (next === cur || !next.includes('{{')) return next;
    cur = next;
  }
  return cur;
}

export const resolver = (s: Scopes) => (text: string) => resolve(text, (n) => lookup(s, n));

/** Names referenced in a string. */
export function referenced(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) {
    const n = m[1]!.trim();
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
