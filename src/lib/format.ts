import { t } from './i18n';

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 2 : 1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–';
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '–';
  const sec = Math.round(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  if (h) return `${h}h ${m}m ${r}s`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

export function formatNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatPct(r: number, digits = 2): string {
  if (!Number.isFinite(r)) return '–';
  return `${(r * 100).toFixed(digits)}%`;
}

export function relTime(ts: number): string {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return t('just now');
  if (d < 3600) return t('{n}m ago', { n: Math.floor(d / 60) });
  if (d < 86400) return t('{n}h ago', { n: Math.floor(d / 3600) });
  return new Date(ts).toLocaleDateString();
}

export function statusTone(code: number | null | undefined): 'success' | 'warning' | 'danger' | 'muted' {
  if (!code) return 'danger';
  if (code < 300) return 'success';
  if (code < 400) return 'warning';
  return 'danger';
}

/** Pretty-print JSON when possible, otherwise return input. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function prettyXml(xml: string): string {
  const s = xml.replace(/>\s*</g, '><').trim();
  if (!s.startsWith('<')) return xml;
  let out = '';
  let depth = 0;
  for (const tok of s.split(/(?=<)|(?<=>)/g)) {
    if (!tok.trim()) continue;
    if (/^<\//.test(tok)) depth = Math.max(0, depth - 1);
    out += `${'  '.repeat(depth)}${tok}\n`;
    if (/^<[^!?/][^>]*[^/]>$/.test(tok) || /^<[^!?/>]>$/.test(tok)) depth++;
  }
  return out.replace(/(<([^/>\s]+)[^>]*>)\n\s*([^<\n]+)\n\s*(<\/\2>)/g, '$1$3$4').trim();
}

export function languageOf(contentType: string, body: string): 'json' | 'xml' | 'html' | 'javascript' | 'text' {
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('javascript')) return 'javascript';
  const head = body.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      JSON.parse(body);
      return 'json';
    } catch {
      /* not json */
    }
  }
  if (head.startsWith('<')) return head.toLowerCase().startsWith('<!doctype html') || head.toLowerCase().startsWith('<html') ? 'html' : 'xml';
  return 'text';
}

export function download(name: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'export';
