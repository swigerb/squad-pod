# Ned Flanders — History

## Project Context

**Project:** squad-pod — A VS Code extension bringing animated pixel art offices to Brady Gaster's Squad framework
**User:** Brian Swiger
**Stack:** VS Code Extension (TypeScript, esbuild), React 19 webview (Vite, Canvas 2D pixel art), Squad integration
**Inspiration:** pablodelucca/pixel-agents adapted for bradygaster/squad
**Universe:** The Simpsons

## Core Context

- DevRel owning all documentation: README, marketplace listing, developer guides, API docs
- VS Code Marketplace listing is the storefront — must be compelling and accurate
- Need screenshots/GIFs showing the pixel art office in action for the README
- Contributing guide should get someone from clone to running extension in <5 minutes

## Learnings

### README.md Creation (Session 1)

**What was written:** A complete README.md for Squad Pod covering:
- Warm, welcoming title & tagline ("Welcome, neighbor!")
- One-paragraph description of what Squad Pod does (pixel art office that reflects agent activity)
- All 8 required features as a scannable bullet list
- Clear requirements section (VS Code 1.107.0+, Squad-powered project)
- Step-by-step "Install from Source" instructions under Getting Started
- "How It Works" section explaining the `.squad/` directory monitoring and activity detection
- Full tech stack breakdown (both Extension and Webview layers)
- Credits acknowledging both Pixel Agents (origin) and Squad (integration target)
- MIT License note

**Structural choices:**
- Lead with a warm greeting ("Welcome, neighbor!") to set tone and make the project feel approachable
- Used 4 backticks for code blocks (standard GitHub markdown)
- Placed install instructions in a collapsible narrative flow: Install → Build → Launch → Use
- Added "Screenshot coming soon!" placeholder at the end for future visual content
- Kept total length ~200 lines (concise, under 500 target)
- Cross-linked to Squad and Pixel Agents GitHub repositories for discoverability
- Every code example is copy-pasteable and reflects actual project structure

**Tone applied:**
- Neighborly and warm throughout (Ned Flanders character)
- Addressed the reader directly ("Welcome," "neighbor," "Happy squad building")
- Used casual language ("cozy pixel art office," "watch your team come alive")
- Emphasized zero-friction onboarding ("no manual setup needed," "appears automatically")
- Celebration at the end (emojis, encouragement)
