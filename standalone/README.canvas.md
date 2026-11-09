# Squad Pod Canvas

![Squad Pod pixel-art office](assets/preview.png)

A pixel-art office for your Squad team, shown as a **GitHub Copilot app canvas**.
See your project's roster, select members to inspect their details, and observe
activity supplied by the exact joined session. This is the Canvas plugin, not
the VS Code extension or the standalone CLI.

**Experimental preview, not generally available.** The preview is for Windows
x64 local sessions; macOS, Linux, WSL and remote sessions are unsupported.
Implemented features and automated checks do not establish native qualification.
See the [install guide](https://github.com/swigerb/squad-pod/blob/master/docs/canvas-install.md)
for per-release provenance, preview approvals and qualification status.

## Install and open

1. In the GitHub Copilot app, choose **Customize**, open marketplace settings
   next to the marketplace dropdown, and add **`swigerb/squad-pod`**.
2. In **Browse**, find **Squad Pod** from **`squad-pod-plugins`** and choose
   **Install**. Review and confirm the app's installation prompts.
3. Open a local project session containing `.squad/team.md` (or legacy
   `.ai-team/team.md`) and ask Copilot to **open the Squad Pod canvas**.

The canvas uses only the joined session's project; it cannot browse to another
project or initialize a team. End users do not need a source checkout, npm
install, SDK install or build. Your organization must allow the plugin; do not
bypass managed policy or trust prompts.

## Read-only by default

Every instance starts **read-only**, including reloads. Explore the office,
select team members and view available joined-session activity without write
access. Missing activity is not invented, and historical events are not replayed.

Choose **Enable editing** explicitly for that instance to customize the office:
layout, floors, walls, carpets, furniture, named Areas, pets, seats, appearance
and project preferences. Saves are revision-checked, with conflict/recovery
copies retained rather than silently overwriting changes. Host-mediated actions
and embedded JSON transfers have capability and qualification limits.

See the [Canvas feature matrix](https://github.com/swigerb/squad-pod/blob/master/docs/canvas-feature-matrix.md)
for supported behavior and limitations. The plugin does not offer terminal or
CLI launch, directory management, or private CLI-log scanning/import.

## Privacy and local data

The plugin serves its office over local HTTP/WebSocket connections bound to
`127.0.0.1`. For project data, it reads the joined project's `.squad/` (or legacy
`.ai-team/`) and `.squad-pod/`, alongside bundled UI/assets. Live events arrive
through the host's exact joined-session SDK connection, not other sessions or
private CLI logs.

The plugin makes **no external network calls**, sends no telemetry and needs no
GitHub tokens. App marketplace installation/downloads are separate from plugin
runtime traffic. Plugin code runs with your local user privileges: this is
**not a sandbox**. Treat the canvas URL's single-use viewer credential as private.

Opt-in editing saves project state under `.squad-pod/`, not Squad charters,
decisions, histories or session logs. Closing the canvas disposes its server,
watchers and in-memory activity; saved layouts/preferences remain in the
project. Instance-scoped drafts/recovery are not durable backups. See the
[privacy and lifecycle guide](https://github.com/swigerb/squad-pod/blob/master/docs/canvas-install.md#privacy-authority-and-local-data)
before exporting drafts, updating or uninstalling.

## Development and licensing

Build and package details are in the
[Canvas development guide](https://github.com/swigerb/squad-pod/blob/master/docs/canvas-development.md).
Source changes do not update an already-published immutable plugin release.

The code is **MIT**; see [LICENSE](LICENSE). The **JIK-A-4 MetroCity character
sprites are not MIT** and retain creator-specific permissions. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for asset attribution, permissions
and bundled dependency notices. Plugin availability does not relicense assets.
