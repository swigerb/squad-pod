# Squad Pod local observer

The default standalone mode is a **read-only, authenticated, loopback-only office**.
It uses the production React/Canvas renderer and shared `HostClient` office seam.
Optional owned terminals have separate authority; they do not enable office writes.
This is a private local package, not a published npm product.
Its build copies the canonical repository LICENSE and THIRD_PARTY_NOTICES.md
into the package root; bundled asset provenance and runtime dependency licenses
remain intact in the installed distribution.

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
discovers recent projects, installs Squad, or launches Copilot automatically.
Open the printed `http://127.0.0.1:PORT` address manually. Paste the separate
runtime credential from the console into the password form. Do not put it in a
URL, take a screenshot of that console, or send it in diagnostics.

Type `rotate` in the CLI console to revoke all channels and print new credentials;
use **Authenticate again** in the browser. Type `quit`, press Ctrl+C, or send
SIGTERM to dispose the server. Restarting also revokes credentials and cookies.
Shutdown also closes owned terminals; merely disconnecting a viewer does not.
Disconnected browsers retry office observation with their existing cookie, never
start processes, and require authentication again after rotation/restart.

To try the built package independently:

```powershell
npm pack .\standalone --pack-destination "C:\owned output"
# In an empty owned directory (including paths with spaces):
npm install "C:\owned output\squad-pod-observer-0.1.0.tgz"
node node_modules\squad-pod-observer\dist\cli.mjs "C:\absolute\selected project" --port 0
```

## Optional selected-project office control

```powershell
node standalone\dist\cli.mjs "C:\absolute\selected project" --port 0 --office-control
```

The default form still connects a **read-only viewer**. Explicitly select
**Use separate office-control authority** and paste the additional office-control
credential. `POST /control-auth` and `/control` use a third independent runtime
credential/cookie; observation and terminal credentials never grant office writes.
`--office-control` can be used without terminals or combined with `--terminals`.
Rotation/restart revokes all channels. Reconnect requests snapshots only, never
replays a save. Export unsaved copies before restarting the server.

The existing desktop editor supports floors, carpets, furniture colors/states,
pets, Areas, undo/redo and manual save. Seat changes and sound/debug/Areas settings
persist only for the selected project; settings display committed acknowledgements.
Browser **Import Layout** deliberately selects bounded JSON and creates a draft;
**Save Layout** is still required. **Export Layout** downloads the current validated
draft. Recovery copies can also be exported from the conflict panel. These are
browser file selection/download actions, not native-file or shell bridges.

Layout stays in canonical `.squad-pod/layout.json`; standalone settings and member
appearance/seat history use `.squad-pod/office-preferences.json`. A removed member's
unchanged saved identity remains retained for its return, but cannot authorize new
seat writes. The existing `.squad` directory wins over `.ai-team`, even if its roster
is missing. Cooperating writers use exclusive locks, exact-byte revision hashes,
staged/fsynced writes and atomic rename, with prior versions under
`.squad-pod/recovery/`. Stale viewers/external edits conflict rather than overwrite;
invalid saved files must be recovered explicitly. Failed saves remain visible with
the local draft retained. Do not edit the files concurrently with noncooperating
programs during a commit: portable Node checks are not an adversarial filesystem sandbox.
If a parent directory identity changes during a save, cleanup deliberately does not
follow the replacement: the lock/staged bytes remain in the original directory for
manual recovery, with no successful acknowledgement.

Browser draft storage is bounded to 8 MiB and scoped to project **and server instance**,
contains no runtime credentials and is not a durable backup. Reload within that
instance can recover conflicts/unsaved drafts; another server instance never
automatically applies old recovery data. Storage denial/quota errors remain visible;
export copies before clearing browser data or switching instances.
Unacknowledged setting/seat attempts have a separate bounded preference draft in
the same project/server scope. Inspect/export it or retry deliberately after
reconciling current assignments; reconnect/reload never resends it automatically.
Disconnected/not-ready attempts are retained before sending. With an unresolved
preference draft, a different attempt is explicitly rejected and the displayed
settings/seats reconciled to authoritative state, without replacing the draft.
Export and deliberately discard it to make a different change; discarding is blocked
while a save is awaiting acknowledgement.
Native dialogs/charters, cross-project directories, external asset registration and
private-home/live-log consent stay explicitly unavailable. VS Code recovery and
settings remain unchanged. Narrow screenshots do not claim touch-editor parity.

