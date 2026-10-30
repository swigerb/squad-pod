<img src="https://bradygaster.github.io/squad/assets/squad-logo.png" alt="Squad" width="100" align="left" style="margin-right: 12px;" />

# Squad Pod

**Local browser observer:** [Build/run and security instructions](standalone/README.md)
for the private, authenticated, loopback-only read-only office. It uses the same
production renderer, observes only an explicitly selected project, and has no
workspace writes. Optional owned terminals use separate authentication and
`copilot --agent squad`; observation stays read-only. This is separate from the VSIX.

**Your Squad AI team, but make it pixel art.**

Squad Pod is a VS Code extension that turns a [Squad](https://github.com/bradygaster/squad) agent team into animated characters in a virtual office.

## Features

- Discover the team roster and show each visible member as a character at a desk.
- Animate activity inferred from changes to Squad files.
- Show six built-in character identities with authored walk, typing, and reading poses.
- Opt in to live member tool labels and context gauges from local Copilot CLI sessions.
- View an agent's status, current task, recent activity, and charter.
- Design the office with floors, walls, furniture, colors, carpets, named Areas, and pets.
- Manage directories and explicitly launch Squad in a new VS Code terminal.
- Browse activity and available recorded usage in the Telemetry drawer.
- Add local furniture, pets, and character sheets; stateful furniture animates at active desks and supports manual toggles.

## Requirements

- VS Code 1.107 or later.
- A Squad project with a `.squad/team.md` roster. Legacy `.ai-team/team.md` projects are also supported.
- Node.js 22.13 or later to build from source.

## Install from source

```bash
git clone https://github.com/swigerb/squad-pod.git
cd squad-pod
npm run install:all
npm run build
```

Open the project in VS Code and press **F5** to launch the Extension Development Host.

### Development commands

| Command | Description |
|---|---|
| `npm run lint` | Lint the extension host |
| `npm run check-types` | Type-check the extension and webview |
| `npm run test:all` | Run extension and webview tests |
| `npm run build` | Build the extension and webview |
| `npm run verify` | Run lint, type checks, tests, builds, and provider smoke checks |
| `npm run package` | Build a VSIX package |

## Use Squad Pod

### Open the office

Open the **Squad Pod** panel, or run **Squad Pod: Show Panel** from the Command Palette. Team members are discovered from `.squad/team.md`; roster changes appear in the office. Click a character, its name (**Enter** or **Space** also works), or its occupied desk or chair to open the details card; select a character, then click another seat to move it. **View Charter** opens `charter.md`. These clicks never open a terminal.

### Edit the office

Choose **Layout** in the toolbar to edit the office:

- Paint all nine bundled floor styles and walls, adjust their colors, and place or color furniture. Floor 10 adds the remaining style; existing floors and empty tiles keep their meaning.
- Paint decorative carpets with a style and main/accent colors.
- Create named Areas, paint their tiles, and map launch directories to Areas to prefer those seats for observed agents. Turn the Area overlay on or off in Settings.
- Add or remove Claudio and Gitcat; pets wander around the office and react when clicked.
- Select and drag furniture to move it. Hold **Alt** when releasing to copy; press **R** to rotate. Ungrouped furniture rotates geometrically; grouped directional furniture cycles through available views. A desk moves or rotates with overlapping computers and lamps.
- Use **Undo** and **Redo** for editor changes. A paint stroke is one step.
- Export a layout or import a JSON layout from Settings. An import is a draft until you save it. If an incoming layout conflicts with an unsaved draft, review the versions and choose which one to keep before saving.
- To try the bundled starter, run **Squad Pod: Export Default Layout** and import the file from Settings. Your saved office is replaced only when you explicitly save the draft.

### Settings

The VS Code setting **`squad-pod.autoShowPanel`** focuses the panel once when the extension activates. It is off by default; changes apply the next time the extension activates. It does not launch Squad.

In the office's **Settings**, sound notifications play a short chime when an active agent becomes inactive; **Debug View** opens agent and layout diagnostics; and **Show Named Areas** toggles the Area overlay. You can also add or unload local asset directories and import or export layouts.

Enable **Live Activity** in Settings and accept the VS Code confirmation to turn on `squad-pod.liveActivity` (off by default). It reads local Copilot CLI session metadata and `events.jsonl` for the newest Squad session matching the observed workspace. Only exact roster members animate. Short task descriptions, tool names, file basenames, command names and context counts are used; prompts, other arguments and outputs are never displayed or stored. Turning it off stops reading and clears live displays. Settings shows whether the source is off, searching, following or unavailable.

**Telemetry → Observed transient tasks** lists task calls from that same consented session, separately from recorded usage. Names, types, modes and bounded descriptions are display metadata, not identities or durable membership. Only explicit same-session parent calls are linked; missing or cyclic parents are unknown. Unknown, ambiguous and non-general-purpose calls stay unattributed and never create office members. The in-memory list retains at most 64 tasks (16 recent completions), flags omitted data/shortened fields, and restores only in-flight calls on startup. Switching sessions, stale/lost sources and disabling Live Activity clear the list.

### Launch Squad in a directory

Open **Directories** to launch Squad in a workspace folder or a saved directory. Squad Pod opens a new VS Code terminal at that folder and runs `copilot --agent squad` only after you click **Launch**. Workspace trust and the Copilot CLI on `PATH` are required. Squad Pod does not launch automatically.

**Recent Squad directories** fills the add-directory form from local Copilot CLI working-directory metadata without saving or launching; disable this read with `squad-pod.directorySuggestions`.

### Activity and recorded usage

Open **Telemetry** in the toolbar to browse observed status changes, session activity, logs, orchestration events, and decisions. The drawer also displays historical usage from the local Squad usage ledger when available, including reported token and estimated-cost totals and recent model reports. These reports are historical source data, not live context utilization or billing records.

## Activity detection

Squad Pod watches the selected project's `.squad/` files, including the roster, sessions, logs, orchestration logs, decision inbox, and agent files. It uses filesystem notifications with polling as a fallback and treats the initial scan as a baseline rather than replaying old files.

## Known limitations

- File-observed activity is approximate. Opt-in live activity uses an undocumented, best-effort Copilot CLI session format, not a supported Squad event API. Unmatched members remain unattributed; stale or missing sessions fall back to file observations. Bounded scans may miss older in-flight members. Context gauges appear only when a live member's tool completion includes context metrics.
- Directory launches do not switch the office's observed project.

## Acceptance testing

Use the [native VS Code and real Squad acceptance plan](docs/native-acceptance.md) for a Scout-ready, approval-gated test handoff.

## Custom assets

Add a local asset directory in **Settings** for furniture, pets, and character sheets. Folder layouts, supported images, reload behavior, and import limits are described in [Custom asset manifests](docs/custom-assets.md).

## Architecture

- `src/` is the VS Code extension host. It discovers agents, watches Squad files, loads assets, and manages settings and layout persistence.
- `webview-ui/src/` is the React webview. It renders the office and provides the editor, character details, directories, and telemetry.
- The extension host and webview communicate through typed messages.

## Compared with Pixel Agents

**Supported:** Squad roster discovery, file-observed activity, opt-in live tool labels and context gauges, the animated office, layout editing, directional furniture groups, pets, local furniture assets, and explicit Squad CLI launches.

**Not yet supported:** a supported Squad event API, general browser office mutations,
remote access, and full mobile terminal parity.

## How we built this

Squad Pod began with the question, *What if [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) worked with Squad?* A Simpsons-themed Squad team helped build the extension:

| Agent | Role | Contribution |
|---|---|---|
| Homer Simpson | Lead | Architecture and code review |
| Lisa Simpson | Core developer | Extension host |
| Bart Simpson | Frontend developer | Webview and office |
| Marge Simpson | Tester | Tests and edge cases |
| Ned Flanders | DevRel | Documentation |
| Scribe | Session logger | Decisions and session notes |

The original [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca) watches Claude Code transcripts. Squad Pod adapts its virtual-office idea to Squad's team roster and files.

## Roadmap

- Adopt a supported Squad event API when available.
- Visualize team ceremonies in the office.

## Credits

Squad Pod is adapted from [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca). Character art is based on the work of [JIK-A-4](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack). Built for [Squad](https://github.com/bradygaster/squad) by [Brady Gaster](https://github.com/bradygaster). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for licenses and attribution.

## License

This project is licensed under the [MIT License](LICENSE).
