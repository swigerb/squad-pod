<img src="https://bradygaster.github.io/squad/assets/squad-logo.png" alt="Squad" width="100" align="left" style="margin-right: 12px;" />

# Squad Pod

**Your Squad AI team, but make it pixel art.**

A VS Code extension that turns your [Squad](https://github.com/bradygaster/squad) agent team into animated pixel art characters in a virtual office. Homer reviews architecture. Lisa writes TypeScript. Bart animates the canvas. Marge catches every edge case. Ned writes the docs with a smile.

Each agent on your Squad roster gets their own character that walks around, sits at desks, and visually reflects what the agent is doing — typing when writing code, reading when searching files, waiting when it needs your attention.

> Built in one session by a Simpsons-themed Squad team, because of course it was.

![Squad Pod in action — pixel art office with Squad agents at their desks](Screenshot.jpg)

## Features

- **Team auto-discovery** — reads your `.squad/team.md` roster (or a legacy `.ai-team/team.md`) and spawns a character for every agent, no setup needed. In multi-root workspaces it picks the folder that contains Squad.
- **One agent, one character** — Homer gets a desk, Lisa gets a desk, everyone gets a desk. Adding or removing roster members updates the office live.
- **Live activity tracking** — watches Squad's sessions, logs, orchestration log, decision inbox, and per-agent folders to animate the right character when real work happens (see [File Watching & Activity Detection](#file-watching--activity-detection))
- **Stable look and seats** — each member keeps the same appearance and desk across reloads; reopening the panel restores the whole office without duplicating anyone
- **Telemetry feed** — click the 📡 button to open a live stream of all Squad agent activity — status changes, sessions, logs, orchestration events, color-coded by type, timestamps, and agent names
- **Office layout editor** — design your office with floors, walls, and furniture using the built-in editor
- **Speech bubbles** — visual indicators when an agent needs your attention
- **Sound notifications** — optional chime when an agent finishes its work (turn it off in Settings if you're in a meeting)
- **Persistent layouts** — your office design is saved and shared across VS Code windows
- **6 distinct characters** — two bundled character sheets, color-shifted into six looks (more members cycle through further hue shifts), no external assets required
- **Desk-as-directory** — click any occupied desk to see the agent's charter summary, current task, and recent activity
- **Diagnostics** — extension logs go to the **Squad Pod** output channel; Settings → **Debug View** shows live per-agent state

## How We Built This

This project started as a question: *"What if [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) worked with [Squad](https://github.com/bradygaster/squad)?"*

We used Squad itself to build it. The team was cast from The Simpsons universe:

| Agent | Role | What They Did |
|-------|------|---------------|
| 🏗️ **Homer Simpson** | Lead | Architecture decisions, code review, keeping it simple |
| 🔧 **Lisa Simpson** | Core Dev | All 10 extension host TypeScript files — types, parsers, watchers, providers |
| ⚛️ **Bart Simpson** | Frontend Dev | All 37 webview files — Canvas engine, React components, pixel art rendering |
| 🧪 **Marge Simpson** | Tester | Test coverage, edge case discovery, build verification |
| 📝 **Ned Flanders** | DevRel | This README, documentation, developer guides |
| 📋 **Scribe** | Session Logger | Decision tracking, orchestration logs, cross-agent context |

The original [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca) watches Claude Code's JSONL transcript files. Squad Pod replaces that entire integration layer with Squad-native file watching — reading the `.squad/` directory structure for team rosters, session data, and orchestration logs.

**What stayed the same:** The pixel art engine, Canvas 2D rendering, BFS pathfinding, character state machine, office layout editor, and the general "cozy virtual office" vibe.

**What changed:** Everything about how agents are discovered, tracked, and animated. Instead of JSONL transcripts → we parse `team.md` tables. Instead of terminal-per-agent → agents are pre-populated from the roster. Instead of `~/.claude/projects/` → we watch `.squad/sessions/`.

## Requirements

- VS Code 1.107.0 or later
- A [Squad](https://github.com/bradygaster/squad)-powered project (needs a `.squad/` directory with `team.md`)
- Node.js 22.13 or later to build from source (see `.nvmrc`)

## Getting Started

### Install from source

```bash
git clone https://github.com/swigerb/squad-pod.git
cd squad-pod
npm run install:all
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Development commands

| Command | What it does |
|---|---|
| `npm run install:all` | Clean install for the extension and the webview |
| `npm run lint` | ESLint for the extension host |
| `npm run check-types` | Type-check the extension host and the webview |
| `npm run test:all` | Run extension host and webview unit tests |
| `npm run build` | Production build of the webview (Vite) and extension (esbuild) |
| `npm run verify` | Lint, type-check, test, and build: the same checks CI runs |
| `npm run package` | Build `squad-pod-<version>.vsix` with `@vscode/vsce` |

### Usage

1. Open the **Squad Pod** panel (it appears in the bottom panel area alongside your terminal)
2. Your Squad team members appear automatically from `.squad/team.md`
3. Watch the characters walk to their desks and start working
4. Click a character to select it, then click another desk to move it there (an occupant is swapped into the old seat). Seat choices are saved.
5. Click **Layout** to open the office editor and customize your space
6. Open **Settings** for sound, layout export/import, and the Debug View

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper. Floor, wall, and erase tools paint continuously while you drag.
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y. Each drag (a paint stroke or a furniture move) is a single undo step.
- **Furniture moves and copies** — Select, then drag to move; hold **Alt when releasing** to copy. Desks carry their overlapping PCs and lamps; grabbing a PC or lamp moves just that object. Copies have fresh IDs and preserve the source's color (including no color), independently of the palette's Colorize setting.
- **Atomic groups** — green/red outlines preview the entire group; only the final drop commits. Moves, copies, and **R** rotations reject the whole group if any member collides, leaves the grid, or lands on walls/void. A rejected operation shows an error and does not change the layout or undo history. Leaving the canvas or losing window focus cancels a furniture drag.
- **Group rotation** — select a desk and press **R** (or Rotate) to turn the desk and its PCs/lamps together. Each move, copy, or rotation is one undo step; redo restores all members with the same IDs. Groups are inferred from overlapping catalog surfaces, not new saved group fields; existing layout files need no migration.
- **Export/Import** — share layouts as JSON files via the Settings modal. Imports are validated first; an invalid file shows an error and leaves your saved layout untouched.

The grid is expandable up to 64×64 tiles. The default layout is a 20×11 office with 6 desk/chair pairs — enough for a solid Squad team.

## Telemetry Feed

Squad Pod streams live activity from your Squad team to a dedicated drawer at the bottom of the office view. Click the **📡 Telemetry** button in the bottom toolbar to open it.

### What You'll See

- **Color-coded event types** — Status (🟦 agent state), Session (🟩 activity), Log (🟨 completed work), Orchestration (🟪 live events)
- **Live timestamp** — Every event shows when it happened
- **Agent name** — Which team member the event concerns
- **Event summary** — Quick description (e.g., "homer-simpson → busy typing")
- **Expandable details** — Click any event to see full context
- **Unread badge** — Count of new events while the drawer is closed, so you don't miss activity

### How It Works

The extension watches your `.squad/` directories and streams all activity to the webview via its internal messaging protocol. Events are buffered (newest first, max 200) so you can scroll back and see what happened. When you scroll up to review older events, the drawer pauses auto-scrolling; click **↓ Latest** to jump back to the newest activity.

## File Watching & Activity Detection

Squad Pod watches your project's `.squad/` directory (or legacy `.ai-team/`):

```
.squad/
├── team.md                    → Who's on the team (roster discovery, live updates)
├── sessions/*.json            → Active sessions (team-level activity)
├── log/*.md                   → Completed work (what happened)
├── orchestration-log/<ts>-<agent>.md → Which member is working right now
├── decisions/inbox/<agent>-*.md      → A member recording a decision
└── agents/<slug>/             → charter.md / history.md edits by that member
```

Files are matched to roster members by slug, display name, or a unique first name. A change marks that member as working; after 30 seconds without new activity they go back to idle, and the optional sound plays. Existing files are read as a baseline when the panel opens, so old history doesn't replay as new activity. Squad Pod uses `fs.watch` with a polling fallback, and it handles paths that contain spaces. No modifications to Squad are needed — it's purely observational.

The webview runs a lightweight game loop with Canvas 2D rendering, BFS pathfinding, and a character state machine (idle → walk → type/read). Everything is pixel-perfect at integer zoom levels.

## Tech Stack

- **Extension**: TypeScript, VS Code Webview API, esbuild
- **Webview**: React 19, TypeScript, Vite, Canvas 2D
- **Build**: Dual pipeline — esbuild for the Node.js extension host, Vite for the React webview

## Architecture

```
squad-pod/
├── src/                          # Extension host (Node.js)
│   ├── extension.ts              # Entry point
│   ├── SquadPodViewProvider.ts   # Main webview provider
│   ├── teamParser.ts             # Parses .squad/team.md roster
│   ├── squadWatcher.ts           # Watches .squad/ for activity
│   ├── agentManager.ts           # Name-based agent tracking
│   ├── assetLoader.ts            # PNG sprite loading
│   ├── layoutPersistence.ts      # Office layout save/load
│   ├── timerManager.ts           # Activity timeouts
│   ├── types.ts                  # TypeScript interfaces
│   └── constants.ts              # Config constants
├── webview-ui/                   # Webview (React)
│   └── src/
│       ├── App.tsx               # Main React app
│       ├── office/engine/        # Canvas game engine
│       ├── office/layout/        # Layout management
│       ├── office/editor/        # Layout editor
│       ├── office/sprites/       # Built-in character sprites
│       ├── components/           # React UI components
│       └── hooks/                # React hooks
├── dist/                         # Build output
│   ├── extension.js              # Bundled extension
│   └── webview/                  # Bundled webview
└── .squad/                       # Squad team config
```

## Known Limitations

- **Activity detection is heuristic** — Squad doesn't emit real-time status or tool events, so activity is inferred from file changes. Squad Pod can tell *who* is working but not *which tool* they are using, and session files carry no agent name. Characters may briefly show the wrong status, and "waiting for input" is rarely detectable.
- **Platform coverage** — CI runs unit tests and builds on Ubuntu and Windows. Manual testing has been done on Windows 11.
- **No premium tileset** — the built-in office uses basic sprites. For the full furniture catalog from Pixel Agents, you'd need the [Office Interior Tileset](https://retropi-art.itch.io/office) by Donarg and the import pipeline. Its license forbids redistribution (even edited) and requires credit, so imported tiles must stay local and must never be committed or packaged.

## Pixel Agents parity

Squad Pod tracks [Pixel Agents v1.5.0](https://github.com/pixel-agents-hq/pixel-agents/releases/tag/v1.5.0) (`b1bafd0`). Claude-specific pieces (hooks, JSONL transcripts, `claude` launch flags) are intentionally replaced by Squad's file-based model rather than ported. Progress is tracked in [#4](https://github.com/swigerb/squad-pod/issues/4).

| Area | Status |
|---|---|
| Activity/lifecycle from real Squad files, roster add/remove | ✅ |
| Reconnect snapshot, stable appearance, persisted seats with swap | ✅ |
| Sound on completion, Debug View, diagnostics output channel | ✅ |
| Editor: drag painting, one undo per gesture, safe import, atomic save | ✅ |
| Alt-drag copy, atomic catalog desk + PC/lamp moves and rotations | ✅ |
| Carpets, Areas and remaining editor parity | ⏳ [#7](https://github.com/swigerb/squad-pod/issues/7) |
| Directory launch drawer, pets, external asset directories | ⏳ [#7](https://github.com/swigerb/squad-pod/issues/7) |
| Standalone browser server, embedded terminal, mobile layout | ⏳ [#8](https://github.com/swigerb/squad-pod/issues/8) |
| Per-tool overlays and context gauges | ❌ Needs a Squad event API |

## Roadmap

- **Simpsons-themed sprites** — custom pixel art characters matching the casting universe 🍩
- **Real-time Squad events** — if Squad adds a status API or event stream, hook into it for instant updates
- **Multi-window sync** — coordinate the office view across multiple VS Code windows
- **Custom character skins** — let users assign custom sprites per agent
- **Team ceremonies visualization** — animate design reviews and retros as team gatherings

## Credits

Squad Pod is adapted from [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca) — a brilliant extension that inspired this project. Character sprites are based on the work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled code and asset licenses.

Built for use with [Squad](https://github.com/bradygaster/squad) by [Brady Gaster](https://github.com/bradygaster).

## License

This project is licensed under the [MIT License](LICENSE).
