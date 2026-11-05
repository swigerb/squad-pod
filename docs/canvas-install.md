# Install Squad Pod in the GitHub Copilot app

**Canvas plugin 0.1.1 is an owner-approved Windows preview, not generally
available.** It brings the pixel-art Squad office into a GitHub Copilot app
session. This is separate from the [VS Code Marketplace extension](../README.md#install)
and the source-only [standalone browser companion](../standalone/README.md).
Installing a VSIX or updating Copilot CLI does not install or update this plugin.
The **GitHub Copilot app** is the native agent desktop application, **not GitHub
Desktop** (the Git client) and not VS Code.

**Native 0.1.1 qualification is pending** in
[#218](https://github.com/swigerb/squad-pod/issues/218). All prior native PASS
records below remain pinned to 0.1.0; automated packaging checks do not extend
them to the new artifact.

## Compatibility

- **Windows x64, local sessions only.** Prior 0.1.0 native qualification used GitHub Copilot app
  **1.1.34** with `copilot-sdk-runtime` **1.0.102**. These are tested versions,
  not minimum versions or a promise of compatibility with other builds.
- macOS, Linux, WSL and remote sessions are **not supported** in this preview.
- Open a session for a local project with `.squad/` (or legacy `.ai-team/`) and
  its `team.md` roster. The canvas uses the joined session's project; it cannot
  browse to a different project.
- No source checkout, npm install, SDK install or build is needed by end users.
  The published plugin includes its runtime, browser UI and bundled assets.
- Sign in to the GitHub Copilot app with access to the marketplace repository.
  Your organization must allow the plugin; do not bypass managed policy or trust
  prompts. See GitHub's [marketplace prerequisites](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/create-and-share-plugin-marketplaces#share-the-marketplace).

## Install and open

1. In the GitHub Copilot app, choose **Customize**.
2. Select the **marketplace settings control next to the marketplace dropdown**,
   as described in GitHub's [current app guide](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#adding-a-plugin-marketplace).
   The previously qualified 1.1.34 build used **Add extension → Manage marketplaces**.
3. Add the GitHub repository **`swigerb/squad-pod`** and confirm the form.
   The marketplace name is **`squad-pod-plugins`**, with **1 plugin**.
   If fetching the catalog fails transiently, use the marketplace's **Refresh
   catalog** action, or **Retry** if offered. Scout encountered a Windows file
   lock (`os error 32`) on the first fetch; **Refresh catalog** succeeded.
4. Find **Squad Pod** on Customize's **Browse** page and choose **Install**. Review and confirm the
   installation prompts; install only if you trust the publisher and code.
5. In a supported local project session, ask Copilot to **open the Squad Pod
   canvas**, or use **Open canvas** and select Squad Pod.

Quick links for the app:

- [Add the Squad Pod marketplace](ghapp://plugins/marketplace/add?source=swigerb%2Fsquad-pod)
- [Install Squad Pod](ghapp://plugins/install?source=squad-pod%40squad-pod-plugins)

These links **prefill confirmation forms**, never install silently. Add the
marketplace before using the install link. If your browser does not open
`ghapp://` links, use the manual flow above.

### Verified public install of 0.1.0 (historical)

Scout recorded native verification in [issue #216](https://github.com/swigerb/squad-pod/issues/216)
on **2026-11-03**, using **GitHub Copilot app 1.1.34**, runtime **1.0.102**,
on **Windows x64**. These are tested versions, not minimum requirements.

- Adding `swigerb/squad-pod` loaded `squad-pod-plugins` with 1 plugin after the
  fetch recovery described above.
- Installing from Customize produced files matching **all 103 entries** in the
  tag's `checksums.json` (source `c1a0df7`, distribution `16d33ae`; full provenance
  below). **Installed** listed **squad-pod 0.1.0, Marketplace: squad-pod-plugins**.
- In a new session, Copilot opened **`plugin:squad-pod:squad-pod`**, and
  **`get_office_state`** returned the roster without error.
- The marketplace quick link opened **“Add plugin marketplace?”** and the install
  quick link opened **“Install plugin?”**. Both offered **Allow / Deny**; neither
  installs silently.
- **Disable / Enable** worked both ways in **Customize → Installed**. Removing
  the marketplace through **Actions → Remove marketplace** removed it from the list.

This evidence does not establish 0.1.1 native acceptance, support for other
platforms/builds, updates, plugin uninstall or rollback. Local metadata, link and
documentation checks are not native install evidence. The owner closed the
0.1.0 preview epic under reduced scope; the deferred native gates remain in
[#218](https://github.com/swigerb/squad-pod/issues/218), not retroactively passed.

## Distribution and discovery

The public [owner-hosted marketplace catalog](https://github.com/swigerb/squad-pod/blob/master/.github/plugin/marketplace.json)
in **`swigerb/squad-pod`** is the distribution hub for the desktop plugin.
It pins an immutable distribution tag, commit and plugin version, rather than
requiring a local build. The [Canvas GitHub releases](https://github.com/swigerb/squad-pod/releases)
provide downloadable preview artifacts and integrity information separately from
the stable VSIX `v1.0.0` release.

[Awesome Copilot](https://github.com/github/awesome-copilot) provides central
discovery and plugin catalogs. Squad Pod was submitted in
[github/awesome-copilot#6270](https://github.com/github/awesome-copilot/issues/6270)
for the native-qualified **0.1.0** artifact at `16d33ae623f82b7c10a5d46f892bcc98b97b39d6`,
not for unqualified 0.1.1.
[Automated intake passed](https://github.com/github/awesome-copilot/actions/runs/42086032096);
maintainer acceptance and listing are **pending**: do not
assume it is listed, featured or GitHub-verified. Use the owner marketplace above
now. Adding that marketplace is not publication to Visual Studio Marketplace;
the latter distributes only the separate VS Code extension.

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

The Disable/Enable toggle and marketplace removal below were verified in #216.
Update, plugin uninstall and rollback guidance remains unverified natively.

- **Update:** close existing Squad Pod canvases after saving/exporting work.
  Refresh the `squad-pod-plugins` catalog in **Manage marketplaces**, then check
  Squad Pod under **Customize → Installed** for the offered plugin update.
  If the app offers no update action, uninstall and reinstall from the refreshed
  catalog, retaining project data. Reopen the canvas in a local session and
  authorize editing again if needed. Refreshing alone does not change a pinned
  distribution; a future release must publish a new catalog ref/SHA/version.
- **Disable / Enable:** in **Customize → Installed**, use Squad Pod's toggle to
  disable or enable it. Close its existing canvases; enable and reopen when needed.
- **Uninstall:** close existing canvases, then use Squad Pod's installed-plugin
  management controls to remove/uninstall it, if offered by your app build.
  Saved project data is retained as described above.
- **Remove marketplace:** under **Manage marketplaces**, open
  `squad-pod-plugins`' **Actions → Remove marketplace**. This removes the catalog
  from the list; it is not evidence that the installed plugin was uninstalled.

App controls may vary by build or managed policy; do not bypass trust or
organization restrictions. GitHub's [app customization guide](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
describes marketplaces and the Installed toggle.

### Roll back with your own marketplace

For the distinct-version 0.1.1-to-0.1.0 comparison, `canvas-v0.1.0` remains
available at the exact distribution SHA in the historical provenance table
below. **Native update/rollback and saved-data compatibility are pending #218**;
tag availability is not a successful downgrade test. Owner-operated procedure:

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

## Troubleshooting and diagnostics

| Symptom | Safe next step |
|---|---|
| Marketplace missing or fetch failed | Confirm repository `swigerb/squad-pod`; use marketplace **Refresh catalog** or **Retry** if offered. If policy blocks it, ask your administrator rather than changing permissions. |
| Quick link does not open | Use the manual Customize flow; allow/deny prompts still apply. |
| Squad Pod is absent or disabled | Check **Customize → Installed**, its toggle and marketplace name. A VSIX installation or CLI upgrade is not a Canvas installation. |
| Empty or wrong team | Check the exact joined local session project has `.squad/team.md` or `.ai-team/team.md`. A sibling worktree's roster does not apply; the office cannot switch projects. |
| Office does not load or loses its connection | Close and reopen the canvas in the supported session. Reopening starts read-only; preserve unresolved drafts first when possible. Do not copy its private viewer URL into a report. |
| Layout/settings controls disabled | Choose **Enable editing** for this instance. This does not grant terminal, private-log or arbitrary-file authority. |
| No task bubbles or runtime model | Only matching exact-session events appear; missing producer fields are unavailable, not zero or guessed activity. |
| Import/export or native file action unavailable | Check the [feature matrix](canvas-feature-matrix.md). Embedded transfers are unqualified; native charter opening, directory/terminal management and CLI usage imports are unavailable. |

For a report, retain the installed plugin version/marketplace, app build, Windows
architecture, source/dist pins and the exact operation and visible error.
The authorized `get_office_state` Canvas action in 0.1.1 includes bounded
per-instance `readiness` counters: document/script requests, viewer bootstrap,
office-context requests, office socket admissions/closures and `webviewReady`.
These are **requests observed, not proof of visible rendering or a host defect**.
They reset with the instance; they are not a public HTTP diagnostics endpoint.
Share only sanitized results, never credentials, private URLs, private logs,
authentication screens or unrelated project content.

## Published 0.1.1 preview provenance

The [Canvas 0.1.1 GitHub pre-release](https://github.com/swigerb/squad-pod/releases/tag/canvas-v0.1.1)
is separate from stable VSIX `v1.0.0` (which remains Latest).
The catalog pins this exact distribution; installation is not a local build.
**Native 0.1.1 qualification remains pending #218.**

| Field | Canvas 0.1.1 preview value |
|---|---|
| Marketplace / plugin | `squad-pod-plugins` / `squad-pod` |
| Plugin version | `0.1.1` (VSIX `1.0.0` and private standalone `0.1.0` unchanged) |
| Source repository / plugin path | `swigerb/squad-pod` / `plugins/squad-pod` |
| Immutable distribution tag | `canvas-v0.1.1` |
| Distribution commit | `dbf62801cc480cceef6b8cc072cc6091866cc74f` |
| Built from approved clean source | `0f4f08bbfdfc7c6c3a8c3bf8715847c130df5967` (`sourceDirty: false`) |
| Source tree | `973388f1e307ad7d24edd6956f3aa442445fe669` |
| Source approval and CI | [#220](https://github.com/swigerb/squad-pod/pull/220), [exact-head run 42087252555](https://github.com/swigerb/squad-pod/actions/runs/42087252555), all three jobs successful |
| Plugin manifest SHA-256 | `7f74c6c6a460a417f0f31eb2b555cf12f2a907b425871b4ab6d05d7eec17e46a` |
| Extension entry SHA-256 | `caa39af2efdabdb6531c8865b9313f4d3e02b3c349a7cd9c6b0dc662f2a0b3b1` |
| Build-info SHA-256 | `73b71bf8a8f40bd1736413602033fa6a5b4d0696f82b5377ef3e222d33520144` |
| Checksums SHA-256 | `2ee42f9f15fc84a702cef5f70dc408518887e3324df5927e0a7300183eff8425` |
| Receipt payload | 103 files, 1,548,634 bytes (excludes `checksums.json`) |
| Complete plugin | 104 files, 1,571,007 bytes (includes `checksums.json`) |
| [Downloadable ZIP](https://github.com/swigerb/squad-pod/releases/download/canvas-v0.1.1/squad-pod-canvas-0.1.1.zip) | 564,758 bytes; contains `squad-pod/` |
| ZIP SHA-256 | `80ebd8f14e2e4d0b5cf6c585eee2fc42113b64af9754bebb37d8c43786589ad4` |

The release also carries `SHA256SUMS`, `canvas-0.1.1-checksums.json`,
`canvas-0.1.1-build-info.json` and `canvas-0.1.1-freeze.json`.
The downloaded published ZIP was checked against every payload receipt entry.
Integrity and green CI establish artifact identity and automated checks, not
native install/update/rollback success.

## Historical 0.1.0 provenance (unchanged evidence)

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