## Optional owned terminals

```powershell
node standalone\dist\cli.mjs "C:\absolute\selected project" --port 0 --terminals
```

Authorize the office and terminal forms with their **different console credentials**.
Terminal authentication is `POST /terminal-auth`; its independent HttpOnly cookie
authorizes `/terminal`, never office observation/control. Office viewing remains
`POST /auth`. All channels require exact Host/Origin checks. Rotation invalidates all
cookies, detaches viewers synchronously and cancels launches still waiting for the native
broker; it does not terminate an already-owned process. Reauthenticate after rotation.
Credentials stay runtime-only, never in URLs, files or browser storage.

**Launch selected project** runs only `copilot --agent squad`, with normal Copilot
permission prompts. The browser cannot supply a directory, executable, arguments or
environment. Only absolute PATH entries are searched, never cwd or PATHEXT. Windows
requires a canonical real `copilot.exe` with an executable header; `.cmd`, PowerShell
and shell wrappers are rejected. POSIX accepts an executable or a Node entry point
with an exact supported Node shebang; Node entry points use the current real Node
executable. No shell, permission bypass, `squad shell`, or hook installation is used.
The selected canonical directory's file identity is checked again inside the native
broker immediately before spawn. This is not a sandbox against malicious concurrent
local filesystem replacement.

The bounded environment allowlist is `PATH`, `SystemRoot`, `WINDIR`, `HOME`,
`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TMPDIR`, `TMP`, `TEMP`, `LANG`, `LC_ALL`,
`LC_CTYPE`, plus fixed `TERM=xterm-256color` and `COLORTERM=truecolor`. Windows keys
are matched case-insensitively. Node injection variables, loader variables, GitHub
tokens, proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`) and
custom-CA variables (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`) are not
forwarded. Environments requiring those inherited network settings must resolve
that limitation before real-session acceptance; no network compatibility is assumed.
Normal Copilot permissions
and authentication through its normal user configuration still apply; observation
itself never reads private home logs.

Each run gets an opaque random runId, independent of the roster. Select a run to
view/input/resize, **Reconnect** to recover the same process, or **Close run...**
and confirm to terminate/remove only that owned run. Exited runs retain bounded
output until explicitly removed. No observed process is registered for termination.
On Windows, each native ConPTY uses its own broker and the packaged ConPTY DLL;
on POSIX it uses its own forkpty session/process group. Closing/shutdown cleans
that owned console/group and normal descendants, not unrelated consoles/processes.
Processes that deliberately escape their console/session are outside the supported
launch contract; this is not an OS containment/security sandbox. A broker also bounds
native-helper lifetime so helper threads cannot keep the office host alive after exit.

Terminal frames reuse version 1 history/attachment/receiver contracts: 64 KiB
serialized frames, 16 KiB input commands, 1 MiB/4096 frames retained history and
per-viewer pending output. Native UTF-8 output is streamed, Unicode-safe and split
before framing. IPC output is bounded at 1 MiB with native pause/resume backpressure;
overflow or unexpected broker death invalidates continuity explicitly. At most
8 runs, 64 commands/second/connection and 64 outstanding native actions/run are
accepted. There is also a **1 MiB outstanding broker-input budget/run**, released
after native adapter acknowledgment or failure; cumulative successful input is
not capped. The acknowledgment means `node-pty.write` accepted input, not that
the child consumed it (the public API has no input-drain acknowledgment).
Sends/startup/cleanup have bounded timeouts. Nothing is silently
dropped or retried as a process action.

xterm renders escape sequences as terminal data, not HTML; output links cannot
navigate the authenticated page. Input is disabled until replay finishes. The
cursor advances only after the terminal's write callback succeeds. An ordinary
disconnect drains pending rendered output before reconnecting; reload authenticates
again and rebuilds from cursor zero, not an orphaned persisted cursor. History
eviction/slow-client overflow produces explicit resync. **Clear terminal and resync
retained history** acknowledges that earlier output/terminal state is lost; it never
quietly launches a replacement. Scrollback is capped at 2000 lines. Narrow controls
are usable, but full mobile gestures/keyboard/clipboard parity is not claimed.

