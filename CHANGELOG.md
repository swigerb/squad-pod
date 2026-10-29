# Changelog

All notable changes to Squad Pod are documented here.

## [Unreleased]

### Changed
- Toolchain modernized: Node 22.13+, VS Code 1.107+, React 19, Vite 8, Vitest 4, ESLint 10, esbuild 0.28; CI on Ubuntu and Windows.
- Activity detection rewritten for current Squad: orchestration log, decision inbox and per-agent folders identify the working member; startup no longer replays old files.
- Diagnostics moved to the **Squad Pod** output channel (no more workspace debug logs or popups).

### Added
- Persisted sound/Debug View preferences, host-reported team file and native/polling observer status, and missing-team setup guidance. Launch remains off/unavailable; EventBus / WebSocket has no connected producer, and file observations do not supply authoritative tool/context events. Issue #7 remains partial.
- Alt-drag furniture copies with fresh IDs and preserved colors; atomic desk + PC/lamp moves and rotations, group previews, and single-step undo/redo.
- Reconnect-safe office snapshot: reopening the panel restores characters, statuses and seats without duplicates.
- Stable per-member appearance and persisted seat reassignment (with swap).
- Layout editor: drag painting, one undo step per gesture, undoable off-grid-safe furniture moves.
- Settings → Debug View.
- Legacy `.ai-team/` support and multi-root workspace selection.
- `LICENSE` and `THIRD_PARTY_NOTICES.md` with Pixel Agents, sprite and font attribution.

### Fixed
- Canvas asset diagnostics now draw only when Debug View is enabled (default off), including after reload. Settings use one host snapshot instead of a separate modal sound handshake.
- No-workspace guidance is no longer hidden behind the office-loading state; a newly available team updates onboarding without resetting the saved office.
- Invalid furniture drops and rotations now reject the whole group without partial moves, collisions, or changes to saved layout/history.
- Sprites with opaque edge pixels no longer crash the animation loop while generating selection outlines.
- Sound setting was ignored; the chime now plays when a member finishes work.
- Invalid layout imports could overwrite the saved office; layouts are now validated and written atomically.
- Roster tables with empty cells or CRLF line endings were misparsed.
