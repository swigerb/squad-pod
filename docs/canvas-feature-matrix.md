# Canvas feature matrix

Release truth for Canvas plugin **0.1.1**, an owner-approved **Windows
local-session preview**, not generally available or a VSIX/CLI replacement
(#214, epic #172). Prior **0.1.0** evidence qualified app **1.1.34**; this is
not 0.1.1 acceptance, a minimum or a broad compatibility promise.
Native 0.1.1 checks remain pending in [#218](https://github.com/swigerb/squad-pod/issues/218).
macOS, Linux, WSL and remote sessions
are unsupported. See the [install and lifecycle guide](canvas-install.md).
It observes only the exact joined session/project. No directory browsing,
terminal authority or private CLI-log consent is implied.

## Authority and release decisions

Every instance starts **read-only**, including reloads. **Enable editing** is a
separate, explicit per-instance office-control opt-in; viewer access alone cannot
write. Editing authorizes project layout, declared-member seats/appearance and
settings, not arbitrary files, launches, logs or other projects.

In the tables, **Candidate** means implemented in the preview, not a promise of
full native parity; **OPEN** marks unavailable capabilities/remaining parity work.
The owner-approved preview does not close those broader capability gaps.
**Transfer gate** means implemented browser behavior, embedded transfer unverified.

## Office, editor and preferences

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

## Information, assets and telemetry

| Control (including subcontrols) | Canvas behavior | Reason | Release decision |
|---|---|---|---|
| Squad Info open/close; member expand/collapse | Shows selected roster, inline charter summary/source and available detail. | Read-only observation of selected project. | Candidate |
| Agent View Charter; member Open charter | On explicit click, attempt the host `editor` canvas only when its advertised schema supports repo scope. Missing/rejected capability disables opening with one sanitized reason; inline information remains readable. | Current declared member only, guarded `.squad`/`.ai-team` charter; translate joined-project paths from the actual Git worktree root. Not arbitrary file-opening authority. | Candidate; pending native |
| Runtime model details/status | Show source-reported joined-session model/context observations when supplied and attributable; missing fields remain unavailable. | SDK events, not live-log scanning; configured preference is not observed runtime truth. | Candidate; producer-dependent |
| Missing-team setup guide link | External Squad documentation; selected-project explanation, no in-panel directory navigation. | Panel cannot select another project or initialize a team. | Candidate; external-link native gate |
| Asset warning/details disclosure | Inspect load diagnostics and existing directory status. | Observation only. | Candidate |
| Add Asset Directory; existing directory Unload | Disabled with filesystem/management reason. | No local folder picker/asset-directory authority. | OPEN |
| Telemetry open/close; event count; scroll; jump to latest | Browse available observed activity. | Existing observation feed; not synthetic live-session evidence. | Candidate |
| Clear activity feed | Clears displayed activity only, not tasks or recorded usage. | Feed clearing is not accounting deletion. | Candidate |
| Event detail expansion | Inspect available event detail. Live activity-source diagnostics/consent controls are not offered in Canvas. | Missing data remains unavailable, not fabricated. | Candidate |
| Recorded usage coverage/source diagnostics and recent-history disclosures; CLI model-breakdown and provenance disclosures | Display only available recorded quantities with source/units; missing is not zero. CLI snapshot is separate from ledger totals. | No invented billing, runtime model or cross-source sums. | Candidate |
| CLI usage Select JSON, Refresh selected export, Forget export | Action controls absent; explicit Canvas-unavailable explanation replaces import/launch instructions. | Canvas does not import CLI usage files or launch CLI. | OPEN |
| Joined-session usage Refresh | Explicit click calls joined-session `usage.getMetrics()` when available. Displays supplied nonnegative finite session quantities and units only; rejected paths become unavailable. | Separate source, not a replacement for external CLI export import/refresh/Forget, recorded ledger totals, USD billing or runtime model observation. Missing is not zero. | Candidate; pending native |
| Joined-session live activity: Squad member sub-agents, tools, task bubbles | Available from the exact current session, with exact roster attribution and no historical event replay (#209/#210). | Bounded SDK projection; no cross-session discovery or private CLI-log reads. Missing/unmatched data is not invented. | Candidate |

## Files, recovery and host-bound operations

| Control (including subcontrols) | Canvas behavior | Reason | Release decision |
|---|---|---|---|
| Import Layout | After opt-in, explicit project-relative JSON path with guarded read, 2 MiB and layout-schema validation; replaces draft only. Browser JSON picker remains the fallback. | Exact joined project only; no links, absolute paths or traversal. No automatic save. Embedded picker remains unqualified. | Candidate; pending native |
| Export Layout | After opt-in, attempt `workspaces.createFile` with exact validated layout JSON (2 MiB) and a generated filename in the joined session's workspace files. Show the filename after success. Missing capability uses browser download; rejection shows one sanitized reason and a subsequent explicit Export uses browser fallback. | Method presence is not permission. No caller-supplied export destination or Markdown substitute. Embedded transfers remain unqualified. | Candidate; pending native |
| Conflict JSON disclosures; Export local draft/snapshot/retained copy | Inspect preserved versions and export exact validated JSON through the same host-mediated path, with browser fallback. | Recovery is scoped to project/server instance, not a durable backup. | Candidate; pending native |
| Keep local draft; Use incoming; Confirm incoming; Cancel replacement | Deliberate conflict resolution retains copies; incoming replacement requires confirmation. | Revision protection; no silent overwrite. | Candidate |
| Unacknowledged preference/seat Retry, Export, Discard | Explicit recovery choices; no automatic retry after lost acknowledgement. | Shared guarded preferences and instance-scoped recovery. | Candidate; export transfer gate |
| Directories entry point | Disabled with selected-project/native-authority reason. | No directory catalog management in Canvas. | OPEN |
| Nested directory add/remove/rename/navigation; directory CLI launch; terminal open/input/reconnect/close | Inaccessible through disabled directory entry point; no launch/terminal action offered. | No native filesystem, CLI-launch or terminal authority. | OPEN |
| Startup diagnostic report | Unsupported request capability-gated; no visible button. | Host must advertise the action. | Candidate |
| `get_office_state` readiness | Bounded per-instance request/handshake counters via the authorized Canvas action only. | Requests observed are not visible-renderer acceptance or host-fault evidence; no public diagnostics endpoint. | Candidate; 0.1.1 native checks pending |

## Remaining — OPEN release gates

- Historical 0.1.0 Windows qualification is recorded in #182 and the public
  marketplace install in #216. Neither qualifies 0.1.1. Its update/rollback,
  repeated lifecycle, fault handling and separate native VS Code checks remain
  pending #218; local catalog checks and browser tests do not establish them.
- Retain exact project/session and host-build evidence for read-only/enabled
  editing, narrow labels/editor, keyboard/focus, system theme and panel resize;
  qualification of one build is not cross-platform or general parity evidence.
- Verify embedded JSON picker/download and recovery exports end-to-end; browser
  tests do not establish native embedded file-transfer support. Host-mediated
  charter, joined-session metrics and JSON transfers are **Candidate; pending native**,
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
