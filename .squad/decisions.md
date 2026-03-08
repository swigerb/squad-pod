# Squad Decisions

## Active Decisions

### 1. Squad Pod: Project Structure & Build Pipeline

**Decision Date:** 2026-03-05  
**Author:** Lisa Simpson  
**Status:** Implemented  

#### Context

Squad Pod is a VS Code extension that embeds a React webview with Canvas-based pixel art animations. This requires two completely separate build targets:
1. Extension Host (Node.js environment, VS Code Extension API)
2. Webview (Browser environment, React)

#### Decision

Implement a dual build pipeline with clear separation of concerns:

**Extension Host Build (esbuild):**
- Bundler: esbuild (fast, Node-native, CJS output)
- Entry: src/extension.ts → dist/extension.js
- Config: esbuild.js with watch mode, problem matcher integration
- Why esbuild: Instant rebuilds, native Node.js support

**Webview Build (Vite):**
- Bundler: Vite (modern, React-optimized, ESM output)
- Entry: webview-ui/src/main.tsx → dist/webview/assets/
- Config: webview-ui/vite.config.ts with fixed asset names
- Why Vite: Best-in-class React DX, HMR, modern ESM output

**Asset Handling:**
- Static assets (spritesheets, layouts) live in webview-ui/public/assets/
- esbuild plugin copies them to dist/assets/ post-build
- Extension serves assets from dist/ via webview.asWebviewUri()

**Development Workflow:**
```bash
npm run watch          # Parallel: watch:esbuild + watch:tsc
npm run check-types    # Type check without bundling
npm run build          # Production build (minified, no sourcesContent)
npm run build:webview  # Vite build (called separately when needed)
```

#### Consequences

**Positive:**
- Clear separation: Node.js code vs browser code never mix
- Fast rebuilds: esbuild for extension (~50ms), Vite HMR for webview
- Type safety: Separate tsconfigs catch environment-specific errors early
- Standard tooling: esbuild/Vite are industry standard for their respective domains

**Negative:**
- Two build systems to maintain (but each is trivial)
- Webview must be built separately (acceptable tradeoff)
- Assets must be copied by plugin (no magic resolution)

#### Team Impact

- **Bart (Canvas Dev):** Works entirely in webview-ui/src/, uses npm run dev for Vite HMR
- **Lisa (Project Lead):** Scaffold and build infrastructure complete
- **Marge (Tests):** Extension tests use dist/extension.js, webview tests use Vite test mode

### 2. Squad Pod: README Structure & Tone

**Decision Date:** 2026-03-05  
**Author:** Ned Flanders (DevRel)  
**Status:** Implemented  

#### Context

Squad Pod README.md is the primary onboarding document for new developers discovering the project. Tone and structure directly impact whether first-time users feel welcome and confident running the extension.

#### Decision

Created README.md with a warm, approachable tone emphasizing zero-friction onboarding:

**Tone:** "Welcome, neighbor!" opening establishes friendly, inviting atmosphere. README as hospitality—first-time readers should feel they belong.

**Structure:** Discovery funnel designed for ~5-minute onboarding:
- Hook + description (30 seconds to assess relevance)
- Features (scannable, benefits-driven bullet list)
- Requirements (hard filters)
- Getting Started (copy-pasteable commands, tested flow: clone → npm install → webview setup → build → F5)
- How It Works (mental model for extension behavior)
- Tech Stack (for contributors considering involvement)
- Credits + License (attribute Pixel Agents origin, clarify licensing)

**Code Examples:** All install command chains work as-is—no manual editing required.

**Screenshots:** Added "Screenshot coming soon!" placeholder to manage expectations without blocking documentation.

**Length:** ~200 lines—well under 500-line limit. Link-based references avoid redundancy.

#### Consequences

**Positive:**
- First-time developers can run extension in ~5 minutes
- Clear mental model for what extension does
- Proper attribution to Pixel Agents origin
- Marketplace-ready foundation
- Scanning-friendly structure

**Negative:**
- Screenshots deferred (placeholder visible)
- Relies on external links for detailed Squad/Pixel Agents context

#### Team Impact

- **Ned (DevRel):** Created and validated README structure
- **Brian (User):** Has authoritative onboarding documentation
- **Marketplace:** Can mirror this README structure for extension listing

#### Next Steps

- Marketplace listing should emphasize "beautiful pixel art office" in opening
- Contributing guide links here, then focuses on local dev setup
- Screenshots/GIFs should showcase office editor and live activity tracking

### 3. Agent Detail Feature — Extension Implementation

**Decision Date:** 2026-03-05  
**Author:** Lisa Simpson  
**Status:** Implemented  

#### Context

Bart needs richer agent information in the webview for the "Desk-as-directory" feature. When a user hovers or clicks on an agent's desk, the UI should display:
- Charter summary (first few sentences from charter.md)
- Recent activity (log entries mentioning this agent)

#### Decision

Implemented extension-side support for agent detail inspection:

1. **New AgentDetailInfo interface** (types.ts):
   - Extends basic agent state with charterSummary and recentActivity
   - Typed as nullable (charter.md may not exist, logs may be empty)

2. **Message handler** (SquadPodViewProvider.ts):
   - `requestAgentDetail` case in handleWebviewMessage
   - Calls getAgentDetail helper, posts agentDetailLoaded response

3. **getAgentDetail implementation**:
   - Reads charter.md synchronously (single file, low overhead)
   - Extracts first paragraph after title heading, limits to 2-3 sentences
   - Scans last 5 log files for agent name/slug mentions
   - Returns null if agent not found

#### Rationale

- **Synchronous reads:** Charter files are small (~few KB), log scans are bounded to 5 files — no need for async complexity
- **Graceful degradation:** null handling for missing charter/logs ensures feature works even with sparse .squad/ content
- **Simple text extraction:** Regex-free line parsing for charter summary — robust to varying markdown styles
- **Log mention detection:** Case-insensitive search for agent name OR slug ensures we catch both formal and casual references

#### Consequences

**Positive:**
- Enables rich agent detail display in webview without frontend guessing
- Performance impact zero — reads are on-demand and scope-limited
- Type-safe protocol enforces consistent structure

**Negative:**
- Log scanning is linear scan (acceptable for 5-file bound)
- Charter files may not exist for all agents (handled gracefully)

