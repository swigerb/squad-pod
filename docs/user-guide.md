# Squad Pod user guide

Detailed usage, privacy, compatibility and host-specific guidance for Squad Pod. For a short introduction, see the [README](../README.md).

- [Feature overview](#feature-overview)
- [Install](#install)
- [Use Squad Pod](#use-squad-pod)
- [Activity detection](#activity-detection)
- [Compatibility and privacy](#compatibility-and-privacy)
- [Custom assets](#custom-assets)
- [Local browser observer](#local-browser-observer)
- [GitHub Copilot app Canvas plugin — Windows preview](#github-copilot-app-canvas-plugin--windows-preview)
- [Squad Pod and Pixel Agents](#squad-pod-and-pixel-agents)
- [Showcase credits](#showcase-credits)
- [Author and support](#author-and-support)

## Feature overview

| Feature | What you can do |
|---|---|
| Animated team office | Discover your Squad roster automatically and watch characters walk, type, read, and settle into their assigned seats. |
| Squad Info | Explore agent roles, charters, declared models, observed runtime models, current tasks, and recent activity. Open a member's charter directly in VS Code. |
| Live activity | Opt in to matching local Copilot CLI sessions for tool labels, task bubbles, source-reported models and context gauges, plus temporary parent-linked subtask characters. |
| Full office editor | Paint floors, walls and carpets; color, move, rotate and copy furniture; arrange directional groups and desktop accessories; undo and redo changes. |
| Named Areas and seating | Create color-coded Areas, map launch directories to them, and assign or swap seats while retaining each member's appearance. |
| Pets and custom assets | Add Claudio and Gitcat, import local furniture, pets and character sheets, and use stateful furniture at active desks. |
| Layout persistence and recovery | Save your office, import and export JSON layouts, try the bundled starter, and resolve conflicting edits with retained recovery copies. |
| Directories and launch | Save project directories and explicitly launch `copilot --agent squad` in a new VS Code terminal. |
| Telemetry and usage | Browse observed events, historical Squad usage and model reports, and explicitly selected Copilot CLI usage exports. |
| Accessible office navigation | Use keyboard-accessible agent details, pan and zoom, Fit office, off-screen Locate controls, and a crowded-label list. |
| Local browser companion | Run the same office renderer outside VS Code, with separately authenticated office editing and owned-terminal options. |
| GitHub Copilot desktop app preview | Open the exact joined local project's office as a Canvas plugin, read-only by default with opt-in layout editing. See the [Canvas scope and limits](canvas-feature-matrix.md). |

## Install

Install [Squad Pod from Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=brianswiger.squad-pod), published by **Brian Swiger**, or run:

```powershell
code --install-extension brianswiger.squad-pod
```

Open your Squad project, then run **Squad Pod: Show Panel** from the Command Palette. Your team appears from `.squad/team.md`; legacy `.ai-team/team.md` projects are also supported.

Requires **VS Code 1.107 or later**. No Node.js installation or Copilot authentication is needed to view the office and observe project files. Copilot CLI on `PATH`, its authentication, and a trusted workspace are required only when you choose to launch Squad.

**Upgrading from 0.1.x:** use **Switch to Release Version** on the extension's VS Code page if you selected the pre-release channel. The extension identity remains `brianswiger.squad-pod`; keep it installed to retain your existing settings and workspace state. Installing or opening the office never starts an AI task.

Choose your host: VS Code (above) or the [GitHub Copilot app installation](canvas-install.md). The Copilot app is **not GitHub Desktop**, the Git client. Canvas has its own preview version and marketplace; a VSIX does not install it.

## Use Squad Pod

### Open the office

Click a character, its name (**Enter** or **Space** also works), or its occupied desk or chair to open its details. Choose **Squad Info** for the team view and **Open charter** to open a member's `charter.md`. Select a character, then click another seat to move it. Roster changes update the office without turning temporary tasks into permanent members.

Use **Fit office** to center the map and **Locate character** to find off-screen members. Labels stay above characters; a scrollable list handles crowded views. Pan, zoom, fit and locate change your view, not your saved layout or seat assignments.

Squad Info distinguishes **declared model preferences** from **observed runtime models**, with source fields and timestamps. It reports what the producer supplies rather than guessing a model from a role or configuration. `auto` means automatic selection, not a specific model.

### Edit the office

Choose **Layout** in the toolbar to edit the office:

- Paint nine bundled floor styles and walls, adjust their colors, and place or color furniture.
- Paint decorative carpets with a style and main/accent colors.
- Create named Areas, paint their tiles, and map launch directories to Areas to prefer those seats for observed agents. Turn the Area overlay on or off in Settings.
- Add or remove Claudio and Gitcat; pets wander around the office and react when clicked.
- Select and drag furniture to move it. Hold **Alt** when releasing to copy; press **R** to rotate. Ungrouped furniture rotates geometrically; grouped directional furniture cycles through available views. A desk moves or rotates with overlapping computers and lamps.
- Use **Undo** and **Redo** for editor changes. A paint stroke is one step.
- Export a layout or import a JSON layout from Settings. An import is a draft until you save it. If an incoming layout conflicts with an unsaved draft, review the versions and choose which one to keep before saving.
- To try the bundled starter, run **Squad Pod: Export Default Layout** and import the file from Settings. Your saved office is replaced only when you explicitly save the draft.

### Settings

The VS Code setting **`squad-pod.autoShowPanel`** focuses the panel once when the extension activates. It is off by default; changes apply the next time the extension activates. It does not launch Squad.

Roster and file observation does not require Copilot CLI authentication or an AI task. Live CLI log observation is a separate opt-in (`squad-pod.liveActivity`, default off); recent-directory suggestions are a separate metadata read that you can disable with `squad-pod.directorySuggestions` (default on).

In the office's **Settings**, sound notifications play a short chime when an active agent becomes inactive; **Debug View** opens agent and layout diagnostics; and **Show Named Areas** toggles the Area overlay. You can also add or unload local asset directories and import or export layouts. Sound is an office control, not a VS Code configuration key.

### Live activity and subagents

Enable **Live Activity** in Settings and accept the VS Code confirmation. Squad Pod follows the newest matching local Squad session and attributes tools and runtime models to exact roster identities. Context gauges appear when the source provides context metrics.

**Task bubbles** give active tools readable, source-labeled summaries such as **CLI tool: Reading a file**. Toggle them per view without changing consent or project settings. They describe tool activity, not invented agent dialogue. See the [task-bubble and privacy contract](task-bubbles.md).

**Telemetry > Observed transient tasks** shows session-local task calls. Running children with explicit parent links appear near their roster ancestor with **Subtask / Parent** labels and disappear when they finish or their source clears. Instance IDs prevent duplicates; an authoritative roster match uses the existing member's character.

Your `.squad/team.md` roster remains the membership authority. Temporary subagents are session activity, not permanent reporting lines or automatic roster promotions. The [team identity contract](team-hierarchy.md) documents lifecycle, attribution and producer compatibility.

### Launch Squad in a directory

In VS Code, open **Directories** to browse for a folder or enter its path manually. Workspace folders and saved directories each have an explicit **Launch** action. Squad Pod submits `copilot --agent squad` to a new terminal only after you select **Launch**; workspace trust and the Copilot CLI on `PATH` are required. Squad Pod does not auto-launch, and opening the panel never launches a task.

Recent Squad directories can fill the manual-entry form from local working-directory metadata; disable those suggestions with `squad-pod.directorySuggestions`. Saving a directory or launching it does not switch the office's observed project. Launch history records command submission, while the terminal shows the running process.

### Activity and recorded usage

Open **Telemetry** to browse status changes, session activity, logs, orchestration events and decisions. Historical Squad usage shows source-reported tokens, estimated costs and model reports. **Clear activity** clears observed events without discarding usage or active-task displays.

For a Copilot CLI usage export created with `copilot --agent squad --usage-output-file <file.json>`, choose **Select CLI usage JSON...** and confirm the exact workspace-local file. **Refresh selected export** rereads it; **Forget export** removes the in-memory selection. Pod does not create exports, discover private export files, or modify the selected source.

Premium requests and nano-AI units retain their native units, never USD. Export totals and the Squad ledger remain separate; missing usage is not zero. Historical usage is neither live context utilization nor an invoice. See the [CLI import contract](native-acceptance.md#cli-import-contract) for supported fields, provenance and read limits.

## Activity detection

Squad Pod watches the selected project's `.squad/` files, including the roster, sessions, logs, orchestration logs, decision inbox, and agent files. It uses filesystem notifications with polling as a fallback and treats the initial scan as a baseline rather than replaying old files.

Descriptions inferred from those files are labeled **File activity hint**, not live tasks. HTML comments, structural headings, and empty scaffolding are excluded; a change without meaningful content uses a neutral `File changed: <filename>` hint. File hints clear after 30 seconds without activity. An observed **Live task** takes precedence until its live source finishes or expires; file observations cannot overwrite it. These descriptions never modify the underlying history files.

## Compatibility and privacy

Squad Pod is local-first. Basic observation reads the selected project's Squad files. **Live Activity is off by default** and needs separate consent to read matching local CLI session metadata and events. It uses bounded task descriptions, tool names, file basenames, command names and context counts; prompts, other arguments and outputs are not displayed or stored. Turning it off stops live reads and clears live displays.

The live adapter targets **Copilot CLI 1.0.105**. Producer-supplied fields control which details appear; unmatched identities remain unattributed and missing or stale sessions fall back to file observations. Squad Pod does not execute `squad.config.ts` to discover preferences.

Version 1.0 is a **stable Squad-native release**, not a claim that Claude-specific integration rules apply to Squad. The [release scope and compatibility matrix](testing.md#stable-10-release-scope) covers supported distribution, platform evidence, and the separate local browser companion. Detailed historical acceptance records stay in the technical documentation rather than the product introduction.

## Custom assets

Add a local asset directory in **Settings** for furniture, pets, and character sheets. Folder layouts, supported images, reload behavior, and import limits are described in [Custom asset manifests](custom-assets.md).

## Local browser observer

Run the same office in a browser using the separate, source-only local companion. It observes an explicitly selected project and is authenticated, loopback-only, and read-only by default.

Separate credentials enable **office controls** (editing, seats, sound/debug/Areas, browser layout import/export and protected recovery) and **owned terminals** (explicit Squad launches, terminal interaction and reconnect). Local [`--live-activity` opt-in](../standalone/README.md#optional-live-activity) enables live tools, context and tasks; browser settings cannot grant private-log access.

Responsive controls provide touch pan/zoom, page navigation and deliberate clipboard actions. The companion is a local desktop-browser tool, not a remote-access service or a supported phone/tablet product. Native dialogs, charter opening, directory management and CLI usage-file import remain VS Code features.

See the [build/run and security instructions](../standalone/README.md). The companion is separate from the Marketplace extension and is not published as an npm product.

## GitHub Copilot app Canvas plugin — Windows preview

**Canvas plugin 0.1.2 is being prepared.** The currently published, owner-approved
Windows local-session preview remains **0.1.1**, not generally available or the
VS Code Marketplace/VSIX extension. Prior **0.1.0** native evidence used app
**1.1.34** / runtime **1.0.102** on Windows x64; it is not 0.1.1 or 0.1.2
acceptance or a minimum-version promise. Native checks for both newer versions
remain pending in [#218](https://github.com/swigerb/squad-pod/issues/218).
macOS, Linux, WSL and remote sessions are unsupported. No source checkout,
Node.js installation or build is needed by plugin users.

In the **GitHub Copilot app**: **Customize** → marketplace settings next to the
marketplace dropdown → add **`swigerb/squad-pod`** and confirm. Find **Squad Pod**
in Browse and choose **Install**, reviewing the trust prompt. Open a local
project session containing `.squad/team.md` (or `.ai-team/team.md`) and ask
Copilot to **open the Squad Pod canvas**. The office uses that exact joined
project, not another checkout or a directory selected in the office.

Use the [add-marketplace and install confirmation links in the setup guide](canvas-install.md#install-and-open).
Both prefill confirmation forms; they never install silently. The guide also
includes the manual setup flow and troubleshooting.

The canvas starts read-only; **Enable editing** is opt-in per instance. It shows
the joined session's live Squad member activity without replaying history.
See the [install, privacy and lifecycle guide](canvas-install.md) and
[feature matrix](canvas-feature-matrix.md). Scout verified the public install
on **2026-11-03**, on **Windows x64** with app **1.1.34** / runtime **1.0.102**
([#216](https://github.com/swigerb/squad-pod/issues/216)); this does not verify
updates, plugin uninstall or rollback. Local checks are not native install proof.
VSIX versions, defaults and behavior are unchanged.

The owner-hosted **`squad-pod-plugins`** GitHub marketplace is the desktop
distribution hub. **Awesome Copilot** is a separate central discovery route;
[github/awesome-copilot#6270](https://github.com/github/awesome-copilot/issues/6270)
submits the native-qualified **0.1.0** artifact. Acceptance and listing are
pending, not a verified listing or featured placement.
The desktop Canvas plugin is not a Visual Studio Marketplace product.

### Canvas browser client (source-only)

Build the separate Copilot app panel client with `cd webview-ui` then
`npx vite build --config vite.canvas.config.ts`. Its entry is
`standalone/dist/canvas-browser/canvas.html`; the Canvas office host (#194) must serve
that entry at `/`, with `/auth`, `/office-context` and `/office` on the same origin.
This does not change the standalone CLI's credential-paste entry or host defaults.

Canvas checks the existing HttpOnly viewer cookie first. Only an unauthenticated
response allows a single `c` exchange from `#c=<viewer>`; the
whole fragment is removed before network requests and is never stored.
**Read-only remains the default**, including reloads. **Enable editing** explicitly
requests a cookie-authenticated, same-origin one-time anti-forgery challenge
(or reuses its valid control cookie) for revision-checked layout, declared-member
seats and settings changes. Control authority never appears in the URL.
The [authorization and recovery design](../standalone/README.md#host-neutral-canvas-module-read-only-by-default)
reuses the standalone guarded store and conflict UI, without changing VS Code's
layout format or migrating workspace state. An expired session must be reopened;
export unresolved drafts before closing the instance. File opening, directory
management and CLI-log scanning remain unavailable; joined-session live activity
is supported. No agent-callable write actions are
registered. The panel follows the system light/dark preference.

## Squad Pod and Pixel Agents

Squad Pod brings the Pixel Agents office experience to **Squad and Copilot CLI**. It shares the visual-office foundations while using Squad's own roster, charters and task identities.

| Experience | Squad Pod 1.0 |
|---|---|
| Pixel-art office | Animated characters, pathfinding, typing/reading poses, seating, pets and accessible labels. |
| Office creation | Floors, walls, carpets, directional furniture, color controls, named Areas, custom assets, undo/redo and protected layout persistence. |
| Agent integration | Squad roster and charters, project-file observation, opt-in Copilot CLI tools/models/context, and temporary parent-linked tasks. |
| Team identity | Explicit Squad membership, stable member appearances and seats, and session-local subagents without inferred permanent promotion. |
| Launch and terminals | Explicit VS Code launches plus separately authorized owned terminals in the local browser companion. |
| Usage | Historical Squad ledger and explicitly selected Copilot CLI usage exports, with provenance and units preserved. |

This is a Squad-native adaptation, not a clone of Claude transcript handling, persistent team promotion or remote/mobile access.

## Showcase credits

The [animated showcase](https://raw.githubusercontent.com/swigerb/squad-pod/master/assets/showcase/Squad-Pod-Sizzle.mp4) (1:53, [captions](../assets/showcase/Squad-Pod-Sizzle.srt)) is titled "Big ideas. Tiny office." It shows the pixel squad walking and working at their computers, the office controls, and Claudio and Gitcat. It uses staged activity in the production office renderer and contains no private session logs or customer data.

AI narration: Ava (US English).
Music: Brian Swiger's supplied DaVinci AI-generated soundtrack. [Download the source MP3](../assets/showcase/Squad-Pod-Soundtrack.mp3).

## Author and support

Squad Pod is a personal open-source project by [Brian Swiger](https://www.mightybs.com/), a software developer and cloud architect with more than 30 years of experience in software engineering, application modernization, and cloud delivery. His work spans C#, .NET, Python, and AI-powered systems.

[Website](https://www.mightybs.com/) | [Brian on LinkedIn](https://www.linkedin.com/in/brianswiger/) | [MightyBS on LinkedIn](https://www.linkedin.com/company/mightybs/)

For Squad Pod questions, bugs, or feature requests, [open a GitHub issue](https://github.com/swigerb/squad-pod/issues). Squad Pod is not an official Microsoft or GitHub product.

## Credits

Squad Pod is adapted from [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca). Character art is based on the work of [JIK-A-4](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack). Built for [Squad](https://github.com/bradygaster/squad) by [Brady Gaster](https://github.com/bradygaster). See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for licenses and attribution. Squad Pod is released under the [MIT License](../LICENSE).

To build from source or contribute, see [Build and contribute](contributing.md).
