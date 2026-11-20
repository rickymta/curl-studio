// ---- Postman collection v2.1 (stored as-is) -------------------------------------------------

export interface PmKV {
  key: string;
  value?: string;
  type?: string;
  disabled?: boolean;
  description?: string | { content: string };
}

export interface PmFormParam extends PmKV {
  /** `text` or `file` */
  type?: string;
  src?: string | string[] | null;
  contentType?: string;
}

export interface PmUrl {
  raw: string;
  protocol?: string;
  host?: string[] | string;
  port?: string;
  path?: string[] | string;
  query?: PmKV[];
  variable?: PmKV[];
  hash?: string;
}

export interface PmBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql' | 'none' | string;
  raw?: string;
  urlencoded?: PmKV[];
  formdata?: PmFormParam[];
  file?: { src?: string | null; content?: string };
  graphql?: { query?: string; variables?: string };
  options?: { raw?: { language?: string } };
  disabled?: boolean;
}

export interface PmAuthAttr {
  key: string;
  value?: unknown;
  type?: string;
}

export interface PmAuth {
  type: string;
  [scheme: string]: PmAuthAttr[] | string | undefined;
}

export interface PmScript {
  id?: string;
  type?: string;
  exec?: string[] | string;
}

export interface PmEvent {
  listen: 'prerequest' | 'test' | string;
  script: PmScript;
  disabled?: boolean;
}

export interface PmRequest {
  method?: string;
  header?: PmKV[];
  url?: PmUrl | string;
  body?: PmBody;
  auth?: PmAuth | null;
  description?: string | { content: string };
}

export interface PmResponse {
  id?: string;
  name?: string;
  originalRequest?: PmRequest;
  status?: string;
  code?: number;
  header?: PmKV[];
  body?: string;
  _postman_previewlanguage?: string;
}

/** CurlStudio extension for non-HTTP items (Postman ignores unknown keys). */
export interface ProtocolExt {
  kind: 'ws' | 'sse' | 'grpc' | 'mqtt';
  ws?: { protocols?: string; messages?: SavedMessage[] };
  grpc?: {
    protoFiles?: string[];
    includes?: string[];
    useReflection?: boolean;
    method?: string;
    message?: string;
    tls?: boolean;
  };
  mqtt?: {
    clientId?: string;
    username?: string;
    password?: string;
    keepAlive?: number;
    cleanSession?: boolean;
    topics?: { topic: string; qos: number }[];
    publishTopic?: string;
    publishQos?: number;
    retain?: boolean;
    will?: { topic: string; payload: string; qos: number; retain: boolean };
  };
}

export interface SavedMessage {
  name: string;
  data: string;
}

export interface PmItem {
  id?: string;
  name: string;
  description?: string | { content: string };
  item?: PmItem[];
  request?: PmRequest;
  response?: PmResponse[];
  event?: PmEvent[];
  auth?: PmAuth | null;
  variable?: PmKV[];
  protocolProfileBehavior?: Record<string, unknown>;
  'x-curlstudio'?: ProtocolExt;
}

export interface PmCollection {
  info: {
    _postman_id?: string;
    name: string;
    description?: string | { content: string };
    schema: string;
    _exporter_id?: string;
  };
  item: PmItem[];
  auth?: PmAuth | null;
  event?: PmEvent[];
  variable?: PmKV[];
  protocolProfileBehavior?: Record<string, unknown>;
}

export interface PmEnvValue {
  key: string;
  value: string;
  type?: 'default' | 'secret' | string;
  enabled?: boolean;
  /** CurlStudio: value changed by scripts / the user this session (Postman "current value"). */
  currentValue?: string;
}

export interface PmEnvironment {
  id: string;
  name: string;
  values: PmEnvValue[];
  _postman_variable_scope?: 'environment' | 'globals';
  _postman_exported_at?: string;
  _postman_exported_using?: string;
}

// ---- backend wire types -----------------------------------------------------------------------

export interface KeyValue {
  key: string;
  value: string;
}