Without `--terminals`, without a supported executable, or without the optional native
dependency, the office still works and terminal authentication shows an explicit
unavailability reason. `--fixture` instead selects the packaged deterministic Node
fixture through the same host/transport/PTY paths; it is an explicit synthetic
acceptance mode, never a way for browser clients to provide executable arguments.

The native dependency is official `node-pty@1.1.0`, pinned separately from the VSIX.
Its actual tarball contains Windows x64/arm64 prebuilds, including the ConPTY
DLL/OpenConsole helper, and macOS x64/arm64 prebuilds. However, **both macOS
spawn-helper files have mode0644 in the official tarball and cannot execute**.
macOS therefore requires an explicit source rebuild, not a runtime chmod:
`npm_config_build_from_source=true npm rebuild node-pty` from the standalone
installation. This requires Xcode command-line tools and Python/node-gyp.
Linux has no prebuild and needs its source build with a working C++/Python/node-gyp
toolchain. Neither platform has a usable PTY immediately after `--ignore-scripts`.
Installed acceptance records these actual failures before rebuilding, then checks
the source-built helper executable permissions and exercises real native PTYs.
Windows x64 installed prebuild acceptance is exercised locally with scripts disabled.
CI retains full Ubuntu/Windows product gates and a dedicated macOS standalone
types/native/installed-fixture job, not full macOS extension acceptance.
An unrun or failing platform is not an acceptance claim.
See [standalone-only terminal notices](TERMINAL_NOTICES.md). No native/server payload
or terminal license directory is included in the VSIX.

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

Read-only viewers cannot change layouts/appearance/seats or settings and do not
persist drafts. Pan, zoom, agent details and recorded usage remain available.
Separately authorized office control adds the selected-project slice described above;
asset registration, directory management, native dialogs and charter opening remain unavailable.

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
  There is no tokenless mode, remote auth, TLS or firewall configuration.
- Direction-specific network allowlists reject unsupported versions/kinds/fields.
  On `/office`, only readiness, settings reads and bounded agent-detail reads are accepted;
  forged layout, seat, settings, directory, asset and terminal commands on the
  office channel are rejected server-side before dispatch. Invalid server event/layout/numeric
  shapes are rejected by the browser adapter. Opted-in `/control` additionally accepts
  revision-protected layout/seat writes and sound/debug/Areas toggles, not arbitrary
  settings, paths, native actions or terminal commands.
- At most 8 TCP connections, 4 KiB observer frames/auth bodies/headers, 2 MiB + 8 KiB
  control frames (layout data 2 MiB; preferences 128 KiB), 8 MiB
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
npm run acceptance:office --prefix standalone
npm run acceptance:terminals --prefix standalone
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

The office-control helper requires `PLAYWRIGHT_MODULE` and uses the same optional
`EDGE_PATH`. It installs the tarball offline, starts only the opted-in office host
with an empty synthetic home, and drives the real editor, save/reload, conflict
recovery/export, storage-failure retry, settings, import/export and reconnect.
`OFFICE_ARTIFACTS` receives the credential-free desktop/narrow screenshots and
structured results. It checks actual project bytes, unchanged installed bytes,
unchanged roster and no synthetic-home writes. All fixture hosts/browser contexts
are closed and their owned fixture directories removed.

The terminal acceptance helper installs the actual tarball and official dependencies
using the configured feed, loads a real native PTY and executes only the packaged
fixture in an empty synthetic home/project/installation with spaces. It checks
argv/cwd/Unicode, input/resize, reconnect/replay gaps, observed identity rejection,
revocation and owned descendant cleanup. With the same installed Playwright/Edge
settings it exercises production terminal controls and reload, writing screenshots,
package inventory/hashes, source head and failure details under `TERMINAL_ARTIFACTS`.
It downloads no browser. Both helpers remove their owned fixtures and stop hosts.

These are synthetic checks, **not** real Squad/Copilot session acceptance
or native VS Code acceptance. Follow `docs/native-acceptance.md` for the
user/Scout-owned native and real-session plan. Its standalone observation gates
remain pinned to its accepted baseline; this implementation's synthetic terminal
procedures are separate. Real Squad launch and native VS Code execution remain
user/Scout-owned. Private home-log telemetry, persistent credentials, remote
auth/TLS and full mobile terminals remain later layers. Nothing here completes
or closes issues #4, #7 or #8.
