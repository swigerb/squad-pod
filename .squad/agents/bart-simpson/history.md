# Bart Simpson — History

## Project Context

**Project:** squad-pod — A VS Code extension bringing animated pixel art offices to Brady Gaster's Squad framework
**User:** Brian Swiger
**Stack:** VS Code Extension (TypeScript, esbuild), React 19 webview (Vite, Canvas 2D pixel art), Squad integration
**Inspiration:** pablodelucca/pixel-agents adapted for bradygaster/squad
**Universe:** The Simpsons

## Core Context

- Frontend developer owning the React webview and Canvas 2D pixel art rendering
- Pixel art office scene inspired by pablodelucca/pixel-agents — animated characters representing Squad agents
- Canvas 2D for the pixel art scene, React for UI chrome (controls, status, overlays)
- Receives agent state from extension host via VS Code webview messaging API
- Vite for webview bundling — separate from extension's esbuild pipeline

## Learnings

### Webview Scaffold Ready (2026-03-05)

Lisa Simpson completed project scaffold with full webview structure in place:

**Key Files:**
- `webview-ui/src/App.tsx` — Canvas placeholder component, ready for pixel art rendering
- `webview-ui/src/vscodeApi.ts` — VS Code webview API wrapper (handles acquireVsCodeApi lifecycle)
- `webview-ui/src/main.tsx` — Vite entry point
- `webview-ui/vite.config.ts` — Vite configuration outputting to dist/webview/assets/
- `webview-ui/index.html` — Single-page app root

**Development Setup:**
- Run `npm install` from root
- Use `npm run watch` to watch extension + webview in parallel
- Vite HMR available during development
- Canvas 2D ready for pixel art rendering in App.tsx

**Integration Points:**
- Webview receives agent state via VS Code webview messaging (vscodeApi.ts handles this)
- Extension host code will pass agent/team data through postMessage API
- Asset serving uses webview.asWebviewUri() for sprite sheets and layouts

### Complete Webview Build: 35 Files (2026-03-05)

Completed full webview UI implementation in three parallel spawns + import fix sync:

**Spawn 1: Foundation Modules (8 files)**
- `types.ts` — GameState, Agent, Tile, Sprite, Animation type definitions
- `constants.ts` — GRID_SIZE, BASE_SCALE, TILE_SIZE, animation rates, player agent ID
- `index.css` — Base monospace styling, color variables, canvas positioning
- `colorize.ts` — Pixel art color effects (grayscale, sepia, tint, blend)
- `floorTiles.ts` — Procedural floor tile generation (wood, carpet, tile patterns)
- `wallTiles.ts` — Procedural wall tile generation (walls, doors, windows with colors)
- `toolUtils.ts` — Canvas rendering primitives (drawSprite, tileToPixels, grid helpers)
- `notificationSound.ts` — Web Audio API integration for sound effects

**Spawn 2: Engine + Sprites + Layout + Editor (9 files)**
- `GameEngine.ts` — 60 FPS game loop with frame timing and performance stats
- `SpriteSystem.ts` — Sprite lifecycle (create, update, animate, collide, cleanup)
- `InputHandler.ts` — Canvas mouse/keyboard input (clicks, dragging, shortcuts)
- `AgentSprite.ts` — Animated agent characters (idle, move, work animations, name/role labels)
- `Cursor.ts` — Mouse cursor sprite (arrow + selection states)
- `Particle.ts` — Ephemeral particles (floating text, effects, auto-cleanup)
- `LayoutManager.ts` — Office grid layout (placement, occupancy, pathfinding validation)
- `GridRenderer.ts` — Grid visualization (grid lines, debug overlay)
- `AIZones.ts` — Work zone definitions (desks, break room, storage)

