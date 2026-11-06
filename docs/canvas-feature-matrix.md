# Canvas feature matrix

Release truth for Canvas plugin **0.1.2**, an owner-approved **Windows
local-session preview**, not generally available or a VSIX/CLI replacement
(#214, epic #172). Prior **0.1.0** evidence qualified app **1.1.34**; this is
not acceptance of 0.1.2, a minimum or a broad compatibility promise.
Native 0.1.2 checks remain pending in [#218](https://github.com/swigerb/squad-pod/issues/218).
The catalog pins the published 0.1.2 artifact. It retains the prior 0.1.1
office, editor and preferences behavior. The 0.1.1 tables below preserve
historical release truth; the 0.1.2 C14/C15 rows describe current candidates
and supersede the corresponding charter and import/export rows. All 0.1.2
candidates remain pending native acceptance.
macOS, Linux, WSL and remote sessions
are unsupported. See the [install and lifecycle guide](canvas-install.md).
It observes only the exact joined session/project. No directory browsing,
terminal authority or private CLI-log consent is implied.

## Authority and release decisions

Every instance starts **read-only**, including reloads. **Enable editing** is a
separate, explicit per-instance office-control opt-in; viewer access alone cannot
write. Editing authorizes project layout, declared-member seats/appearance and
settings, not arbitrary files, launches, logs or other projects.

In the 0.1.1 tables, **Candidate** means implemented in that prior preview, not a
promise of full native parity; **OPEN** marks unavailable capabilities/remaining
parity work at that release. These decisions are historical, not current 0.1.2
availability. **Transfer gate** means implemented browser behavior, embedded
transfer unverified. The separate 0.1.2 section describes current candidate
features; CLI usage import, terminal and directory management remain OPEN or
excluded.

## Previous published 0.1.1: office, editor and preferences

| Control (including subcontrols) | Canvas behavior | Reason | Release decision |
|---|---|---|---|
| Pan/drag, wheel zoom, Zoom +/−, Fit and center | Operate on the displayed office without write access. | Shared renderer and viewport controls. | Candidate |
| Agent character/label selection; detail card; close | Inspect observed agent details; close returns to office. | Selected-project observation, not a launch. | Candidate |
| Expand/collapse agent labels; scroll crowded labels; Locate character | Canvas labels start collapsed; expand to browse and locate. No initial focus grab. | Keeps narrow (~750px) panels usable; other hosts retain defaults. | Candidate; narrow-panel native gate |
| Task-bubble toggle | Toggles joined-session task text, without inventing tasks. | Exact current-session SDK activity, not CLI-log scanning; no historical replay (#209/#210). | Candidate |
| Enable editing; Edit Layout / Exit Layout Editor | Explicit control authorization first; editor unavailable read-only. | Viewer and office-control authority are separate. | Candidate |
| Narrow desktop panel editor | Layout editor remains available after opt-in; narrow width alone does not select mobile-view controls. | Canvas uses pointer capability rather than width for this distinction (#212/#213); not mobile-platform support. | Candidate |
| Select, Floor, Wall, Carpet, Furniture, Areas, Pets, Eyedropper, Erase tools | Shared editor after opt-in; paint/place/select on the office. | Layout-only editing within the selected project. | Candidate |
| Floor patterns; wall color; carpet styles 1–3 | Choose loaded patterns/styles; unavailable carpet sprites cannot be selected. | Uses bundled/available sprites. | Candidate |
| Color hue/saturation/brightness; carpet main/accent | Adjust the selected tool's colors. | Shared layout color data. | Candidate |
| Furniture catalogs/categories and item previews | Choose and place available furniture. | Existing sprite catalog, not external-folder access. | Candidate |
| New/selected furniture color; clear color; copy color from another item | Change or sample furniture colors. | Existing editor gestures. | Candidate |
| Selected furniture Delete, Rotate (R), on/off | Apply supported selection transforms/toggles. | Shared layout operations, not device control. | Candidate |
| Expand Left/Up/Down/Right; ghost-border expansion | Expand the layout grid. | Existing bounded editor. | Candidate |
| Undo (Ctrl+Z), Redo (Ctrl+Y) | Work with available history; disabled with a reason when empty. | No misleading actionable empty-history buttons. | Candidate |
| Reset to last save; Save | Reset draft or submit revision-checked save; failures/conflicts remain visible. | Shared guarded project store; no automatic overwrite. | Candidate |
| Pets carousel: add/remove, click pet for heart | Loaded pets can be toggled; missing sprites cannot be added, but saved unavailable pets can be removed. | Preserve saved data without pretending assets loaded. | Candidate |
| Areas: name/color inputs, Add, select, rename, recolor, paint/erase, remove; Shift-Eyedrop selection | Available after editing opt-in. | Host-neutral named layout regions. | Candidate |
| Areas directory selector and mapping checkbox | Disabled with Canvas explanation; existing mappings preserved. | No directory-management authority; only selected project observed. | OPEN |
| Seat assignment gesture (selected agent, click another seat); member appearance persistence | Authorized declared-member preferences only; seat changes unavailable read-only. | Shared project preferences; transient subagents cannot gain persisted seats. | Candidate |
| Settings open/close; Sound Notifications; Show Named Areas; Debug View | Settings unavailable read-only; project preferences after opt-in. | Explicit office-control authorization. | Candidate |
| VS Code Live Activity checkbox / CLI-log observation | Checkbox disabled; private CLI-log scanning unavailable. Joined-session activity works independently. | Office editing does not grant private CLI-log access; Canvas receives exact-session SDK events. | OPEN for CLI-log observation only |

## Previous published 0.1.1: information, assets and telemetry

| Control (including subcontrols) | Canvas behavior | Reason | Release decision |
|---|---|---|---|
| Squad Info open/close; member expand/collapse | Shows selected roster, inline charter summary/source and available detail. | Read-only observation of selected project. | Candidate |
| Agent View Charter; member Open charter | Native file-opening action disabled with reason. Inline information remains readable. | No native editor/file-opening authority in published 0.1.1. Superseded for 0.1.2 by the host-mediated action below. | OPEN in 0.1.1 only |
| Runtime model details/status | Show source-reported joined-session model/context observations when supplied and attributable; missing fields remain unavailable. | SDK events, not live-log scanning; configured preference is not observed runtime truth. | Candidate; producer-dependent |
| Missing-team setup guide link | External Squad documentation; selected-project explanation, no in-panel directory navigation. | Panel cannot select another project or initialize a team. | Candidate; external-link native gate |
| Asset warning/details disclosure | Inspect load diagnostics and existing directory status. | Observation only. | Candidate |
| Add Asset Directory; existing directory Unload | Disabled with filesystem/management reason. | No local folder picker/asset-directory authority. | OPEN |
| Telemetry open/close; event count; scroll; jump to latest | Browse available observed activity. | Existing observation feed; not synthetic live-session evidence. | Candidate |
| Clear activity feed | Clears displayed activity only, not tasks or recorded usage. | Feed clearing is not accounting deletion. | Candidate |
| Event detail expansion | Inspect available event detail. Live activity-source diagnostics/consent controls are not offered in Canvas. | Missing data remains unavailable, not fabricated. | Candidate |
| Recorded usage coverage/source diagnostics and recent-history disclosures; CLI model-breakdown and provenance disclosures | Display only available recorded quantities with source/units; missing is not zero. CLI snapshot is separate from ledger totals. | No invented billing, runtime model or cross-source sums. | Candidate |
| CLI usage Select JSON, Refresh selected export, Forget export | Action controls absent; explicit Canvas-unavailable explanation replaces import/launch instructions. | Canvas does not import CLI usage files or launch CLI. | OPEN |
| Joined-session live activity: Squad member sub-agents, tools, task bubbles | Available from the exact current session, with exact roster attribution and no historical event replay (#209/#210). | Bounded SDK projection; no cross-session discovery or private CLI-log reads. Missing/unmatched data is not invented. | Candidate |

## Previous published 0.1.1: files, recovery and host-bound operations

| Control (including subcontrols) | Canvas behavior | Reason | Release decision |
|---|---|---|---|
| Import Layout | After opt-in, browser JSON picker; 2 MiB limit and schema validation; replaces draft, does not automatically save. | Published 0.1.1 browser path, not native filesystem access. | Transfer gate |
| Export Layout | After opt-in, browser download of bounded JSON (2 MiB). | Published 0.1.1 browser transfer, not arbitrary file writing. | Transfer gate |
| Conflict JSON disclosures; Export local draft/snapshot/retained copy | Inspect preserved versions and download copies. | Published 0.1.1 recovery is scoped to project/server instance, not a durable backup. | Transfer gate |
| Keep local draft; Use incoming; Confirm incoming; Cancel replacement | Deliberate conflict resolution retains copies; incoming replacement requires confirmation. | Revision protection; no silent overwrite. | Candidate |
| Unacknowledged preference/seat Retry, Export, Discard | Explicit recovery choices; no automatic retry after lost acknowledgement. | Shared guarded preferences and instance-scoped recovery. | Candidate; export transfer gate |
| Directories entry point | Disabled with selected-project/native-authority reason. | No directory catalog management in Canvas. | OPEN |
| Nested directory add/remove/rename/navigation; directory CLI launch; terminal open/input/reconnect/close | Inaccessible through disabled directory entry point; no launch/terminal action offered. | No native filesystem, CLI-launch or terminal authority. | OPEN |
| Startup diagnostic report | Unsupported request capability-gated; no visible button. | Host must advertise the action. | Candidate |
| `get_office_state` readiness | Bounded per-instance request/handshake counters via the authorized Canvas action only. | Requests observed are not visible-renderer acceptance or host-fault evidence; no public diagnostics endpoint. | Candidate; 0.1.1 native checks pending |

## Canvas 0.1.2 release truth (C14/C15; native acceptance pending #218)

The C14 renderer diagnostics and snapshot action and the C15 host-mediated
capabilities are included in the published 0.1.2 artifact. This release retains
the prior office, editor and preferences behavior. The C15 charter and
import/export rows below supersede their corresponding 0.1.1 rows; CLI usage
import, terminal and directory management remain OPEN or excluded. Browser
transfer remains a fallback, and native embedded transfer is still unqualified.

| Control | 0.1.2 candidate behavior | Boundary | Release decision |
|---|---|---|---|
| `get_office_state` rendering (C14) | `rendering.firstFrame` is null (unknown) until an authenticated webview reports a completed nonzero-area office draw. Reports first draw time (Unix milliseconds), frame count (saturates at 65535), backing-store pixel width/height, document visibility and IntersectionObserver intersection (`null` until known/unavailable). | Application-reported drawing, not compositor visibility, human observation or host-defect diagnosis. Request counters retain their separate meaning. | Candidate; pending native acceptance (#218) |
| `get_office_snapshot` (C14) | Read-only agent action returns one fresh PNG through SDK `ToolResultObject.binaryResultsForLlm` for the exact authorized requesting instance. On-demand next-draw readback; maximum 1024 x 768 pixels (aspect ratio preserved, no upscaling), 1 MiB decoded PNG, 2-second response deadline, one pending request per viewer socket. | Random request correlation, authenticated instance socket, PNG signature/dimensions/full decode/CRC checks. No image cache, cross-project lookup, control opt-in, filesystem writes or diagnostics endpoint. Missing frame, malformed/stale/oversized image, disconnect or timeout cannot return an image; action errors are sanitized. | Candidate; pending native acceptance (#218) |
| Agent View Charter; member Open charter | Explicit click attempts the host `editor` only when its discovered schema supports repo scope. Missing/rejected capability disables opening with one sanitized reason; inline text stays readable. **Confirmed regression NA-012-CHARTER-001 ([#230](https://github.com/swigerb/squad-pod/issues/230)):** in the published artifact, one member's missing charter also disables View Charter for other valid members in the same office instance (final disabled state owner-confirmed). **Known defect ([#232](https://github.com/swigerb/squad-pod/issues/232)):** a second host request made while another is in flight in the same instance (for example, a double-click on View Charter, or View Charter during a usage Refresh) is refused as busy, and that refusal disables the second operation for the instance. | Current declared member only; guarded `.squad`/`.ai-team` charter translated from the actual Git worktree root, including nested joined-project prefixes. No arbitrary opening authority. | Candidate; pending native acceptance (#218); NA-012 regression open (#230) |
| Joined-session usage Refresh | Explicit click calls joined-session `usage.getMetrics()` when available. Displays only supplied finite nonnegative session quantities and units. | New separate source, not external CLI export Select/Refresh/Forget, ledger totals, USD billing or model observation. The CLI-import OPEN row stays OPEN. Missing is not zero. **Known defect (#232):** a Refresh made while another host request is in flight is refused as busy and disables usage for the instance. | Candidate; pending native acceptance (#218); busy defect open (#232) |
| Import project JSON | After editing opt-in, a project-relative `.json` path receives guarded UTF-8 read, 2 MiB and layout-schema validation, replacing the draft only. | Exact joined project; no links, absolute paths or traversal. No automatic save. Browser picker remains the fallback and is still unqualified natively. | Candidate; pending native acceptance (#218) |
| Export Layout | After editing opt-in, attempts `workspaces.createFile` with exact validated JSON (2 MiB), a generated filename in this session's workspace files, and a success filename disclosure. | Presence is not permission. No caller-supplied destination or Markdown substitute. Missing method uses browser download; after rejection the user must explicitly export again to use the browser fallback. | Candidate; pending native acceptance (#218) |
| Export local draft/snapshot/retained layout copy | Uses the same exact-JSON host export path with browser fallback. | Instance/project-scoped recovery, not a durable backup. Workspace file accessibility and embedded transfer remain native gates. | Candidate; pending native acceptance (#218) |

SDK awaits have one-second deadlines. A timed-out path is quarantined for the
instance, and unrelated operations can continue. A timeout does not cancel an
underlying write/open, permit automatic retry or prove a successful outcome.
Late results cannot turn the unavailable response into success.

These C14 features do not extend historical native results. First-frame
evidence is a bounded first observation for the live viewer connection, not a
continuous visibility monitor. `onScreen: true` means IntersectionObserver
reported intersection, not that the window was unobscured or its pixels reached
a display. PNG readback shows canvas contents, not the native compositor or
other app UI. A hidden or stalled panel can have historical drawing evidence
while a fresh snapshot times out. Disconnect discards that connection's
evidence and pending reads. A deliberate retry replaces a timed-out request
still queued in a stalled webview; resuming drawing returns only the latest
nonce without disconnecting the office. The server continues to reject
old/unsolicited snapshot results.

See the [agent-runnable qualification procedure](canvas-install.md#agent-runnable-qualification-c14-012-preview)
for the subset of #218 that can be investigated without UI automation; no result
automatically changes a native gate to PASS.

## Canvas 0.1.3 source candidates (not published; native acceptance pending #218)

These rows describe repository source only. They are not included in
the published 0.1.2 artifact or current catalog pin. They are 0.1.3 candidates,
not accepted native behavior, and need a new immutable candidate plus native
retest before any release decision.

| Control | Source behavior | Boundary | Release decision |
|---|---|---|---|
| Agent View Charter; member Open charter (NA-012-CHARTER-001 fix, #230) | A known local refusal for one member (missing, unreadable or undeclared charter) is reported as that member's charter being unavailable, makes no Editor call and leaves other members' charters available in the same office. Host rejection, timeout, malformed, unrecognized or late results still disable opening for the instance with one sanitized reason and no automatic retry. | Current declared member only, validated before Editor discovery and rechecked against the roster declaration and charter file immediately before opening; a change during discovery fails closed. Same guarded path translation as 0.1.2. | 0.1.3 candidate; requires new immutable artifact and native retest (#230, #218) |
| Host request overlap (busy; #232) | One host request runs at a time per office instance, shared by every viewer. A request refused only because another is in flight makes no host call, quarantines nothing and is reported as a typed request refusal; every capability stays available, and the status says nothing was sent. A repeated View Charter for the same member while its open is in flight joins that request: one Editor open, no error status. Every joined caller receives the actual operation result, including failure or disposal; none can hang or receive a success-shaped fallback. In one browser, other operations are refused locally while busy without sending anything; a busy export keeps the host path rather than falling back. | Busy is accepted only as an exact three-key request refusal after the disposal checks. Malformed, forged, extra-key, late or post-disposal busy-shaped results, unauthorized or revoked requests, and genuine rejection or timeout still fail closed and quarantine as before. No automatic retry. | 0.1.3 candidate; requires new immutable artifact and native retest including a double-click step (#232, #218) |

## Remaining — OPEN release gates

- Historical 0.1.0 Windows qualification is recorded in #182 and the public
  marketplace install in #216. Neither qualifies 0.1.1 or 0.1.2. Their
  update/rollback,
  repeated lifecycle, fault handling and separate native VS Code checks remain
  pending #218; local catalog checks and browser tests do not establish them.
- Retain exact project/session and host-build evidence for read-only/enabled
  editing, narrow labels/editor, keyboard/focus, system theme and panel resize;
  qualification of one build is not cross-platform or general parity evidence.
- Verify embedded JSON picker/download and recovery exports end-to-end; browser
  tests do not establish native embedded file-transfer support. The 0.1.2
  host-mediated charter, joined-session metrics and JSON transfers are
  **Candidate; pending native acceptance (#218)**,
  not PASS. Method detection and successful mocked calls are not permission grants.
- OPEN capabilities remain disclosed preview limitations, not parity claims.
  Any broader release needs its own owner disposition and native evidence.
- Independent final code/documentation review remains required. Local
  tests/builds and synthetic fixtures are not native app passes.

## Platform investigation (static only; #223)

The experimental SDK `CanvasProviderOpenResult` supplies a URL, not a forwarded
socket or tunnel contract. `standalone/src/canvas/officeHost.ts` returns
`http://127.0.0.1:<port>/`; `transport.ts` binds only that address and validates
the exact Host/Origin plus instance viewer/control cookies. In WSL or a remote
session, that address may identify a different machine/network namespace from
the app webview. No documented forwarding guarantee was found in the inspected
SDK contracts. A URL-only result does not prove forwarding or usable office data.

**WSL/remote remain unsupported and deferred**; do not broaden the listener,
relax origin/auth checks or add a forwarding workaround. This is the owner-directed
disposition, not a failed native probe. macOS/Linux code portability is exercised
by the mocked-SDK headless provider smoke in `standalone/src/canvas/officeHost.test.ts`,
already included in Ubuntu, Windows and macOS CI standalone suites.
Those are **Candidate; pending native** checks only: native macOS/Linux Pod
qualification remains unsupported/unverified. The
[official app documentation](https://docs.github.com/en/copilot/concepts/copilot-surfaces/github-copilot-app)
lists macOS, Linux and Windows, and the [app install page](https://github.com/github/app#install)
offers Mac Apple Silicon/Intel and Linux x64/ARM builds (checked 2026-11-05).
App availability is not Pod qualification; neither platform becomes supported
through CI.

Bundled artwork and attribution are unchanged. Keep [third-party notices](../THIRD_PARTY_NOTICES.md),
[LICENSE](../LICENSE) and asset provenance with distributions. Character permission
is creator-specific, not blanket MIT; external-asset ownership is not granted by
this plugin. See [Canvas development](canvas-development.md) for artifact context
and [authorization/recovery](../standalone/README.md#host-neutral-canvas-module-read-only-by-default)
for the existing store contract.
