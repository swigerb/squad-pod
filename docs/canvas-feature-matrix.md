# Canvas feature matrix

Release truth for the experimental local Canvas plugin, issue #200 (parent #180,
epic #172). This is an initial Windows candidate, not native acceptance or a
VSIX/CLI replacement. It observes only the explicitly selected project/session.
No directory browsing, terminal authority or private-log consent is implied.

## Authority and release decisions

Every instance starts **read-only**, including reloads. **Enable editing** is a
separate, explicit per-instance office-control opt-in; viewer access alone cannot
write. Editing authorizes project layout, declared-member seats/appearance and
settings, not arbitrary files, launches, logs or other projects.

In the tables, **Candidate** means implemented for review, still subject to native
acceptance; **OPEN** means unavailable and awaiting owner release disposition.
Documenting a limitation does not approve its deferral or close #200.
**Transfer gate** means implemented browser behavior, embedded transfer unverified.

## Office, editor and preferences

| Control (including subcontrols) | Canvas behavior | Reason | Release decision |
|---|---|---|---|
| Pan/drag, wheel zoom, Zoom +/−, Fit and center | Operate on the displayed office without write access. | Shared renderer and viewport controls. | Candidate |
| Agent character/label selection; detail card; close | Inspect observed agent details; close returns to office. | Selected-project observation, not a launch. | Candidate |
| Expand/collapse agent labels; scroll crowded labels; Locate character | Canvas labels start collapsed; expand to browse and locate. No initial focus grab. | Keeps narrow (~750px) panels usable; other hosts retain defaults. | Candidate; narrow-panel native gate |
| Task-bubble toggle | Toggles available task text, without inventing tasks. | Display-only; live CLI tasks remain unavailable. | Candidate |
| Enable editing; Edit Layout / Exit Layout Editor | Explicit control authorization first; editor unavailable read-only. | Viewer and office-control authority are separate. | Candidate |
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
| Live Activity checkbox | Disabled; explains logs/session tasks are unavailable. | Office editing does not grant private CLI-log access. | OPEN |

## Information, assets and telemetry

| Control (including subcontrols) | Canvas behavior | Reason | Release decision |
|---|---|---|---|
| Squad Info open/close; member expand/collapse | Shows selected roster, inline charter summary/source and available detail. | Read-only observation of selected project. | Candidate |
| Agent View Charter; member Open charter | Native file-opening action disabled with reason. Inline information remains readable. | No native editor/file-opening authority. | OPEN |
| Runtime model details/status | Unavailable observations are explained without CLI-restart instructions. | No live-log scanning; configured preference is not observed runtime truth. | OPEN for runtime observation |
| Missing-team setup guide link | External Squad documentation; selected-project explanation, no in-panel directory navigation. | Panel cannot select another project or initialize a team. | Candidate; external-link native gate |
| Asset warning/details disclosure | Inspect load diagnostics and existing directory status. | Observation only. | Candidate |
| Add Asset Directory; existing directory Unload | Disabled with filesystem/management reason. | No local folder picker/asset-directory authority. | OPEN |
| Telemetry open/close; event count; scroll; jump to latest | Browse available observed activity. | Existing observation feed; not synthetic live-session evidence. | Candidate |
| Clear activity feed | Clears displayed activity only, not tasks or recorded usage. | Feed clearing is not accounting deletion. | Candidate |
| Event detail expansion | Inspect available event detail. Live activity-source diagnostics/consent controls are not offered in Canvas. | Missing data remains unavailable, not fabricated. | Candidate |
| Recorded usage coverage/source diagnostics and recent-history disclosures; CLI model-breakdown and provenance disclosures | Display only available recorded quantities with source/units; missing is not zero. CLI snapshot is separate from ledger totals. | No invented billing, runtime model or cross-source sums. | Candidate |
| CLI usage Select JSON, Refresh selected export, Forget export | Action controls absent; explicit Canvas-unavailable explanation replaces import/launch instructions. | Canvas does not import CLI usage files or launch CLI. | OPEN |
| Live logs and session tasks | Unavailable with Canvas-specific explanation. | Selected-project file observation is not private/live CLI consent. | OPEN |

## Files, recovery and host-bound operations

| Control (including subcontrols) | Canvas behavior | Reason | Release decision |
|---|---|---|---|
| Import Layout | After opt-in, browser JSON picker; 2 MiB limit and schema validation; replaces draft, does not automatically save. | Existing browser path, not native filesystem access. | Transfer gate |
| Export Layout | After opt-in, browser download of bounded JSON (2 MiB). | Browser transfer, not arbitrary file writing. | Transfer gate |
| Conflict JSON disclosures; Export local draft/snapshot/retained copy | Inspect preserved versions and download copies. | Recovery is scoped to project/server instance, not a durable backup. | Transfer gate |
| Keep local draft; Use incoming; Confirm incoming; Cancel replacement | Deliberate conflict resolution retains copies; incoming replacement requires confirmation. | Revision protection; no silent overwrite. | Candidate |
| Unacknowledged preference/seat Retry, Export, Discard | Explicit recovery choices; no automatic retry after lost acknowledgement. | Shared guarded preferences and instance-scoped recovery. | Candidate; export transfer gate |
| Directories entry point | Disabled with selected-project/native-authority reason. | No directory catalog management in Canvas. | OPEN |
| Nested directory add/remove/rename/navigation; directory CLI launch; terminal open/input/reconnect/close | Inaccessible through disabled directory entry point; no launch/terminal action offered. | No native filesystem, CLI-launch or terminal authority. | OPEN |
| Startup diagnostic report | Unsupported request capability-gated; no visible button. | Host must advertise the action. | Candidate |

## Remaining — OPEN release gates

- Scout must capture **native app screenshots** and acceptance for this exact
  selected project/session and qualified host build, including read-only and
  enabled editing, narrow labels, keyboard/focus, system theme and panel resize.
- Verify embedded JSON picker/download and recovery exports end-to-end; browser
  tests do not establish native embedded file-transfer support.
- Obtain explicit owner disposition for every OPEN capability above. Disabled or
  inaccessible controls are disclosed limitations, not accepted parity.
- Independent final code/documentation review and native evidence are still
  required. Local tests/builds and synthetic fixtures are not native app passes.

Bundled artwork and attribution are unchanged. Keep [third-party notices](../THIRD_PARTY_NOTICES.md),
[LICENSE](../LICENSE) and asset provenance with distributions. Character permission
is creator-specific, not blanket MIT; external-asset ownership is not granted by
this plugin. See [Canvas development](canvas-development.md) for artifact context
and [authorization/recovery](../standalone/README.md#host-neutral-canvas-module-read-only-by-default)
for the existing store contract.