#### Team Impact

- Bart can now implement hover/click interactions that fetch and display rich agent details
- Type-safe protocol: AgentDetailInfo enforces consistent structure across extension/webview boundary

### 4. Desk-as-Directory Feature — Webview Implementation

**Decision Date:** 2026-03-05  
**Author:** Bart Simpson  
**Status:** Implemented  

#### Context

Users need an intuitive way to inspect agent details from the pixel art office. Clicking on an agent's desk (not just their character sprite) should open a detail card with agent metadata, charter summary, and recent activity.

#### Decision

Implemented the webview side of the "Desk-as-directory" feature using a click detection system that extends beyond character sprites to include desk/seat areas, triggering a detail card overlay with agent information.

#### Key Design Choices

**1. Click Detection Strategy**
- **Priority:** Direct character sprite clicks take precedence over desk area clicks
- **Radius Search:** If no character sprite clicked, search the exact tile and 8 adjacent tiles for seats
- **Occupancy Check:** Only trigger card if seat has an `occupant` (non-null agent ID)
- **Rationale:** Provides forgiving click target for users while maintaining sprite click accuracy

**2. AgentCard Positioning**
- **Fixed positioning:** Uses screen coordinates from click event (clientX, clientY)
- **Viewport clamping:** Automatically adjusts position to prevent off-screen rendering
- **Z-index:** 100 (renders above all other overlays)
- **Rationale:** Ensures card is always visible and accessible regardless of where user clicks

**3. Card Dismissal UX**
- **Click outside:** Document-level click listener detects clicks outside card bounds
- **Escape key:** Keydown listener for keyboard-first users
- **Close button:** Explicit × button in top-right corner
- **Rationale:** Multiple dismissal methods accommodate different user preferences

**4. Type Definitions**
- **Local types:** AgentDetailInfo defined in AgentCard.tsx (not imported from extension types)
- **Rationale:** Webview and extension maintain separate type definitions for decoupling; types are synced by convention via task description

**5. Messaging Protocol**
- **Request-response pattern:** Webview sends `requestAgentDetail` → Extension responds with `agentDetailLoaded`
- **Stateful card:** Card position and detail stored separately in App.tsx state
- **Rationale:** Separates click coordinates (UI concern) from agent data (extension concern)

#### Consequences

**Positive:**
- Forgiving click target (desk area, not just character)
- Multiple dismissal methods improve UX
- Card always visible (viewport clamping)
- Type-safe request/response messaging
- No breaking changes to existing features

**Negative:**
- Two separate AgentDetailInfo definitions (minimal sync burden)
- Radius search adds ~50ms per click (acceptable for 9-tile scan)

#### Integration Points

- **OfficeCanvas.tsx:** Click detection integrated into existing handleMouseDown callback
- **useExtensionMessages.ts:** New message type added to existing switch statement
- **App.tsx:** Card rendered after all other components (maintains z-index layering)
- **AgentCard.tsx (NEW):** Self-contained card component with positioning and dismissal logic

#### Future Considerations

- Could extend to show additional agent metadata (commit history, PR count, etc.)
- Card could be made draggable if users want to reposition it
- Animation on card appearance/dismissal for polish
- Could cache recent detail loads to reduce extension → webview round-trips

### 5. Telemetry Drawer Feature — Architecture & Review

**Decision Date:** 2026-03-05  
**Author:** Homer Simpson  
**Status:** Approved  

#### Context

We needed a way to see what the heck the agents are doing without staring at raw log files. The team implemented a "Telemetry Drawer" — a slide-up panel in the webview that streams live events.

#### Decision

**Approve the current implementation.**

The design follows our "keep it simple, stupid" philosophy:
1.  **Protocol:** Uses the existing `postMessage` pipeline. No new sockets or weird connections.
2.  **Data Flow:** Extension host (source of truth) -> Webview (renderer). One-way flow for telemetry.
3.  **Buffering:** Webview keeps a rolling buffer of 200 events. Prevents memory leaks if you leave it running overnight.
4.  **Types:** Yes, `TelemetryEvent` is duplicated in `src/types.ts` and `webview-ui/src/office/types.ts`. This is fine. Sharing code between Node and Browser builds is a headache we don't need right now.

#### Feedback

-   **Performance:** The 200-item limit is smart. React handles that easily.
-   **UX:** The "Unread" badge logic in `App.tsx` (`total - seen`) is a nice touch.
-   **Code:** Inline styles in `TelemetryDrawer` are ugly but functional. I'll let it slide because it keeps the component self-contained.

#### Consequences

