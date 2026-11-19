# CurlStudio

An API client in the spirit of Postman, plus a load-testing studio that borrows from Postman,
JMeter and k6. Tauri 2 + React 19 front end, Rust core (`crates/curlstudio-core`) for every
network protocol and the load engine.

## Features (v0.1)

**Protocols**

- **HTTP**: every method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, COPY, LINK, UNLINK,
  PURGE, LOCK, UNLOCK, PROPFIND, VIEW, TRACE, CONNECT, plus custom ones); params with path
  variables (`:id`); headers; bodies `none`, `form-data` (files), `x-www-form-urlencoded`, `raw`
  (JSON/XML/HTML/JS/Text), `binary`, `GraphQL`; HTTP/2, gzip/br/deflate/zstd, proxy, TLS on/off,
  redirects, per-request timeouts, cancel.
- **GraphQL**: query + variables editor, schema introspection and a field explorer.
- **WebSocket**: headers, subprotocols, text/binary messages, saved messages, ping.
- **Server-Sent Events**: live event stream with event/id parsing.
- **gRPC**: server reflection (v1 and v1alpha) or `.proto` files compiled in-process (no
  `protoc`); unary, server streaming, client streaming and bidi; metadata (incl. `-bin`); JSON
  templates generated from the message type.
- **MQTT 3.1.1**: TCP/TLS, subscribe (wildcards, QoS 0–2), publish (retain), last will.

**Postman compatibility**

- Collections are stored **as Postman v2.1 JSON** (one file each), environments as Postman
  environment files. Import Postman v1 / v2.0 / v2.1 collections, environments, globals and full
  data dumps; export v2.1 (or v2.0) and environments that Postman opens directly.
- Auth: Basic, Bearer, API key (header/query), Digest (MD5/SHA-256, `-sess`, `qop`), OAuth 2.0
  (client credentials / password grant token fetch), AWS Signature v4; inheritance
  request → folder → collection.
- Variables: globals < collection < environment < data < local, nested references and Postman
  dynamic variables (`{{$guid}}`, `{{$timestamp}}`, `{{$randomEmail}}`, …), highlighted inline
  (unknown names in red).
- Scripts: pre-request and test scripts at collection, folder and request level in a
  Postman-compatible sandbox — `pm.environment/globals/collectionVariables/variables/iterationData`,
  `pm.request` (mutable), `pm.response`, `pm.test`, `pm.expect` (chai) and the Postman chai
  helpers (`to.have.status`, `.header`, `.jsonBody`, `.jsonSchema`, `.be.ok/success/…`),
  `pm.sendRequest`, `pm.execution.setNextRequest/skipRequest`, `pm.visualizer`, `pm.cookies`,
  CryptoJS, `xml2Json` and the legacy `postman.*` / `tests[]` API.
- **cURL**: paste a curl command into the URL bar or Import (Chrome/Firefox “Copy as cURL” works);
  generate cURL (bash, cmd, PowerShell) and snippets for fetch, axios, Python requests, Go, C#,
  Java OkHttp, PowerShell, HTTPie, PHP and raw HTTP.
- Collection Runner: iterations, delay, CSV/JSON data files, `setNextRequest`, keep variables,
  stop on failure; export HTML / JUnit / JSON.
- History, cookie manager (persistent jar), console with sent requests and `console.log`, tabs
  with unsaved drafts, drag-and-drop in the tree, response pretty/raw/preview (HTML, images,
  PDF), timings, cookies, save response to file.

**Load testing (Postman + JMeter + k6)**

- Build a scenario from a collection, folder or request (right click → *Load test*); steps are
  taken live from the collection with their auth/body and the chosen environment.
- Executors: ramping/constant **virtual users** (closed model, JMeter thread group with ramp-up),
  **arrival rate** (open model, k6 ramping/constant-arrival-rate with pre-allocated/max VUs and
  dropped-iteration tracking) and **shared iterations** (threads × loops).
- Presets for k6 test types: smoke, average load, stress, spike, soak, breakpoint, constant RPS,
  thread group — with a planned-load preview chart.
- Per-step **checks/assertions** (status, time, size, body, JSON path, header, regex) and
  **extractors** (JSON path, header, regex, cookie) for correlation (tokens, ids) per VU; CSV/JSON
  data sets (sequential / random / per VU); think time; per-VU cookie jars; keep-alive on/off.
