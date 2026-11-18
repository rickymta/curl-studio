/** cURL import (parse a command line into a Postman item) and export. */
import { makeUrl, newRequest } from './postman';
import type { PmItem, PmKV, RequestSpec } from './types';

/** Shell-like tokenizer: quotes, backslash/caret/backtick line continuations, $'…' strings. */
export function tokenize(cmd: string): string[] {
  const s = cmd
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ');
  const out: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
      i++;
      continue;
    }
    has = true;
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      cur += s.slice(i + 1, j < 0 ? s.length : j);
      i = j < 0 ? s.length : j + 1;
    } else if (c === '$' && s[i + 1] === "'") {
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          const n = s[i + 1]!;
          cur += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
          i += 2;
        } else cur += s[i++];
      }
      i++;
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1]!)) {
          cur += s[i + 1];
          i += 2;
        } else cur += s[i++];
      }
      i++;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1];
      i += 2;
    } else {
      cur += c;
      i++;
    }
  }
  if (has) out.push(cur);
  return out;
}

const DATA_FLAGS = ['-d', '--data', '--data-raw', '--data-ascii', '--data-binary', '--data-urlencode', '--json'];
const WITH_VALUE = new Set([
  '-X', '--request', '-H', '--header', '-u', '--user', '-A', '--user-agent', '-b', '--cookie', '-e', '--referer',
  '-F', '--form', '--form-string', '--url', '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy',
  '--oauth2-bearer', '-w', '--write-out', '-c', '--cookie-jar', '--cacert', '--cert', '--key', '-T', '--upload-file',
  '--retry', '--limit-rate', '--resolve', '--aws-sigv4', '--max-redirs', '-r', '--range',
  ...DATA_FLAGS,
]);

export function isCurl(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text);
}