export type SpecBody =
  | { mode: 'none' }
  | { mode: 'raw'; raw: string }
  | { mode: 'urlencoded'; fields: KeyValue[] }
  | {
      mode: 'formdata';
      fields: { key: string; value: string; type: string; src: string[]; contentType?: string }[];
    }
  | { mode: 'binary'; path: string }
  | { mode: 'base64'; data: string };

export type SpecAuth =
  | { type: 'none' }
  | { type: 'digest'; username: string; password: string }
  | {
      type: 'awsv4';
      accessKey: string;
      secretKey: string;
      region: string;
      service: string;
      sessionToken: string;
    };

export interface RequestOptions {
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  verifyTls: boolean;
  proxy: string;
  http1Only: boolean;
  cookies: boolean;
  maxBodyBytes: number;
}

export interface RequestSpec {
  method: string;
  url: string;
  headers: KeyValue[];
  body: SpecBody;
  auth: SpecAuth;
  options: RequestOptions;
}

export interface Timings {
  prepareMs: number;
  waitMs: number;
  downloadMs: number;
  totalMs: number;
}

export interface ResponseData {
  status: number;
  statusText: string;
  httpVersion: string;
  url: string;
  headers: KeyValue[];
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  bodyTruncated: boolean;
  size: number;
  headersSize: number;
  timings: Timings;
  remoteAddr: string | null;
  requestHeaders: KeyValue[];
  requestMethod: string;
  requestUrl: string;
}

export interface AppError {
  kind: string;
  message: string;
}

export interface SessionMessage {
  seq: number;
  ts: number;
  dir: 'in' | 'out' | 'info' | 'error';
  kind: string;
  data: string;
  meta?: Record<string, unknown>;
}

export interface SessionPoll {
  state: 'connecting' | 'open' | 'closed';
  seq: number;
  messages: SessionMessage[];
}

export interface CookieInfo {
  domain: string;
  hostOnly: boolean;
  path: string;
  name: string;
  value: string;
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
}

export interface GrpcMethod {
  name: string;
  fullName: string;
  path: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  inputType: string;
  outputType: string;
  template: unknown;
}

export interface GrpcSource {
  sourceId: string;
  services: { name: string; methods: GrpcMethod[] }[];
}

// ---- settings / history -----------------------------------------------------------------------

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  verifyTls: boolean;
  proxy: string;
  http1Only: boolean;
  cookies: boolean;
  maxBodyMb: number;
  historyLimit: number;
  autoSave: boolean;
  /** Close tabs with unsaved changes without asking. */
  discardUnsavedOnClose: boolean;
  /** UI zoom, 0.6–2 (Ctrl +, Ctrl -, Ctrl 0). */
  zoom: number;
  /** Whole-UI brightness per theme, percent (70–130). */
  brightnessDark: number;
  brightnessLight: number;
  /** In-app terminal shell: auto | powershell | pwsh | cmd | gitbash. */
  terminalShell: string;
  /** Folder new terminals start in (empty = home folder). */
  terminalCwd: string;
  fontSize: number;
  /** Activity Logs: entries older than this many days are deleted at startup; 0 keeps all. */
  activityRetentionDays: number;
  /** Size of activity.jsonl (MB) above which the app warns. */
  activityWarnMb: number;
  /** Size (MB) activity.jsonl never exceeds: the oldest entries are dropped. */
  activityMaxMb: number;
  /** Most recent Activity Logs entries loaded at startup. */
  activityLoadLimit: number;
}

export interface HistoryEntry {
  id: string;
  ts: number;
  method: string;
  url: string;
  status: number | null;
  timeMs: number | null;
  item: PmItem;
}

export interface TestResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  error?: string;
}

export interface ConsoleEntry {
  id: number;
  ts: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'request';
  text: string;
  detail?: unknown;
}

export interface ActivityStats {
  path: string;
  bytes: number;
  entries: number;
  /** `warn`: over the warning size; `full`: at the limit, the oldest entries are being dropped. */
  level: 'ok' | 'warn' | 'full';
  warnBytes: number;
  maxBytes: number;
  retentionDays: number;
}

export type SupportTopic = 'bug' | 'feature' | 'question' | 'other';

export interface SupportRequest {
  name: string;
  email: string;
  topic: SupportTopic;
  subject: string;
  message: string;
  includeSystem: boolean;
  appVersion?: string;
}
