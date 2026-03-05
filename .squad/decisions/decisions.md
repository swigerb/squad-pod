# Decisions

## Squad Pod: TypeScript Interface Alignment — Engine Layer

**Decision Date:** 2026-03-05  
**Author:** Lisa Simpson (Core Dev)  
**Status:** Implemented

### Context

TypeScript interfaces in `types.ts` were misaligned with implementation code in the engine layer, causing property name mismatches (`dir` vs `direction`, `tileCol` vs `col`, `isActive` vs `active`), incorrect type declarations (`seats: Map<string, Seat>` vs `Seat[]`), missing properties, and type confusion between branded types and primitives.

### Decision

Standardize all core interfaces and data structures to match implementation:

**Character Interface:**
- Properties: `direction`, `col`/`row`, `frameIndex`, `tool`, `active`, `bubbleState: { type: string; fadeTimer?: number }`
- Keep both tile coords (`col`/`row`) AND pixel coords (`x`/`y`) for rendering

**Seat Interface:**
- Complete rewrite: `id`, `col`/`row`, `direction`, `occupant?: string | null` (not boolean `assigned`)

**FurnitureInstance:** `uid`, `type`, `col`, `row`, `width`, `height`, `rotation`, `state?`

**FurnitureCatalogEntry:** Renamed `footprintW/H` to `width/height`, added `label`, `isDesk`

**OfficeLayout:** `version` optional, `tiles: number[]` (not `TileType[]`), `tileColors?: Record<string, FloorColor>` (not sparse array)

**PlacedFurniture:** Added `rotation: number`, `state?: string`

**EditorState Class:** Renamed properties (`activeTool`→`tool`, `selectedTileType`→`tileType`, `selectedFurnitureType`→`furnitureType`), added setter methods

**OfficeState Class:** 
- `seats: Map<string, Seat>` → `seats: Seat[]` (simpler iteration)
- `walkableTiles: Array<{col,row}>` → `walkableTiles: Set<string>` (O(1) lookups)
- `tileMap: TileType[][]` → `tileMap: number[][]` (match runtime type)

### Rationale

- **Property consistency:** If frontend uses `direction`, backend should too; reduces cognitive load
- **Shorter names:** `col/row` vs `tileCol/tileRow` reduces verbosity
- **Seat.occupant vs .assigned:** Need to track WHICH agent is sitting, not just if occupied
- **Seat[] vs Map:** No perf bottleneck at ~10 seats; simpler iteration pattern
- **Set<string> for walkableTiles:** Fast O(1) membership checks for pathfinding
- **number[][] instead of TileType[][]:** TileType is branded number; runtime is just number; unnecessary assertion churn
- **Record<string, FloorColor>:** String keys "5,3" make intent explicit vs confusing sparse numeric indices

### Consequences

**Positive:**
- TypeScript errors in engine eliminated
- Consistent naming reduces bugs
- Data structures match actual usage
- Stable foundation for component layer

**Negative:**
- Breaking change for old property names (all fixed in this session)

## Squad Pod: Component TypeScript Interface Fixes

**Decision Date:** 2026-03-05  
**Author:** Bart Simpson (Frontend Dev)  
**Status:** Implemented

### Context

Lisa's interface refactors required cascading updates across rendering/component files. All consumers of Character, Seat, FurnitureInstance, EditorState, OfficeState were broken.

### Decision

Perform surgical updates across Bart-owned files (characters.ts, renderer.ts, OfficeCanvas.tsx, AgentLabels.tsx, App.tsx, useExtensionMessages.ts, DebugView.tsx, ToolOverlay.tsx):

**Engine Layer (characters.ts, renderer.ts):**
- Remove unused imports/functions
- Add x/y pixel coordinates to Character for hit detection
- Update all property access (direction, col/row, frameIndex, tool, active, bubbleState)
- Prefix unused params with underscore

**React Components:**
- Fix gameLoop callbacks: `onUpdate/onRender` → `update/render`
- Update function signatures
- Fix seat lookups: `seats.get(id)` → `seats.find(s => s.id === id)`
- Remove unused prop destructuring
- Fix useRef initialization with valid initial values

