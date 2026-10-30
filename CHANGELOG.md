# Changelog

All notable changes to Squad Pod are documented here.

## [Unreleased]

- Furniture groups now support directional rotation and mirrored views, with one palette entry per group, preserved tint and seat assignments, and one undo step per turn.

### Changed
- Explicit supported reading-tool metadata now selects supplied reading sprites instead of typing sprites. Bundled employee PNG sheets contain no reading art, so reading uses an inline sprite template instead of duplicated walk frames; the generated fallback shares typing art until dedicated reading frames are supplied, and the provider still emits no live tool metadata.
- Replaced the unresolved office tileset and inline furniture art with the source-pinned original Pixel Agents furniture/floor/wall bundle (MIT, Pablo De Lucca). The historical screenshot is excluded from the VSIX. Legacy layout IDs/geometry remain intact as explicit missing-art markers; no automatic reset or remap occurs.
- Toolchain modernized: Node 22.13+, VS Code 1.107+, React 19, Vite 8, Vitest 4, ESLint 10, esbuild 0.28; CI on Ubuntu and Windows.
- Activity detection rewritten for current Squad: orchestration log, decision inbox and per-agent folders identify the working member; startup no longer replays old files.
- Diagnostics moved to the **Squad Pod** output channel (no more workspace debug logs or popups).