export function parseCurl(cmd: string): PmItem {
  const t = tokenize(cmd.trim());
  if (!t.length || !/^curl(\.exe)?$/i.test(t[0]!)) throw new Error('Not a curl command');
  let method: string | null = null;
  let url = '';
  const headers: PmKV[] = [];
  const data: string[] = [];
  const urlencode: string[] = [];
  const form: { key: string; value: string; file: boolean }[] = [];
  let user: string | null = null;
  let get = false;
  let head = false;
  let json = false;
  let binaryFile: string | null = null;
  let insecure = false;
  let follow = false;
  let compressed = false;
  for (let i = 1; i < t.length; i++) {
    let a = t[i]!;
    let v: string | undefined;
    // --flag=value
    if (a.startsWith('--') && a.includes('=') && WITH_VALUE.has(a.slice(0, a.indexOf('=')))) {
      v = a.slice(a.indexOf('=') + 1);
      a = a.slice(0, a.indexOf('='));
    } else if (/^-[A-Za-z]./.test(a) && WITH_VALUE.has(a.slice(0, 2)) && !a.startsWith('--')) {
      // -XPOST, -H'…'
      v = a.slice(2);
      a = a.slice(0, 2);
    } else if (WITH_VALUE.has(a)) {
      v = t[++i] ?? '';
    }
    switch (a) {
      case '-X':
      case '--request':
        method = (v ?? '').toUpperCase();
        break;
      case '-H':
      case '--header': {
        const h = v ?? '';
        const c = h.indexOf(':');
        if (c > 0) headers.push({ key: h.slice(0, c).trim(), value: h.slice(c + 1).trim() });
        else if (h.endsWith(';')) headers.push({ key: h.slice(0, -1).trim(), value: '' });
        break;
      }
      case '-A':
      case '--user-agent':
        headers.push({ key: 'User-Agent', value: v ?? '' });
        break;
      case '-e':
      case '--referer':
        headers.push({ key: 'Referer', value: v ?? '' });
        break;
      case '-b':
      case '--cookie':
        headers.push({ key: 'Cookie', value: v ?? '' });
        break;
      case '-u':
      case '--user':
        user = v ?? '';
        break;
      case '--oauth2-bearer':
        headers.push({ key: 'Authorization', value: `Bearer ${v ?? ''}` });
        break;
      case '-F':
      case '--form':
      case '--form-string': {
        const f = v ?? '';
        const eq = f.indexOf('=');
        const key = f.slice(0, eq);
        const val = f.slice(eq + 1);
        const isFile = a !== '--form-string' && val.startsWith('@');
        form.push({ key, value: isFile ? val.slice(1).split(';')[0]! : val, file: isFile });
        break;
      }
      case '--data-urlencode':
        urlencode.push(v ?? '');
        break;
      case '--json':
        json = true;
        data.push(v ?? '');
        break;
      case '-T':
      case '--upload-file':
        binaryFile = v ?? '';
        if (!method) method = 'PUT';
        break;
      case '--url':
        url = v ?? '';
        break;
      case '-G':
      case '--get':
        get = true;
        break;
      case '-I':
      case '--head':
        head = true;
        break;
      case '-k':
      case '--insecure':
        insecure = true;
        break;
      case '-L':
      case '--location':
        follow = true;
        break;
      case '--compressed':
        compressed = true;
        break;
      default:
        if (DATA_FLAGS.includes(a)) {
          const d = v ?? '';
          if (d.startsWith('@') && a !== '--data-raw') binaryFile = d.slice(1);
          else data.push(d);
        } else if (!a.startsWith('-') && !url) {
          url = a;
        }
    }
  }
  if (!url) throw new Error('No URL found in the curl command');
  if (get && (data.length || urlencode.length)) {
    const q = [...data, ...urlencode].join('&');
    url += (url.includes('?') ? '&' : '?') + q;
    data.length = 0;
    urlencode.length = 0;
  }
  const hasBody = data.length || urlencode.length || form.length || binaryFile;
  const m = method ?? (head ? 'HEAD' : hasBody ? 'POST' : 'GET');
  const item = newRequest(url.replace(/^https?:\/\//, '').slice(0, 60) || 'Imported request', m, url);
  const req = item.request!;
  req.url = makeUrl(url);
  if (json) {
    if (!headers.some((h) => h.key.toLowerCase() === 'content-type'))
      headers.push({ key: 'Content-Type', value: 'application/json' });
    if (!headers.some((h) => h.key.toLowerCase() === 'accept')) headers.push({ key: 'Accept', value: 'application/json' });
  }
  req.header = headers;
  if (user !== null) {
    const c = user.indexOf(':');
    req.auth = {
      type: 'basic',
      basic: [
        { key: 'username', value: c < 0 ? user : user.slice(0, c), type: 'string' },
        { key: 'password', value: c < 0 ? '' : user.slice(c + 1), type: 'string' },
      ],
    };
  }
  if (form.length) {
    req.body = {
      mode: 'formdata',
      formdata: form.map((f) => (f.file ? { key: f.key, type: 'file', src: f.value } : { key: f.key, value: f.value, type: 'text' })),
    };
  } else if (binaryFile) {
    req.body = { mode: 'file', file: { src: binaryFile } };
  } else if (urlencode.length && !data.length) {
    req.body = {
      mode: 'urlencoded',
      urlencoded: urlencode.map((p) => {
        const eq = p.indexOf('=');
        return eq < 0 ? { key: p, value: '' } : { key: p.slice(0, eq), value: p.slice(eq + 1) };
      }),
    };
  } else if (data.length) {
    const raw = [...data, ...urlencode].join('&');
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
    const looksJson = /^\s*[[{]/.test(raw);
    if (ct.includes('x-www-form-urlencoded') || (!ct && !looksJson && /^[^=&\s]+=/.test(raw))) {
      req.body = {
        mode: 'urlencoded',
        urlencoded: raw.split('&').map((p) => {
          const eq = p.indexOf('=');
          const dec = (s: string) => {
            try {
              return decodeURIComponent(s.replace(/\+/g, ' '));
            } catch {
              return s;
            }
          };
          return eq < 0 ? { key: dec(p), value: '' } : { key: dec(p.slice(0, eq)), value: dec(p.slice(eq + 1)) };
        }),
      };
    } else {
      const lang = ct.includes('json') || looksJson ? 'json' : ct.includes('xml') ? 'xml' : 'text';
      req.body = { mode: 'raw', raw, options: { raw: { language: lang } } };
    }
  }
  const behavior: Record<string, unknown> = {};
  if (insecure) behavior.strictSSL = false;
  if (!follow) behavior.followRedirects = false;
  if (compressed && !headers.some((h) => h.key.toLowerCase() === 'accept-encoding')) {
    headers.push({ key: 'Accept-Encoding', value: 'gzip, deflate, br' });
  }
  if (Object.keys(behavior).length) item.protocolProfileBehavior = behavior;
  return item;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type CurlStyle = 'bash' | 'cmd' | 'powershell';

/** Render a resolved request as a curl command. */
export function toCurl(spec: RequestSpec, style: CurlStyle = 'bash', multiline = true): string {
  const q =
    style === 'cmd'
      ? (s: string) => `"${s.replace(/"/g, '\\"')}"`
      : style === 'powershell'
        ? (s: string) => `'${s.replace(/'/g, "''")}'`
        : shq;
  const cont = style === 'cmd' ? ' ^\n  ' : style === 'powershell' ? ' `\n  ' : ' \\\n  ';
  const exe = style === 'powershell' ? 'curl.exe' : 'curl';
  const parts: string[] = [];
  const hasBody = spec.body.mode !== 'none';
  if (spec.method !== 'GET' || (hasBody && spec.method === 'GET')) {
    if (!(spec.method === 'POST' && hasBody)) parts.push(`--request ${spec.method}`);
  }
  parts.push(q(spec.url));
  for (const h of spec.headers) parts.push(`--header ${q(`${h.key}: ${h.value}`)}`);
  if (spec.auth.type === 'digest') parts.push(`--digest --user ${q(`${spec.auth.username}:${spec.auth.password}`)}`);
  if (spec.auth.type === 'awsv4') {
    parts.push(`--aws-sigv4 ${q(`aws:amz:${spec.auth.region}:${spec.auth.service}`)}`);
    parts.push(`--user ${q(`${spec.auth.accessKey}:${spec.auth.secretKey}`)}`);
  }
  switch (spec.body.mode) {
    case 'raw':
      parts.push(`--data-raw ${q(spec.body.raw)}`);
      break;
    case 'urlencoded':
      for (const f of spec.body.fields) parts.push(`--data-urlencode ${q(`${f.key}=${f.value}`)}`);
      break;
    case 'formdata':
      for (const f of spec.body.fields) {
        if (f.type === 'file') for (const s of f.src) parts.push(`--form ${q(`${f.key}=@${s}`)}`);
        else parts.push(`--form ${q(`${f.key}=${f.value}`)}`);
      }
      break;
    case 'binary':
      parts.push(`--data-binary ${q(`@${spec.body.path}`)}`);
      break;
    case 'base64':
      parts.push(`--data-binary ${q('@payload.bin')}`);
      break;
  }
  if (spec.options.followRedirects) parts.push('--location');
  if (!spec.options.verifyTls) parts.push('--insecure');
  return `${exe} ${parts.join(multiline ? cont : ' ')}`;
}