-   **Positive:** We can now debug agent behavior visually.
-   **Negative:** If we change the `TelemetryEvent` shape, we have to update it in two places. (Don't change it often.)

#### Sign-off

🍩 **Homer Simpson**  
*Lead / Architect*

### 6. Unit Test Suite for Extension Host Code

**Decision Date:** 2026-07-24  
**Author:** Lisa Simpson  
**Status:** Implemented  

#### Context

The extension host code had no unit tests. Five core modules — teamParser, timerManager, agentManager, squadWatcher, and layoutPersistence — needed coverage to catch regressions as the codebase evolves.

#### Decision

- **37 test cases** across 5 test files using Vitest with `globals: true` and `environment: 'node'`
- Module-level state is cleaned between tests via `cancelAllTimers()` and `disposeAgentManager()`
- agentManager tests mock `teamParser.js` and `timerManager.js` to isolate unit behavior
- layoutPersistence tests use real temp directories for integration-level confidence
- Timer tests use `vi.useFakeTimers()` for deterministic time control

#### Consequences

**Positive:**
- All team members can now run `npx vitest run` to verify extension host behavior
- New features touching these modules should add corresponding test cases
- Strong regression detection for core functionality

#### Team Impact

- **Lisa (Core Dev):** Established testing pattern for extension host
- **All team members:** Can run tests locally and in CI/CD

### 7. No-Workspace Handling — Explicit Communication Pattern

**Decision Date:** 2026-03-07  
**Author:** Lisa Simpson (Core Dev)  
**Status:** Implemented

#### Context

When Squad Pod extension opens in VS Code without a workspace folder open, the webview would get stuck showing "Loading office..." forever. The extension host's `onWebviewReady()` handler would detect no workspace root and return early without sending any message, leaving the webview in an indefinite loading state.

#### Problem

Silent early returns in message handlers break the request-response contract between extension host and webview. The webview expected a `layoutLoaded` message to exit loading state, but never received it when no workspace was available.

#### Decision

**Always send a message when a condition changes, never silently return early.**

1. Added `noWorkspace` to the `OutboundMessage` discriminated union in `src/types.ts`
2. Extension host explicitly sends `{ type: 'noWorkspace' }` when `getWorkspaceRoot()` returns undefined
3. Webview handles this message by setting both `noWorkspace: true` and `layoutReady: true`
4. `App.tsx` renders a helpful message when `noWorkspace` is true instead of showing loading spinner

#### Rationale

- **Explicit over implicit:** Sending a message makes the no-workspace state observable in the message flow
- **Type safety:** Discriminated union ensures all message types are exhaustively handled
- **User experience:** Clear guidance ("Open a folder to get started") is better than indefinite spinner
- **Debuggability:** Message appears in webview console, making the state transition visible

#### Alternatives Considered

1. **Show error notification and keep loading spinner** — Too passive, user might miss the notification
2. **Auto-close webview when no workspace** — Bad UX, webview would disappear immediately on open
3. **Poll for workspace changes** — Unnecessary complexity, VS Code already notifies on workspace changes

#### Pattern for Future Work

When an extension host handler detects a condition that prevents normal flow:
1. Add a new message type to `OutboundMessage` describing the condition (e.g., `noWorkspace`, `invalidConfig`, `permissionDenied`)
2. Send the message before returning
3. Handle the message in `useExtensionMessages` hook
4. Update `App.tsx` to render appropriate UI for the state

This pattern applies to any situation where the extension cannot fulfill the webview's expectations.

### 8. Tileset Import Pipeline — Self-Contained Scripts

**Date:** 2026-07-24  
**Author:** Lisa Simpson (Core Dev)  
**Status:** Implemented

#### Context

Ported the tileset import pipeline from pixel-agents into squad-pod. The pixel-agents `export-characters.ts` imported `CHARACTER_TEMPLATES` and `CHARACTER_PALETTES` from `webview-ui/src/office/sprites/spriteData.js`, which doesn't exist in squad-pod. Our sprite system uses procedural generation (`defaultCharacters.ts`) with a simpler 3-color palette model.

#### Decision

**Scripts in `scripts/` are self-contained — they duplicate any data they need rather than importing from extension host or webview source.**

Specifically:
- `export-characters.ts` duplicates the 6 character palettes and sprite generation functions from `defaultCharacters.ts`
- This avoids cross-build-target imports (scripts run via tsx in Node, webview code is browser-targeted ESM)
- If palettes change in `defaultCharacters.ts`, they must be updated in `export-characters.ts` too

#### Rationale

- **Simplicity:** Scripts run via `npx tsx` from repo root. No build step needed.
- **Isolation:** Scripts don't depend on webview build artifacts or extension host code.
- **Reliability:** No risk of ESM/CJS import resolution issues across build targets.
- **Tradeoff accepted:** Palette duplication is a small maintenance burden (6 color objects) vs. the complexity of cross-target imports.

#### Consequences

- If character palettes are added or modified, update both `defaultCharacters.ts` and `scripts/export-characters.ts`
- Future direction-specific sprite templates would need to be reflected in the export script

### 9. Pixel Agents Gap Analysis

**Date:** 2026-03-06  
**By:** Homer Simpson (Lead)  
**Status:** Approved

#### Context

Squad-pod successfully implements the core layout editor features from pixel-agents (tile painting, furniture placement, rotation, undo/redo) and adds significant Squad-specific value (agent visualization, team discovery, telemetry streaming). The main feature gaps are cosmetic (matrix effect), advanced editing workflows (ghost preview, wall drag tracking, toolbar UI richness), and furniture catalog sophistication (rotation/state groups, dynamic catalog loading from external assets, category filtering).

#### Key Gaps (Prioritized)

**P0 — Blocking:** None. Core editing is fully functional.

**P1 — Important but Not Blocking:**
1. **Editor Toolbar UI** — No visual toolbar; tools triggered via settings/hotkeys only
2. **Furniture Catalog UI with Category Filtering** — No UI to browse furniture by category
3. **Color Picker UI (HSB Sliders)** — Field exists in `FloorColor` type but no UI
4. **Ghost Preview During Furniture Drag** — Drag works but lacks visual feedback

**P2 — Nice to Have:**
- Matrix rain effect (cosmetic)
- Grid resizing UI (expandability)

### 10. Always Send Both Tileset Message Formats

**Decision Date:** 2026-03-08  
**Author:** Lisa Simpson  
**Status:** Accepted

#### Context

The extension host can load two JSON formats for the office tileset:
- `tileset-metadata.json` — rich format with typed items, bounds, and interactables
- `tileset.json` — legacy format with simple name→region object map

Previously the extension sent EITHER `tilesetMetadataLoaded` OR `tilesetAssetsLoaded`, never both. This caused a rendering failure because the renderer's `furnitureToTileset` mapping uses `tileset.json` object names, which differ from `tileset-metadata.json` item IDs.

#### Decision

The extension now ALWAYS sends both messages when both JSON files exist:
1. `tilesetMetadataLoaded` — populates metadata indexes (`itemById`, `itemsByType`, `interactables`) for future metadata-driven rendering
2. `tilesetAssetsLoaded` — populates legacy `tilesetData` with correct object names for the current `drawTilesetFurniture()` rendering path

### 11. Character Sheet URI Handler Must Match Extension Message Protocol

**Decision Date:** 2026-03-08  
**Author:** Lisa Simpson  
**Status:** Implemented  

#### Context

The extension host sends `characterAssetsLoaded` messages containing webview-safe URIs for character sprite sheet PNGs (char_employeeA–D.png). The webview had no handler for this message type, causing all characters to render as colored rectangles instead of custom PNG sprites.

#### Decision

Every `OutboundMessage` variant defined in `src/types.ts` MUST have a corresponding handler in `webview-ui/src/hooks/useExtensionMessages.ts`. The `default: break` case in the message switch silently drops unhandled messages with no runtime warning.

### 12. EditorToolbar as Left Side Panel

**Decision Date:** 2026-03-08  
**Author:** Bart Simpson (Frontend Dev)  
**Status:** Implemented

#### Context

The layout editor had all backend plumbing (EditorState, tools, undo/redo, ghost rendering, furniture catalog) but no visible UI. Clicking "Edit Layout" toggled edit mode but showed no toolbar.

#### Decision

(see original document for details)

### 13. No `window.confirm()` or `window.alert()` in Webview

**Author:** Bart Simpson  
**Date:** 2025-07-24  
**Status:** Implemented

#### Context

The "Exit Layout Editor" button silently did nothing because `handleToggleEditMode` used `window.confirm()` to ask about unsaved changes. In VS Code webview sandbox, `window.confirm()` returns `false` immediately without showing a dialog (no `allow-modals` permission), causing the handler to return early.

#### Decision

Never use `window.confirm()`, `window.alert()`, or `window.prompt()` in the webview. These modal dialog APIs are blocked by the VS Code webview sandbox.

For confirmation flows, either:
1. Use VS Code message passing (`postMessage` to extension → extension calls `vscode.window.showWarningMessage` → posts result back)
2. Design UX that doesn't require blocking confirmation (e.g., undo/reset buttons, auto-save)

#### Impact

All webview code (`webview-ui/src/`). Anyone adding user-facing dialogs must use the VS Code messaging pattern instead of browser-native modals.

### 14. Tileset PNG Replaces Colored Rectangles for Tile Grid Rendering

**Author:** Lisa Simpson  
**Date:** 2026-03-08  
**Status:** Implemented

#### Context

The renderer always drew floor and wall tiles as colored rectangles (HSB-adjusted solid fills for walls, colorized inline sprites for floors). Custom tileset assets were loaded into memory but never used for tile grid rendering — only furniture used the tileset via `drawTilesetFurniture()`.

#### Decision

When tileset metadata and the tileset PNG are loaded, `renderTileGrid()` now draws floor and wall tiles directly from the tileset sprite sheet. Colored rendering is preserved as a fallback when assets aren't available.

**TileType → Tileset item mapping:**
- `FLOOR_1` → `floor_wood`
- `FLOOR_2` → `floor_blue_diamond`
- `FLOOR_3–7` → alternating `floor_wood`/`floor_blue_diamond`
- `WALL` → `wall_white_panel` (clipped to top 16px of 16×32 source)

#### Rationale

The tileset PNG contains hand-crafted pixel art that looks significantly better than procedurally colored rectangles. The asset delivery pipeline was already working correctly — only the renderer was missing the connection.

#### Impact

- **Rendering:** Office now shows tileset artwork instead of flat colors when custom assets are present
- **Fallback:** No-asset installs continue working with colored rectangles
- **Performance:** `drawImage()` from a cached `HTMLImageElement` is faster than `getColorizedSprite()` → `getCachedSprite()` → `drawImage()`
- **Future:** Additional floor/wall variants in tileset-metadata.json can be mapped to new TileType values by extending `tileTypeToMetadataItem` in `tilesetRenderer.ts`

Implemented EditorToolbar as a **left side panel** (220px wide) rather than a floating overlay or top strip:

1. **Left panel positioning** — sits between left edge and canvas, above the BottomToolbar (bottom: 48px). Doesn't obscure the canvas.
2. **Context-sensitive sections** — floor patterns and color sliders only appear when the relevant tool is active, keeping the panel compact.
3. **Inline styles only** — all styling via React style objects, no external CSS. Required for VS Code webview CSP compliance.
4. **SpritePreview via Canvas** — furniture palette items render their inline sprites using tiny `<canvas>` elements with `imageRendering: pixelated`, avoiding the need to load external preview images.
5. **Grid expansion in useEditorActions** — `handleExpandGrid` manipulates the tile array directly, shifting furniture positions and tileColor keys for left/up expansion. Ghost border clicks in OfficeCanvas trigger this.

#### Consequences

- **Positive:** Full editor functionality now accessible via UI. Ghost borders enable visual grid expansion.
- **Consideration:** The 220px side panel reduces canvas viewport width when editing. This is acceptable since editing is a separate mode.
- **Team impact:** Any new EditTool variants added to types.ts should also be added to TOOL_DEFS in EditorToolbar.tsx.

#### Rationale

- The discriminated union in `types.ts` provides compile-time type safety on the extension side, but the webview's switch/case has no exhaustiveness check — unhandled variants are silently ignored
- This bug was invisible: no errors, no warnings, just silent fallback to inline sprites
- The fix follows the existing pattern for asset loading: dynamic import + function call in the message handler

---

## Decision: CORS-Safe Image Loading in Webview

**Author:** Lisa Simpson  
**Date:** 2026-03-08  
**Status:** Implemented

### Context

VS Code webviews run at origin `vscode-webview://[uuid]` while resources are served from `https://file+.vscode-resource.vscode-cdn.net/`. This cross-origin relationship means:

1. `new Image()` loads succeed (CSP `img-src` allows it)
2. `canvas.getImageData()` may throw `SecurityError` (canvas tainted by cross-origin image)
3. Setting `crossOrigin="anonymous"` enables CORS but may cause the load itself to fail if the server doesn't send `Access-Control-Allow-Origin` headers

### Decision

All browser-side image loading in the webview must follow a **three-tier fallback** pattern:

1. **Try with `crossOrigin="anonymous"`** — enables `getImageData()` for pixel manipulation (background removal)
2. **On load error, retry WITHOUT `crossOrigin`** — image loads but canvas is tainted; pixel manipulation falls back gracefully
3. **On pixel access error (`getImageData`), catch and use raw image** — character has visible background but renders

Additionally, all `removeBackground()` / `getImageData()` calls must be wrapped in try/catch with graceful degradation.

### Team Impact

- **Bart (Canvas Dev):** Any new canvas pixel-manipulation code must handle `SecurityError` from `getImageData()`
- **Lisa (Extension Dev):** Image URIs from `webview.asWebviewUri()` are cross-origin; plan accordingly
- **All:** Never assume `getImageData()` works on images loaded from webview URIs

---

## Decision: Tileset Metadata Items as Placeable Furniture

**Author:** Bart Simpson (Frontend Dev)  
**Date:** 2026-03-08

### Context

The EditorToolbar now supports placing items from tileset-metadata.json (Electronics, Appliances, Decorations) in addition to the legacy FURNITURE_CATALOG items.

### Decision

Tileset metadata item IDs (e.g. `vending_machine_soda`, `pc_monitor_on`) are used directly as the furniture `type` string in `PlacedFurniture`. The rendering pipeline tries three fallbacks in order:

1. **Legacy tileset** (`drawTilesetFurniture`) — uses `furnitureToTileset` mapping for old types like `desk`, `pc`
2. **Metadata PNG** (`drawMetadataItemScaled`) — uses tileset-metadata.json bounds for new items
3. **Inline sprite** — falls back to the SpriteData array (placeholder for metadata items)

`layoutToFurnitureInstances()` also handles metadata items by looking up bounds from the asset loader when `getCatalogEntry()` returns null.

### Impact

- New items placed from the metadata catalog will use metadata IDs as types in saved layouts
- Existing layouts with legacy types (`desk`, `chair`, etc.) continue to work unchanged
- Any agent adding new tileset items to tileset-metadata.json will see them automatically appear in the editor toolbar under their category

#### Recommendation

When adding new message types to `OutboundMessage`, treat the handler in `useExtensionMessages.ts` as a mandatory counterpart. Consider adding a lint rule or code review checklist item to catch missing handlers.

#### Rationale

- Sending both is cheap (same PNG URL, browser caches it)
- Separates concerns: metadata for rich features, legacy for current rendering
- No need to maintain a cross-mapping between naming conventions
- Preserves backward compatibility — renderers using either path work correctly

#### Consequences

- When migrating the renderer to use metadata-driven `drawMetadataItem()` instead of legacy `drawTilesetFurniture()`, the legacy message can eventually be dropped
- The `assetsReady` flag must be set by ALL asset ingestion paths, not just the `loadAssets()` URL-fetch path
- Furniture rotation & state groups (advanced catalog)
- Dynamic catalog from external assets (maintainability at scale)

#### Recommendation

Implement **EditorToolbar** + **Furniture Palette UI** + **Color Picker** in next iteration (~2-3 days for a small team). These three unlock the discovery experience and bring UX parity with pixel-agents.

#### Roadmap

- **v1.0**: Core editor (done) + EditorToolbar + Furniture Palette + Color Picker
- **v1.1**: Ghost preview + keyboard shortcuts docs
- **v2.0**: Consider grid resizing, state toggling, dynamic catalog
- **v3.0+**: Matrix effect, sound notifications, sub-agent visualization polish

#### Full Analysis

See `.squad/decisions/inbox/homer-simpson-pixel-agents-gap-analysis.md` for complete feature comparison matrix, implementation notes, and file references.

### 10. Custom Asset URI Pipeline

**Date:** 2026-03-08  
**Author:** Lisa Simpson (Core Dev)  
**Status:** Implemented

#### Context

Brian provided custom 16×16 pixel art assets — a tileset spritesheet (tileset_office.png, 2.1MB) with 12 furniture objects and 4 character sprite sheets (char_employeeA–D.png, ~5MB each) with a 4-direction walk format. The existing asset pipeline decodes PNGs server-side via `pngjs` and sends pixel arrays as JSON through `postMessage`. This works for small procedural sprites but would be prohibitively slow and memory-intensive for multi-megabyte spritesheets.

#### Decision

**Introduce a parallel URI-based asset delivery path alongside the existing inline-sprite pipeline.**

**New message types:**
- `tilesetAssetsLoaded` — sends the tileset PNG as a webview URI plus the parsed tileset.json coordinate map
- `characterAssetsLoaded` — sends an array of `{id, uri}` entries for each custom character sprite sheet

**How it works:**
1. Extension host reads `tileset.json` from `dist/assets/` to get the object coordinate map
2. Converts local file paths to webview-safe URIs via `webview.asWebviewUri()`
3. Sends URIs + JSON metadata to webview via `postMessage`
4. Webview loads PNGs via `new Image()` in the browser (Bart's territory)

**Key types:**
- `TilesetData` / `TilesetObjectRegion` — JSON coordinate map
- `CharacterAssetEntry` — `{id, uri}` pair

#### Rationale

- **Performance:** Browser-native image loading is orders of magnitude faster than server-side PNG decode → pixel array → JSON serialize → postMessage → deserialize
- **Backward compatibility:** Legacy inline-sprite messages (`characterSpritesLoaded`, `furnitureLoaded`, etc.) are still sent — webview can prefer URI-based assets when available
- **Separation of concerns:** Extension host only handles URI generation and JSON parsing; webview handles all rendering (Bart's domain)
- **Graceful degradation:** If custom assets don't exist, no messages are sent — no errors, no broken state

#### Consequences

**Positive:**
- Custom assets load efficiently in the webview without blocking the extension host
- No dependency on `pngjs` for the new asset path
- Webview can use Canvas `drawImage()` with source rectangles for tileset slicing

**Negative:**
- Two parallel asset delivery mechanisms (inline pixels vs URIs) — slightly more complexity
- Webview must handle both old and new message types during transition

#### Team Impact

- **Bart (Canvas Dev):** Can now receive `tilesetAssetsLoaded` and `characterAssetsLoaded` messages in `useExtensionMessages.ts` and load the images for Canvas rendering
- **Lisa (Core Dev):** Types, URI generation, and message protocol complete
- **All:** TILE_SIZE = 16 is now a named constant in `src/constants.ts` (was previously only in webview code)

### 11. PNG Asset Rendering Pipeline

**Author:** Bart Simpson (Frontend Dev)  
**Date:** 2026-03-08  
**Status:** Implemented

#### Context

Brian provided custom 16×16 pixel art assets (tileset + 4 character sprite sheets) placed in `webview-ui/public/assets/`. The existing rendering system uses inline `SpriteData` (2D string arrays) for both furniture and characters. We need to render from PNG sprite sheets without breaking the existing system.

#### Decision

Implemented a **parallel rendering pipeline** that loads PNG assets at startup and uses them when available, with automatic fallback to inline sprites.

#### Architecture

1. **assetLoader.ts** preloads all PNGs on mount. Character sheets get background removal (color keying) since they have opaque near-white backgrounds instead of alpha transparency.
2. **tilesetRenderer.ts** and **characterSheetRenderer.ts** provide draw functions that clip from sprite sheets using `ctx.drawImage()`.
3. **renderer.ts** checks `areAssetsReady()` each frame. Per-drawable, it tries PNG first then falls back to inline.
4. The extension can send an `assetBaseUrl` message to set the correct webview URI base for production.

#### Character Sheet Format

- 4 rows: Up(0), Right(1), Down(2), Left(3)
- 7 frames per row, 23×16 base pixels at 20× upscale
- Palette index maps to sheet: 0→A, 1→B, 2→C, 3→D (wraps for 4+)

#### Team Impact

- **Lisa:** Can send `assetBaseUrl` message from extension host to set correct webview URI for assets. No extension host code was modified.
- **Marge:** All 78 existing tests pass. New rendering code is browser-only (Canvas API) so not directly unit-testable in jsdom without canvas mocks.
- **Ned:** Asset pipeline documented in history.md. Users place PNGs in `webview-ui/public/assets/`.

#### Consequences

**Positive:** PNG rendering is completely opt-in. If assets fail to load, nothing breaks.  
**Negative:** Character sprite sheets require background removal at load time (one-time cost per sheet, ~50ms each).

### 12. User Directive: Custom Asset Integration (2026-03-08T03:03)

**From:** Brian Swiger (via Copilot)  
**Status:** Captured for team memory

Custom 16x16 pixel assets must be integrated manually into the codebase. Character PNGs (4 employees A-D) go to webview-ui/public/assets/characters/. Tileset PNG + JSON go to webview-ui/public/assets/. TILE_SIZE must be 16. tileset.json is the source of truth for object IDs. Character sheets use 4-frame rows: Row 0=Walk Up, Row 1=Walk Right, Row 2=Walk Down, Row 3=Walk Left.

#### Rationale

User request — captured for team memory and decision context.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

### 13. Tileset Metadata Integration — Prefer Rich Format with Legacy Fallback

**Author:** Lisa Simpson (Core Dev)
**Date:** 2026-03-08
**Status:** Implemented

#### Context

The tileset asset pipeline now produces two JSON files:
- \	ileset.json\ — 12 objects, flat \{x,y,w,h}\ regions, no categorization
- \	ileset-metadata.json\ — 18 items with type categories, structured bounds, interactables

The webview needs richer data (item types for rendering layers, interactables for player actions) but existing renderers still reference the legacy \getTilesetData()\ API.

#### Decision

**Prefer tileset-metadata.json; fall back to tileset.json.**

1. Extension host tries \	ileset-metadata.json\ first → sends \	ilesetMetadataLoaded\ message
2. If missing or malformed, falls back to \	ileset.json\ → sends \	ilesetAssetsLoaded\ (unchanged)
3. Webview's \setTilesetMetadata()\ also populates the legacy \	ilesetData\ object so all existing renderers continue working without changes

#### Consequences

**Positive:**
- Renderers can query items by type (\getItemsByType('furniture')\) for layered rendering
- Interactables are first-class data — no hardcoded action mappings needed
- Zero breaking changes: legacy code path untouched, legacy accessors still work

**Negative:**
- Two parallel metadata formats to maintain (until legacy tileset.json is fully retired)
- Webview duplicates type definitions from extension host (no shared package yet)

#### Team Impact

- **Bart (HTML Tools):** Can use \getItemById()\, \getItemsByType()\, \getInteractables()\ in renderers — no need to look up objects by string key anymore
- **All:** New OutboundMessage variant \	ilesetMetadataLoaded\ — add a case if you handle messages exhaustively

### 14. Tileset Metadata Rendering Pipeline

**Author:** Bart Simpson (Frontend Dev)
**Date:** 2026-03-08
**Status:** Implemented

#### Context

The tileset-metadata.json introduces a richer format with typed items (floor/wall/furniture/electronics/appliance/decoration), precise pixel bounds, and interactable definitions. This supersedes the legacy tileset.json object map for new items while maintaining backward compat.

#### Decision

Three new modules consume the metadata:

1. **tilesetRenderer.ts** — Added \drawMetadataItem()\ and \drawMetadataItemScaled()\ for metadata-driven rendering. Legacy \drawTilesetFurniture()\ untouched. Rendering looks up items via \getItemById()\ from assetLoader (Lisa's domain), keeping loading/rendering cleanly separated.

2. **collision.ts** — Stateless functions that classify item types as blocking or walkable. Multi-tile items (e.g., 48×32 desk = 3×2 tiles) correctly occupy all grid cells via \Math.ceil(bounds / TILE_SIZE)\. Integrates with existing \lockedTiles: Set<string>\ via \mergeBlockedTiles()\.

3. **interactables.ts** — \InteractableRegistry\ class with load/query lifecycle. Maps item_id→action from metadata. Spatial queries find adjacent interaction points and nearby interactables for characters.

#### Consequences

- **Forward path clear:** Future items just need a metadata entry — no code changes for rendering/collision
- **Backward compat preserved:** Old furnitureCatalog.ts sprites still render when metadata isn't loaded
- **Team impact:** Lisa's assetLoader provides the data; Bart's modules consume it. Marge can unit-test collision/interactables without Canvas mocks (pure logic).

### 15. User Directive: Tileset Metadata Integration (2026-03-08T03:21)

**From:** Brian Swiger (via Copilot)
**Status:** Captured for team memory

Integrate tileset-metadata.json as the primary metadata source for office assets. The metadata defines 18 items (floors, walls, furniture, electronics, appliances, decorations) with precise pixel bounds from tileset_office.png. The renderer must use bounds (x, y, width, height) to clip sprites. All dimensions must be multiples of 16. Interactables (vending_machine_soda, coffee_maker_carafe, pc_monitor_on) must map to character states. Type field (furniture, appliance, etc.) generates collision maps. This bypasses the import-tileset pipeline — metadata is manually registered.

#### Rationale

User request — captured for team memory.

### 16. Recompose Non-Standard Sprite Sheets to Match Pipeline Format

**Author:** Lisa Simpson
**Date:** 2025-07-25
**Status:** Implemented

#### Context

Character sprite sheets A-D follow a uniform format: 3220×1280 pixels, 7 frames per row × 4 direction rows, 460×320 per frame. The new sheet E arrived at 2385×1280 with 6 character poses at irregular spacing (~414px apart). The width doesn't divide cleanly by any frame count to produce integer base pixel dimensions.

#### Decision

When a new sprite sheet has non-standard dimensions, **recompose it to 3220×1280** (matching A-D format) using image preprocessing rather than adding dynamic frame detection to the browser-side pipeline.

#### Rationale

- Pipeline uniformity eliminates an entire class of frame-alignment bugs
- Auto-detection from dimensions alone is ambiguous (multiple valid frame counts for most widths)
- Content-aware detection (body blob counting) adds complexity for a rare edge case
- One-time Python preprocessing is simpler and more reliable than runtime detection
- The \PALETTE_TO_SHEET\ mapping and animation frame indices assume consistent frame geometry

#### Consequences

- New character sheets must be preprocessed to 3220×1280 before adding to \webview-ui/public/assets/characters/\
- The preprocessing recipe: divide source into N strips, center each in a 460px cell, fill remaining frames with background
- If future sheets require >7 frames, the pipeline will need refactoring (but 7 frames exceeds the animation's max index of 3)

### 17. No Dynamic import() for State-Sharing Modules in Webview

**Author:** Lisa Simpson  
**Date:** 2026-03-08  
**Status:** Accepted  
**Commit:** 74715a4

#### Context

The webview (`webview-ui/`) is bundled by Vite. When source code uses dynamic `import()` to lazily load a module, Vite may code-split it into a separate chunk file. If the same module is ALSO statically imported elsewhere in the bundle, two separate instances of the module's state can exist — the chunk's copy and the main bundle's copy.

#### Problem

All 8 message handlers in `useExtensionMessages.ts` used dynamic `import()` to call state-setter functions (e.g., `setTilesetMetadata`, `setFloorSprites`, `loadCharacterSheetsFromUris`). These wrote to module-level variables in code-split chunk copies. But `renderer.ts` read from the main bundle's copies via static imports. Result: assets loaded into one copy, renderer read from another — rendering always fell back to colored rectangles.

#### Decision

**NEVER use dynamic `import()` in webview code for modules that share mutable state with the renderer or other statically-imported consumers.** Use static `import` at the top of the file instead.

Dynamic `import()` is acceptable ONLY for:
- Truly lazy-loaded UI components with no shared mutable state
- Modules that are self-contained and don't communicate via module-level variables

#### Enforcement

- `vite.config.ts` uses `emptyOutDir: true` to prevent stale chunks from lingering
- If a new code-split chunk appears in `dist/webview/assets/` after a build, investigate whether it duplicates module state

### 18. Synchronous RGBA Loading for Critical Webview Assets

**Author:** Bart Simpson (Frontend Dev)  
**Date:** 2026-03-08  
**Status:** Implemented

#### Context

Character sprites failed to render in the VS Code Electron webview across 7+ fix attempts. All async image loading approaches (new Image().onload, createImageBitmap, img.decode()) proved unreliable in the Electron/Chromium environment. Characters rendered as colored rectangle fallbacks instead of PNG sprite art.

#### Problem

**Async Image Loading is Fundamentally Unreliable in VS Code Webviews:**
- 
ew Image().onload may never fire for data URIs in Electron
- createImageBitmap is async and may resolve too late for module init
- img.decode() is async and has timing issues
- All three approaches worked in Chrome DevTools but failed in production VS Code environment

**Webview Caching Hid the Problem:**
- Previous fixes (removeBackground skip, code-splitting fix, race condition guard) never took effect
- VS Code Electron webview served cached JS/CSS from old builds
- No cache-busting mechanism existed in _getHtmlForWebview()

#### Decision

**For critical bootstrap assets in VS Code webviews:**

1. **Pre-decode images to raw RGBA at build time** using server-side tools (Python PIL, Node.js Sharp, etc.)
2. **Embed raw RGBA pixel data** as base64-encoded strings in the bundle (not PNG data URIs)
3. **Use putImageData() at module init time** — this is 100% synchronous with zero dependencies on Image objects, decode(), or onload
4. **Add cache-busting to all script/CSS URIs** — append ?v= parameter to force fresh loads

#### Implementation

**Build-Time PNG Decode (scripts/gen_embedded_chars.py):**
- Convert PNG to RGBA using PIL
- Encode raw bytes as base64
- Generate TypeScript with width/height metadata

**Synchronous Bootstrap (assetLoader.ts):**
- Decode base64 → raw RGBA bytes via atob
- Create ImageData from raw pixels
- Draw to canvas via putImageData (SYNCHRONOUS!)
- Store immediately in characterSheets Map at module init

**Cache-Busting (SquadPodViewProvider.ts):**
- Append ?v= to all script/CSS URLs in _getHtmlForWebview()
- Forces fresh loads on each extension activation

#### Rationale

- **putImageData is 100% synchronous** — no onload, no decode(), no Promises, no race conditions
- **Module init guarantees load order** — characterSheets Map is populated before any other code runs
- **Build-time decode is reliable** — Python PIL/Node.js Sharp are battle-tested, deterministic
- **Cache-busting prevents silent failures** — fixes take effect immediately, no stale JS served
- **Bundle size tradeoff is acceptable** — 597KB vs 375KB for guaranteed rendering

#### Consequences

**Positive:**
- **Zero async dependencies for critical assets** — rendering works 100% reliably
- **No more colored rectangle fallbacks** — sprites always render
- **Faster first paint** — no Image load delay, pixels are immediately available
- **Debuggable** — console logs show characterSheets.size at bootstrap time

**Negative:**
- **Larger bundle size** — raw RGBA is ~3× bigger than compressed PNG (224×128 = 114KB raw vs ~38KB PNG)
- **Build-time dependency on PIL** — Python Pillow must be installed to run gen script
- **Regenerate on PNG changes** — run python scripts/gen_embedded_chars.py after updating source PNGs

#### Team Impact

- **Bart (Frontend Dev):** Owns gen script and bootstrap code — regenerate embeddedCharacters.ts after PNG updates
- **Lisa (Core Dev):** Cache-busting pattern applies to all webview HTML generation — use ?v= for script/CSS
- **All:** If adding new critical bootstrap assets (tileset, icons), use this pattern — raw RGBA + putImageData

#### Enforcement

- Add comment to assetLoader.ts bootstrap section: "CRITICAL: Use putImageData for sync load — do not replace with async Image"
- Document in README.md: "Run python scripts/gen_embedded_chars.py after updating character PNGs"
- If webview caching issues recur, verify cache-busting is present in _getHtmlForWebview()

### 19. User Directive: Base64 Data URIs for PNG Asset Delivery (2026-03-08)

**From:** Squad Coordinator  
**Status:** Implemented

**What:** All PNG assets sent as base64 data URIs instead of webview resource URIs.  
**Why:** Webview resource URIs failed silently in new Image() loads after 5+ fix attempts. Data URIs bypass the webview resource server entirely.

**Note:** This directive was superseded by Decision §18 (Synchronous RGBA Loading), which replaced data URIs with embedded base64 RGBA and putImageData() for even greater reliability.

### 20. User Directive: Smaller Sprite Sheets Incoming (2026-03-08T15:52)

**From:** Brian Swiger (via Copilot)  
**Status:** Captured for team memory

**What:** Brian is generating smaller character sprite sheet PNGs using Gemini with Nano Banana Pro 2. These will replace the current oversized character PNGs. Team should be ready to integrate when provided.  
**Why:** User request - captured for team memory

### 21. Reduce Character Sprites to 2 (A and B)

**Author:** Lisa Simpson  
**Date:** 2026-03-08  
**Status:** Implemented

#### Context

Brian provided two new source character images to replace all existing sprite sheets. The project previously had 5 character variants (A-E, all identical 63KB placeholders) with CHAR_COUNT=6 palette cycling.

#### Decision
- Reduce to exactly 2 character sprite sheets: char_employeeA.png (dark-haired male) and char_employeeB.png (blonde female).
- CHAR_COUNT set to 2. Palette index cycles 0→A, 1→B, 2→A, 3→B, etc.
- PALETTE_TO_SHEET reduced to ['A', 'B'] with modulo wrapping.
- The SquadPodViewProvider auto-discovers sheets via glob — no code change needed there.

#### Impact
- All agents now alternate between 2 character appearances instead of 6.
- Sprite sheet file size dropped from 63KB each to ~23-29KB each (real pixel art vs placeholders).
- If more character variety is needed later, add new sheets (C, D, etc.) and bump CHAR_COUNT + PALETTE_TO_SHEET.

#### UP-Facing Sprite Limitation

Image A's UP-facing direction had gray clothing indistinguishable from the gray background. The UP row uses horizontally-flipped DOWN frames as a workaround. If Brian provides a re-rendered source with distinct background color (e.g., magenta/green screen), the true back view can be extracted.

### 22. Never Use crossOrigin on Image Loads in VS Code Webviews

**Author:** Lisa Simpson  
**Date:** 2026-03-08  
**Status:** Implemented

#### Context

Five consecutive fix attempts failed to make PNG tileset and character sprites render in the webview. The root cause was crossOrigin='anonymous' on 
ew Image() — the vscode-resource server does not reliably send CORS headers, causing the image load to fail entirely (onerror fires). The retry mechanism (load without crossOrigin after CORS failure) was also unreliable due to browser response caching.

#### Decision

**Never set crossOrigin on Image elements in VS Code webviews.** Load all images as plain 
ew Image() without any CORS attribute.

- **Tilesets:** Only need ctx.drawImage() which works perfectly on tainted canvases. No downside.
- **Character sheets:** emoveBackground() may fail to getImageData() on a tainted canvas, but its existing catch block handles this gracefully (returns canvas with raw image — character renders with visible background instead of colored circles).

Additionally, always keep strong module-level references to in-flight Image objects to prevent garbage collection before onload/onerror fires.

#### Rationale

- ctx.drawImage() does not require CORS. Only pixel manipulation (getImageData/toDataURL) requires it.
- The character background removal is a nice-to-have, not critical. The catch block already handles the failure gracefully.
- Reliability of image loading trumps background removal quality.

### 23. Separate Readiness Gates for Tileset vs Character Assets

**Author:** Lisa Simpson  
**Date:** 2026-03-08  
**Status:** Implemented

#### Context

Squad Pod's PNG rendering pipeline now uses extension-host base64 data URIs sent over postMessage, then browser-side Image loads in the webview. Even with that transport fixed, the runtime could still fall back to colored rectangles/circles because the renderer relied on one shared ssetsReady flag for three different async asset families:

1. metadata tileset PNG + item index
2. legacy tileset PNG + object map
3. character sprite sheets keyed by palette

That shared flag allowed partial success to masquerade as full readiness.

#### Decision

Use **resource-specific readiness checks** instead of a single global gate:

- reTilesetAssetsReady() for floor/wall/furniture PNG rendering
- reCharacterAssetsReady() plus direct palette-sheet existence checks for character rendering
- getAssetLoadSnapshot() for diagnostics

Keep reAssetsReady() only as an aggregate "anything PNG-based is available" helper, not as the renderer's primary decision point.

#### Why

- Tile rendering depends on **tileset metadata image/object data**, not on character sheets.
- Character rendering depends on **the requested sheet for that palette**, not on the tileset.
- A single async success must not flip the entire renderer into a PNG path that still lacks the data it needs.
- Brian needs DevTools visibility into which exact stage loaded, failed, or is still pending.

#### Consequences

- Renderer fallback decisions now match the actual resource each path consumes.
- DevTools logs clearly show when messages are sent, received, dispatched, loaded, failed, and why fallback was chosen.
- Future asset work should avoid reintroducing a shared readiness boolean across unrelated pipelines.

### 24. Clean Build Targets Before Asset Copy

**Author:** Bart Simpson (Frontend Dev)  
**Date:** 2026-03-08  
**Status:** Implemented

#### Context

The esbuild copy-assets plugin copied webview-ui/public/assets/ to dist/assets/ using fs.cpSync() without cleaning the target first. When character sprite files C/D/E were removed from source, the stale PNGs persisted in dist/assets/characters/. The extension host then sent 5 character sheet data URIs instead of 2, adding ~252KB of unnecessary payload to the characterAssetsLoaded message.

#### Decision

Updated esbuild.js copy-assets plugin to rmSync the target directory before cpSync. This ensures dist/assets/ is always a clean mirror of webview-ui/public/assets/.

#### Consequences

- dist/assets/ will always match source, no stale file surprises
- Build is slightly slower (delete + copy instead of overwrite), negligible impact
- All team members building from source get identical dist/ output
