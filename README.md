# Squad Pod — Pixel art office for your Squad AI team

Welcome, neighbor! Squad Pod brings your Squad AI team to life in a cozy pixel art office right in VS Code. Each team member becomes an animated character that walks around, sits at desks, and visually reflects what the agent is doing. Watch your team collaborate in real-time.

## Features

- **Auto-discovers team from `.squad/team.md` roster** — Characters appear automatically as soon as you open the extension
- **One character per Squad agent** — Auto-populated on startup, no manual setup needed
- **Live activity tracking** — Monitors Squad sessions and logs to show what each agent is doing
- **Office layout editor** — Design your office with floors, walls, and furniture to match your team's vibe
- **Speech bubbles** — Agents get attention-grabbing bubbles when they need you
- **Sound notifications** (optional) — Optional audio cues to keep you in the loop
- **Persistent layouts** — Your custom office design is shared across all VS Code windows
- **6 diverse pixel art characters** — Choose from a variety of unique animated characters

## Requirements

- **VS Code 1.107.0 or later**
- **A Squad-powered project** — Your project must have a `.squad/` directory with team orchestration data
- **Squad** — Built to integrate with [Squad](https://github.com/bradygaster/squad) by Brady Gaster

## Getting Started

### Install from Source

```bash
# Clone the repository
git clone https://github.com/YOUR_ORG/squad-pod.git
cd squad-pod

# Install extension dependencies
npm install

# Install webview dependencies
cd webview-ui
npm install
cd ..

# Build the project
npm run build

# Launch the extension in VS Code
# Press F5 in VS Code or use Debug > Start Debugging
```

Once the extension is running, open the Squad Pod panel in VS Code. If your project has a `.squad/team.md` file, your team will appear automatically. Click around, resize, and place characters to build your office!

## How It Works

Squad Pod watches your project's `.squad/` directory for:
- **`team.md`** — Your team roster and agent definitions
- **Session logs** — Real-time activity from Squad orchestration
- **Team state** — Which agents are active, idle, or busy

Characters animate based on detected activity—when an agent starts a session, your office comes alive. When they're thinking, they pace. When they're waiting, they sit. It's all driven by what Squad is actually doing.

## Tech Stack

**Extension:**
- TypeScript with strict type checking
- VS Code Webview API for seamless panel integration
- esbuild for fast, bundled builds

**Webview:**
- React 19 with hooks for reactive UI
- TypeScript for type safety
- Vite for lightning-fast dev bundling
- Canvas 2D for smooth pixel art animation

## Credits

Squad Pod is lovingly adapted from [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by Pablo De Lucca, enhanced for use with [Squad](https://github.com/bradygaster/squad) by Brady Gaster.

## License

MIT — See LICENSE file for details

---

**Screenshot coming soon!**

Need help? Check out the [Squad documentation](https://github.com/bradygaster/squad) or open an issue on GitHub. Happy squad building! 🎨✨