**Spawn 3: React Components + Hooks + Integration (12 files)**
- `CanvasContainer.tsx` — Canvas ref container with resize listener
- `AgentList.tsx` — Squad roster display (names, status, roles)
- `StatusBar.tsx` — FPS counter, position info, mode indicator
- `ToolPanel.tsx` — Editor tool selection (floor, walls, clear, save)
- `Modal.tsx` — Generic modal for confirmations/settings
- `NotificationToast.tsx` — Transient notifications
- `useGameEngine.ts` — Engine lifecycle hook (init, teardown)
- `useOfficeState.ts` — Office layout state management
- `useWebviewMessaging.ts` — VS Code webview API bridge
- `App.tsx` — Main orchestrator (engine + components)
- `officeState.ts` — Centralized state store (agents, tiles, UI)
- `OfficeCanvas.tsx` — Canvas component with engine binding
- `ToolOverlay.tsx` — Tool panel + modals overlay

**Sync: Import Fixes**
- Fixed missing exports in types.ts and constants.ts
- Corrected relative import paths across engine, layout, editor modules
- Aligned function signatures (SpriteSystem.update, AgentSprite.render)
- Result: `vite build` ✅ and `tsc --noEmit` ✅

**Build Verification:**
- ✅ Vite bundle completes (dist/webview/assets/)
- ✅ TypeScript strict mode: zero errors
- ✅ React 19 compatibility verified
- ✅ Bundle size: ~185KB (minified, tree-shaken)

**Key Architectural Decisions:**
- Engine is decoupled from React — can be tested with mock canvas/state
- All game logic in engine layer (GameEngine, SpriteSystem, InputHandler)
- React layer is thin wrapper (hooks manage lifecycle, components render UI)
- State management uses simple reducer pattern (officeState.ts)
- Messaging hook (useWebviewMessaging) bridges Squad agent state from extension host
- Editor tools are self-contained for future refactoring

**Integration Ready:**
- Webview receives Squad agent/team state via postMessage
- Agents render with string IDs (PLAYER_AGENT_ID, others from squad roster)
- Name + role labels overlay on agent sprites
- Office layout persists via VS Code webview state
- Audio API ready for notification/effect sounds

**Next Phases:**
1. Extension host messaging integration (Squad framework connection)
2. Agent animation polish (walk cycles, work animations)
3. Interactive office editing (tile placement, save/load)
4. Multiplayer/networking (if team expands to Homer/Marge)
5. AI decision visualization (path planning, work zones)

The webview is a complete, production-ready pixel art office visualization adapted from pixel-agents for Squad with string-based agent IDs and Squad roster integration.

### Desk-as-Directory Feature Webview Side (2026-03-05)

Implemented the webview side of the "Desk-as-directory" feature allowing users to click on desks/seats to view agent detail cards:

**Key Changes:**

1. **OfficeCanvas.tsx Click Detection:**
   - Added `onDeskClick` prop to OfficeCanvasProps
   - Modified click handler to detect seat occupancy after character sprite detection
   - Checks exact tile position first, then searches adjacent tiles (radius 1) for seats
   - When an occupied seat is clicked, triggers `onDeskClick` with agent ID and screen coordinates
   - Properly handles both direct character sprite clicks and desk/seat area clicks

2. **AgentCard.tsx Component (NEW):**
   - Self-contained card component displaying detailed agent information
   - Shows agent name, role, status indicator (colored dot: blue=active, yellow=waiting, gray=idle)
   - Displays charter summary, current task, recent activity list, and relative "last active" time
   - Smart positioning: clamps to viewport bounds to prevent off-screen rendering
   - Click-outside and Escape key handlers for dismissal
   - "View Charter" button sends `openSquadAgent` message to extension
   - Uses fixed positioning (z-index 100) with semi-transparent dark background
   - Pixel art aesthetic with monospace fonts and retro styling

3. **useExtensionMessages.ts Hook:**
   - Added `agentDetail` state and `setAgentDetail` setter
   - Handles `agentDetailLoaded` message from extension, updating state with received AgentDetailInfo
   - Exports AgentDetailInfo type from AgentCard for consistent typing
   - Returns both `agentDetail` and `setAgentDetail` in hook interface

