/** Code snippets for a resolved request (Postman "Code" panel). */
import { toCurl } from './curl';
import type { RequestSpec } from './types';

export interface Language {
  id: string;
  label: string;
  cm: 'shell' | 'javascript' | 'python' | 'go' | 'csharp' | 'java' | 'php' | 'text';
  gen: (s: RequestSpec) => string;
}

const js = (v: unknown) => JSON.stringify(v);
const py = (s: string) => JSON.stringify(s);

function headersWithAuth(s: RequestSpec) {
  const h = [...s.headers];
  if (s.auth.type === 'digest') h.push({ key: '# digest auth', value: `${s.auth.username}` });
  return h.filter((x) => !x.key.startsWith('#'));
}

function bodyText(s: RequestSpec): string | null {
  switch (s.body.mode) {
    case 'raw':
      return s.body.raw;
    case 'urlencoded':
      return s.body.fields.map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`).join('&');
    default:
      return null;
  }
}

const fetchJs = (s: RequestSpec) => {
  const lines: string[] = [];
  const h = headersWithAuth(s);
  if (s.body.mode === 'formdata') {
    lines.push('const form = new FormData();');
    for (const f of s.body.fields) {
      if (f.type === 'file') for (const p of f.src) lines.push(`form.append(${js(f.key)}, fileInput.files[0], ${js(p)});`);
      else lines.push(`form.append(${js(f.key)}, ${js(f.value)});`);
    }
    lines.push('');
  }
  const opts: string[] = [`  method: ${js(s.method)},`];
  if (h.length) {
    opts.push('  headers: {');
    for (const x of h) opts.push(`    ${js(x.key)}: ${js(x.value)},`);
    opts.push('  },');
  }
  const b = bodyText(s);
  if (s.body.mode === 'formdata') opts.push('  body: form,');
  else if (b !== null) opts.push(`  body: ${s.body.mode === 'raw' && looksJson(b) ? `JSON.stringify(${b.trim()})` : js(b)},`);
  if (!s.options.followRedirects) opts.push("  redirect: 'manual',");
  lines.push(`const response = await fetch(${js(s.url)}, {`, ...opts, '});', '', 'console.log(response.status, await response.text());');
  return lines.join('\n');
};

function looksJson(b: string) {
  try {
    JSON.parse(b);
    return /^\s*[[{]/.test(b);
  } catch {
    return false;
  }
}

const axiosJs = (s: RequestSpec) => {
  const h = headersWithAuth(s);
  const lines = ["import axios from 'axios';", ''];
  if (s.body.mode === 'formdata') {
    lines.push("import FormData from 'form-data';", "import fs from 'node:fs';", '', 'const data = new FormData();');
    for (const f of s.body.fields) {
      if (f.type === 'file') for (const p of f.src) lines.push(`data.append(${js(f.key)}, fs.createReadStream(${js(p)}));`);
      else lines.push(`data.append(${js(f.key)}, ${js(f.value)});`);
    }
    lines.push('');
  }
  lines.push('const response = await axios.request({', `  method: ${js(s.method.toLowerCase())},`, `  url: ${js(s.url)},`);
  if (h.length) {
    lines.push('  headers: {');
    for (const x of h) lines.push(`    ${js(x.key)}: ${js(x.value)},`);
    if (s.body.mode === 'formdata') lines.push('    ...data.getHeaders(),');
    lines.push('  },');
  }
  const b = bodyText(s);
  if (s.body.mode === 'formdata') lines.push('  data,');
  else if (b !== null) lines.push(`  data: ${s.body.mode === 'raw' && looksJson(b) ? b.trim() : js(b)},`);
  if (!s.options.followRedirects) lines.push('  maxRedirects: 0,');
  lines.push(`  timeout: ${s.options.timeoutMs},`, '});', '', 'console.log(response.status, response.data);');
  return lines.join('\n');
};

const pythonRequests = (s: RequestSpec) => {
  const h = headersWithAuth(s);
  const lines = ['import requests', ''];
  lines.push(`url = ${py(s.url)}`);
  if (h.length) {
    lines.push('headers = {');
    for (const x of h) lines.push(`    ${py(x.key)}: ${py(x.value)},`);
    lines.push('}');
  }
  const args = ['url'];
  if (h.length) args.push('headers=headers');
  if (s.body.mode === 'raw') {
    lines.push(`payload = ${py(s.body.raw)}`);
    args.push('data=payload');
  } else if (s.body.mode === 'urlencoded') {
    lines.push('payload = {');
    for (const f of s.body.fields) lines.push(`    ${py(f.key)}: ${py(f.value)},`);
    lines.push('}');
    args.push('data=payload');
  } else if (s.body.mode === 'formdata') {
    lines.push('payload = {');
    for (const f of s.body.fields.filter((x) => x.type !== 'file')) lines.push(`    ${py(f.key)}: ${py(f.value)},`);
    lines.push('}', 'files = [');
    for (const f of s.body.fields.filter((x) => x.type === 'file'))
      for (const p of f.src) lines.push(`    (${py(f.key)}, open(${py(p)}, "rb")),`);
    lines.push(']');
    args.push('data=payload', 'files=files');
  } else if (s.body.mode === 'binary') {
    lines.push(`payload = open(${py(s.body.path)}, "rb").read()`);
    args.push('data=payload');
  }
  if (s.auth.type === 'digest') {
    lines.unshift('from requests.auth import HTTPDigestAuth');
    args.push(`auth=HTTPDigestAuth(${py(s.auth.username)}, ${py(s.auth.password)})`);
  }
  if (!s.options.verifyTls) args.push('verify=False');
  if (!s.options.followRedirects) args.push('allow_redirects=False');
  args.push(`timeout=${s.options.timeoutMs / 1000}`);
  lines.push('', `response = requests.request(${py(s.method)}, ${args.join(', ')})`, '', 'print(response.status_code)', 'print(response.text)');
  return lines.join('\n');
};

const goNet = (s: RequestSpec) => {
  const b = bodyText(s);
  const lines = ['package main', '', 'import (', '\t"fmt"', '\t"io"', '\t"net/http"'];
  if (b !== null) lines.push('\t"strings"');
  lines.push(')', '', 'func main() {');
  if (b !== null) lines.push(`\tbody := strings.NewReader(${js(b)})`);
  lines.push(`\treq, err := http.NewRequest(${js(s.method)}, ${js(s.url)}, ${b !== null ? 'body' : 'nil'})`, '\tif err != nil {', '\t\tpanic(err)', '\t}');
  for (const h of headersWithAuth(s)) lines.push(`\treq.Header.Add(${js(h.key)}, ${js(h.value)})`);
  lines.push(
    '\tres, err := http.DefaultClient.Do(req)',
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    '\tdefer res.Body.Close()',
    '\tdata, _ := io.ReadAll(res.Body)',
    '\tfmt.Println(res.Status)',
    '\tfmt.Println(string(data))',
    '}',
  );
  return lines.join('\n');
};

const csharp = (s: RequestSpec) => {
  const b = bodyText(s);
  const lines = ['using System.Net.Http;', '', 'var client = new HttpClient();', `var request = new HttpRequestMessage(new HttpMethod(${js(s.method)}), ${js(s.url)});`];
  const ct = s.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
  for (const h of headersWithAuth(s)) {
    if (h.key.toLowerCase() === 'content-type') continue;
    lines.push(`request.Headers.TryAddWithoutValidation(${js(h.key)}, ${js(h.value)});`);
  }
  if (b !== null) {
    lines.push(`request.Content = new StringContent(${js(b)}, System.Text.Encoding.UTF8${ct ? `, ${js(ct.split(';')[0])}` : ''});`);
  }
  lines.push('var response = await client.SendAsync(request);', 'Console.WriteLine((int)response.StatusCode);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());');
  return lines.join('\n');
};

const javaOkHttp = (s: RequestSpec) => {
  const b = bodyText(s);
  const ct = s.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? 'text/plain';
  const lines = ['OkHttpClient client = new OkHttpClient();'];
  if (b !== null) lines.push(`RequestBody body = RequestBody.create(${js(b)}, MediaType.parse(${js(ct)}));`);
  lines.push('Request request = new Request.Builder()', `    .url(${js(s.url)})`, `    .method(${js(s.method)}, ${b !== null ? 'body' : 'null'})`);
  for (const h of headersWithAuth(s)) lines.push(`    .addHeader(${js(h.key)}, ${js(h.value)})`);
  lines.push('    .build();', 'Response response = client.newCall(request).execute();', 'System.out.println(response.code());', 'System.out.println(response.body().string());');
  return lines.join('\n');
};

const powershell = (s: RequestSpec) => {
  const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
  const lines = ['$headers = @{'];
  for (const h of headersWithAuth(s)) lines.push(`  ${q(h.key)} = ${q(h.value)}`);
  lines.push('}');
  const b = bodyText(s);
  if (b !== null) lines.push(`$body = ${q(b)}`);
  lines.push(
    `$response = Invoke-WebRequest -Uri ${q(s.url)} -Method ${q(s.method)} -Headers $headers${b !== null ? ' -Body $body' : ''}${s.options.verifyTls ? '' : ' -SkipCertificateCheck'}`,
    '$response.StatusCode',
    '$response.Content',
  );
  return lines.join('\n');
};

const httpie = (s: RequestSpec) => {
  const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
  const parts = [`http ${s.method} ${q(s.url)}`];
  for (const h of headersWithAuth(s)) parts.push(q(`${h.key}:${h.value}`));
  if (s.body.mode === 'urlencoded') {
    parts[0] = `http --form ${s.method} ${q(s.url)}`;
    for (const f of s.body.fields) parts.push(q(`${f.key}=${f.value}`));
  }
  if (!s.options.verifyTls) parts.push('--verify=no');
  if (s.options.followRedirects) parts.push('--follow');
  let out = parts.join(' \\\n  ');
  if (s.body.mode === 'raw') out = `printf %s ${q(s.body.raw)} | ${out}`;
  return out;
};

const phpCurl = (s: RequestSpec) => {
  const q = (x: string) => `'${x.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const b = bodyText(s);
  const lines = ['<?php', '$curl = curl_init();', 'curl_setopt_array($curl, [', `  CURLOPT_URL => ${q(s.url)},`, '  CURLOPT_RETURNTRANSFER => true,', `  CURLOPT_CUSTOMREQUEST => ${q(s.method)},`];
  if (s.options.followRedirects) lines.push('  CURLOPT_FOLLOWLOCATION => true,');
  if (b !== null) lines.push(`  CURLOPT_POSTFIELDS => ${q(b)},`);
  lines.push('  CURLOPT_HTTPHEADER => [');
  for (const h of headersWithAuth(s)) lines.push(`    ${q(`${h.key}: ${h.value}`)},`);
  lines.push('  ],', ']);', '$response = curl_exec($curl);', 'curl_close($curl);', 'echo $response;');
  return lines.join('\n');
};

const rawHttp = (s: RequestSpec) => {
  let u: URL | null = null;
  try {
    u = new URL(s.url);
  } catch {
    /* keep null */
  }
  const lines = [`${s.method} ${u ? u.pathname + u.search : s.url} HTTP/1.1`];
  if (u) lines.push(`Host: ${u.host}`);
  for (const h of headersWithAuth(s)) lines.push(`${h.key}: ${h.value}`);
  const b = bodyText(s);
  if (b !== null) lines.push('', b);
  return lines.join('\n');
};

export const LANGUAGES: Language[] = [
  { id: 'curl', label: 'cURL (bash)', cm: 'shell', gen: (s) => toCurl(s, 'bash') },
  { id: 'curl-cmd', label: 'cURL (cmd.exe)', cm: 'shell', gen: (s) => toCurl(s, 'cmd') },
  { id: 'curl-ps', label: 'cURL (PowerShell)', cm: 'shell', gen: (s) => toCurl(s, 'powershell') },
  { id: 'http', label: 'HTTP (raw)', cm: 'text', gen: rawHttp },
  { id: 'fetch', label: 'JavaScript – fetch', cm: 'javascript', gen: fetchJs },
  { id: 'axios', label: 'Node.js – axios', cm: 'javascript', gen: axiosJs },
  { id: 'python', label: 'Python – requests', cm: 'python', gen: pythonRequests },
  { id: 'go', label: 'Go – net/http', cm: 'go', gen: goNet },
  { id: 'csharp', label: 'C# – HttpClient', cm: 'csharp', gen: csharp },
  { id: 'java', label: 'Java – OkHttp', cm: 'java', gen: javaOkHttp },
  { id: 'powershell', label: 'PowerShell – Invoke-WebRequest', cm: 'shell', gen: powershell },
  { id: 'httpie', label: 'HTTPie', cm: 'shell', gen: httpie },
  { id: 'php', label: 'PHP – cURL', cm: 'php', gen: phpCurl },
];
