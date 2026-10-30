<img src="https://bradygaster.github.io/squad/assets/squad-logo.png" alt="Squad" width="100" align="left" style="margin-right: 12px;" />

# Squad Pod

**Your Squad AI team, but make it pixel art.**

A VS Code extension that turns your [Squad](https://github.com/bradygaster/squad) agent team into animated pixel art characters in a virtual office. Homer reviews architecture. Lisa writes TypeScript. Bart animates the canvas. Marge catches every edge case. Ned writes the docs with a smile.

Each visible agent on your Squad roster gets their own character that walks around and sits at desks. Squad file changes drive activity animations; they do not establish which tool is running, context usage, or authoritative task completion.

> Built in one session by a Simpsons-themed Squad team, because of course it was.

The historical office screenshot is omitted: it predates the verified redistributable asset bundle.

## Features

- **Team auto-discovery** — reads your `.squad/team.md` roster (or a legacy `.ai-team/team.md`) and spawns a character for every agent, no setup needed. In multi-root workspaces it picks the folder that contains Squad.
- **One agent, one character** — Homer gets a desk, Lisa gets a desk, everyone gets a desk. Adding or removing roster members updates the office live.
- **Live activity tracking** — watches Squad's sessions, logs, orchestration log, decision inbox, and per-agent folders to animate the right character when real work happens (see [File Watching & Activity Detection](#file-watching--activity-detection))
- **Stable look and seats** — each member keeps the same appearance and desk across reloads; reopening the panel restores the whole office without duplicating anyone
- **Telemetry feed** — click the 📡 button to open a live stream of all Squad agent activity — status changes, sessions, logs, orchestration events, color-coded by type, timestamps, and agent names
- **Recorded usage / model history** — the same telemetry drawer passively reads a bounded local Squad usage ledger, with freshness, coverage and explicit partial/unavailable states; historical reports never drive activity or chimes.
- **Office layout editor** — design your office with floors, walls, furniture and named Areas using the built-in editor
- **Decorative carpets** — three auto-tiling styles with independent main/accent colors, painted over floors without changing floor IDs or agent walkability.
- **Animated pets** — add or remove Claudio and Gitcat in the Layout editor; pets wander, follow nearby agents, and show a timed heart when clicked. Pet IDs/types survive save, reload, import and export; asset type numbers stay stable when another pet sheet fails to load.
- **Manifest furniture and live imports** — verified original Pixel Agents furniture/floors/walls; Settings can load local furniture manifests and pick up edits without restarting VS Code.
- **Explicit directory launches** — manage named directories and open `copilot --agent squad` in a new terminal at the selected working directory; no automatic launch.
- **Speech bubbles** — visual indicators when an agent needs your attention
- **Sound notifications** — optional chime when a file-observed active member returns to idle (not proof of task completion; turn it off in Settings if you're in a meeting)
- **Persistent layouts** — your office design is saved and shared across VS Code windows
- **6 distinct characters** — two bundled character sheets, color-shifted into six looks (more members cycle through further hue shifts), no external assets required
- **Desk-as-directory** — click any occupied desk to see the agent's charter summary, current task, and recent activity
- **Settings and diagnostics** — sound and Debug View persist in VS Code global storage across webview reloads; Debug View defaults off and gates the canvas asset strip. Settings shows the host-reported team file and file-observer status.

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
| `npm run package` | Build `squad-pod-<version>.vsix` and verify shipped pet manifests against their committed Git blobs |
| `npm run test:smoke:pets-provider` | Verify the compiled provider and production bundle markers through a mocked VS Code boundary (does not execute the webview UI) |
| `npm run serve:acceptance:pets` | Serve the production webview with asset/layout snapshots from the compiled provider through a mocked boundary for browser interaction (not a native VS Code host) |

### Development dependency advisories

Audit both dependency roots separately with `npm audit` and
`npm audit --prefix webview-ui`, using your configured registry. For maintenance,
prefer targeted, compatible lockfile updates and verify the installed ancestry
with `npm ls` / `npm explain`; do not force incompatible transitive majors to
silence an advisory. Keep the tileset tools and their `@anthropic-ai/sdk`
dependency: `scripts/3-vision-inspect.ts` still uses it.

The 2026-10-29 refresh ([#21](https://github.com/swigerb/squad-pod/issues/21))
updated only the root lockfile:

| Development dependency path | Locked version |
|---|---|
| `eslint` → `@humanfs/node` | 0.16.8 (requires `@humanfs/core` 0.19.2 and `@humanfs/types` 0.15.0) |
| `npm-run-all` → `minimatch` → `brace-expansion` | 1.1.21 |
| `npm-run-all` → `shell-quote` | 1.12.0 |

The prior audit had reduced the root report from five affected package entries
(one critical, three high, one moderate) to two high Azure Identity/MSAL entries;
it reported zero webview findings. This follow-up resolves the remaining entries
with a compatible lockfile refresh: `@vscode/vsce` 4.1.0
declares `@azure/identity ^4.13.2`, and
[@azure/identity 4.14.1](https://github.com/Azure/azure-sdk-for-js/releases/tag/%40azure%2Fidentity_4.14.1)
(release commit `56472b9a9bcfb3b2d98a049332ebe77af2918663`) declares
`@azure/msal-node ^7.1.0`; the lock satisfies those ranges with MSAL Node 7.1.2
and `@azure/msal-common` 16.15.0. The linked
[GHSA-xcx6-jx8p-x3h5](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5) affects
MSAL Node `>=5.0.0-beta.0 <7.1.0`. Fresh audits reported **zero vulnerabilities**
for the full root dependency tree, the root production-only tree (`--omit=dev`),
and the separate webview dependency tree.

These were development-tool advisory classifications, not a demonstrated
application exploit. The package command uses `--no-dependencies`; audit results
do not establish exploitability, and a zero-finding audit is not proof of exploit
freedom. No publishing or release operation is needed to validate a local VSIX.

### Usage

1. Open the **Squad Pod** panel (it appears in the bottom panel area alongside your terminal)
2. Your Squad team members appear automatically from `.squad/team.md`
3. Watch the characters walk to their desks and start working
4. Click a character to select it, then click another desk to move it there (an occupant is swapped into the old seat). Seat choices are saved.
5. Click **Layout** to open the office editor and customize your space
6. Open **Settings** for sound, layout export/import, and the Debug View
7. Open **Directories** to launch Squad in an open workspace folder or a saved directory

### Panel activation preference

In VS Code Settings, enable **Squad Pod: Auto Show Panel**
(`squad-pod.autoShowPanel`) to focus the office once when the extension activates.
It defaults to `false`; changes apply on the next extension activation.
This preference does not itself activate the extension at startup and never
launches Squad, a terminal, a process, server or bridge. Roster replay, recorded
usage, activity observations and panel reload/visibility changes do not trigger
auto-show. An already-visible office is not focused again.
Explicit **Show Panel** and directory-launch actions remain available.

While editing, zoom buttons occupy a separate top strip above the tool palette.
The palette fits narrow panels and scrolls vertically to reach its options and
Save/Undo actions. Outside edit mode, zoom buttons keep their vertical top-left
placement. This rearranges controls only: the canvas viewport and zoom/pan
anchors do not move, and switching tools or leaving/reopening the editor keeps
the current draft and undo history.
The bottom toolbar scrolls horizontally when its buttons do not fit, keeping
Directories, Settings and the editor toggle reachable without shifting the canvas.

For the control hit-target regression, build production assets, run
`npm run serve:acceptance:pets`, then run `node scripts/acceptance-controls.cjs`
in another terminal. It uses an **existing** Playwright installation
(`PLAYWRIGHT_MODULE` can name its module path) and installed Microsoft Edge;
it never downloads either. Optional `ACCEPTANCE_OUTPUT_DIR` writes JSON hit
stacks and screenshots, and `ACCEPTANCE_URL` overrides the fixture URL.
The check uses `elementsFromPoint` and normal, unforced clicks on zoom and
every editor tool (including Area, Carpet and Select after Pets) at 1280×900,
640×900, 360×640, 320×640, 240×480 and 320×240, including editor scrolling,
draft save/undo/redo, Area naming/mapping text-key isolation, stable selected-root
identity and explicit directory-launch request compatibility. The provider
smoke also feeds the compiled provider snapshot into the real seat allocator to
check canonical saved-path aliases, workspace mappings, and unrelated/recent ID
exclusion.
It supplies Dark+ theme variables normally supplied by VS Code. This is a
production-browser fixture with a mocked host boundary, **not** native VS Code
or installed-VSIX acceptance; no terminal/CLI launch is executed.

### Client transport foundation

The webview now sends requests, receives host messages and reads/writes protected
layout recovery state through one typed client boundary. Its production adapter
uses the existing VS Code webview API; a missing or failing host and recovery
state-read failures are shown explicitly, and failed recovery writes remain
visible without discarding the live draft. This is only a prerequisite for
future host adapters: standalone/browser transport and controls are not
available outside the supported VS Code host.

The remaining [#8](https://github.com/swigerb/squad-pod/issues/8) gates include
authenticated host/origin and WebSocket mutation authorization with token
rotation; a supported launch/lifecycle producer; separate office and terminal
channels; replay/reconnect without duplicate processes; owned shutdown,
external dismissal and no-terminal behavior; mobile keyboard, gesture,
clipboard and link behavior with the desktop editor hidden; a Windows-native
PTY; and installed-artifact checks with an isolated home and spaced paths.
Browser fixtures and adapters do not establish native-host or real-process
support.

### Source status and missing-team setup

Settings reports whether `team.md` exists in the selected Squad directory and whether the file observer is running (native watch plus polling, or polling alone). Native-watch errors are shown with the polling fallback; EventBus / WebSocket is **not connected** because no producer is wired. These are file-observation hints, **not authoritative lifecycle, tool or context events**. The idle timeout is not proof that a task finished.

### Recorded usage and capability limits

The **Telemetry** drawer also shows historical version-1 records from
`log/usage.jsonl` under the resolved `.squad` / legacy `.ai-team` directory.
It refreshes every two seconds and on panel reload, independently of live
activity. It shows reported input/output event sums and estimated cost (producer
units), distinct-turn-ID coverage against recorded turn-start records (matching
the pinned `squad cost` consumer), last valid record / usage timestamps, and the
40 newest reports with their reported model. Expand **Recorded usage / model
history** inside the drawer; it defaults collapsed so the activity feed remains
accessible. Additional source diagnostics and report history expand separately.
Scope is all valid complete local records, without agent/time filtering or the
CLI's default latest-Markdown-log cutoff. Coverage is only for this ledger, not
proof that every runtime turn was observed; it follows the source's turn-ID
identity assumption rather than introducing a session/turn composite key.
Repeated usage events are counted as reported, not silently deduplicated.
Roster name/slug matches are exact apart from case/outer whitespace; unknown or
ambiguous names stay unattributed. They never create or promote characters.

Missing or unreadable sources, empty ledgers and turn starts without usage do
**not** become zero totals. Invalid fields and unsupported versions/kinds are
counted; partial sums explicitly include only valid complete records. An
unterminated final line is held pending until its newline arrives, even if its
JSON is already parseable. Rewrites, truncation and deletion replace the prior
snapshot instead of accumulating stale totals. Files over 2 MiB or 10,000 complete
lines are rejected without totals; per-record strings and numeric sums are bounded.
Roster matching is disabled above 1,000 members rather than ignoring potential
collisions outside a slice. Nothing writes to the ledger.

The source contract is pinned to [Squad v1.1.0's ledger schema and producer](https://github.com/bradygaster/squad/blob/c24da2aad2ab7576f6b68dec2bc50b2fe2dc7a8a/packages/squad-sdk/src/runtime/usage-ledger.ts)
and its [cost consumer](https://github.com/bradygaster/squad/blob/c24da2aad2ab7576f6b68dec2bc50b2fe2dc7a8a/packages/squad-cli/src/cli/commands/cost.ts).
The deprecated interactive shell automatically persists usage when events arrive
and writes succeed, but recommended `copilot --agent squad`, VS Code and App paths
do not guarantee this producer; nonlocal state backends need not materialize a
local file. **Do not start the deprecated shell to populate this view.** Its
normalization may substitute zero / unknown for missing values, so these are
reported historical values, not billing-grade accounting, measured-zero proof
or evidence of the currently selected model.

**Live context utilization and parent-child hierarchy / roster promotion remain
unavailable.** Token sums are not context occupancy or context-window percentages.
Exact context requires an actually connected runtime `context:utilization` colon
bus; the opt-in bridge is not automatic and supplies neither replay nor workspace
identity. No bridge is started here. Charters, UI focus, directory launches and
persistence flags do not establish hierarchy or membership.

For recorded-usage evidence, build, run
`node scripts/acceptance-pets.cjs --serve --usage`, then
`node scripts/acceptance-usage.cjs` in another terminal. For UI controls, start
`node scripts/acceptance-pets.cjs --serve` and run
`node scripts/acceptance-controls.cjs` in another terminal. Use existing
Playwright via `PLAYWRIGHT_MODULE` and installed Microsoft Edge (no downloads);
`ACCEPTANCE_OUTPUT_DIR` writes screenshots and a JSON report. The fixture
obtains real snapshots from the compiled provider and exercises the production
webview at 1280, 360 and 240 pixel widths. The controls check verifies single
API acquisition and the dirty-conflict/local-resolution/save-acknowledgement
path through the mocked adapter. These are **mocked VS Code boundary** checks,
not native-host or real-Squad-session acceptance, and never launch a terminal/CLI.

### Missing-team and directory behavior

If no team file exists, the office shows setup guidance: open the correct project folder or follow [Squad's setup instructions](https://github.com/bradygaster/squad#readme) and initialize a team yourself. The observer detects a newly created roster without a reload. Saved layouts, seats and hidden-member rules are unchanged.

Automatic launch on startup or panel refocus is **off**. Directory launches are available only after an explicit click in **Directories**; Squad Pod opens a new VS Code terminal with `copilot --agent squad` and the selected folder as its working directory. VS Code workspace trust is required, the Copilot CLI must be on `PATH`, and normal terminal/Copilot permission prompts are preserved. Removing a saved directory does not close a terminal that was already launched.

The directory picker lists current workspace folders, user-saved named directories and recent launch requests recorded by Squad Pod when it submits the command. A record is not proof that the CLI started. **Squad history suggestions are unavailable**: current Squad session JSON contains conversation envelopes, not a supported directory launch-history source, so Squad Pod does not infer a directory from it. These app-owned records are not presented as Squad history. Saved-directory IDs remain stable across name and path edits; workspace mapping IDs use the workspace-folder URI. Recent launch records are not mapping choices, and mappings to unavailable directories are retained rather than reassigned. Tool activity and context gauges are likewise not offered as working integrations without supported producers. Sound, Debug View and Show Named Areas are persistent preferences in this slice; transient editor/drawer state is unchanged. This is a partial [#7](https://github.com/swigerb/squad-pod/issues/7) implementation, not full upstream parity. The office observes agents only from its selected Squad root; explicitly launching another directory does not attach its roster or start another observer. VS Code Development Host/installed-VSIX behavior still needs host verification; browser fixtures and unit tests do not establish that.

Pending folder/name dialogs revalidate the latest catalog before saving, preserving intervening renames and removals and checking current duplicates and capacity. Layout keyboard shortcuts are suspended while the directory picker is open so editing a name cannot delete, rotate or undo office furniture. Regression tests exercise the compiled provider with delayed mock VS Code dialogs and the App with selected furniture and a focused name field; these are not native-host observations.

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Named Areas** — define labeled/colorized Areas, paint or erase membership on floor tiles, and Shift-click a painted tile with the Eyedrop tool to select its Area; ordinary Eyedrop continues sampling carpet/floor. Areas are optional layout data: legacy layouts keep their original JSON shape until an Area is edited. The Show Named Areas preference controls the canvas overlay. Map a directory to one or more Areas to prefer seats in those Areas for its currently observed agents; if mapped seats are full, allocation falls back to free seats outside Areas and then any free seat. Existing manual/persisted seats remain preferred. Selected-root workspace IDs and canonically matching saved-directory IDs are combined in a deterministic order; unrelated saved paths and recent launch IDs do not affect allocation. Launching a directory does not make its roster observable.
- **Carpets** — choose one of three pinned styles and adjust Main/Accent hue, saturation and brightness. Left-drag paints on existing floors (including beneath furniture); right-drag removes only carpet. Eyedrop copies the style and both colors. The generic Erase tool removes carpet first when present, preserving the underlying floor and furniture.
- **Pets** — use the Pets tool to add/remove the pinned Claudio and Gitcat companions. They wander across walkable tiles, sometimes follow nearby agents, and respond to a click with a heart. Each placement's `id` and stable manifest `petType` are saved; older layouts behave as having no pets without rewriting the legacy JSON shape.
- **Tools** — Select, paint, erase, place, eyedropper. Floor, wall, and erase tools paint continuously while you drag.
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y. Each drag (a paint stroke or a furniture move) is a single undo step.
- **Furniture moves and copies** — Select, then drag to move; hold **Alt when releasing** to copy. Desks carry their overlapping PCs and lamps; grabbing a PC or lamp moves just that object. Copies have fresh IDs and preserve the source's color (including no color), independently of the palette's Colorize setting.
- **Atomic groups** — green/red outlines preview the entire group; only the final drop commits. Moves, copies, and **R** rotations reject the whole group if any member collides, leaves the grid, or lands on walls/void. A rejected operation shows an error and does not change the layout or undo history. Leaving the canvas or losing window focus cancels a furniture drag.
- **Group rotation** — select a desk and press **R** (or Rotate) to turn the desk and its PCs/lamps together. Each move, copy, or rotation is one undo step; redo restores all members with the same IDs. Groups are inferred from overlapping catalog surfaces, not new saved group fields; existing layout files need no migration.
- **Export/Import** — share layouts as JSON files via the Settings modal. Imports are validated first; an invalid file shows an error and leaves your saved layout untouched.

The grid is expandable up to 64×64 tiles. A new host-created office is 20×15 with four verified desk/chair pairs. Existing offices are never reset to this default.

Layouts without `tileColors` (including imports and external updates) still draw
floors and walls. Missing per-tile entries use warm floor and dark wall rendering
defaults; existing colors are unchanged. These fallbacks are display-only:
opening a layout does not dirty the draft, alter its revision, or add synthesized
colors to the saved JSON.

Areas are optional `areas` definitions (`{label, color}`) with floor-only
membership in an `areaTiles` array parallel to `tiles`; directory preferences
are stored separately in `areaMappings` by directory ID. Adding, removing,
renaming, recoloring, mapping, painting and erasing Areas are editor
transactions, so undo/redo and protected drafts include them. Missing Area
fields remain missing until an Area edit; validation, import/export, save
acknowledgements and recovery preserve the optional shape and unknown metadata.

Carpets are an optional `carpetTiles` array parallel to `tiles` (`null` means no
carpet). Each cell stores `variant` (0–2), optional `color`, `accentColor` and
overlap `order`. Carpet strokes/right-erase are one undo step; resizing in any
direction, saving, reloading and JSON export/import retain these fields.
Existing layouts without carpets are not filled with empty carpet data or
reset. Walls/void cannot be carpet-painted; changing a floor to wall/void removes
its carpet within the same undo transaction. Carpet artwork reloads do not save
or reset the office. Area name and directory mapping controls keep native text
editing/undo local and do not send Delete, rotate or office-undo shortcuts to
the canvas while focused. Areas are a bounded partial parity slice; tool and
context history and other unsupported upstream behavior remain separate work
under #7/#4.

Carpet rendering caches masked junctions and palettes until the tile map,
carpet array, dimensions or artwork generation changes. Frames draw only the
visible region plus edge junctions, without rescanning off-screen cells.
Opaque sheets use one cropped composite (at most 1040x1040 pixels, about
4.13 MiB RGBA per canvas). Translucent art, fractional device-pixel scales or
fractional device-pixel offsets (including the context translation),
larger maps or unavailable detached contexts use cached, viewport-culled
direct draws instead. Previous composites are released on layout changes;
unmounted contexts are weakly held. The first frame after an edit rebuilds
derived rendering data; no cache is written to layouts or recovery snapshots.
Fractional offsets keep individual sprite edges because GPU rasterization can
antialias those edges against the floor; merging them would change seam pixels.

### Unsaved layouts and incoming conflicts

Dirty state compares the **actual layout contents**, including metadata, not
whether the editor happens to be open. File reloads and saves from another
window use the same incoming-snapshot path. A clean external snapshot applies
normally. **Import stages a draft; it does not write the workspace file until
you click Save.** Settings' ordinary Export exports the saved office; the
recovery panel's Export buttons export the exact displayed draft/snapshot.

If an incoming layout differs from an unsaved draft, **Layout conflict** keeps
the current canvas and queues the complete incoming snapshot. Multiple distinct
snapshots remain individually inspectable; resolving one does not ignore later
changes from that source. Save and Reset are blocked while snapshots remain.
For each pending snapshot:

- **Keep local draft** keeps editing locally and retains the incoming JSON in
  recovery copies. It does not write anything to disk.
- **Use incoming... → Confirm incoming** replaces the working canvas only after
  confirmation and retains the previous local draft in recovery copies. Other
  pending snapshots still need a decision.
- Expand the inspection sections and **Export** either version to a chosen
  JSON file, including retained copies after resolution/save.

Save clears dirty state only after the host acknowledges the actual written
layout. Edits made while a save is in flight remain dirty. A stale disk revision
rejects the save and returns the newer snapshot for resolution instead of
overwriting it. Cooperating Squad Pod windows use an exclusive
`.squad-pod/layout.json.lock` during check/write. Every successful replacement
also preserves the previous raw file in `.squad-pod/recovery/<unique-id>.json`;
these saved-file backups are never automatically pruned. A failed/interrupted
writer may leave a lock: verify no writer is active before manually removing
that specific lock. Malformed files are reported and not overwritten. Legacy
colors, unknown asset IDs, dimensions, roles, positions and extra JSON metadata
are preserved, not reset/remapped. Workspace changes block saving an original
draft into the new workspace; export copies and return to the original folder.

**Recovery boundaries:** after each rendered editor action and snapshot decision,
the complete draft, baseline, incoming queue and retained copies are serialized
with VS Code's per-webview `setState`. They recover when VS Code recreates the
same view and supplies that state (tested with a simulated panel recreation).
Undo history, current tool and in-progress uncommitted drag previews are not
serialized. This is **not** a durable unsaved-draft file or cross-window draft
sync: closing/removing the view, changing workspace, clearing state, a hard
crash before persistence, or a VS Code lifecycle that does not return the state
can lose these recovery copies. Export before closing/restarting; disk backups
contain previously saved layouts, not unsaved drafts. Reported state-write
failures leave the live versions available for export. The filesystem lock is
advisory: unrelated tools that ignore it are not transactionally serialized with
the final rename. Concurrent arbitrary filesystem writers and storage-provider
failures cannot be promised lossless by this mechanism.

Evidence for this slice is automated DOM/host-message simulation plus real
temporary-file import parsing, watcher, revision-checked save and backup tests.
The save regression also runs independent Node hosts against the production
helper with a deterministic pre-rename barrier: the second writer is rejected
under the shared lock, and its later stale retry cannot replace the winning file.
The regression imports a 20×15 office, expands locally to width 21, receives
four legacy items from disk, then checks exact JSON through both resolutions,
save and panel recovery. These are **not live VS Code Development Host or
installed-VSIX observations**; that manual host proof remains outstanding.

**Editor integration contract:** incoming layouts must enter through
`useEditorActions.receiveLayout`, never directly rebuild the office or assign a
saved-baseline ref. Editor mutations must advance `editorTick` so recovery captures
their actual contents. The host `layoutLoaded` envelope carries `source`
(`external`/`import`), raw-file `revision`, and `workspaceRoot`; `saveLayout`
must echo the observed `expectedRevision` and original `workspaceRoot`. Only
`layoutSaved` acknowledges a successful disk write; `layoutError` leaves the
draft available. New layout metadata must round-trip untouched through snapshots,
validation, editor transforms and saves. No caller should bypass
`saveLayoutIfUnchanged` for a user save or write imports before resolution.

## Office assets and local manifests

Bundled originals are pinned to Pixel Agents `b1bafd02896d90d83457266575a1e8e5011ce997`.
Furniture/floor/wall provenance is the explicit original/open-source asset replacement in
[pixel-agents-hq/pixel-agents#117](https://github.com/pixel-agents-hq/pixel-agents/pull/117),
merged as `3ebb247a8138b2608bf291997562f2854929894b`.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for verification and MIT attribution.
The three carpet sheets have a separately verified contribution trail through
[pixel-agents-hq/pixel-agents#316](https://github.com/pixel-agents-hq/pixel-agents/pull/316);
they are not part of PR117. Exact source blobs and the combined 76-file checksum
are recorded in `assets/pixel-agents-source.json`.
The old unprovenanced office PNG and metadata are removed; they are not a fallback.

**Settings → Add Asset Directory** opens a native folder picker. Select a local directory
containing item subfolders, each with a `manifest.json` and sibling PNGs:

```text
my-furniture/
  SAMPLE/
    manifest.json
    SAMPLE.png
```

```json
{
  "id": "SAMPLE",
  "name": "My licensed local furniture",
  "category": "decor",
  "type": "asset",
  "file": "SAMPLE.png",
  "width": 16,
  "height": 16,
  "footprintW": 1,
  "footprintH": 1,
  "canPlaceOnWalls": false,
  "canPlaceOnSurfaces": false,
  "backgroundTiles": 0
}
```

Supply your own legally obtained PNG; the example is schema only, not bundled artwork.
`file` defaults to `<id>.png`. Upstream recursive `rotation`, `state`, and `animation`
groups with `members` are accepted; this adapter exposes their leaves as **static,
independently selectable variants**. It does not yet animate frames or auto-mirror
orientations. Use the existing editor rotation for geometric rotation.

Directories are stored in VS Code global storage, not in layouts or the repository.
Up to eight roots are polled every second; content changes, additions, deletion,
invalid edits and recovery update the current panel without a restart. **Unload**
only removes the directory registration, never files or placed items. Local PNGs
are decoded in the host and sent as sprite data; no external resource roots,
network URLs, script execution or CSP relaxation are needed.

Validation rejects absolute/relative traversal, URLs, nested file paths,
symlinks/junctions, non-PNG content, interlacing, repeated PNG headers, wrong
dimensions and CRC/decode failures. Export non-interlaced PNGs.
Limits: 128 entries per root/item directory, 64 KiB JSON, 1 MiB per PNG, 256×256 pixels per sprite,
16×16 tiles per footprint and 128 nodes/eight levels per manifest.
Dimensions must exactly match the footprint at 16 pixels per tile. A failing
manifest is skipped atomically; other items remain available. Duplicated IDs are
rejected, not allowed to override earlier/bundled assets. Diagnostics appear in
the office warning panel, Settings and the **Squad Pod** output channel.
Missing-art warnings also update immediately when a later host layout snapshot
introduces or removes legacy/unknown IDs; no unrelated UI action or save is needed.
Incoming host layouts now use the draft-conflict protection described above;
missing-art warnings follow the selected canvas rather than an unresolved
incoming snapshot. Asset-only refreshes do not replace the layout or editor history.

### Custom pet sheets

Put pet assets under `pets/<id>/` inside an already registered asset directory.
Each pet folder needs a `manifest.json` and sibling `pet.png`:

```text
my-assets/
  pets/
    my-dog/
      manifest.json
      pet.png
```

```json
{
  "id": "my-dog",
  "name": "My Dog",
  "petType": 2
}
```

`id` must match the folder name. `petType` is a stable integer from 0 to 511, unique across all pet manifests:
bundled Claudio and Gitcat reserve 0 and 1, so custom sheets should use an
unused value from 2 through 511. A valid type stays reserved even if its image
fails to load, preventing a repaired or later-added sheet from changing a
saved pet's species. Duplicate IDs or types and invalid types are rejected
with asset diagnostics. A pet sheet
must be exactly 96×96 pixels and no larger than 512 KiB. Upstream Pixel Agents
pet manifests contain `id` and `name`; Squad Pod additionally requires
`petType`, so add this field before loading an upstream pet pack.

Saved pet placements keep their identity and numeric type if a sheet becomes
unavailable. The Pets editor labels those placements unavailable and still
lets you remove them; it does not substitute another species or add a new
placement without a valid sheet.

**Aggregate reload work is bounded, including failed attempts.** Each root has
its own non-transferable allowance per fingerprint/load pass: **2 MiB of file
content, 128 file reads and 2,048 directory enumeration calls** (including
end-of-directory probes). The bundled root reserves 128 furniture leaves /
262,144 attempted decoded pixels; each of up to eight external roots reserves
48 leaves / 98,304 pixels. Thus all roots together permit at most 18 MiB read
and hashed, 1,152 file reads, 18,432 enumeration calls, 512 furniture decodes
and 1,048,576 furniture pixels per pass. The fixed bundled floor/wall sheets
add at most 10 decodes / 10,496 pixels, within the bundled read allowance.
An actual change can run a fingerprint pass followed by a load pass, so those
I/O limits can be spent twice in that refresh; idle polling runs only the
fingerprint pass. These are bounded synchronous operations, not an async loader.

The fingerprint reads only validated manifests and their referenced PNGs
(deduplicated per manifest), plus the fixed bundled floor/wall sheets.
Unreferenced PNG content is never read or hashed; folder enumeration still
checks the per-directory/aggregate limits. Both paths use the same manifest
read plan and work reservations. A failed manifest does not refund work already
spent or reserved, preventing repeated corrupt PNGs from bypassing decode caps.

Roots cannot borrow each other's allowances: an oversized import cannot starve
another root or the originals. Within each root, folders are processed in
lexicographic order, each manifest atomically. An over-budget manifest receives
a path-specific warning and is not claimed loaded; smaller later manifests can
still fit unused capacity. When a read/enumeration allowance is exhausted,
remaining affected manifests each receive warnings. Split large collections
among the available roots or reduce them to fit; unused allowance in another
root does not raise a pack's limits. Removing oversized content recovers on the
next poll without rewriting placed items. These stricter import limits replace
the earlier shared output-only budget.

**This asset update never migrates or rewrites saved furniture.** The existing
v1-to-v2 tile-color compatibility handling is unchanged. New bundle IDs use `pa_`; local
IDs use `local_<manifest-id>_<leaf-id>`. Old `desk` remains 2×1; new
`pa_DESK_FRONT` is 3×2 and `pa_DESK_SIDE` is 1×4. New placements store their
footprints (and desk/seat roles so unloading art does not erase seats).
Later dimension changes keep the placed footprint and show a grey
missing-art marker instead of expanding into neighbors. Removed and unknown IDs
are retained on export/save, with explicit warnings; unknown dimensions block
new placements/transforms conservatively. Export a backup and manually replace
old pieces in free space to adopt the new art. There is no automatic ID remap,
layout-revision reset or silent movement.

Nine floor PNGs are included; the existing seven floor slots use the first seven
without changing tile IDs (legacy tile 8 remains VOID). The single bundled wall
set is active. External floor/wall/character packs are not supported.
Bundled and custom pets use the separately documented manifest and provenance checks above.

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
- **No premium tileset** — only the verified original furniture/floor/wall bundle ships. Premium art must never be committed or packaged; local imports are the user's responsibility.

## Pixel Agents parity

Squad Pod tracks [Pixel Agents v1.5.0](https://github.com/pixel-agents-hq/pixel-agents/releases/tag/v1.5.0) (`b1bafd0`). Claude-specific pieces (hooks, JSONL transcripts, `claude` launch flags) are intentionally replaced by Squad's file-based model rather than ported. Progress is tracked in [#4](https://github.com/swigerb/squad-pod/issues/4).

| Area | Status |
|---|---|
| File-observed activity hints, roster add/remove (not authoritative lifecycle) | ✅ |
| Reconnect snapshot, stable appearance, persisted seats with swap | ✅ |
| Sound on observed active-to-idle, persisted sound/Debug View, diagnostics output channel | ✅ |
| Settings source status and missing-Squad guidance | ✅ File observer only; automatic launch off, EventBus / WebSocket not connected |
| Editor: drag painting, one undo per gesture, safe import, atomic save | ✅ |
| Alt-drag copy, atomic catalog desk + PC/lamp moves and rotations | ✅ |
| Carpets | ✅ |
| Named Areas and directory-to-Area/seat mapping | ✅ Browser/provider fixtures; native VS Code host verification pending |
| Historical `log/usage.jsonl` records | ✅ All valid rows counted without deduplication; distinct-turnId coverage only, not live context, model or hierarchy |
| Original furniture/floors/walls; validated local furniture manifests and live reload | ✅ (static variants; real VS Code-host verification pending) |
| Named directory management and explicit `copilot --agent squad` launch requests | ✅ Browser/unit fixtures; VS Code host verification pending |
| Squad-history directory suggestions | ❌ No supported launch-history producer |
| Animated pets, stable saved pet types, validated local pet manifests | ✅ Browser/provider fixtures; VS Code host verification pending |
| Other external pack kinds and furniture animation | ⏳ [#7](https://github.com/swigerb/squad-pod/issues/7) |
| Typed host-neutral webview client seam | ✅ VS Code adapter only; no standalone transport |
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
