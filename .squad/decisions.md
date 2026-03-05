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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
