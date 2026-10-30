# Standalone office and owned-terminal channels

The host-neutral office/control and terminal contracts now back the separate
[local standalone package](../standalone/README.md): an authenticated loopback
listener and production browser adapter with **read-only office observation by
default** and optional separately authorized owned PTYs/browser terminals.
The VS Code adapter continues using the same
typed office messages, API acquisition and recovery-state storage.

## Office/control

`src/core/officeChannel.ts` owns the existing `HostClient` interface. The webview
re-exports it for compatibility. `connectOffice` subscribes before sending
`webviewReady`, so synchronous snapshots cannot race subscription. Office
commands/events remain `WebviewMessage`/`OutboundMessage`; terminal messages are
not added to that union. This is a trusted typed seam, **not** a JSON validator or
an authenticated network boundary. The observer's isolated transport validates
office commands before dispatch and rejects every mutation server-side; its
browser adapter separately validates server events. `/office` remains read-only:
separate terminal authority never enables unsupported office mutations.

## Terminal wire contract

`src/core/terminalFrames.ts` defines strict version-1 JSON frames. Both directions
carry an opaque runtime-issued `runId`, distinct from agent/Directory/observation
identity. IDs are not credentials; the server authenticates clients and
look up owned runs in its own registry. Never accept ownership from a wire object.

| Direction | Kind | Fields in addition to version/runId/type |
|---|---|---|
| Client | attach | cursor (last applied output sequence, initially 0) |
| Client | input | data |
| Client | resize | cols, rows (integers, 1..1000) |
| Client | terminate | none |
| Server | replayStart | cursor, through |
| Server | output | seq (starts at 1), data |
| Server | replayEnd | through |
| Server | resync | reason, earliest (oldest retained), latest |

Use the direction-specific decoders on incoming JSON. Unknown versions, kinds,
extra properties, malformed JSON, unsafe/fractional/negative numeric fields and
unpaired UTF-16 surrogates are rejected explicitly. All sequences/cursors are safe
integers. Strings preserve complete Unicode code points and terminal escapes.
The native adapter uses streaming UTF-8 decoding across byte-chunk boundaries and
supplies complete, bounded strings; history rejects oversized chunks
atomically rather than truncating or splitting code points.

The hard ceilings are 64 KiB per serialized UTF-8 JSON frame, 16 KiB per input
payload, 1 MiB / 4096 frames of retained output, and 1 MiB / 4096 frames pending
per attachment. Byte accounting includes JSON envelope/escaping, not just string
length. Both byte and count ceilings apply; replay boundaries and an in-flight
send count toward the pending budget. History evicts oldest records at its
ceiling; reconnect reports `history-gap` if it cannot cover the cursor.
Pending overflow closes that attachment with an explicit `overflow` resync;
it never silently drops data or terminates the owned run.

## Replay and reconnect

`TerminalHistory` assigns monotonic sequences and retains bounded, immutable
records. `attachTerminal` subscribes **before** awaiting a snapshot. A source
snapshot must atomically capture a contiguous range `(cursor, through]`, its
oldest retained sequence and its high-water mark. Output received while awaiting
that snapshot is queued, output already covered by the snapshot is removed,
then replayStart, replay output, replayEnd and queued live output are sent in
order. Replay is staged one record at a time, so even the exact full retained
history can drain without needing extra queue space for its boundaries. A
captured snapshot is separately bounded to 1 MiB / 4096 records and validated
before replay. Per attachment this permits at most that bounded snapshot plus
1 MiB / 4096 pending/in-flight records; no unbounded replay array is constructed.
Snapshot and send failures produce `source-error`; a cursor beyond the source
high-water mark produces `cursor-ahead`.

The sink must resolve `send` only when transport backpressure drains, and `abort`
must signal resync and close even if a send is stalled. Only one send is in
flight. Dispose removes the subscription; it does not kill a process. Attach is
given an existing source and has no spawn capability. The pending budget includes
queued live output and the one in-flight replay/live record or boundary. If a
slow sink lets those exceed either cap, attach fails explicitly rather than
promising continuity. Unstaged snapshot records remain within the separate
captured-history bound; they do not artificially overflow the queue. A resync
requires a fresh, deliberate recovery/clear-terminal policy in the browser,
not an automatic retry loop that silently advances the cursor.

`TerminalReceiver` rejects wrong runs and invalid replay ordering, suppresses
already-applied output, and enters a terminal resync state on a sequence gap.
The browser uses its asynchronous `apply` method: its cursor advances only after
xterm's write callback succeeds and the screen generation is still current.
Pending writes drain before an ordinary same-page reconnect. Reload has no orphaned
cursor: authentication and reconstruction start from zero. A missing retained range
requires explicit clear/resync from the server's earliest retained sequence minus one,
with visible lost-history disclosure. Native output failure invalidates history and
notifies both live attachments and subsequent reconnects with `source-error`. Reconnect
uses the same owned run and that last successfully applied cursor; it must not
launch another process. `owned` registry entries permit attach/input/resize/
terminate for their matching run. `observed` entries permit none of those actions,
even if they happen to carry a forged runId property. Dismissing an observed
card has no process-side authority.

## Implemented runtime and remaining acceptance gates

The private standalone CLI/runtime remains separately packaged, with native/server
dependencies and terminal license payloads excluded from the VSIX. It binds only
`127.0.0.1`. Office and terminal authentication have different runtime credentials,
cookies and WebSocket channels (`/office` and `/terminal`); both enforce exact
Host/Origin checks. Rotation revokes both channels and cancels pending unauthorized
launches without terminating already-owned runs. Credentials are runtime-only; no
tokenless or persistent-credential mode, proxy exposure or remote TLS/auth is claimed.

`src/core/ownedTerminalProtocol.ts` adds strict fixed `list`/`launch` controls and
bounded run-state/error events to the terminal frames above. Clients cannot supply
an executable, argv, environment or directory. The supported launch is
`copilot --agent squad`, with normal permissions and an allowlisted environment.
Windows requires a real `copilot.exe`, not a `.cmd` shim; POSIX admits native binary
headers or an explicit supported Node entry point, not execvp's implicit shell
fallback for executable text. The canonical selected cwd is revalidated immediately
before native launch. The README documents token/proxy/custom-CA exclusions and
platform/toolchain limitations.

Each owned run has an isolated native broker, bounded IPC, input/action/rate ceilings,
bounded retained output and explicit close/shutdown cleanup of its native console or
POSIX process group and ordinary descendants. Input budget is outstanding work,
released on native adapter ack/failure, not a lifetime cap or a claim that the child
consumed the bytes. This is not a containment sandbox for deliberately escaped
processes. Synthetic acceptance installs the real private tarball with an empty
home and paths containing spaces, uses actual native PTYs and production transport,
and optionally captures installed Edge desktop/narrow browser evidence. Windows
tests are not skipped; CI also exercises Ubuntu/macOS rather than assuming prebuild
metadata proves support. Canonical notices and VSIX isolation are inspected.

The native VS Code live-data adapter remains consented/best-effort Copilot JSONL;
standalone office activity remains approximate project-file observation, not a
fabricated live Squad lifecycle. No automatically started Squad EventBus producer
is assumed. Real Squad-session and native VS Code acceptance remain user/Scout-owned
under their separately pinned plan. Full mobile interactions, general browser office
mutations, remote access and persistent credentials remain separate gates. Narrow
screenshots are not full mobile parity. Revision-protected drafts, native
directories/Areas, usage and asset behavior are unchanged.