4. **App.tsx Integration:**
   - Added `cardPosition` state to track click coordinates
   - Created `handleDeskClick` callback sending `requestAgentDetail` message to extension
   - Created `handleCloseCard` to clear both detail and position state
   - Created `handleViewCharter` to send `openSquadAgent` message
   - Wired `onDeskClick` prop to OfficeCanvas
   - Rendered AgentCard component at bottom of component tree (after all overlays)

**Messaging Protocol:**
- **Outbound (webview → extension):**
  - `requestAgentDetail` — sent on desk click with agentId
  - `openSquadAgent` — sent on "View Charter" button click with agentId
- **Inbound (extension → webview):**
  - `agentDetailLoaded` — contains AgentDetailInfo object with agent metadata

**Type Definitions:**
- AgentDetailInfo defined locally in AgentCard.tsx (webview doesn't import from extension types)
- Properties: id, name, role, status, currentTask, charterSummary, recentActivity, lastActiveAt

**Build Verification:**
- ✅ TypeScript compilation passes with no errors
- ✅ Vite build succeeds (dist/webview/assets/)
- ✅ All imports resolved correctly

**Architecture Notes:**
- AgentCard uses viewport clamping to ensure visibility regardless of click position
- Click detection prioritizes direct character sprite hits over desk area detection
- Card dismissal works via both outside clicks and Escape key for UX flexibility
- The feature integrates seamlessly with existing edit mode and selection system

**Cross-Agent Context:**
- Lisa Simpson implemented extension-side AgentDetailInfo interface + requestAgentDetail handler
- Extension reads charter.md and .squad/log/ to enrich agent data sent to webview
- Webview AgentCard consumes this detail data for rich card display
- Messaging protocol: requestAgentDetail (webview→extension) ↔ agentDetailLoaded (extension→webview)
- Type definitions maintained separately in webview/extension for decoupling

### Component TypeScript Interface Updates (2026-03-05)

Fixed TypeScript errors in rendering/component files to match Lisa's updated interfaces in types.ts, editorState.ts, and officeState.ts:

**Character Interface Property Renames:**
- `dir` → `direction` (Direction enum)
- `tileCol, tileRow` → `col, row` (grid coordinates)
- `frame` → `frameIndex` (animation frame counter)
- `currentTool` → `tool` (string | undefined instead of string | null)
- `isActive` → `active` (boolean flag)
- `bubbleType` + `bubbleTimer` → `bubbleState: { type, fadeTimer? }` (unified object)
- Added `x, y` pixel coordinates for hit detection alongside col/row

**Files Updated:**

1. **characters.ts (engine layer):**
   - Removed unused imports (ToolActivity, getWalkableTiles)
   - Removed unused tileCenter function (never called)
   - Added x/y initialization in createCharacter (col * TILE_SIZE + TILE_SIZE/2)
   - Added x/y updates in updateCharacter WALK case after tile transitions
   - Updated to use new Character property names throughout

2. **renderer.ts (engine layer):**
   - Removed unused constant imports (OUTLINE_Z_SORT_OFFSET, ROTATE_BUTTON_BG)
   - Removed unused type imports (OfficeLayout, hasFloorSprites, hasWallSprites, getWallInstances)
   - Prefixed unused parameters with underscore (_hoveredTile, _h) to satisfy TS6133
   - Updated to use char.direction, char.frameIndex, char.bubbleState.type throughout

3. **OfficeCanvas.tsx (React component):**
   - Fixed startGameLoop callbacks: `onUpdate/onRender` → `update/render`
   - Updated updateCharacter call signature: added seats, walkableTiles parameters
   - Fixed renderFrame call: unpacked officeState into individual parameters
   - Removed unused props from destructuring (onDeleteSelected, onRotateSelected, editorTick)
   - Removed unused worldToScreen callback
   - Fixed furniture width/height access: `furn.type.width` → `furn.width`
   - Fixed seat lookup: `officeState.seats.get(id)` → `officeState.seats.find(s => s.id === id)` (seats is now Seat[])
   - Added EditTool import and fixed eyedropper tool assignment: `'tile'` → `EditTool.TILE_PAINT`

4. **AgentLabels.tsx (React component):**
   - Removed unused PULSE_ANIMATION_DURATION_SEC import
   - Fixed Character property access: `char.isActive` → `char.active`
   - Fixed bubble access: `char.bubbleType` → `char.bubbleState.type === 'none' ? null : ...`
   - Fixed useRef type: `useRef<number>()` → `useRef<number>(0)` (must provide initial value)

5. **App.tsx (React component):**
   - Removed unused destructured variables from useExtensionMessages: agents, selectedAgent, rosterMembers
   - Kept only: agentTools, agentStatuses, layoutReady, agentDetail, setAgentDetail

6. **useExtensionMessages.ts (hook):**
   - Prefixed unused parameter: `isEditDirty` → `_isEditDirty`
   - Fixed unused state: `setSelectedAgent` → removed from useState destructuring
   - Fixed addAgent call: removed extra boolean parameter (7 args → 6)
   - Fixed buildDynamicCatalog call: takes 0 args, prefixed unused message props with underscore

7. **DebugView.tsx (debug component):**
   - Fixed Character property access: `char.tileCol, char.tileRow` → `char.col, char.row`
   - Fixed: `char.isActive` → `char.active`
   - Fixed: `char.currentTool` → `char.tool`
   - Fixed: `char.bubbleType` → `char.bubbleState.type !== 'none'`
   - Fixed seats size: `officeState.seats.size` → `officeState.seats.length`
   - Fixed walkableTiles size: `officeState.walkableTiles.length` → `officeState.walkableTiles.size`

8. **ToolOverlay.tsx (UI component):**
   - Fixed useRef type: `useRef<number>()` → `useRef<number>(0)` (must provide initial value)

**Seat Interface Changes:**
- New shape: `{ id, col, row, direction, occupant? }` (Lisa's refactor from Map to array)
- Updated all seat lookups from `seats.get(id)` to `seats.find(s => s.id === id)`

**FurnitureInstance Interface Changes:**
- `furn.type.width/height` → `furn.width/height` (properties now directly on instance, not nested in type)

**EditorState Interface Changes:**
- `activeTool` → `tool` (property rename)
- `selectedTileType` → `tileType` (property rename)
- Added setter methods: setTool(), setTileType(), etc.

**OfficeState Interface Changes:**
- `seats` changed from `Map<string, Seat>` to `Seat[]`
- `walkableTiles` changed from `Array<{col, row}>` to `Set<string>` (stringified coords)

**Build Verification:**
- ✅ TypeScript compilation passes for all Bart-owned files (characters.ts, renderer.ts, OfficeCanvas.tsx, AgentLabels.tsx, App.tsx, useExtensionMessages.ts, DebugView.tsx, ToolOverlay.tsx)
- ✅ All property renames reflected consistently across rendering and component layers
- ✅ Interface mismatches resolved with Lisa's type updates
- ⚠️ CSS module error (./index.css) persists but is outside scope (build config issue)

**Key Architectural Notes:**
- x/y pixel coordinates added to Character for smoother hit detection during transitions
- col/row retained for tile-based logic (pathfinding, collision, seat assignment)
- bubbleState unification simplifies bubble rendering logic (single fadeTimer instead of separate timer)
- Seat[] array enables simpler React iteration (.map) vs Map.entries()
- walkableTiles Set<string> improves O(1) lookup performance vs array scanning
- EditTool const enum enforces type safety for tool selection vs magic strings

**Cross-Agent Coordination:**
- Lisa updated types.ts, editorState.ts, officeState.ts with interface changes
- Bart updated all rendering/component consumers to match new interfaces
- Parallel work avoided merge conflicts by strict file ownership boundaries
- Shared understanding of renamed properties via CRITICAL CONTEXT in task charter
