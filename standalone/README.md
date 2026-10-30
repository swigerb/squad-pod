# Squad Pod local observer

The first standalone mode is a **read-only, authenticated, loopback-only office**.
It uses the production React/Canvas renderer and shared `HostClient` office seam.
This is a private local package, not a published npm product.

## Build and run

Requires Node 22.13+ and the repository's configured package feed. From the repository:

```powershell
npm run install:all
npm ci --prefix standalone
npm run build --prefix standalone
node standalone\dist\cli.mjs "C:\absolute\selected project" --port 0
```

Port `0` chooses an available port; omitting `--port` uses `3210`. The CLI
canonicalizes the explicit absolute project path. It never opens a browser,
discovers recent projects, installs Squad, or launches Copilot.
Open the printed `http://127.0.0.1:PORT` address manually. Paste the separate
runtime credential from the console into the password form. Do not put it in a
URL, take a screenshot of that console, or send it in diagnostics.

Type `rotate` in the CLI console to revoke all viewers and print a new credential;
use **Authenticate again** in the browser. Type `quit`, press Ctrl+C, or send
SIGTERM to dispose the server. Restarting also revokes credentials and cookies.
Disconnected browsers retry office observation with their existing cookie, never
start processes, and require authentication again after rotation/restart.

To try the built package independently:

```powershell
npm pack .\standalone --pack-destination "C:\owned output"
# In an empty owned directory (including paths with spaces):
npm install "C:\owned output\squad-pod-observer-0.1.0.tgz"
node node_modules\squad-pod-observer\dist\cli.mjs "C:\absolute\selected project" --port 0
```

## What is observed

Only the selected project: `.squad/team.md` (legacy `.ai-team` fallback),
`.squad-pod/layout.json`, local Squad `sessions/*.json`, `log/*.md`,
`orchestration-log/*.md`, and `log/usage.jsonl`. Existing roster, layout, activity,
and recorded-usage parsers are reused. The bundled starter layout and built-in
furniture/floors/walls/carpets/pets/embedded characters work without external
asset directories. No project file is served over HTTP.

File changes are polled every second **while viewers are connected**. A new or edited
recognized session/log source marks the named roster agent active for approximately
30 seconds; unchanged reads do not extend that window. Initial connection and
resuming after all viewers disconnect baseline existing files without animating
historical changes. An old file is not evidence of a currently running tool. There are no
live context counters. Usage is the recorded ledger only, not billing or live
session telemetry. Missing/malformed/bounded sources are explained; invalid saved
layouts show the bundled starter, without overwriting the source.
File aliases use the native roster resolver, including ambiguity rejection.
Built-in appearances are deterministically scoped to member identity, not roster
order, so existing and reconnecting viewers agree without writing metadata.

Layout/editor/appearance/seat changes, settings, asset registration, directory
management, native file dialogs and charter opening are disabled. Pan, zoom,
agent details, and recorded-usage inspection remain available. No draft recovery
is persisted by the standalone adapter. VS Code draft/recovery behavior is unchanged.

## Security and limits

- Binds only `127.0.0.1`. Host must be the exact canonical `127.0.0.1:PORT`
  authority; alternative IP spellings, DNS names, userinfo, duplicate Host,
  and non-loopback binds fail closed. Browser auth and WebSocket upgrade require
  the exact same HTTP Origin, including port. No wildcard CORS.
- Random 256-bit runtime credentials and independent session cookies are compared
  through constant-time SHA-256 digest comparison. The authentication form posts
  JSON; cookies are HttpOnly/SameSite=Strict and memory-only for the browser session.
  HTTP is permitted only on loopback; **do not proxy or expose this listener**.
  Console output is an intentional credential handoff, not an access log.
  The server has no request/access logging and never reflects submitted tokens.
- No credential files are written, on Windows or POSIX. Persistent credential
  storage/ACL protection is **not implemented or claimed**. No Node `chmod`
  assumption is used for Windows protection. Protect the console and machine
  account; another process running as the same user is not an isolated trust boundary.
  There is no tokenless mode, remote auth, TLS, firewall configuration or terminal authority.
- Direction-specific network allowlists reject unsupported versions/kinds/fields.
  Only readiness, settings reads and bounded agent-detail reads are accepted;
  forged layout, seat, settings, directory, asset and terminal commands are
  rejected server-side before dispatch. Invalid server event/layout/numeric
  shapes are rejected by the browser adapter.
- At most 8 TCP connections, 4 KiB inbound frames/auth bodies/headers, 8 MiB
  outbound office frames, 16 MiB queued bytes per viewer, 32 commands/second,
  5-second reads and 10-second sends. Ping/pong detects dead viewers.
  The built-in asset event measures 483,977 bytes (about 473 KiB) and the initial
  office snapshot about 506 KB; terminal-sized frame limits are not reused.
- Project reads reject internal symlinks/junctions, escapes, non-regular files,
  changed file identities and oversized inputs. Roster 256 KiB/128 agents;
  layout/ledger 2 MiB each; activity 128 KiB/file, 256 directory entries/source,
  8 MiB total per observation pass. Treat the selected local project as trusted:
  portable Node path checks are not a sandbox against an adversarial process
  concurrently replacing parent directories.
- Static HTTP content is indexed from the installed browser bundle only,
  excludes symlinks/dotfiles and rejects traversal/encoded separators. Cached
  bytes prevent later path substitution. CSP allows bundled scripts only, no eval
  or inline scripts; inline styles are necessary for the existing React renderer.
  No arbitrary project/home path or external assets can be requested.

## Verification and acceptance boundary

```powershell
npm run check --prefix standalone
npm test --prefix standalone
npm run build --prefix standalone
node standalone\scripts\acceptance.mjs
npm run verify
npm run package
```

The packaged acceptance helper creates only an owned synthetic project and empty
synthetic home, installs the tarball into an isolated path with spaces, then checks
the production CLI/HTTP/WS/read-only path. Installation is offline with an empty
cache, using local tarballs of the already-restored runtime dependencies (no feed
metadata lookup). When `PLAYWRIGHT_MODULE` points to an
already installed Playwright module, it additionally drives the actual browser
authentication form and renderer, observes live fixture changes, reconnects, and
writes desktop/narrow screenshots to `OBSERVER_ARTIFACTS`. A saved-project Floor10
probe checks exact installed source-sheet canvas pixels and legacy VOID8 transparency.
`EDGE_PATH` optionally
selects an installed Edge executable; it installs no browsers.

These are synthetic observer checks, **not** real Squad/Copilot session acceptance
or native VS Code acceptance. Follow `docs/native-acceptance.md` for the
user/Scout-owned native and real-session plan. Its standalone observation gates
now apply to this package's explicit selected-project/read-only mode only.
Do not run its launch/terminal/mobile/remote gates against this observer:
owned-process/PTY launch, live/private home logs, persistent credentials, remote
auth/TLS and mobile terminal remain later issue #8 layers. Nothing here completes
or closes issues #4, #7 or #8.
