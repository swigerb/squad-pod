<img src="https://bradygaster.github.io/squad/assets/squad-logo.png" alt="Squad" width="100" align="left" style="margin-right: 12px;" />

# Squad Pod

**Your Squad AI team, but make it pixel art.**

A VS Code extension that turns your [Squad](https://github.com/bradygaster/squad) agent team into animated pixel art characters in a virtual office. Homer reviews architecture. Lisa writes TypeScript. Bart animates the canvas. Marge catches every edge case. Ned writes the docs with a smile.

Each agent on your Squad roster gets their own character that walks around, sits at desks, and visually reflects what the agent is doing — typing when writing code, reading when searching files, waiting when it needs your attention.

> Built in one session by a Simpsons-themed Squad team, because of course it was.

![Squad Pod in action — pixel art office with Squad agents at their desks](Screenshot.jpg)

## Features

- **Team auto-discovery** — reads your `.squad/team.md` roster and spawns a character for every agent, no setup needed
- **One agent, one character** — Homer gets a desk, Lisa gets a desk, everyone gets a desk
- **Live activity tracking** — watches `.squad/sessions/`, `.squad/log/`, and `.squad/orchestration-log/` to animate characters based on real agent activity
- **Office layout editor** — design your office with floors, walls, and furniture using the built-in editor
- **Speech bubbles** — visual indicators when an agent needs your attention
- **Sound notifications** — optional chime when an agent finishes (turn it off if you're in a meeting)
- **Persistent layouts** — your office design is saved and shared across VS Code windows
- **6 diverse characters** — built-in pixel art character sprites, no external assets required
- **Desk-as-directory** — click any occupied desk to see the agent's charter summary, current task, and recent activity

## How We Built This

This project started as a question: *"What if [Pixel Agents](https://github.com/pablodelucca/pixel-agents) worked with [Squad](https://github.com/bradygaster/squad)?"*

We used Squad itself to build it. The team was cast from The Simpsons universe:

| Agent | Role | What They Did |
|-------|------|---------------|
| 🏗️ **Homer Simpson** | Lead | Architecture decisions, code review, keeping it simple |
| 🔧 **Lisa Simpson** | Core Dev | All 10 extension host TypeScript files — types, parsers, watchers, providers |
| ⚛️ **Bart Simpson** | Frontend Dev | All 37 webview files — Canvas engine, React components, pixel art rendering |
| 🧪 **Marge Simpson** | Tester | Test coverage, edge case discovery, build verification |
| 📝 **Ned Flanders** | DevRel | This README, documentation, developer guides |
| 📋 **Scribe** | Session Logger | Decision tracking, orchestration logs, cross-agent context |

The original [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca) watches Claude Code's JSONL transcript files. Squad Pod replaces that entire integration layer with Squad-native file watching — reading the `.squad/` directory structure for team rosters, session data, and orchestration logs.

**What stayed the same:** The pixel art engine, Canvas 2D rendering, BFS pathfinding, character state machine, office layout editor, and the general "cozy virtual office" vibe.

**What changed:** Everything about how agents are discovered, tracked, and animated. Instead of JSONL transcripts → we parse `team.md` tables. Instead of terminal-per-agent → agents are pre-populated from the roster. Instead of `~/.claude/projects/` → we watch `.squad/sessions/`.

## Requirements

- VS Code 1.107.0 or later
- A [Squad](https://github.com/bradygaster/squad)-powered project (needs a `.squad/` directory with `team.md`)

## Getting Started

### Install from source

```bash
git clone https://github.com/swigerb/squad-pod.git
cd squad-pod
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Usage

1. Open the **Squad Pod** panel (it appears in the bottom panel area alongside your terminal)
2. Your Squad team members appear automatically from `.squad/team.md`
3. Watch the characters walk to their desks and start working
4. Click a character to select it, click a seat to reassign it
5. Click **Layout** to open the office editor and customize your space

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — Share layouts as JSON files via the Settings modal

The grid is expandable up to 64×64 tiles. The default layout is a 20×11 office with 6 desk/chair pairs — enough for a solid Squad team.

## How It Works

Squad Pod watches your project's `.squad/` directory:

```
.squad/
├── team.md              → Who's on the team (roster discovery)
├── sessions/*.json      → Active sessions (who's working now)
├── log/*.md             → Completed work (what happened)
├── orchestration-log/   → Live orchestration (who's doing what)
└── agents/*/charter.md  → Agent identity and role for display
```

Characters animate based on detected activity. When a session file updates, the corresponding character starts typing. When things go quiet, they sit idle. When something needs attention, they get a speech bubble. No modifications to Squad are needed — it's purely observational.

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

- **Activity detection is heuristic** — Squad doesn't emit real-time status events, so agent activity is inferred from file modification times and content changes. Characters may briefly show the wrong status.
- **Windows-only testing** — developed and tested on Windows 11. May work on macOS/Linux but file watching behavior could differ.
- **No premium tileset** — the built-in office uses basic sprites. For the full furniture catalog from Pixel Agents, you'd need the [Office Interior Tileset](https://donarg.itch.io/officetileset) by Donarg ($2 USD) and the import pipeline.

## Roadmap

- **Simpsons-themed sprites** — custom pixel art characters matching the casting universe 🍩
- **Real-time Squad events** — if Squad adds a status API or event stream, hook into it for instant updates
- **Multi-window sync** — coordinate the office view across multiple VS Code windows
- **Custom character skins** — let users assign custom sprites per agent
- **Team ceremonies visualization** — animate design reviews and retros as team gatherings

## Credits

Squad Pod is adapted from [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca) — a brilliant extension that inspired this project. Character sprites are based on the work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

Built for use with [Squad](https://github.com/bradygaster/squad) by [Brady Gaster](https://github.com/bradygaster).

## License

This project is licensed under the [MIT License](LICENSE).
