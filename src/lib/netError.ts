// Turn raw transport errors ("error sending request for url (…): client error (Connect): tcp
// connect error: … (os error 10061)") into a short title and a hint, keeping the raw text as
// details.

export interface ExplainedError {
  kind: 'refused' | 'dns' | 'tls' | 'timeout' | 'url' | 'reset' | 'proxy' | 'other';
  title: string;
  hint: string;
  /** host:port the error mentions, when there is one. */
  target?: string;
}

function target(raw: string): string | undefined {
  const m = /for url \(([^)]+)\)/i.exec(raw) ?? /(https?|wss?|mqtts?):\/\/[^\s)'"]+/i.exec(raw);
  const url = m ? (m[1]?.includes('://') ? m[1] : m[0]) : undefined;
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return undefined;
  }
}

export function explainError(raw: string): ExplainedError {
  const s = raw.toLowerCase();
  const t = target(raw);
  const where = t ? ` ${t}` : '';
  if (/10061|econnrefused|connection refused|actively refused/.test(s)) {
    return { kind: 'refused', target: t, title: `Connection refused by${where || ' the server'}`, hint: 'Nothing is listening on that address. Is the server running, and are the host, port and variables such as {{baseUrl}} right?' };
  }
  if (/failed to lookup|no such host|getaddrinfo|dns error|name or service not known|11001|nodename nor servname/.test(s)) {
    return { kind: 'dns', target: t, title: `Host not found${where ? ` (${t})` : ''}`, hint: 'The name could not be resolved. Check the spelling, your network or VPN, and the proxy setting.' };
  }
  if (/certificate|invalidcertificate|unknownissuer|tls|ssl|handshake/.test(s)) {
    return { kind: 'tls', target: t, title: 'TLS/SSL error', hint: 'The certificate was not accepted. For a self-signed or local certificate, turn off “SSL certificate verification” in the request Settings tab (or in Settings → General).' };
  }
  if (/timed out|timeout|10060|deadline/.test(s)) {
    return { kind: 'timeout', target: t, title: `Request timed out${where ? ` (${t})` : ''}`, hint: 'The server did not answer in time. Raise the timeout in the request Settings tab or in Settings → General, or check the network.' };
  }
  if (/invalid url|empty host|relative url|builder error|invalid uri|url parse/.test(s)) {
    return { kind: 'url', target: t, title: 'Invalid URL', hint: 'Check the URL. A red {{variable}} means it has no value in the active environment.' };
  }
  if (/connection reset|10054|broken pipe|connection closed before message completed|unexpected eof/.test(s)) {
    return { kind: 'reset', target: t, title: `Connection closed by${where || ' the server'}`, hint: 'The server dropped the connection. Try HTTP/1.1 (request Settings), or check the server logs.' };
  }
  if (/proxy/.test(s)) {
    return { kind: 'proxy', target: t, title: 'Proxy error', hint: 'Check the proxy in Settings → General (empty = system proxy, none = direct).' };
  }
  return { kind: 'other', target: t, title: 'Could not send request', hint: 'See the details below.' };
}
