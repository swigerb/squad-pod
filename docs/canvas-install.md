# Install Squad Pod in the GitHub Copilot app

**Canvas plugin 0.1.0 is an owner-approved Windows preview, not generally
available.** It brings the pixel-art Squad office into a GitHub Copilot app
session. This is separate from the [VS Code Marketplace extension](../README.md#install)
and the source-only [standalone browser companion](../standalone/README.md).
Installing a VSIX or updating Copilot CLI does not install or update this plugin.

## Compatibility

- **Windows, local sessions only.** Native qualification used GitHub Copilot app
  **1.1.34** with `copilot-sdk-runtime` **1.0.102**. These are tested versions,
  not minimum versions or a promise of compatibility with other builds.
- macOS, Linux, WSL and remote sessions are **not supported** in this preview.
- Open a session for a local project with `.squad/` (or legacy `.ai-team/`) and
  its `team.md` roster. The canvas uses the joined session's project; it cannot
  browse to a different project.
- No source checkout, npm install, SDK install or build is needed by end users.
  The published plugin includes its runtime, browser UI and bundled assets.

## Install and open

1. In the GitHub Copilot app, choose **Customize**.
2. Choose **Add extension**, then **Manage marketplaces**.
3. Add the GitHub repository **`swigerb/squad-pod`** and confirm the form.
   The marketplace name is **`squad-pod-plugins`**.
4. Find **Squad Pod** in Customize and choose **Install**. Review and confirm the
   installation prompts; install only if you trust the publisher and code.
5. In a supported local project session, ask Copilot to **open the Squad Pod
   canvas**, or use **Open canvas** and select Squad Pod.

Quick links for the app:

- [Add the Squad Pod marketplace](ghapp://plugins/marketplace/add?source=swigerb%2Fsquad-pod)
- [Install Squad Pod](ghapp://plugins/install?source=squad-pod%40squad-pod-plugins)

These links **prefill confirmation forms**, never install silently. Add the
marketplace before using the install link. If your browser does not open
`ghapp://` links, use the manual flow above.

This guide does not claim that these links or the public marketplace install
have been tested locally. Scout owns native public-marketplace installation
confirmation after the catalog merges. Local metadata, link and documentation
checks are not native install evidence.

## What this preview does

The office shows the project's declared Squad members and details. Joined-session
live activity is available: Squad member sub-agents, tool labels and task bubbles
come from the **exact current session**, with no historical event replay.
Missing or unmatched activity is not invented. This is not CLI-log observation:
Canvas does not scan private Copilot CLI logs, and the VS Code **Live Activity**
checkbox remains unavailable.

Each instance starts **read-only**, including reloads. Choose **Enable editing**
to authorize that instance's layout, declared-member seats/appearance and office
preferences. Editing is not permission to launch agents, manage directories or
open arbitrary files. Narrow desktop panels retain the layout editor; width alone
no longer switches Canvas to the mobile-view controls (#212/#213).

See the [Canvas feature matrix](canvas-feature-matrix.md) for individual controls
and limitations, including native file opening, directory/terminal management,
CLI usage imports and embedded file-transfer evidence.

## Privacy, authority and local data

- Every canvas instance starts its own server bound to **`127.0.0.1`**. For
  project data, it reads only the joined session project's **`.squad/` or
  `.ai-team/` and `.squad-pod/`**, alongside the plugin's bundled UI/assets.
  Live events arrive through the host's joined-session SDK connection, not a
  search of other sessions or private CLI logs.
- The plugin makes **no external network calls**, sends no telemetry and needs
  no GitHub tokens. Loopback HTTP/WebSocket traffic serves the local office;
  app marketplace installation/downloads are separate from plugin runtime traffic.
- The canvas URL contains a **single-use viewer credential**, not a GitHub token
  or editing credential. Treat it as private. It is exchanged for a local viewer
  cookie and removed from the URL fragment; editing authority is never in the URL.
- This is **not a sandbox**: plugin code runs with your local user privileges.
  The scoped behavior above is the implementation's boundary, not OS isolation.
- Editing is opt-in per instance and writes project state only under
  **`.squad-pod/`**, including guarded layout/preferences and recovery copies.
  It does not write Squad charters, decisions, histories or session logs.
- Closing the canvas disposes its server, watchers and in-memory live activity;
  it does not end the Copilot session. Saved layouts/preferences remain in the
  project. Instance-scoped drafts/recovery are not a durable backup: export any
  unresolved draft before closing, subject to the feature matrix's transfer caveat.

Disabling or uninstalling the plugin is not a request to delete project data.
Keep `.squad-pod/` to retain layouts/preferences for a later install. If you want
to remove that data, first close all offices using the project, back it up and
explicitly delete only the data you intend to discard. Do not delete `.squad/`
or `.ai-team/` as part of plugin removal.

## Update, disable and uninstall

Manage the plugin in the **GitHub Copilot app**, not VS Code:

- **Update:** close existing Squad Pod canvases after saving/exporting work.
  Refresh the `squad-pod-plugins` catalog in **Manage marketplaces**, then check
  Squad Pod under **Customize → Installed** for the offered plugin update.
  If the app offers no update action, uninstall and reinstall from the refreshed
  catalog, retaining project data. Reopen the canvas in a local session and
  authorize editing again if needed. Refreshing alone does not change a pinned
  distribution; a future release must publish a new catalog ref/SHA/version.
- **Disable:** in **Customize → Installed**, turn off Squad Pod's toggle.
  Close its existing canvases; re-enable the toggle and reopen when needed.
- **Uninstall:** close existing canvases, then use Squad Pod's installed-plugin
  management controls to remove/uninstall it. To remove the catalog too, remove
  `squad-pod-plugins` under **Manage marketplaces** after uninstalling its plugin.
  Saved project data is retained as described above.

App controls may vary by build or managed policy; do not bypass trust or
organization restrictions. GitHub's [app customization guide](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
describes marketplaces and the Installed toggle.

### Roll back with your own marketplace

There is **no promise that an earlier Canvas release tag exists**. If a suitable
earlier immutable release is available and qualified for your app:

1. Back up `.squad-pod/` and export unresolved drafts before closing canvases.
2. Create a marketplace you control, with a distinct marketplace name and an
   entry pointing to that earlier release's plugin directory. Use its exact tag
   in `source.ref`, matching distribution commit in `source.sha`, correct
   `source.path`, and matching released plugin version/metadata.
3. Uninstall the current plugin, add your marketplace through **Manage
   marketplaces**, then install its Squad Pod entry and reopen the canvas.
   Confirm saved-data compatibility before editing; do not assume downgrades can
   read newer layouts.

Never move or overwrite published tags, edit the public release in place, or use
`latest`/VSIX updates as a rollback mechanism. See GitHub's
[marketplace authoring guide](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/create-and-share-plugin-marketplaces)
for catalog structure.

## Pinned preview provenance

| Field | Canvas preview value |
|---|---|
| Marketplace / plugin | `squad-pod-plugins` / `squad-pod` |
| Plugin version | `0.1.0` (independent of VSIX `1.0.0`) |
| Source repository / path | `swigerb/squad-pod` / `plugins/squad-pod` |
| Immutable distribution tag | `canvas-v0.1.0` |
| Distribution commit | `16d33ae623f82b7c10a5d46f892bcc98b97b39d6` |
| Built from master commit | `c1a0df7ca66b8c0f50a42b83758f9c8e1572e66e` |

The distribution includes `build-info.json` and `checksums.json`. The catalog pins
the released artifact, not a checkout/build on the user's machine.
Developer packaging details remain in [Canvas development](canvas-development.md).
Bundled art retains [third-party notices](../THIRD_PARTY_NOTICES.md) and
creator-specific permissions; plugin availability does not relicense assets.
