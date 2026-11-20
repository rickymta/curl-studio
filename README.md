# CurlStudio

An API client in the spirit of Postman, plus a load-testing studio that borrows from Postman,
JMeter and k6. Tauri 2 + React 19 front end, Rust core (`crates/curlstudio-core`) for every
network protocol, the load engine and the in-app terminal. Postman collections and environments
open as they are; collections are stored as Postman v2.1 files.

## Install

Download the installer for your platform from the
[Releases](https://github.com/rickymta/curl-studio/releases) page:

| Platform | Files                                                     |
| -------- | --------------------------------------------------------- |
| Windows  | `CurlStudio_x.y.z_windows-x64-setup.exe` or `.msi`        |
| macOS    | `.dmg` for Apple Silicon (`macos-aarch64`) or Intel (`macos-x64`) |
| Linux    | `.deb`, `.rpm` or `.AppImage`                             |

Builds are not code-signed yet: Windows SmartScreen and macOS Gatekeeper may ask you to confirm the
first launch (on macOS: right-click the app → Open, or
`xattr -dr com.apple.quarantine /Applications/CurlStudio.app`). `SHA256SUMS.txt` in each release
lets you verify the downloads.

## Features

**Protocols**

- **HTTP**: every method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, COPY, LINK, UNLINK,
  PURGE, LOCK, UNLOCK, PROPFIND, VIEW, TRACE, CONNECT, plus custom ones); params with path
  variables (`:id`); headers; bodies `none`, `form-data` (files), `x-www-form-urlencoded`, `raw`
  (JSON/XML/HTML/JS/Text), `binary`, `GraphQL`; HTTP/2, gzip/br/deflate/zstd, proxy, TLS on/off,
  redirects, per-request timeouts, cancel.
- **GraphQL**: query + variables editor, schema introspection, a field explorer, and once the schema
  is loaded: field completion for the type at the cursor and inline errors (unknown fields,
  sub-selections on scalars, unbalanced braces).
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
  dynamic variables (`{{$guid}}`, `{{$timestamp}}`, `{{$randomEmail}}`, …). Hover a `{{variable}}`
  anywhere (URL, tables, body and script editors) to see its current and initial value and where it
  comes from, edit it in place or add a missing one; secrets are masked.
- Scripts: pre-request and test scripts at collection, folder and request level in a
  Postman-compatible sandbox — `pm.environment/globals/collectionVariables/variables/iterationData`,
  `pm.request` (mutable), `pm.response`, `pm.test`, `pm.expect` (chai) and the Postman chai
  helpers (`to.have.status`, `.header`, `.jsonBody`, `.jsonSchema`, `.be.ok/success/…`),
  `pm.sendRequest`, `pm.execution.setNextRequest/skipRequest`, `pm.visualizer`, `pm.cookies`,
  CryptoJS, `xml2Json` and the legacy `postman.*` / `tests[]` API.
- **cURL**: paste a curl command into the URL bar or Import (Chrome/Firefox “Copy as cURL” works);
  generate cURL (bash, cmd, PowerShell) and snippets for fetch, axios, Python requests, Go, C#,
  Java OkHttp, PowerShell, HTTPie, PHP and raw HTTP; **Run in terminal** types the command, quoted
  for your shell, into the in-app terminal.
- Collection Runner: iterations, delay, CSV/JSON data files, `setNextRequest`, keep variables,
  stop on failure; failed and non-2xx counts and filters; response-time chart (linear or log
  scale); export HTML / JUnit / JSON.
- History, cookie manager (persistent jar), console with sent requests and `console.log`,
  response pretty/raw/preview (HTML, images, PDF), timings, cookies, save response to file; the
  last response of each tab is kept across restarts; network errors are explained (refused, DNS,
  TLS, timeout…) with the raw message one click away.

**Load testing (Postman + JMeter + k6)**

- Build a scenario from a collection, folder or request (right click → *Load test*); steps are
  taken live from the collection with their auth/body and the chosen environment. Values that test
  scripts save (`pm.environment.set('token', json.token)`, headers, cookies) become extractors
  automatically, since load tests don't run scripts.
- Executors: ramping/constant **virtual users** (closed model, JMeter thread group with ramp-up),
  **arrival rate** (open model, k6 ramping/constant-arrival-rate with pre-allocated/max VUs and
  dropped-iteration tracking) and **shared iterations** (threads × loops).
- Presets for k6 test types: smoke, average load, stress, spike, soak, breakpoint, constant RPS,
  thread group — with a planned-load preview chart.
- Per-step **checks/assertions** (status, time, size, body, JSON path, header, regex) and
  **extractors** (JSON path, header, regex, cookie, status) for correlation (tokens, ids) per VU;
  CSV/JSON data sets (sequential / random / per VU); think time; per-VU cookie jars; keep-alive
  on/off.
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

**Workspace**

- Tabs with unsaved drafts and a Postman-style **Save changes?** prompt on close (or “always
  discard”); pinned tabs, *Close saved tabs*, a list of every open tab.
- Sidebar: search (Ctrl+K) with highlighting, add menus, quick “+” on collections and folders,
  drag-and-drop, the open request revealed in the tree, keyboard navigation (arrows, Enter).
- Resizable request/response split and table columns; resizable, hideable sidebar.
- **Status bar**: environment, running load tests, console, terminal, Activity Logs, shortcuts,
  zoom, help and version.
