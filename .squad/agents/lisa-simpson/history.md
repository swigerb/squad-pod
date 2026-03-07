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

## Learnings

### Project Scaffold (2026-03-05)

**Architecture Decisions:**
- Dual build pipeline: esbuild for extension host (Node.js/CJS), Vite for webview (React/ESM)
- Extension host bundled to `dist/extension.js`, webview bundled to `dist/webview/assets/`
- esbuild plugin pattern for post-build asset copying (webview-ui/public/assets → dist/assets)
- Solution-style TypeScript config in webview-ui for app vs build tool separation
- Empty activationEvents array for instant activation (VS Code 1.107+ auto-activates on any contribution)

**Key File Paths:**
- Extension entry: `src/extension.ts` → `dist/extension.js`
- Webview entry: `webview-ui/src/main.tsx` → `dist/webview/assets/main.js`
- Webview API wrapper: `webview-ui/src/vscodeApi.ts` (handles acquireVsCodeApi lifecycle)
- Build script: `esbuild.js` (watches, bundles, copies assets)

**User Preferences:**
- Prefers modern flat ESLint config (eslint.config.mjs)
- Wants type checking separate from bundling (npm run check-types)
- Expects npm-run-all for parallel watch tasks (watch:esbuild + watch:tsc)
- Panel webview preferred over sidebar (contributes.viewsContainers.panel)

### Agent Detail Feature (2026-03-05)

**Architecture Decisions:**
- AgentDetailInfo interface added to types.ts for rich agent inspection
- Extension-side message handler `requestAgentDetail` reads charter.md and .squad/log/ to enrich agent state
- Charter summary extraction: skip title heading, take first paragraph, limit to 2-3 sentences
- Recent activity scan: read last 5 log files, find mentions of agent name/slug, extract first non-heading line
- Synchronous fs.readFileSync is acceptable for single-file charter reads (no async churn for small data)

**Key File Paths:**
- `src/types.ts` — AgentDetailInfo interface, agentDetailLoaded message type
- `src/SquadPodViewProvider.ts` — onRequestAgentDetail handler, getAgentDetail helper function
- `.squad/agents/{agentId}/charter.md` — source for charterSummary
- `.squad/log/*.md` — source for recentActivity

**Cross-Agent Context:**
- Bart Simpson implemented webview-side AgentCard component + click detection consuming this extension handler
- Feature pairs extension-side detail fetching with frontend card rendering
- Type protocol AgentDetailInfo is maintained separately in webview (decoupled, synced by convention)

### Interface Alignment (2026-03-05)

**Core Problem:**
- TypeScript interfaces in types.ts were misaligned with actual implementation in characters.ts, renderer.ts, and engine layer
- Property names were inconsistent (e.g., `dir` vs `direction`, `tileCol` vs `col`, `isActive` vs `active`)
- Type declarations didn't match actual data structures (e.g., `seats: Map<string, Seat>` vs `seats: Seat[]`, `walkableTiles: Array<{col,row}>` vs `walkableTiles: Set<string>`)

**Interface Changes:**

Character interface (types.ts):
- `dir` → `direction` (matches Direction enum)
- `tileCol` → `col`, `tileRow` → `row` (simplified naming, but kept x/y for pixel coordinates)
- `frame` → `frameIndex` (clearer naming for animation frame counter)
- `currentTool: string | null` → `tool: string | undefined` (null→undefined for optional pattern)
- `isActive` → `active` (more concise)
- `bubbleType` + `bubbleTimer` → `bubbleState: { type: string; fadeTimer?: number }` (consolidated state object)

Seat interface (types.ts):
- `uid` → `id` (consistent with Character.id naming)
- `seatCol` → `col`, `seatRow` → `row` (simplified naming)
- `facingDir` → `direction` (consistent with Character.direction)
- `assigned: boolean` → `occupant?: string | null` (tracks which agent ID is sitting, not just boolean)

FurnitureInstance interface (types.ts):
- Complete rewrite: added `uid`, `type`, `col`, `row`, `width`, `height`, `rotation`, `state?`
- Removed old `x`, `y`, `zY` properties (those were render-time calculations, not instance state)

FurnitureCatalogEntry interface (types.ts):
- `footprintW`/`footprintH` → `width`/`height` (clearer naming)
- Added `name?`, `dynamicState?` for runtime catalog entries
- Added `label` and `isDesk` as required properties (were missing)

OfficeLayout interface (types.ts):
- `version: 1` → `version?: number` (optional, allows createDefaultLayout to omit it)
- `tiles: TileType[]` → `tiles: number[]` (TileType is just a number, be explicit about runtime type)
- `tileColors?: Array<FloorColor | null>` → `tileColors?: Record<string, FloorColor>` (changed from sparse array to map with "col,row" keys)

PlacedFurniture interface (types.ts):
- Added `rotation: number` and `state?: string` (were missing but used in layoutManager and renderer)

**EditorState Changes (editorState.ts):**
- `activeTool` → `tool`, `selectedTileType` → `tileType`, `selectedFurnitureType` → `furnitureType` (simplified naming)
- Added setter methods: `setTool()`, `setTileType()`, `setFurnitureType()`, `setFloorColor()`, `setWallColor()`, `setSelectedFurnitureUid()`
- Removed unused import `UNDO_STACK_MAX_SIZE` from constants.js

