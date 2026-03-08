# Lisa Simpson — History

## Project Context

**Project:** squad-pod — A VS Code extension bringing animated pixel art offices to Brady Gaster's Squad framework
**User:** Brian Swiger
**Stack:** VS Code Extension (TypeScript, esbuild), React 19 webview (Vite, Canvas 2D pixel art), Squad integration
**Inspiration:** pablodelucca/pixel-agents adapted for bradygaster/squad
**Universe:** The Simpsons

## Core Context

- Core developer owning extension host code, Squad integration, and build pipeline
- Extension reads .squad/ directory: team.md, agents/*/history.md, decisions.md, orchestration-log/
- Must bridge extension host (Node.js) and webview (React) via VS Code webview messaging
- esbuild for extension bundling, Vite for webview bundling — two separate build targets

## Foundation & Architecture (2026-03-05 to 2026-03-06)

Established dual-build infrastructure (esbuild + Vite), TypeScript interfaces for webview/extension protocol, agent detail feature (charter + activity lookup), and interface alignment across engine layers. Key decisions:

- **Build Pipeline:** esbuild (extension host) + Vite (webview), separate type checking and bundling
- **Agent Details:** Synchronous charter/log reads in extension, getAgentDetail handler serves rich AgentDetailInfo
- **Interface Alignment:** Character/Seat/FurnitureInstance/OfficeLayout properties normalized across implementation
- **Type Safety:** Property names, data structures (Map vs Array), optional vs required fields aligned between types.ts and runtime code
- **Test Infrastructure:** Vitest setup with globals, module cleanup patterns, fake timers for deterministic tests, real temp dirs for fs integration
- **Messaging Protocol:** Discriminated union on `type` field ensures exhaustive handler coverage

## Learnings

### No-Workspace Handling (2026-03-07)

**Problem:** When no workspace folder is open in VS Code, Squad Pod webview gets stuck showing "Loading office..." forever because the extension host returns early from `onWebviewReady()` without sending any message, leaving the webview waiting indefinitely for `layoutLoaded`.

**Architecture Decisions:**
- Added `noWorkspace` to `OutboundMessage` discriminated union in `src/types.ts`
- Extension host now explicitly sends `{ type: 'noWorkspace' }` when `getWorkspaceRoot()` returns undefined in `onWebviewReady()`
- Webview hook `useExtensionMessages` handles `noWorkspace` by setting both `noWorkspace: true` and `layoutReady: true` (so loading screen exits)
- `App.tsx` shows a helpful message when `noWorkspace` is true instead of hanging on loading screen

**Key File Changes:**
- `src/types.ts` — Added `{ type: 'noWorkspace' }` to `OutboundMessage` union
- `src/SquadPodViewProvider.ts` — `onWebviewReady()` sends `noWorkspace` message before returning when no workspace is open
- `webview-ui/src/hooks/useExtensionMessages.ts` — Added `noWorkspace` state, handles `noWorkspace` message case
- `webview-ui/src/App.tsx` — Added conditional render for `noWorkspace` state with helpful guidance message

**User Experience:**
- Before: Extension opens, shows "Loading office..." indefinitely when no folder open
- After: Extension opens, shows clear message: "Open a folder to get started. Squad Pod needs a workspace to discover your AI team."

**Pattern:** Discriminated union on message `type` field ensures type-safe exhaustive handling across extension-webview boundary. Always send a message when a condition changes, never silently return early.

**Decision:** See `.squad/decisions.md` § 7 for full architectural rationale and pattern for future no-workspace-like conditions.

### Missing Layout Assets — Graceful Degradation (2026-03-07)

**Problem:** When a workspace folder is open but ALL layout sources return null (no `.squad-pod/layout.json`, no workspace state, no bundled `dist/assets/layout.json`), the `layoutLoaded` message is never sent, causing the webview to get stuck on "Loading office..." indefinitely.

**Root Cause:** The `loadAndSendLayout()` method in `SquadPodViewProvider.ts` had a conditional guard `if (layout)` before sending the message. When all three fallbacks failed, the function would return early without communicating to the webview.

**Solution:**
- Added `createMinimalLayout()` helper function that creates an empty but valid `LayoutData` structure
- Modified `loadAndSendLayout()` to ALWAYS send `layoutLoaded` message, even when no layout exists
- Removed conditional guard — message is now sent unconditionally with either a real layout or a minimal fallback

**Minimal Layout Structure:**
```typescript
{
  version: 1,
  rooms: [{ id: 'main-room', x: 0, y: 0, width: 20, height: 15, wallType: 'default', floorType: 0 }],
  furniture: [],
  seats: []
}
```

**Key File Changes:**
- `src/SquadPodViewProvider.ts` — `loadAndSendLayout()` always sends message; added `createMinimalLayout()` as last fallback

**User Experience:**
- Before: Extension hangs on "Loading office..." when no layout assets exist
- After: Extension renders an empty 20×15 office when no layout exists; users can populate via layout editor

**Pattern:** Request-response contract must always be fulfilled. If the webview expects a message, send it even when the result is a fallback/empty state.

**Decision:** See `.squad/decisions/inbox/lisa-simpson-layout-fallback.md` for architectural rationale.

### Tileset Import Pipeline Port (2026-07-24 - 2026-03-08)

**Task:** Ported the tileset import scripts from pablodelucca/pixel-agents into squad-pod with Bart Simpson (HTML tools).

**Session:** Brian Swiger requested porting complete pipeline (7 TS + 4 HTML files). Both Lisa and Bart spawned in parallel.

**Files Created by Lisa:**
- `scripts/0-import-tileset.ts` — 7-stage interactive CLI orchestrator (runs via `npm run import-tileset`)
- `scripts/1-detect-assets.ts` — Flood-fill asset detection from PNG tilesets
- `scripts/3-vision-inspect.ts` — Claude Vision auto-metadata generation (requires `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`)
- `scripts/5-export-assets.ts` — Export assets to `webview-ui/public/assets/furniture/{category}/` + `furniture-catalog.json`
- `scripts/export-characters.ts` — Bakes 6 character palette PNGs to `webview-ui/public/assets/characters/`
- `scripts/generate-walls.js` — Generates 16-config bitmask auto-tile `walls.png`
- `scripts/.tileset-working/.gitkeep` — Working directory for intermediate pipeline files

**Key Adaptations:**
- All branding changed: "Pixel Agents"/"ARCADIA" → "Squad Pod"
- Script invocations changed from `npx ts-node` → `npx tsx` (tsx is our devDependency)
- `export-characters.ts` fully rewritten: pixel-agents used a template+palette cell-mapping system (`CHARACTER_TEMPLATES`/`CHARACTER_PALETTES` with hair/skin/shirt/pants/shoes slots). Squad-pod uses procedural sprite generation with a simpler 3-color palette (shirt/skin/pants). Duplicated palette definitions and sprite creation functions from `defaultCharacters.ts` to keep the script self-contained.
- `3-vision-inspect.ts`: Changed Claude model from `claude-opus-4-6` to `claude-sonnet-4-20250514` (more cost-effective for metadata generation)
- All file paths updated to squad-pod conventions (`webview-ui/public/assets/` output, `scripts/.tileset-working/` intermediates)
- Stage 3 "run specific stage" menu option implemented (was a placeholder in pixel-agents)
- Added `@anthropic-ai/sdk` as devDependency, `import-tileset` npm script

**Pattern:** Scripts are standalone CLI tools run via tsx. They don't import from extension host code. The `export-characters.ts` script duplicates palette data rather than importing from the webview source to avoid cross-build-target import complexity. (See `.squad/decisions.md` § 8: Tileset Import Pipeline — Self-Contained Scripts)

**Test Results:** All 46 tests pass, build clean.

**Outcome:** SUCCESS — Complete tileset import pipeline ported and working.

### Custom Asset URI Pipeline (2026-03-08)

**Task:** Extension-host side of custom asset integration — types, asset URI generation, message protocol for Brian's custom 16×16 tileset and 4-direction character sprite sheets.

**Problem:** The legacy asset pipeline (assetLoader.ts) decodes PNGs server-side into pixel arrays and sends them as JSON. Custom assets (tileset_office.png at 2.1MB, 4 character PNGs at ~5MB each) are too large for this approach. The webview needs to load them directly via `<img>` / `new Image()` in the browser.

**Solution — URI-based asset delivery:**
- Extension host generates webview-safe URIs via `webview.asWebviewUri()` and sends them in new message types
- Webview loads PNGs directly in the browser — no PNG decode overhead in the extension host
- Legacy inline-sprite pipeline preserved as fallback (both messages sent during init)

**Types Added (src/types.ts):**
- `TilesetObjectRegion` — pixel region {x, y, w, h} within tileset PNG
- `TilesetData` — parsed tileset.json structure (name, tile_size, source, objects map)
- `CharacterAssetEntry` — {id, uri} for a single character sprite sheet
- `tilesetAssetsLoaded` message — sends tileset PNG URI + parsed JSON coordinate map
- `characterAssetsLoaded` message — sends array of character sprite sheet URIs

**Constants Added (src/constants.ts):**
- `TILE_SIZE = 16` — canonical tile size constant (extension host side)
- `FLOOR_TILE_SIZE` now derives from `TILE_SIZE` instead of hardcoded 16
- `CUSTOM_CHAR_DIRECTIONS` — ['up', 'right', 'down', 'left'] row order for new 4-direction sprites
- `CUSTOM_CHAR_SPRITE_PREFIX` — 'char_employee' filename prefix filter

**Provider Changes (src/SquadPodViewProvider.ts):**
- Added `loadAndSendCustomAssetUris()` method in the `onWebviewReady` flow (step 4, between legacy assets and layout)
- Reads tileset.json, generates webview URIs for tileset PNG and all char_employee*.png files
- Graceful degradation: silently skips if assets don't exist (won't break existing installs)

**Build Pipeline:** No changes needed — esbuild's `copyAssetsPlugin` already recursively copies `webview-ui/public/assets/` → `dist/assets/`, including the new PNG and JSON files. Verified all 6 custom asset files appear in `dist/assets/` after build.

**TILE_SIZE Enforcement:** Added `TILE_SIZE = 16` to `src/constants.ts`. Webview already has `TILE_SIZE = 16` in both `webview-ui/src/constants.ts` and `webview-ui/src/office/types.ts`. The tileset.json also declares `tile_size: 16` — the webview can validate this at runtime.

**Key File Changes:**
- `src/types.ts` — 3 new interfaces + 2 new OutboundMessage variants
- `src/constants.ts` — TILE_SIZE, CUSTOM_CHAR_DIRECTIONS, CUSTOM_CHAR_SPRITE_PREFIX
- `src/SquadPodViewProvider.ts` — loadAndSendCustomAssetUris() method + import updates

**Backward Compatibility:** Fully preserved. Both legacy (characterSpritesLoaded with pixel arrays) and new (characterAssetsLoaded with URIs) messages are sent. Webview can use whichever it prefers.

**Test Results:** All 46 tests pass, build clean.

### Tileset Metadata Integration (2026-03-08)

**Task:** Integrate `tileset-metadata.json` as the primary metadata source for the office tileset, superseding the simpler `tileset.json`.

**Problem:** The legacy `tileset.json` has 12 objects with simple `{x,y,w,h}` regions and no categorization. The new `tileset-metadata.json` provides 18 items with type categories (floor, wall, furniture, electronics, appliance, decoration), structured bounds, and an interactables array mapping items to player actions.

**Solution — Layered metadata with backward compatibility:**

**Types Added (src/types.ts):**
- `ItemType` — union of 6 type categories
- `ItemBounds` — `{x, y, width, height}` pixel region within tileset PNG
- `TilesetItem` — `{id, type, bounds}` for each tileset item
- `TilesetInteractable` — `{item_id, action}` for interactive items
- `TilesetMetadata` — full metadata structure: tileset_name, tile_size, asset_source, items[], interactables[]
- `tilesetMetadataLoaded` — new OutboundMessage variant sending parsed metadata + tileset PNG URI

**Provider Changes (src/SquadPodViewProvider.ts):**
- `loadAndSendCustomAssetUris()` now tries `tileset-metadata.json` first, sends `tilesetMetadataLoaded` message
- Falls back to legacy `tileset.json` → `tilesetAssetsLoaded` if metadata file missing or malformed
- Extracted `sendLegacyTilesetData()` helper for the fallback path

**Webview Changes (webview-ui/src/office/sprites/assetLoader.ts):**
- Added `TilesetMetadata`, `TilesetItem`, `TilesetInteractable`, `ItemBounds`, `ItemType` types (mirror of extension-host types)
- New module state: `tilesetMetadata`, `tilesetMetadataImage`, `itemById` Map, `itemsByType` Map, `interactables` array
- `setTilesetMetadata(metadata, pngUri)` — ingests metadata, builds lookup indexes, loads PNG, also populates legacy `tilesetData` for backward compat
- Query functions: `getItemById(id)`, `getItemsByType(type)`, `getInteractables()`, `getTilesetMetadata()`, `getTilesetMetadataImage()`

**Message Handler (webview-ui/src/hooks/useExtensionMessages.ts):**
- Added `tilesetMetadataLoaded` case — calls `setTilesetMetadata()` via dynamic import

**Backward Compatibility:** Fully preserved via three layers:
1. Extension sends `tilesetMetadataLoaded` if metadata.json exists, else `tilesetAssetsLoaded` from legacy JSON
2. `setTilesetMetadata()` also populates the legacy `tilesetData` object so renderers using `getTilesetData()` continue working
3. Old `tileset.json` path untouched — still works as a standalone fallback

**Test Results:** All 46 tests pass, build clean.


### Tileset Asset Pipeline — assetsReady Gate Bug (2026-03-08)

**Task:** Diagnose and fix custom tileset assets (tileset.json, tileset-metadata.json, tileset_office.png) not loading — webview always fell back to default inline sprites.

**Root Cause — Two bugs:**

1. **`assetsReady` never set to `true`:** `setTilesetMetadata()` in `assetLoader.ts` loaded the tileset PNG and built metadata indexes, but never flipped the `assetsReady` flag. The renderer gates ALL PNG rendering behind `areAssetsReady()`, so it always fell back to inline sprites.

2. **Object name mismatch between metadata and legacy paths:** The extension sent EITHER `tilesetMetadataLoaded` (metadata item IDs like `desk_work_monitor`) OR `tilesetAssetsLoaded` (tileset.json names like `work_desk_v1`), never both. The renderer's `furnitureToTileset` mapping uses tileset.json names.

**Fix:**
- `src/assetLoading.ts`: All asset ingestion paths now set `assetsReady = true`:
  - `loadAssets()` — URL fetch path (existing)
  - `setTilesetMetadata()` — metadata ingestion path (NEW)
  - `setTilesetAssets()` — legacy format path (NEW)
- `src/SquadPodViewProvider.ts`: Extension now always sends BOTH message types when both JSON files exist
  - `tilesetMetadataLoaded` for metadata-driven features
  - `tilesetAssetsLoaded` for current legacy renderer

**Key Decision:** Always send both tileset formats. Cheap to send (browser caches PNG), separates concerns, preserves backward compatibility. (See `.squad/decisions.md` § 10)

**Key Pattern:** When two data formats exist for the same asset, send both. The `assetsReady` flag must be set by ALL ingestion paths.

**Test Results:** All 124 tests pass, both builds clean.

**Outcome:** ✅ SUCCESS — Sprite asset loading now fully functional via both metadata and legacy paths.

### Character Sheet URI Pipeline — Missing Message Handler (2026-03-08)

**Task:** Fix critical bug where custom PNG character sprite sheets never rendered — characters always fell back to inline colored rectangles.

**Root Cause:** The extension host sent `characterAssetsLoaded` messages (with webview URIs for char_employeeA–D.png files), but the webview's `useExtensionMessages.ts` had NO handler for this message type. The message fell through to the `default: break` case silently. As a result:
- `characterSheets` Map in `assetLoader.ts` was never populated
- `getCharacterSheet()` always returned null
- `drawCharacterFromSheet()` always returned false
- All characters rendered as colored rectangles

**Fix — Two files:**
1. **`assetLoader.ts`** — Added `loadCharacterSheetsFromUris(characters)` function:
   - Accepts `Array<{ id: string; uri: string }>` from the extension message
   - Extracts sheet key from id: `"char_employeeA"` → `"A"` (strips `char_employee` prefix)
   - Loads PNG via `new Image()`, runs `removeBackground()` to strip baked checkered bg
   - Computes frame dimensions using same logic as `loadAssets()` (4 rows, 7 frames/row, scale = frameHeight / TILE_SIZE)
   - Stores in `characterSheets` Map and sets `assetsReady = true`

2. **`useExtensionMessages.ts`** — Added `characterAssetsLoaded` case (after `tilesetAssetsLoaded`):
   - Dynamic imports `loadCharacterSheetsFromUris` from assetLoader
   - Follows identical pattern to other asset message handlers

**Debugging:** Added `console.log` statements to all asset loading paths (tileset metadata, legacy tileset, character sheets) to enable runtime verification in the webview dev console.

**Pattern:** When adding new `OutboundMessage` variants to the discriminated union in `src/types.ts`, always add the corresponding handler in `useExtensionMessages.ts`. The `default: break` case silently swallows unhandled messages — there's no runtime warning for missing handlers.

**Key Files:**
- `webview-ui/src/office/sprites/assetLoader.ts` — `loadCharacterSheetsFromUris()` function
- `webview-ui/src/hooks/useExtensionMessages.ts` — `characterAssetsLoaded` case
- `src/SquadPodViewProvider.ts:311` — Extension sends the message
- `src/types.ts:259` — Message type definition

**Test Results:** All 124 tests pass (46 extension + 78 webview), both builds clean.

### Character Asset Loading Webview Handler (2026-03-08)

**Task:** Fix character asset loading in webview post-F5 refresh — characters render as colored rectangles instead of PNG sprites.

**Problem:** Extension sends `characterAssetsLoaded` message with character sprite sheet URIs, but webview has no handler to ingest them.

**Solution:**
- `webview-ui/src/hooks/useExtensionMessages.ts` — Added `characterAssetsLoaded` case in message handler, calls `loadCharacterSheetsFromUris()`
- `webview-ui/src/office/sprites/assetLoader.ts` — Implemented `loadCharacterSheetsFromUris(uri[])` to load PNG image objects from URIs and populate webview sprite cache

**Key File Changes:**
- `webview-ui/src/hooks/useExtensionMessages.ts` — Handle `characterAssetsLoaded` message
- `webview-ui/src/office/sprites/assetLoader.ts` — New `loadCharacterSheetsFromUris()` function

**Backward Compatibility:** Both legacy character sprite JSON decoding (pixel arrays) and new URI-based PNG loading paths coexist. Webview uses PNG assets when available, falls back to inline sprites.

**Status:** ✅ COMPLETED (2026-03-08T0356)

**Test Results:** All 124 tests pass, both builds clean.

**Commit:** 3906f88 — Character asset loading webview handler — fix missing message case for custom sprite sheets

**Pattern Established:** When adding new `OutboundMessage` variants to the discriminated union in `src/types.ts`, always add corresponding handler in `webview-ui/src/hooks/useExtensionMessages.ts`. Silent fallback in default case makes unhandled messages invisible to debugging.

### EditorToolbar UI Build (2026-03-08)

**Task:** Bart spawned to build EditorToolbar left-side panel UI for layout editor.

**Session:** Bart Simpson completed the EditorToolbar component with tool buttons, HSB color sliders, furniture palette, grid expansion, and undo/redo/save. All 124 tests pass, both builds clean. Commit: 70cd542.

**Outcome:** SUCCESS — Full editor functionality now accessible via UI. The toolbar integrates seamlessly with the EditorState infrastructure, furnishing the visual interface for layout editing workflows. Ghost borders enable interactive grid expansion.

**Team Impact:** Any new EditTool variants added to types.ts should also be added to TOOL_DEFS in EditorToolbar.tsx for consistent UI mapping.

### Tileset-Based Tile Grid Rendering (2026-03-08)

**Task:** Fix custom tileset not rendering for floor/wall tiles — webview always showed colored rectangles instead of tileset PNG artwork.

**Root Cause:** `renderTileGrid()` in `renderer.ts` never checked for tileset assets. It always rendered walls as solid-color rectangles (`wallColorToHex`) and floors as colorized inline sprites (`getColorizedFloorSprite`). The tileset PNG was only used for furniture via `drawTilesetFurniture()` in `renderScene()`. The full asset delivery pipeline (extension → webview → assetLoader) worked correctly — the missing link was the renderer itself.

**Fix — Two files:**
1. **`webview-ui/src/office/sprites/tilesetRenderer.ts`** — Added `drawTilesetTile()` function:
   - Maps `TileType` enum values to tileset-metadata.json item IDs (`FLOOR_1` → `floor_wood`, `FLOOR_2` → `floor_blue_diamond`, `WALL` → `wall_white_panel`)
   - Draws tiles from tileset PNG via `ctx.drawImage()` with source-rectangle clipping
   - For wall items taller than TILE_SIZE (wall_white_panel is 16×32), clips to top 16px
   - Returns false if metadata/image not available, enabling graceful fallback

2. **`webview-ui/src/office/engine/renderer.ts`** — Updated `renderTileGrid()`:
   - Checks `areAssetsReady()` and tries `drawTilesetTile()` before existing colored rendering
   - Falls back to `wallColorToHex`/`getColorizedFloorSprite` when tileset not loaded
   - Preserves full backward compatibility

**Key Pattern:** The renderer must actively USE loaded assets — loading and storing them isn't enough. When adding new asset types, trace the full pipeline: extension reads → message sent → webview stores → **renderer draws**.

**Test Results:** All 124 tests pass (46 extension + 78 webview), both builds clean.