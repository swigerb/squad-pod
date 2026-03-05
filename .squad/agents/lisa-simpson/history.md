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