**OfficeState Changes (officeState.ts):**
- Fixed import: `import type { CharacterState }` → `import { CharacterState }` (needed for value references like `CharacterState.TYPE`)
- Added import: `getCatalogEntry` from furnitureCatalog.js (needed for dynamic state checking)
- `seats: Map<string, Seat>` → `seats: Seat[]` (data structure changed from Map to Array)
- `walkableTiles: Array<{col,row}>` → `walkableTiles: Set<string>` (optimized for fast lookups with "col,row" string keys)
- `tileMap: TileType[][]` → `tileMap: number[][]` (runtime type is number, not branded TileType)
- Fixed all function calls to pass `layout.furniture` instead of `layout` to layoutToSeats/getBlockedTiles/layoutToFurnitureInstances
- Fixed all seat iteration: `for (const [sid, seat] of this.seats)` → `for (const seat of this.seats)` + use `seat.id`
- Fixed all seat lookups: `this.seats.get(id)` → `this.seats.find(s => s.id === id)`
- Fixed all character property accesses: `char.tileCol` → `char.col`, `char.isActive` → `char.active`, `char.currentTool` → `char.tool`, etc.
- Fixed walkableTiles random pick: convert Set to Array, parse "col,row" key
- Fixed createCharacter call signature: `createCharacter(id, name, role, palette, seatId, seatObj, hueShift)` with seatObj parameter
- Fixed bubble state updates: `char.bubbleType = 'permission'; char.bubbleTimer = 0;` → `char.bubbleState = { type: 'permission' };`
- Fixed state enum values: `char.state = 'typing'` → `char.state = CharacterState.TYPE`, `'idle'` → `CharacterState.IDLE`, `'walking'` → `CharacterState.WALK`
- Fixed rebuildFurnitureInstances: `furn.type.dynamicState` → `getCatalogEntry(furn.type)?.dynamicState` (furn.type is now string, not object)
- Removed unused parameters: `skipSpawnEffect` from addAgent, `col`/`row` local vars that were overwritten

**EditorActions Changes (editorActions.ts):**
- Fixed applyTilePaint: initialize `tileColors` map if undefined before writing
- Fixed applyErase: check if `tileColors` exists before deleting key
- Fixed applyEyedropper: use optional chaining for `layout.tileColors?.[key]`
- Fixed cloneLayout: preserve `version` field, handle undefined tileColors
- Added type assertion in applyEyedropper: `as TileType` to satisfy return type (layout.tiles is number[], TileType is branded type)

**FurnitureCatalog Changes (furnitureCatalog.ts):**
- Added `label` and `isDesk` properties to all FURNITURE_CATALOG entries (were missing, caused TS errors)
- Changed buildDynamicCatalog signature: removed unused `assets` parameter

**LayoutManager Changes (layoutManager.ts):**
- Removed unused import: `FURNITURE_CATALOG` (only getCatalogEntry is used)

**Key Lessons:**
- Interface property names must match implementation exactly — mismatches cause cascading errors
- Data structure choice (Map vs Array vs Set) affects all access patterns — document in interface comments when non-obvious
- Branded types (like TileType = number) need explicit type assertions at boundaries
- State consolidation (e.g., bubbleType+bubbleTimer → bubbleState object) reduces inconsistency risk
- Optional vs required properties: make version/tileColors optional if callers don't always provide them
- Import type vs value import: use value import when you need to reference enum values at runtime

### Unit Test Suite (2026-07-24)

**Architecture Decisions:**
- Vitest with `globals: true` and `environment: 'node'` — no test-framework imports needed
- Module-level state (timerManager's `Map`, agentManager's `agents` Map) requires explicit cleanup in `afterEach`
- `vi.mock()` for module-level mocking must appear before the import of the module under test (hoisted by Vitest)
- `vi.useFakeTimers()` / `vi.useRealTimers()` paired with `cancelAllTimers()` for deterministic timer tests
- Real temp directories (`fs.mkdtempSync`) for layoutPersistence tests — avoids mocking fs for integration-level confidence
- Import paths use `.js` extensions (TypeScript moduleResolution node16/bundler)

**Key File Paths:**
- `src/teamParser.test.ts` — 9 tests: table parsing, slug derivation, hidden agent filtering
- `src/timerManager.test.ts` — 6 tests: timer lifecycle, reset vs start semantics, cancelAll
- `src/agentManager.test.ts` — 7 tests: init, refresh, status update, seat persistence, dispose
- `src/squadWatcher.test.ts` — 10 tests: session JSON parsing, log entry extraction
- `src/layoutPersistence.test.ts` — 5 tests: read/write round-trip, migration, delete

**Patterns:**
- `parseTeamRoster` regex for `**Agent:**` requires either `(` after name or end-of-string — test inputs must include `(role)` suffix
- agentManager mocks both `./teamParser.js` and `./timerManager.js` to isolate unit behavior
- `disposeAgentManager()` resets module-level state between tests

### TypeScript Build Fix — Test File Exclusion (2026-07-24)

**Problem:** `npm run build` failed with 211 TypeScript errors because `tsc --noEmit` was type-checking `*.test.ts` files that use vitest globals (`vi`, `describe`, `it`, `expect`) without type references.

**Root Cause:** `tsconfig.json` included all of `src/` (including test files), but vitest's `globals: true` only injects types at runtime — TypeScript's compiler had no way to resolve them.

**Fix Applied:**
- Excluded `src/**/*.test.ts` from `tsconfig.json` so `tsc --noEmit` skips test files entirely
- Added `/// <reference types="vitest/globals" />` triple-slash directive to each test file for IDE DX (so VS Code still resolves vitest types when editing tests)
- Vitest handles its own TypeScript compilation via esbuild, so `npm test` is unaffected

**Why This Approach:**
- Option 1 (add `"types": ["vitest/globals"]` to tsconfig) would leak test-framework types into production code
- Option 3 (shared `.d.ts` file) is equivalent to option 1 since the `.d.ts` would be included in tsconfig scope
- Option 2 (exclude + triple-slash) keeps a clean type boundary: production code sees only production types, test files explicitly declare their vitest dependency

**Files Changed:** `tsconfig.json`, all 5 `src/*.test.ts` files

