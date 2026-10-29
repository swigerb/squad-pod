# Changelog

All notable changes to Squad Pod are documented here.

## [Unreleased]

### Changed
- Toolchain modernized: Node 22.13+, VS Code 1.107+, React 19, Vite 8, Vitest 4, ESLint 10, esbuild 0.28; CI on Ubuntu and Windows.
- Activity detection rewritten for current Squad: orchestration log, decision inbox and per-agent folders identify the working member; startup no longer replays old files.
- Diagnostics moved to the **Squad Pod** output channel (no more workspace debug logs or popups).

### Added
- Alt-drag furniture copies with fresh IDs and preserved colors; atomic desk + PC/lamp moves and rotations, group previews, and single-step undo/redo.
- Reconnect-safe office snapshot: reopening the panel restores characters, statuses and seats without duplicates.
- Stable per-member appearance and persisted seat reassignment (with swap).
- Layout editor: drag painting, one undo step per gesture, undoable off-grid-safe furniture moves.
- Settings → Debug View.
- Legacy `.ai-team/` support and multi-root workspace selection.
- `LICENSE` and `THIRD_PARTY_NOTICES.md` with Pixel Agents, sprite and font attribution.

### Fixed
- Invalid furniture drops and rotations now reject the whole group without partial moves, collisions, or changes to saved layout/history.
- Sound setting was ignored; the chime now plays when a member finishes work.
- Invalid layout imports could overwrite the saved office; layouts are now validated and written atomically.
- Roster tables with empty cells or CRLF line endings were misparsed.
