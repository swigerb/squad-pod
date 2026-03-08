# Rendering Fix — Separate Readiness Gates for Tileset vs Character Assets

## Context

Squad Pod's PNG rendering pipeline now uses extension-host base64 data URIs sent over `postMessage`, then browser-side `Image` loads in the webview. Even with that transport fixed, the runtime could still fall back to colored rectangles/circles because the renderer relied on one shared `assetsReady` flag for three different async asset families:

1. metadata tileset PNG + item index
2. legacy tileset PNG + object map
3. character sprite sheets keyed by palette

That shared flag allowed partial success to masquerade as full readiness.

## Decision

Use **resource-specific readiness checks** instead of a single global gate:

- `areTilesetAssetsReady()` for floor/wall/furniture PNG rendering
- `areCharacterAssetsReady()` plus direct palette-sheet existence checks for character rendering
- `getAssetLoadSnapshot()` for diagnostics

Keep `areAssetsReady()` only as an aggregate "anything PNG-based is available" helper, not as the renderer's primary decision point.

## Why

- Tile rendering depends on **tileset metadata image/object data**, not on character sheets.
- Character rendering depends on **the requested sheet for that palette**, not on the tileset.
- A single async success must not flip the entire renderer into a PNG path that still lacks the data it needs.
- Brian needs DevTools visibility into which exact stage loaded, failed, or is still pending.

## Consequences

- Renderer fallback decisions now match the actual resource each path consumes.
- DevTools logs clearly show when messages are sent, received, dispatched, loaded, failed, and why fallback was chosen.
- Future asset work should avoid reintroducing a shared readiness boolean across unrelated pipelines.