**Hooks:**
- Prefix unused parameters
- Fix call signatures (addAgent 7→6 args, buildDynamicCatalog 2→0 args)

**Debug:**
- Update all Character property accesses
- Fix collection checks: `Map.size` → `Array.length`, `Array.length` → `Set.size`

### Rationale

- **Surgical vs rewrite:** Lisa's interfaces are source of truth; minimize diff surface
- **x/y pixel coords:** Hit detection needs interpolated positions during walk animations; col/row alone causes snapping
- **useRef initial values:** TypeScript strictNullChecks requires non-undefined initial value
- **Prefix unused params:** Interface contracts can't change; `_` signals intentional vs forgotten

### Consequences

**Positive:**
- All component files compile clean
- No behavioral regressions
- Smooth character rendering with x/y sync

**Negative:**
- More verbose with underscore-prefixed params

---

## Squad Pod: Project Structure & Build Pipeline

**Decision Date:** 2026-03-05  
**Author:** Lisa Simpson  
**Status:** Implemented

### Context

Squad Pod is a VS Code extension that embeds a React webview with Canvas-based pixel art animations. This requires two completely separate build targets:

1. **Extension Host** (Node.js environment, VS Code Extension API)
2. **Webview** (Browser environment, React)

### Decision

Implement a dual build pipeline with clear separation of concerns:

#### Extension Host Build (esbuild)

- **Bundler:** esbuild (fast, Node-native, CJS output)
- **Entry:** `src/extension.ts` → `dist/extension.js`
- **Config:** `esbuild.js` with watch mode, problem matcher integration
- **Why esbuild:** Instant rebuilds, native Node.js support, simpler than webpack for extension host code

#### Webview Build (Vite)

- **Bundler:** Vite (modern, React-optimized, ESM output)
- **Entry:** `webview-ui/src/main.tsx` → `dist/webview/assets/`
- **Config:** `webview-ui/vite.config.ts` with fixed asset names
- **Why Vite:** Best-in-class React DX, HMR, modern ESM output

#### Asset Handling

- Static assets (spritesheets, layouts) live in `webview-ui/public/assets/`
- esbuild plugin copies them to `dist/assets/` post-build
- Extension serves assets from `dist/` via webview.asWebviewUri()

#### TypeScript Configuration

- **Root tsconfig.json:** Extension host (Node16 module, ES2022 target)
- **webview-ui/tsconfig.json:** Solution-style with references
- **webview-ui/tsconfig.app.json:** App code (ESNext, bundler resolution, JSX)
- **webview-ui/tsconfig.node.json:** Vite config (ESNext, no DOM)

#### Development Workflow

```bash
npm run watch              # Parallel: watch:esbuild + watch:tsc
npm run check-types        # Type check without bundling
npm run build              # Production build (minified, no sourcesContent)
npm run build:webview      # Vite build (called separately when needed)
```

### Consequences

#### Positive

- Clear separation: Node.js code vs browser code never mix
- Fast rebuilds: esbuild for extension (~50ms), Vite HMR for webview
- Type safety: Separate tsconfigs catch environment-specific errors early
- Standard tooling: esbuild/Vite are industry standard for their respective domains

#### Negative

- Two build systems to maintain (but each is trivial)
- Webview must be built separately (acceptable tradeoff)
- Assets must be copied by plugin (no magic resolution)

### Alternatives Considered

1. **Webpack for everything:** Rejected. Slower, more complex config, no benefit over dual-tool approach.
2. **Single TypeScript config:** Rejected. Would mix Node.js and DOM types, causing false positives.
3. **Rollup instead of Vite:** Rejected. Vite is Rollup + better DX for React.

### Team Impact

- **Bart (Canvas Dev):** Works entirely in `webview-ui/src/`, uses `npm run dev` for Vite HMR
- **Marge (Tests):** Extension tests use `dist/extension.js`, webview tests use Vite test mode
- **Ned (Docs):** Build instructions are straightforward (`npm install` → `npm run build`)
- **Homer (Coordinator):** Two build targets, but both "just work" via npm scripts
