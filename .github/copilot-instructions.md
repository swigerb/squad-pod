# Copilot Instructions for Squad Pod

## Build & Test Commands

This is a **dual-pipeline** project — the VS Code extension host (Node.js/esbuild) and the React webview (Vite) build independently.

```bash
# Extension host
npm run build              # Type-check + esbuild production bundle → dist/extension.js
npm run compile            # Type-check + esbuild dev bundle
npm run check-types        # TypeScript only (no emit)
npm run lint               # ESLint on src/

# Webview
cd webview-ui && npm run build    # Vite production build → dist/webview/

# Tests
npm test                          # Extension host tests (vitest, node environment)
cd webview-ui && npx vitest run   # Webview tests (vitest, jsdom environment)
npm run test:all                  # Both suites sequentially

# Single test file
npx vitest run src/teamParser.test.ts
cd webview-ui && npx vitest run src/office/engine/pathfinding.test.ts

# Watch mode
npm run test:watch
```

After cloning, install both dependency roots: `npm install && cd webview-ui && npm install`.

## Architecture

Squad Pod is a VS Code extension that visualizes [Squad](https://github.com/bradygaster/squad) AI agent teams as animated pixel art characters in a virtual office.

### Two-process model

- **Extension host** (`src/`): Node.js process — discovers agents from `.squad/team.md`, watches `.squad/` directories for activity, manages agent state, loads PNG sprite assets, and communicates with the webview via `postMessage`.
- **Webview** (`webview-ui/src/`): React 19 app rendered in a VS Code webview panel — runs a Canvas 2D game loop with A* pathfinding, character state machines, office layout rendering, and an interactive layout editor.

### Extension host → Webview message protocol

All communication uses typed `postMessage`. The extension sends `OutboundMessage` variants (discriminated union on `type` field in `src/types.ts`). The webview sends `WebviewMessage` objects back. Key flow:

1. Webview posts `webviewReady`
2. Extension responds with sprite assets, layout, and agent list
3. Extension posts `agentToolStart`/`agentToolDone`/`agentStatus` as `.squad/` files change
4. Extension posts `telemetryEvent` with structured activity data (status changes, session updates, log entries, orchestration events)
5. Webview posts `saveLayout`, `saveAgentSeats`, `requestAgentDetail`, etc.

### Agent discovery & activity tracking

- **Team roster**: `teamParser.ts` parses the markdown table under `## Members` in `.squad/team.md`. Agent slugs are derived from charter paths (e.g., `.squad/agents/homer-simpson/charter.md` → `homer-simpson`).
- **File watching**: `squadWatcher.ts` uses a dual-layer approach — `fs.watch()` for instant notifications plus stat-based polling at 1-second intervals for cross-platform reliability. Watches `sessions/`, `log/`, and `orchestration-log/` under `.squad/`.
- **State management**: `agentManager.ts` maintains a `Map<agentId, SquadAgentState>` with auto-idle timers (30s timeout via `timerManager.ts`). Palette indices are assigned round-robin across 6 character sprites.

### Webview game engine (`webview-ui/src/office/`)

- `engine/officeState.ts` — master state: characters, layout, tiles, seats, furniture
- `engine/characters.ts` — character lifecycle with idle/walk/type states and wander AI
- `engine/pathfinding.ts` — A* pathfinding on walkable tile grid
- `engine/gameLoop.ts` — tick-based update loop (deltaTime-aware)
- `engine/renderer.ts` — Canvas 2D rendering pipeline

## Key Conventions

- **Strict TypeScript** with `strict: true`. Extension uses `module: Node16`; webview uses ESM.
- **Unused variables**: Prefix with underscore (`_`) — enforced by ESLint rule `@typescript-eslint/no-unused-vars`.
- **Message types are a discriminated union**: When adding new extension↔webview messages, add the variant to `OutboundMessage` in `src/types.ts` and handle it in `SquadPodViewProvider.handleWebviewMessage()` (inbound) or `webview-ui/src/hooks/useExtensionMessages.ts` (outbound from extension).
- **Agent filtering**: The team parser hides Scribe-role agents and the "Ralph" monitor agent — they are intentionally excluded from the office visualization.
- **Seat/palette persistence**: Agent seat assignments and palette indices are persisted via `context.workspaceState` so office layout survives reloads.
- **Webview CSP**: The webview uses a strict Content Security Policy with nonce-gated scripts. When modifying webview HTML generation in `SquadPodViewProvider`, preserve the CSP nonce pattern.
- **No VS Code API in tests**: Extension tests run in a plain Node environment without VS Code mocks. Test pure logic (parsing, pathfinding, state management), not VS Code API interactions.
