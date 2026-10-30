# Standalone channel prerequisite

This slice supplies host-neutral office/control and terminal contracts, not a
standalone runtime. There is no listener, authentication implementation, PTY,
process launcher or terminal UI. The VS Code adapter continues using the same
typed office messages, API acquisition and recovery-state storage.

## Office/control

`src/core/officeChannel.ts` owns the existing `HostClient` interface. The webview
re-exports it for compatibility. `connectOffice` subscribes before sending
`webviewReady`, so synchronous snapshots cannot race subscription. Office
commands/events remain `WebviewMessage`/`OutboundMessage`; terminal messages are
not added to that union. This is a trusted typed seam, **not** a JSON validator or
an authenticated network boundary. A future network adapter must validate office
payloads and authorize mutations before dispatch.

## Terminal wire contract

`src/core/terminalFrames.ts` defines strict version-1 JSON frames. Both directions
carry an opaque runtime-issued `runId`, distinct from agent/Directory/observation
identity. IDs are not credentials; the future server must authenticate clients and
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
The eventual process adapter must use streaming UTF-8 decoding across byte-chunk
boundaries and supply complete, bounded strings; history rejects oversized chunks
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
order. Snapshot and send failures produce `source-error`; a cursor beyond the
source high-water mark produces `cursor-ahead`.

The sink must resolve `send` only when transport backpressure drains, and `abort`
must signal resync and close even if a send is stalled. Only one send is in
flight. Dispose removes the subscription; it does not kill a process. Attach is
given an existing source and has no spawn capability. If a replay plus concurrent
live output cannot fit the pending budget (including boundaries), attach fails
explicitly rather than promising continuity. A resync requires a fresh,
deliberate recovery/clear-terminal policy in the future UI, not an automatic
retry loop that silently advances the cursor.

`TerminalReceiver` rejects wrong runs and invalid replay ordering, suppresses
already-applied output, and enters a terminal resync state on a sequence gap.
Persist its cursor only after applying returned output successfully. Reconnect
uses the same owned run and that last successfully applied cursor; it must not
launch another process. `owned` registry entries permit attach/input/resize/
terminate for their matching run. `observed` entries permit none of those actions,
even if they happen to carry a forged runId property. Dismissing an observed
card has no process-side authority.

## Remaining acceptance gates

The subsequent implementation default is a separately packaged standalone
CLI/runtime, keeping native server dependencies out of the VSIX. That is an
implementation default, not a user-selected distribution decision. Loopback-safe
binding, authenticated office/terminal channels, Host/Origin checks, read-only
authorization, token storage/rotation/redaction and remote TLS/auth remain gates.
Mobile office/terminal interactions remain a later gate, not desktop-layout touch
parity.

The supported eventual launch remains `copilot --agent squad`. Current live data
is a consented, best-effort Copilot JSONL adapter; no Squad EventBus producer is
assumed. Shell-free Windows launch, native PTY/platform support, real Squad-session
acceptance, Native VS Code acceptance and isolated installed-artifact checks
remain unproven here. Deterministic in-memory tests and a packaged VSIX are not
substitutes for those approvals. Revision-protected drafts, directories/Areas,
usage and asset behavior are unchanged.