- **Activity Logs** (Ctrl+Shift+L): requests, runs, load tests, errors and app events, saved in
  `activity.jsonl`, filterable and exportable. Retention (30 days), warning size and maximum size
  (10 MB) are set in Settings → Data & Logs.
- **Notifications** stack above the status bar; hover to read them all and pause their timers.
- One window per user: launching CurlStudio again focuses the one that is running.
- **In-app terminal** (Ctrl+`): real PTY sessions (PowerShell, PowerShell 7, cmd, Git Bash or your
  `$SHELL`), using your Windows Terminal font.
- **Settings**: request defaults, theme (dark / light / system) with brightness per theme, zoom,
  editor font size, terminal shell and folder, data and logs, about.
- **Help & Support** (F1): send a bug report, feature request or question by email.

### Keyboard shortcuts

| Action                              | Keys                         |
| ----------------------------------- | ---------------------------- |
| Send / save request                 | Ctrl+Enter / Ctrl+S          |
| New request tab / close tab         | Ctrl+T / Ctrl+W              |
| Next / previous tab                 | Ctrl+Tab / Ctrl+Shift+Tab    |
| Import                              | Ctrl+O                       |
| Search the sidebar / toggle sidebar | Ctrl+K / Ctrl+\              |
| Terminal / console                  | Ctrl+` / Ctrl+Alt+C          |
| Activity Logs / all shortcuts       | Ctrl+Shift+L / Ctrl+/        |
| Reload the workspace from disk      | F5 / Ctrl+R                  |
| Zoom in / out / reset               | Ctrl+= / Ctrl+- / Ctrl+0     |
| Settings / help                     | Ctrl+, / F1                  |

## Development

Requirements: Node 22 + pnpm 9, Rust 1.88+ (with `rustfmt` and `clippy`). On Linux, the Tauri 2
system packages (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`,
`librsvg2-dev`, …).

```bash
pnpm install
pnpm tauri dev          # desktop app
```

Browser-only UI against the real backend (handy for UI work):

```bash
pnpm bridge             # HTTP bridge on 127.0.0.1:1451 (debug only)
pnpm dev                # http://localhost:1450
```

Checks (the same ones CI runs):

```bash
pnpm lint && pnpm test && pnpm build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
```

### Testing against local services

`testing/mock/docker-compose.yml` starts everything the app talks to: a Node test API (REST CRUD
with token auth, GraphQL, WebSocket, SSE, edge cases) on 18090, go-httpbin on 18080, Mosquitto
(MQTT) on 18830 and grpcbin on 19000. `testing/fixtures/` has a Postman collection and environment
for them; `testing/report/` holds the HTML test report and the script that builds it.

```bash
docker compose -f testing/mock/docker-compose.yml up -d
```

Set `CURLSTUDIO_HOME` to a scratch folder to keep test data out of your own workspace.

## Data

Workspace data lives in the OS data dir (`%APPDATA%\CurlStudio` on Windows, `CURLSTUDIO_HOME`
overrides it): `collections/*.json` (Postman v2.1), `environments/*.json`, `loadScenarios/`,
`loadRuns/`, `globals.json`, `history.json`, `cookies.json`, `settings.json`, `activity.jsonl`.

## Release

GitHub Actions builds and publishes a release when a `vX.Y.Z` tag on the default branch is pushed
(`.github/workflows/release.yml`): version check → full CI on Linux, macOS and Windows (`ci.yml`)
→ draft release → installers for macOS (arm64 and x64 `.dmg`), Windows (`.msi`, setup `.exe`) and
Linux (`.deb`, `.rpm`, `.AppImage`) → `SHA256SUMS.txt` → published. Code signing is optional
(Apple and Windows secrets). Release notes come from the version's section in `CHANGELOG.md`.

```bash
pnpm release patch      # or minor | major | x.y.z — bumps the 3 version files, CHANGELOG, commit + tag
git push origin master
git push origin vX.Y.Z
```

## Layout

- `crates/curlstudio-core` — `dispatch(cmd, args)` command surface; `http` (reqwest, digest,
  SigV4, cookie jar), `ws`, `sse`, `mqtt`, `grpc` (protox + prost-reflect + tonic), `sessions`
  (polled message streams), `store`, `load` (executors, HDR-histogram metrics, rules,
  thresholds), `terminal` (portable-pty), `activity`, `support`.
- `src-tauri` — thin Tauri shell (one `call` command) and the dev bridge binary.
- `src/lib` — Postman model, variables, request builder, sandbox, cURL/codegen, GraphQL assist,
  reports.
- `src/features` — sidebar, request/protocol editors, runner, load-test designer/dashboard/compare,
  shell (status bar, settings, windows, help), terminal.
- `testing/` — Docker mock services, Postman fixtures, test report.

## Known limits

- Load tests drive HTTP/GraphQL; JavaScript scripts are not executed in load tests (common
  token/id setters are turned into extractors; otherwise use checks and extractors, as in
  k6/JMeter).
- gRPC TLS always verifies certificates; MQTT is 3.1.1 over TCP/TLS (no MQTT 5 / WebSocket
  transport yet). OAuth 2.0 authorization-code/PKCE flows, NTLM and Hawk auth are not implemented.
- Timings split prepare / wait (DNS+connect+TLS+server) / download; DNS, TCP and TLS are not
  broken out separately.
- On Windows a refused connection to a local port takes about 2 s to report (the OS retries the
  connection; `curl.exe` behaves the same).

## Contributing

Bug reports, ideas and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). You can
also use **Help & Support** (F1) in the app.

## License

[MIT](LICENSE) © 2026 CurlStudio contributors
