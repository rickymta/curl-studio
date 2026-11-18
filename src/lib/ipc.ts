import type * as T from './types';
import type * as L from './load/types';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const BRIDGE = 'http://127.0.0.1:1451/call';

export class IpcError extends Error {
  kind: string;
  constructor(e: T.AppError) {
    super(e.message);
    this.kind = e.kind;
  }
}

function toError(e: unknown): IpcError {
  if (e instanceof IpcError) return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const o = e as { kind?: string; message: string };
    return new IpcError({ kind: o.kind ?? 'unknown', message: o.message });
  }
  if (e instanceof TypeError) {
    return new IpcError({
      kind: 'bridge',
      message: `Backend unreachable (${e.message}). Run \`pnpm bridge\` or the desktop app.`,
    });
  }
  return new IpcError({ kind: 'unknown', message: String(e) });
}

/** Call one backend command (Tauri in the app, the dev HTTP bridge in a plain browser). */
export async function call<R>(cmd: string, args: Record<string, unknown> = {}): Promise<R> {
  try {
    if (inTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<R>('call', { cmd, args });
    }
    const res = await fetch(BRIDGE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd, args }),
    });
    const body = await res.json();
    if (!res.ok) throw body;
    return body as R;
  } catch (e) {
    throw toError(e);
  }
}

export const isTauri = inTauri;

type StoreKind =
  | 'collections'
  | 'environments'
  | 'loadScenarios'
  | 'loadRuns'
  | 'runnerRuns'
  | 'protos';
type DocName = 'globals' | 'settings' | 'history' | 'cookies' | 'workspace';

export const api = {
  info: () => call<{ version: string; dataDir: string; os: string }>('app.info'),
  readText: (path: string) => call<string>('fs.readText', { path }),
  writeText: (path: string, text: string) => call<null>('fs.writeText', { path, text }),
  readBase64: (path: string) => call<{ data: string; size: number }>('fs.readBase64', { path }),
  writeBase64: (path: string, data: string) => call<null>('fs.writeBase64', { path, data }),

  list: <D>(kind: StoreKind, omit: string[] = []) =>
    call<{ id: string; doc: D }[]>('store.list', { kind, omit }),
  get: <D>(kind: StoreKind, id: string) => call<D>('store.get', { kind, id }),
  put: (kind: StoreKind, id: string, doc: unknown) => call<null>('store.put', { kind, id, doc }),
  remove: (kind: StoreKind, id: string) => call<null>('store.delete', { kind, id }),
  getDoc: <D>(name: DocName) => call<D | null>('store.getDoc', { name }),
  putDoc: (name: DocName, doc: unknown) => call<null>('store.putDoc', { name, doc }),

  send: (spec: T.RequestSpec, id?: string) => call<T.ResponseData>('http.send', { spec, id }),
  cancel: (id: string) => call<boolean>('http.cancel', { id }),
  download: (path: string, spec: T.RequestSpec) => call<number>('http.download', { path, spec }),

  cookies: () => call<T.CookieInfo[]>('cookies.list'),
  removeCookie: (domain: string, path: string, name: string) =>
    call<null>('cookies.remove', { domain, path, name }),
  clearCookies: (domain?: string) => call<null>('cookies.clear', { domain }),
  setCookie: (domain: string, cookie: string) => call<null>('cookies.set', { domain, cookie }),

  wsConnect: (opts: {
    url: string;
    headers: T.KeyValue[];
    protocols: string[];
    verifyTls: boolean;
  }) => call<string>('ws.connect', { opts }),
  sseConnect: (spec: T.RequestSpec) => call<string>('sse.connect', { spec }),
  mqttConnect: (opts: Record<string, unknown>) => call<string>('mqtt.connect', { opts }),
  poll: (id: string, since: number) => call<T.SessionPoll>('session.poll', { id, since }),
  command: (id: string, cmd: Record<string, unknown>) =>
    call<null>('session.command', { id, cmd }),
  closeSession: (id: string) => call<null>('session.close', { id }),

  grpcLoad: (files: string[], includes: string[] = []) =>
    call<T.GrpcSource>('grpc.loadProtos', { files, includes }),
  grpcReflect: (target: { url: string; tls?: boolean; metadata: T.KeyValue[] }) =>
    call<T.GrpcSource>('grpc.reflect', { target }),
  grpcInvoke: (req: {
    sourceId: string;
    method: string;
    url: string;
    tls?: boolean;
    metadata: T.KeyValue[];
    timeoutMs: number;
    messages: string[];
    keepOpen: boolean;
  }) => call<string>('grpc.invoke', { req }),

  loadStart: (scenario: L.Scenario, meta: Record<string, unknown>) =>
    call<string>('load.start', { scenario, meta }),
  loadStatus: (id: string, since?: number) => call<L.LiveStatus>('load.status', { id, since }),
  loadStop: (id: string, hard = false) => call<null>('load.stop', { id, hard }),
  loadDebug: (scenario: L.Scenario) => call<{ steps: L.DebugStep[] }>('load.debug', { scenario }),
  loadActive: () => call<{ id: string; name: string; state: string }[]>('load.active'),
  loadForget: (id: string) => call<null>('load.forget', { id }),
};