- **Thresholds** (k6 style) on `http_req_duration`, `http_req_waiting`, `http_req_failed`,
  `checks`, `http_reqs`, `iteration_duration`, `data_received`, `apdex`, `dropped_iterations`
  — globally or per request, with abort-on-fail.
- Debug run: one iteration, one VU, showing status, checks, extracted and unresolved variables.
- **Live dashboard** (updated every second) and saved **reports**: KPI tiles with sparklines,
  thresholds verdict, throughput, latency percentiles (p50/p90/p95/p99/avg) with threshold line,
  VUs, error rate, **latency heatmap**, response-time **distribution** with percentile markers,
  status codes over time, latency per request, **response time vs VUs**, bandwidth, **Apdex**,
  status distribution, JMeter-style **aggregate report**, checks and top errors, notes.
- **Run comparison** (baseline vs up to three runs): metric table with % deltas
  (better/worse colouring) and overlaid time series; per-scenario trend of p95 and throughput.
- **Exports**: self-contained HTML report (same charts, light/dark, printable to PDF), raw JSON,
  per-second timeline CSV, aggregate-report CSV, JUnit XML for CI, Markdown summary.

## Development

Requirements: Node 22 + pnpm 9, Rust 1.88+.

```bash
pnpm install
pnpm tauri dev          # desktop app
```

Browser-only UI against the real backend (handy for UI work):

```bash
pnpm bridge             # HTTP bridge on 127.0.0.1:1451 (debug only)
pnpm dev                # http://localhost:1450
```

Checks:

```bash
pnpm test               # frontend unit tests (Postman import, cURL, variables, sandbox)
cargo test --workspace  # Rust unit + load-engine integration tests
pnpm lint && npx tsc -b
```

## Release

GitHub Actions builds and publishes a release when a `vX.Y.Z` tag on the default branch is pushed
(`.github/workflows/release.yml`): version check → full CI on Linux, macOS and Windows (`ci.yml`:
lint, unit tests, build, `cargo fmt`, `clippy -D warnings`, `cargo test`) → draft release →
installers for macOS (arm64 and x64 `.dmg`), Windows (`.msi`, setup `.exe`) and Linux (`.deb`,
`.rpm`, `.AppImage`) → `SHA256SUMS.txt` → published. Code signing is optional (Apple and Windows
secrets, as in GitStudio). Release notes come from the version's section in `CHANGELOG.md`.

```bash
pnpm release patch      # or minor | major | x.y.z — bumps the 3 version files, CHANGELOG, commit + tag
git push origin master
git push origin vX.Y.Z
```

Workspace data lives in the OS data dir (`%APPDATA%\CurlStudio` on Windows,
`CURLSTUDIO_HOME` overrides it): `collections/*.json` (Postman v2.1), `environments/*.json`,
`loadScenarios/`, `loadRuns/`, `globals.json`, `history.json`, `cookies.json`, `settings.json`.

## Layout

- `crates/curlstudio-core` — `dispatch(cmd, args)` command surface; `http` (reqwest, digest,
  SigV4, cookie jar), `ws`, `sse`, `mqtt`, `grpc` (protox + prost-reflect + tonic), `sessions`
  (polled message streams), `store`, `load` (executors, HDR-histogram metrics, rules,
  thresholds).
- `src-tauri` — thin Tauri shell (one `call` command) and the dev bridge binary.
- `src/lib` — Postman model, variables, request builder, sandbox, cURL/codegen, reports.
- `src/features` — sidebar, request/protocol editors, runner, load-test designer/dashboard/compare.

## Known limits (v0.1)

- Load tests drive HTTP/GraphQL; JavaScript scripts are not executed in load tests (use checks
  and extractors, as in k6/JMeter).
- gRPC TLS always verifies certificates; MQTT is 3.1.1 over TCP/TLS (no MQTT 5 / WebSocket
  transport yet). OAuth 2.0 authorization-code/PKCE flows, NTLM and Hawk auth are not implemented.
- Timings split prepare / wait (DNS+connect+TLS+server) / download; DNS, TCP and TLS are not
  broken out separately.