### Added
- VS Code setting `squad-pod.autoShowPanel` (default `false`) optionally focuses the office once on extension activation, skipping an already-visible panel. Roster/history replay and visibility changes never trigger it; no Squad, terminal, process, server or bridge is launched (#52).
- Reconnect snapshots now refresh existing roster names and roles and restore observed current-task text alongside status without changing saved appearance or seats.
- A typed webview client seam for outbound requests, inbound subscriptions and protected recovery state, backed by the existing VS Code API. Missing hosts and recovery-read/write failures are surfaced without replacing protected drafts; this is foundation only, not standalone/browser support, and #8 remains open.
- Legacy sprite payloads are validated and ignored with a diagnostic when they do not match the renderer format, retaining existing assets.
- Three source-pinned auto-tiling carpet styles with main/accent colors, style/color eyedropper, single-transaction paint/right-erase undo/redo, and resize/save/import/export preservation. Carpets are an optional visual layer: floor/wall IDs, walkability, furniture and Squad displays are unchanged. Separate PR316 asset provenance, exact blob checks and MIT contributor notices retained. Directory launch and full upstream parity remain separate slices.
- Layout editor furniture color controls: tint selected furniture or choose a color for new placements, clear colors, and copy a furniture color with a color-only eyedropper; overlapping surface items take priority and each color edit/eyedrop is independently undoable. Furniture tint is baked into manifest/placeholder sprites; the production tileset metadata rendering bypass remains inactive and is not covered.
- Named Areas with optional `{label, color}` definitions, floor-only painted tile membership, overlay visibility preference, Area editor transactions and stable directory-ID mappings. Observed agents prefer free seats in their mapped Areas, then unzoned seats, then any free seat; existing persisted/manual placements remain intact. Missing Area fields stay absent until edited, unavailable mappings are preserved, recent-launch IDs are excluded, and a directory launch never adds an observed roster. Shift-click with Eyedrop selects a painted Area; regular Eyedrop continues sampling carpet/floor.
- Dirty-layout conflict protection: retain full local/incoming snapshots, queue distinct file/import/cross-window updates, inspect/export both sides, confirm canvas replacement, and retain recovery copies after resolution/save. Imports stage until Save; per-webview recovery state has explicit lifecycle limits (see README). Pet edits use the same draft, undo, import/export and save-acknowledgement path.
- Added animated Claudio and Gitcat pets from the pinned Pixel Agents v1.5.0 pet sheets. The editor persists pet placement IDs/types, restores legacy layouts with an empty pet list, and renders timed heart responses and wander/follow animation without generating Squad lifecycle or telemetry events.
- Settings → Add Asset Directory / Unload for validated local furniture manifests, independent failure diagnostics and one-second live reload. New placements persist their dimensions; changed/removed assets cannot silently expand saved furniture. Static group variants are supported; animation and other external pack kinds remain deferred.
- Persisted sound/Debug View preferences, host-reported team file and native/polling observer status, and missing-team setup guidance. Launch remains off/unavailable; EventBus / WebSocket has no connected producer, and file observations do not supply authoritative tool/context events. Issue #7 remains partial.
- Alt-drag furniture copies with fresh IDs and preserved colors; atomic desk + PC/lamp moves and rotations, group previews, and single-step undo/redo.
- Reconnect-safe office snapshot: reopening the panel restores characters, statuses and seats without duplicates.
- Stable per-member appearance and persisted seat reassignment (with swap).
- Layout editor: drag painting, one undo step per gesture, undoable off-grid-safe furniture moves.
- Settings → Debug View.
- Legacy `.ai-team/` support and multi-root workspace selection.
- `LICENSE` and `THIRD_PARTY_NOTICES.md` with Pixel Agents, sprite and font attribution.

### Fixed
- Agent clicks open details and View Charter, not a terminal or Squad session; cards stay correct when switching members and fit narrow panels.
- Name and tool labels avoid overlap without shortening their text; name controls support Enter and Space.
- Notification audio now stays silent until the persisted preference loads; muting cancels already scheduled notes and prevents muted audio-unlock attempts from resuming playback. The host's enabled-by-default setting and existing two-note chime are unchanged.
- Generic tile erase now removes all known intersecting furniture, including overlapping surface items, in the same stroke transaction; unknown geometry is retained, and carpet-only erase still preserves furniture.
- Reserved a separate horizontal zoom strip above the layout editor so zoom and tool buttons remain independently clickable, including Select after Pets. Narrow editor panels fit the available width and retain vertical scrolling; the bottom toolbar scrolls horizontally instead of clipping actions or shifting the panel. Canvas bounds, zoom/pan anchoring and draft/undo state are unchanged (#33).
- Bound per-frame carpet rendering to the visible region, cache masked junctions/palettes until inputs or artwork change, and precompose opaque sheets within a 4.13 MiB per-context cap. Retain direct draws for translucent art, fractional device scales or fractional device offsets (preserving GPU sprite-edge antialiasing) and unchanged saved data, editing and protected drafts (#28).
- Fresh workspaces and deleted layout files no longer show false layout-recovery warnings. Successful external reads clear only watcher errors, preserving unrelated recovery errors and local/incoming draft protection.
- Layouts with missing, empty or partial `tileColors` now draw floors and walls on initial load, import, external reload and incoming-conflict acceptance. Renderer-only defaults preserve existing colors, draft baselines, revisions and saved layout data.
- Refreshed compatible development-tool dependencies: `@humanfs/node` 0.16.8, `brace-expansion` 1.1.21, `shell-quote` 1.12.0, `@azure/identity` 4.14.1, `@azure/msal-node` 7.1.2 and `@azure/msal-common` 16.15.0. Identity 4.14.1 satisfies `@vscode/vsce` 4.1.0's `^4.13.2` range and its `^7.1.0` MSAL Node range is satisfied by 7.1.2, outside GHSA-xcx6-jx8p-x3h5's affected range `>=5.0.0-beta.0 <7.1.0`. Fresh full-root, root `--omit=dev` and webview audits reported zero vulnerabilities; these are advisory classifications, not evidence of application exploitability or exploit freedom (#21).
- Prevent incoming layouts from silently replacing unsaved edits, even outside edit mode. Save now waits for host acknowledgement, checks the observed disk revision under a cooperating-window lock, and backs up the replaced raw file. Invalid watcher input cannot replace a good draft/cache; legacy colors and unknown layout metadata are preserved instead of deleted by migration.
- Bound manifest fingerprint/reload work across all roots, including failed attempts: fingerprints read only validated manifest references; isolated per-root byte/read/enumeration/decode allowances report explicit overflow and recover on edits without starving other roots. External roots now allow 48 furniture leaves / 98,304 attempted pixels each.
- Refresh missing-art warnings on every applied host layout snapshot, including after the office is already ready, without requiring an unrelated UI event or saving the layout.
- Character wander tests now use deterministic target candidates and cover staying idle with a reset timer when the current cell is selected or no candidates exist; movement behavior is unchanged.
- Area name and directory-mapping controls now preserve native text editing/undo without letting Delete, rotation or office undo shortcuts mutate the room behind a focused field.
- Resolved observed-root mappings against both stable workspace URI IDs and saved-directory UUIDs whose canonical paths match; unrelated saved paths and recent launch IDs are excluded. Compiled-provider acceptance exercises those identities through the real seat allocator.
- Zooming out with the zoom buttons or Ctrl/Meta-wheel could leave the whole office offscreen (e.g. a narrow panel zoomed 4→1). Zoom now keeps the panel center (buttons) or cursor (wheel) anchored and re-clamps the view; an office that fits the panel stays fully visible, and pan bounds no longer invert for small maps.
- Canvas characters are no longer covered by duplicate opaque HTML avatars; transparent, keyboard-accessible name labels retain roles, activity/waiting indicators, tool text and card navigation.
- Canvas asset diagnostics now draw only when Debug View is enabled (default off), including after reload. Settings use one host snapshot instead of a separate modal sound handshake.
- No-workspace guidance is no longer hidden behind the office-loading state; a newly available team updates onboarding without resetting the saved office.
- Invalid furniture drops and rotations now reject the whole group without partial moves, collisions, or changes to saved layout/history.
- Sprites with opaque edge pixels no longer crash the animation loop while generating selection outlines.
- Sound setting was ignored; the chime now plays when a member finishes work.
- Invalid layout imports could overwrite the saved office; layouts are now validated and written atomically.
- Roster tables with empty cells or CRLF line endings were misparsed.
