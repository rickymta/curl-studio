# Contributing to CurlStudio

Thanks for helping! Bug reports, ideas and pull requests are all welcome. This page covers how to
report a problem, set up a development environment, and get a change merged.

## Reporting bugs and asking for features

- Search the [issues](https://github.com/rickymta/curl-studio/issues) first; add to an existing one
  rather than opening a duplicate.
- For a bug, include: CurlStudio version (status bar or Help → About), operating system, the steps
  to reproduce, what you expected and what happened. A minimal Postman collection or a cURL command
  that shows the problem helps a lot; the **Activity Logs** window (Ctrl+Shift+L → save) often
  shows the error.
- Remove tokens, passwords and private hosts from anything you attach. Collections and
  environments exported from CurlStudio contain variable values in plain text.
- You can also send a report from the app: **Help & Support** (F1).

Security issues: please don't open a public issue — use **Help & Support** in the app (topic “Bug
report”) or contact the maintainer privately, and allow time for a fix before disclosure.

## Development setup

Requirements: Node 22, pnpm 9, Rust 1.88+ with `rustfmt` and `clippy`
(`rustup component add rustfmt clippy`). On Linux, the Tauri 2 system packages:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libxdo-dev libssl-dev build-essential curl wget file
```

Then:

```bash
pnpm install
pnpm tauri dev
```

For UI work it is faster to run the front end in a browser against the real Rust core:

```bash
pnpm bridge     # debug HTTP bridge on 127.0.0.1:1451
pnpm dev        # http://localhost:1450
```

Set `CURLSTUDIO_HOME` to a scratch folder so experiments don't touch your own workspace.

### Local test services

`testing/mock/docker-compose.yml` runs a test API (REST, auth, GraphQL, WebSocket, SSE), httpbin,
an MQTT broker and a gRPC server; `testing/fixtures/` has a matching Postman collection and
environment to import.

```bash
docker compose -f testing/mock/docker-compose.yml up -d
```

## Project layout

- `crates/curlstudio-core` — everything the UI calls goes through `dispatch(cmd, args)` in `lib.rs`:
  HTTP, WebSocket, SSE, MQTT, gRPC, the load engine, storage, terminal, activity log.
- `src-tauri` — the Tauri shell (a single `call` command) and the dev bridge binary.
- `src/lib` — framework-free logic (Postman model, variables, request builder, script sandbox,
  cURL/codegen, reports); this is where unit tests live.
- `src/features`, `src/components`, `src/stores` — React UI and zustand stores.

A new backend command is a match arm in `dispatch` plus a typed wrapper in `src/lib/ipc.ts`; it
then works in both the desktop app and the browser bridge.

## Making a change

1. Fork, then branch from `master` (`fix/…`, `feat/…`).
2. Keep the change focused; unrelated clean-ups go in their own pull request.
3. Add or update tests: Vitest next to the code in `src/` (`*.test.ts`), Rust unit tests in the
   module or integration tests in `crates/curlstudio-core/tests/`.
4. Run the same checks as CI before pushing:

   ```bash
   pnpm lint && pnpm test && pnpm build
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets --all-features -- -D warnings
   cargo test --workspace
   ```

5. Open a pull request describing what changed and why, how you tested it, and screenshots for UI
   changes.

### Style

- TypeScript: strict mode, ESLint and Prettier settings in the repo (`pnpm lint`). Prefer small,
  pure functions in `src/lib` that can be unit-tested.
- Rust: `cargo fmt`, no clippy warnings, errors through `curlstudio_core::Error`.
- UI text in English, short and specific; keyboard shortcuts must also be listed in
  `src/features/shell/shortcuts.ts` so they appear in the shortcuts window.
- Keep Postman compatibility: collections are stored as Postman v2.1, so new request settings go in
  Postman fields where one exists, otherwise in the `x-curlstudio` extension.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) style: `feat: …`, `fix: …`,
`docs: …`, `ci: …`, `chore: …`, with an optional scope (`fix(runner): …`). The subject says what
changes for users; the body says why.

## Releases (maintainers)

```bash
pnpm release patch   # or minor | major | x.y.z — bumps versions, updates CHANGELOG.md, commits and tags
git push origin master
git push origin vX.Y.Z
```

Pushing the tag runs `.github/workflows/release.yml`: full CI on Linux, macOS and Windows, then
installers for every platform, `SHA256SUMS.txt` and the published release.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
