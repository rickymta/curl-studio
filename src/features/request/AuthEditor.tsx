import { useState } from 'react';

import { VarInput } from '@/components/KeyValueTable';
import { Button, Field, Select, Spinner } from '@/components/ui';
import { api } from '@/lib/ipc';
import { authAttrs, setAuthAttr } from '@/lib/postman';
import type { PmAuth } from '@/lib/types';
import { lookup, resolve, type Scopes } from '@/lib/vars';
import { errText, toast } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

const TYPES = [
  { value: 'inherit', label: 'Inherit auth from parent' },
  { value: 'noauth', label: 'No Auth' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apikey', label: 'API Key' },
  { value: 'digest', label: 'Digest Auth' },
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'awsv4', label: 'AWS Signature' },
];

function Row({ label, value, onChange, known, secret, placeholder }: { label: string; value: string; onChange: (v: string) => void; known?: Set<string> | null; secret?: boolean; placeholder?: string }) {
  const [show, setShow] = useState(!secret);
  return (
    <Field label={label}>
      <div className="flex h-8 items-center rounded-md border border-border bg-background focus-within:border-accent">
        {show ? (
          <VarInput value={value} onChange={onChange} known={known} placeholder={placeholder} className="h-full" />
        ) : (
          <input type="password" value={value} onChange={(e) => onChange(e.target.value)} className="h-full flex-1 bg-transparent px-2 font-mono text-[12.5px] outline-none" />
        )}
        {secret && (
          <button type="button" onClick={() => setShow(!show)} className="px-2 text-[11px] text-muted-foreground hover:text-foreground">
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
    </Field>
  );
}

export function AuthEditor({
  auth,
  onChange,
  allowInherit = true,
  inheritedFrom,
  known,
  scopes,
}: {
  auth: PmAuth | null | undefined;
  onChange: (a: PmAuth | null | undefined) => void;
  allowInherit?: boolean;
  inheritedFrom?: string;
  known?: Set<string> | null;
  scopes?: Scopes;
}) {
  const type = auth === null ? 'noauth' : (auth?.type ?? (allowInherit ? 'inherit' : 'noauth'));
  const a = authAttrs(auth);
  const set = (k: string, v: string) => onChange(setAuthAttr(auth ?? { type }, k, v));
  const setType = (t: string) => {
    if (t === 'inherit') onChange(undefined);
    else if (t === 'noauth') onChange({ type: 'noauth' });
    else onChange({ type: t, [t]: [] });
  };
  const [busy, setBusy] = useState(false);

  const getToken = async () => {
    const r = (s: string) => (scopes ? resolve(s, (n) => lookup(scopes, n)) : s);
    const grant = a.grant_type || 'client_credentials';
    const fields: { key: string; value: string }[] = [{ key: 'grant_type', value: grant === 'password_credentials' ? 'password' : grant }];
    if (grant === 'password_credentials') {
      fields.push({ key: 'username', value: r(a.username ?? '') }, { key: 'password', value: r(a.password ?? '') });
    }
    if (a.scope) fields.push({ key: 'scope', value: r(a.scope) });
    if (a.audience) fields.push({ key: 'audience', value: r(a.audience) });
    const headers: { key: string; value: string }[] = [{ key: 'Accept', value: 'application/json' }];
    if ((a.client_authentication ?? 'header') === 'header') {
      headers.push({ key: 'Authorization', value: `Basic ${btoa(`${r(a.clientId ?? '')}:${r(a.clientSecret ?? '')}`)}` });
    } else {
      fields.push({ key: 'client_id', value: r(a.clientId ?? '') }, { key: 'client_secret', value: r(a.clientSecret ?? '') });
    }
    const s = useWorkspace.getState().settings;
    setBusy(true);
    try {
      const res = await api.send({
        method: 'POST',
        url: r(a.accessTokenUrl ?? ''),
        headers,
        body: { mode: 'urlencoded', fields },
        auth: { type: 'none' },
        options: { timeoutMs: s.timeoutMs, followRedirects: true, maxRedirects: 10, verifyTls: s.verifyTls, proxy: s.proxy, http1Only: false, cookies: false, maxBodyBytes: 1 << 20 },
      });
      const json = JSON.parse(res.body) as Record<string, unknown>;
      if (!json.access_token) throw new Error(`No access_token in response (${res.status}): ${res.body.slice(0, 200)}`);
      let next = setAuthAttr(auth ?? { type: 'oauth2' }, 'accessToken', String(json.access_token));
      if (json.refresh_token) next = setAuthAttr(next, 'refreshToken', String(json.refresh_token));
      if (json.token_type) next = setAuthAttr(next, 'tokenType', String(json.token_type));
      onChange(next);
      toast('success', 'Access token received');
    } catch (e) {
      toast('error', `Token request failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-6 p-3">
      <div className="w-60 shrink-0 space-y-2">
        <Field label="Type">
          <Select value={type} onChange={setType} options={allowInherit ? TYPES : TYPES.filter((t) => t.value !== 'inherit')} />
        </Field>
        <p className="text-[11.5px] text-muted-foreground">
          {type === 'inherit' && `Uses the auth of ${inheritedFrom ?? 'the parent folder or collection'}.`}
          {type === 'noauth' && 'This request does not use any authorization.'}
          {type === 'digest' && 'Digest challenge/response is handled automatically (MD5, SHA-256, -sess, qop=auth/auth-int).'}
          {type === 'awsv4' && 'Signed with AWS Signature Version 4 right before sending (covers the final body).'}
          {type === 'oauth2' && 'Adds the access token to the request. Use "Get New Access Token" for client credentials or password grants.'}
          {type === 'apikey' && 'Sends the key as a header or query parameter.'}
        </p>
      </div>
      <div className="grid max-w-xl flex-1 grid-cols-1 gap-3">
        {type === 'basic' && (
          <>
            <Row label="Username" value={a.username ?? ''} onChange={(v) => set('username', v)} known={known} />
            <Row label="Password" value={a.password ?? ''} onChange={(v) => set('password', v)} known={known} secret />
          </>
        )}
        {type === 'digest' && (
          <>
            <Row label="Username" value={a.username ?? ''} onChange={(v) => set('username', v)} known={known} />
            <Row label="Password" value={a.password ?? ''} onChange={(v) => set('password', v)} known={known} secret />
          </>
        )}
        {type === 'bearer' && <Row label="Token" value={a.token ?? ''} onChange={(v) => set('token', v)} known={known} secret />}
        {type === 'apikey' && (
          <>
            <Row label="Key" value={a.key ?? ''} onChange={(v) => set('key', v)} known={known} placeholder="x-api-key" />
            <Row label="Value" value={a.value ?? ''} onChange={(v) => set('value', v)} known={known} secret />
            <Field label="Add to">
              <Select value={a.in || 'header'} onChange={(v) => set('in', v)} options={[{ value: 'header', label: 'Header' }, { value: 'query', label: 'Query Params' }]} />
            </Field>
          </>
        )}
        {type === 'awsv4' && (
          <>
            <Row label="Access Key" value={a.accessKey ?? ''} onChange={(v) => set('accessKey', v)} known={known} />
            <Row label="Secret Key" value={a.secretKey ?? ''} onChange={(v) => set('secretKey', v)} known={known} secret />
            <Row label="AWS Region" value={a.region ?? ''} onChange={(v) => set('region', v)} known={known} placeholder="us-east-1" />
            <Row label="Service Name" value={a.service ?? ''} onChange={(v) => set('service', v)} known={known} placeholder="execute-api" />
            <Row label="Session Token" value={a.sessionToken ?? ''} onChange={(v) => set('sessionToken', v)} known={known} secret />
          </>
        )}
        {type === 'oauth2' && (
          <>
            <Row label="Access Token" value={a.accessToken ?? ''} onChange={(v) => set('accessToken', v)} known={known} secret />
            <div className="grid grid-cols-2 gap-3">
              <Row label="Header Prefix" value={a.headerPrefix ?? 'Bearer'} onChange={(v) => set('headerPrefix', v)} />
              <Field label="Add token to">
                <Select value={a.addTokenTo || 'header'} onChange={(v) => set('addTokenTo', v)} options={[{ value: 'header', label: 'Request Headers' }, { value: 'queryParams', label: 'Request URL' }]} />
              </Field>
            </div>
            <div className="mt-2 rounded-md border border-border p-3">
              <div className="mb-2 text-[12px] font-semibold">Configure New Token</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Grant Type">
                  <Select
                    value={a.grant_type || 'client_credentials'}
                    onChange={(v) => set('grant_type', v)}
                    options={[
                      { value: 'client_credentials', label: 'Client Credentials' },
                      { value: 'password_credentials', label: 'Password Credentials' },
                    ]}
                  />
                </Field>
                <Row label="Access Token URL" value={a.accessTokenUrl ?? ''} onChange={(v) => set('accessTokenUrl', v)} known={known} />
                <Row label="Client ID" value={a.clientId ?? ''} onChange={(v) => set('clientId', v)} known={known} />
                <Row label="Client Secret" value={a.clientSecret ?? ''} onChange={(v) => set('clientSecret', v)} known={known} secret />
                {a.grant_type === 'password_credentials' && (
                  <>
                    <Row label="Username" value={a.username ?? ''} onChange={(v) => set('username', v)} known={known} />
                    <Row label="Password" value={a.password ?? ''} onChange={(v) => set('password', v)} known={known} secret />
                  </>
                )}
                <Row label="Scope" value={a.scope ?? ''} onChange={(v) => set('scope', v)} known={known} />
                <Row label="Audience" value={a.audience ?? ''} onChange={(v) => set('audience', v)} known={known} />
                <Field label="Client Authentication">
                  <Select
                    value={a.client_authentication || 'header'}
                    onChange={(v) => set('client_authentication', v)}
                    options={[
                      { value: 'header', label: 'Send as Basic Auth header' },
                      { value: 'body', label: 'Send client credentials in body' },
                    ]}
                  />
                </Field>
              </div>
              <Button variant="primary" className="mt-3" onClick={getToken} disabled={busy || !a.accessTokenUrl}>
                {busy && <Spinner />} Get New Access Token
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
