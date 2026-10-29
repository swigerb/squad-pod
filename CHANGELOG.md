# Changelog

All notable changes to Squad Pod are documented here.

## [Unreleased]

### Changed
- Replaced the unresolved office tileset and inline furniture art with the source-pinned original Pixel Agents furniture/floor/wall bundle (MIT, Pablo De Lucca). The historical screenshot is excluded from the VSIX. Legacy layout IDs/geometry remain intact as explicit missing-art markers; no automatic reset or remap occurs.
- Toolchain modernized: Node 22.13+, VS Code 1.107+, React 19, Vite 8, Vitest 4, ESLint 10, esbuild 0.28; CI on Ubuntu and Windows.
- Activity detection rewritten for current Squad: orchestration log, decision inbox and per-agent folders identify the working member; startup no longer replays old files.
- Diagnostics moved to the **Squad Pod** output channel (no more workspace debug logs or popups).

### Added
- Three source-pinned auto-tiling carpet styles with main/accent colors, style/color eyedropper, single-transaction paint/right-erase undo/redo, and resize/save/import/export preservation. Carpets are an optional visual layer: floor/wall IDs, walkability, furniture and Squad displays are unchanged. Separate PR316 asset provenance, exact blob checks and MIT contributor notices retained. This completes only the carpet slice of #7, not Areas/pets/launch or full #4 parity.
- Dirty-layout conflict protection: retain full local/incoming snapshots, queue distinct file/import/cross-window updates, inspect/export both sides, confirm canvas replacement, and retain recovery copies after resolution/save. Imports stage until Save; per-webview recovery state has explicit lifecycle limits (see README). Pets remain deferred.
- Settings → Add Asset Directory / Unload for validated local furniture manifests, independent failure diagnostics and one-second live reload. New placements persist their dimensions; changed/removed assets cannot silently expand saved furniture. Static group variants are supported; animation, other external pack kinds and pets remain deferred under partial issue #7.
- Persisted sound/Debug View preferences, host-reported team file and native/polling observer status, and missing-team setup guidance. Launch remains off/unavailable; EventBus / WebSocket has no connected producer, and file observations do not supply authoritative tool/context events. Issue #7 remains partial.
- Alt-drag furniture copies with fresh IDs and preserved colors; atomic desk + PC/lamp moves and rotations, group previews, and single-step undo/redo.
- Reconnect-safe office snapshot: reopening the panel restores characters, statuses and seats without duplicates.
- Stable per-member appearance and persisted seat reassignment (with swap).
- Layout editor: drag painting, one undo step per gesture, undoable off-grid-safe furniture moves.
- Settings → Debug View.
- Legacy `.ai-team/` support and multi-root workspace selection.
- `LICENSE` and `THIRD_PARTY_NOTICES.md` with Pixel Agents, sprite and font attribution.

### Fixed
- Fresh workspaces and deleted layout files no longer show false layout-recovery warnings. Successful external reads clear only watcher errors, preserving unrelated recovery errors and local/incoming draft protection.
- Layouts with missing, empty or partial `tileColors` now draw floors and walls on initial load, import, external reload and incoming-conflict acceptance. Renderer-only defaults preserve existing colors, draft baselines, revisions and saved layout data.
- Refreshed compatible development-tool transitive dependencies: `@humanfs/node` 0.16.8, `brace-expansion` 1.1.21 and `shell-quote` 1.12.0. The 2026-10-29 root audit decreased from five affected package entries to two high Azure Identity/MSAL entries; those remain unresolved pending a compatible stable parent release (#21). The separate webview audit reported zero findings; neither result establishes application exploitability or exploit freedom.
- Prevent incoming layouts from silently replacing unsaved edits, even outside edit mode. Save now waits for host acknowledgement, checks the observed disk revision under a cooperating-window lock, and backs up the replaced raw file. Invalid watcher input cannot replace a good draft/cache; legacy colors and unknown layout metadata are preserved instead of deleted by migration.
- Bound manifest fingerprint/reload work across all roots, including failed attempts: fingerprints read only validated manifest references; isolated per-root byte/read/enumeration/decode allowances report explicit overflow and recover on edits without starving other roots. External roots now allow 48 furniture leaves / 98,304 attempted pixels each.
- Refresh missing-art warnings on every applied host layout snapshot, including after the office is already ready, without requiring an unrelated UI event or saving the layout.
- Character wander tests now use deterministic target candidates and cover staying idle with a reset timer when the current cell is selected or no candidates exist; movement behavior is unchanged.
- Zooming out with the zoom buttons or Ctrl/Meta-wheel could leave the whole office offscreen (e.g. a narrow panel zoomed 4→1). Zoom now keeps the panel center (buttons) or cursor (wheel) anchored and re-clamps the view; an office that fits the panel stays fully visible, and pan bounds no longer invert for small maps.
- Canvas characters are no longer covered by duplicate opaque HTML avatars; transparent, keyboard-accessible name labels retain roles, activity/waiting indicators, tool text and card navigation.
- Canvas asset diagnostics now draw only when Debug View is enabled (default off), including after reload. Settings use one host snapshot instead of a separate modal sound handshake.
- No-workspace guidance is no longer hidden behind the office-loading state; a newly available team updates onboarding without resetting the saved office.
- Invalid furniture drops and rotations now reject the whole group without partial moves, collisions, or changes to saved layout/history.
- Sprites with opaque edge pixels no longer crash the animation loop while generating selection outlines.
- Sound setting was ignored; the chime now plays when a member finishes work.
- Invalid layout imports could overwrite the saved office; layouts are now validated and written atomically.
- Roster tables with empty cells or CRLF line endings were misparsed.
