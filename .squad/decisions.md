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

### 5. Unit Test Suite for Extension Host Code

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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
