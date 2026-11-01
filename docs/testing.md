# Testing and acceptance

This guide is the entry point for trying and verifying Squad Pod. It covers the
VS Code extension and the private `standalone/` browser observer; the observer is
part of this repository, not a published npm package.

## Quick start: try the observer

Requires Node.js 22.13+ and the repository's configured npm feed. From the
repository root:

```powershell
npm run install:all
npm ci --prefix standalone
npm run build --prefix standalone
node standalone\dist\cli.mjs "$((Get-Location).Path)" --port 0
```

The absolute current-directory path selects this checkout, whose tracked
`.squad/team.md` supplies the roster. Open the printed `http://127.0.0.1:PORT`
address manually and enter the runtime credential printed in the CLI. The
credential remains valid until rotation or server restart. The office is
read-only by default. Keep the credential private: do not put it in a URL,
screenshot, log, or report. Type `quit` in the CLI to stop the observer.
You do not need to install Squad or start an AI session to try this office.
Use the automated fixture checks below for a disposable test project.

Do not add `--live-activity` for this quick start: it is a separate opt-in to
bounded local Copilot CLI metadata/event reads. Do not add `--office-control` or
`--terminals` unless you specifically intend to exercise their separate
credentials and authority. The observer never launches Squad automatically.

## Fast automated checks

Run from the repository root. The root suite covers the extension and webview;
the standalone suite is separate:

```powershell
npm run verify
npm run check --prefix standalone
npm test --prefix standalone
npm run build --prefix standalone
npm run package
node --test scripts/verify-acceptance-index.test.cjs
```

`npm run verify` runs lint, type checks, both unit-test suites, the production
build, and a provider smoke check. The standalone type check and tests verify its
boundaries; its build creates the private observer package. `npm run package`
creates the VSIX in the repository root and runs the package audit. These checks
do not install or exercise the VSIX in desktop VS Code.

CI runs the root lint/type/test/build gates and packages the VSIX on Ubuntu and
Windows. It also runs standalone type/tests, build plus the read-only packaged
acceptance helper, and synthetic owned-terminal acceptance on Ubuntu and Windows;
macOS runs the standalone type/tests and those same two acceptance helpers. The
office-control and live-activity browser helpers are not CI gates.
The evidence-index verifier, package receipt/link, acceptance-progress and
release-workflow script tests (`scripts/*.test.cjs`) also run in the
Ubuntu/Windows CI jobs.

### Standalone acceptance helpers

All browser launches are headless. Every helper creates and cleans up its own
synthetic project and installation; none is a real Squad session test. The
read-only, office-control, and live helpers install local tarballs offline. The
terminal helper resolves official dependencies through the configured package
feed and requires a working native `node-pty` helper; see the
[native terminal prerequisites](../standalone/README.md#optional-owned-terminals),
including the macOS source rebuild and Linux compiler/Python requirements.

Playwright is optional for the read-only and terminal helpers; without it, they
run their non-browser checks. The office and live helpers require an already
installed Playwright ESM entry (`index.mjs`); no helper downloads a browser.
`EDGE_PATH` can select an already installed Edge executable. Set the helper's
artifacts variable to retain its output outside the repository. Pre-create the
`OBSERVER_ARTIFACTS` directory before running the read-only helper.

Start with read-only acceptance; no browser is required. Use a new output root
for each run so a failed rerun cannot be confused with old reports or screenshots:

```powershell
$artifacts = Join-Path $env:TEMP ('squad-pod-acceptance-' + [guid]::NewGuid().ToString('N'))
$env:OBSERVER_ARTIFACTS = Join-Path $artifacts 'read-only'
New-Item -ItemType Directory -Force $env:OBSERVER_ARTIFACTS | Out-Null
npm run acceptance --prefix standalone
```

Check `$LASTEXITCODE` after each command; `0` means it completed successfully.
Without `PLAYWRIGHT_MODULE`, `observer-acceptance.json` records `browser: false`:
that is a successful non-browser check, not UI acceptance.

| Command | What it checks | Environment variables | Successful-run artifacts | CI |
|---|---|---|---|---|
| `npm run acceptance --prefix standalone` | Packs and installs the observer offline from local tarballs, then checks the production CLI, HTTP/WebSocket, read-only boundary, reconnect and synthetic project activity. With optional Playwright, also checks the browser UI and renderer. | Optional: `PLAYWRIGHT_MODULE`, `EDGE_PATH`, `OBSERVER_ARTIFACTS` | `observer-acceptance.json`; browser screenshots when Playwright is enabled | Yes |
| `npm run acceptance:office --prefix standalone` | Uses the production browser UI to test separately authorized office-control editing, persistence, conflicts, import/export, and recovery against synthetic project files. | Required: `PLAYWRIGHT_MODULE`; optional: `EDGE_PATH`, `OFFICE_ARTIFACTS` | `office-report.json`; failure diagnostics when the browser page remains available | No |
| `npm run acceptance:live --prefix standalone` | Uses a synthetic `COPILOT_HOME` fixture to check bounded live-activity projection, default-off behavior, filtering, UI, and stale-source clearing. It does not read a real home or launch AI. | Required: `PLAYWRIGHT_MODULE`; optional: `EDGE_PATH`, `LIVE_ARTIFACTS` | `live-report.json` and any screenshots captured before completion | No |
| `npm run acceptance:terminals --prefix standalone` | Installs dependencies through the configured feed and exercises only the deterministic `--fixture` PTY path: input, resize, reconnect, revocation, and owned-process cleanup. Requires the platform's native `node-pty` helper; optional browser checks use installed Playwright/Edge. | Optional: `PLAYWRIGHT_MODULE`, `EDGE_PATH`, `TERMINAL_ARTIFACTS` | `terminal-report.json`, package tarball, and screenshots when captured | Yes |

For browser acceptance, first run this PowerShell setup from the
repository root. It locates an already installed Playwright package resolvable
from this checkout and selects its ESM entry; it does not install Playwright or
download a browser. If resolution fails, provision Playwright through your
approved npm feed in a separate tool directory and set `PLAYWRIGHT_MODULE` to
that installation's absolute `index.mjs` path instead. An installed browser is
also required: set `EDGE_PATH` to your Edge executable, or have Playwright's
compatible Chromium already installed.

```powershell
$playwrightPackage = node -p "require.resolve('playwright')"
if ($LASTEXITCODE -ne 0) { throw 'An installed Playwright package is required for browser acceptance.' }
$playwrightEntry = Join-Path (Split-Path $playwrightPackage -Parent) 'index.mjs'
if (-not (Test-Path $playwrightEntry)) { throw "Installed Playwright index.mjs not found: $playwrightEntry" }
$env:PLAYWRIGHT_MODULE = $playwrightEntry
$edgePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (Test-Path $edgePath) { $env:EDGE_PATH = $edgePath }
$env:OBSERVER_ARTIFACTS = Join-Path $artifacts 'read-only-browser'
New-Item -ItemType Directory -Force $env:OBSERVER_ARTIFACTS | Out-Null
npm run acceptance --prefix standalone
```

Keep those variables set for the office and live checks:

```powershell
$env:OFFICE_ARTIFACTS = Join-Path $artifacts 'office'
New-Item -ItemType Directory -Force $env:OFFICE_ARTIFACTS | Out-Null
npm run acceptance:office --prefix standalone

$env:LIVE_ARTIFACTS = Join-Path $artifacts 'live'
New-Item -ItemType Directory -Force $env:LIVE_ARTIFACTS | Out-Null
npm run acceptance:live --prefix standalone
```

For terminal acceptance, set and pre-create its output directory:

```powershell
$env:TERMINAL_ARTIFACTS = Join-Path $artifacts 'terminals'
New-Item -ItemType Directory -Force $env:TERMINAL_ARTIFACTS | Out-Null
npm run acceptance:terminals --prefix standalone
```

The acceptance helpers print their outcome; do not infer success from a report's
existence alone. The terminal command also exercises its browser checks when
`PLAYWRIGHT_MODULE` remains set. These examples use PowerShell paths; on macOS or
Linux, use equivalent absolute paths and shell environment-variable syntax.

Artifacts variables select output folders for structured reports and, when browser
checks run, screenshots. Use a directory you own outside the repository. The
read-only helper writes `observer-acceptance.json` only after successful checks.
Office, live, and terminal helpers write their named report in cleanup when
artifacts are enabled; an abrupt process termination may prevent it. The office
helper writes its additional failure diagnostics only if its browser page remains
available. Check the process exit code and report `failures` field when present.
The terminal helper uses only its packaged `--fixture`; it does not run Copilot
or Squad. Do not use real profiles, private logs, real Copilot sessions, or real
AI tasks for these synthetic checks.

The helpers stop their own hosts and remove their temporary fixtures. Keep the
artifact root until you finish review. Reports can include local paths and
failure diagnostics: inspect and redact them before sharing, even for a
synthetic run. Never include credentials, authentication screens or private
logs. Use the [evidence handoff checklist](acceptance/README.md) to preserve
reviewed results in GitHub rather than only in a chat or a temporary folder.

## Package and verify a VSIX

`npm run package` builds `squad-pod-<version>.vsix` in the repository root and
checks its packaged assets. It does not install or validate the artifact in a
running VS Code host. For an installed-file identity comparison, see the
[installed VSIX comparison notes](https://github.com/swigerb/squad-pod/issues/4#issuecomment-6546719024);
VS Code installs the VSIX `extension/` payload and adds `__metadata` to the
installed `package.json`, so compare the documented payload rather than the
archive and installed manifest byte-for-byte.

### Release automation

The initial release contract is the **0.1.0 desktop VS Code pre-release** under
`brianswiger.squad-pod`, not a full native/REAL/standalone/mobile acceptance claim.
`package.json` sets `preview: true` for listing presentation, and `npm run package`
separately passes `--pre-release` to `vsce` for the update channel. CI therefore
uploads a pre-release candidate. Verify both markers in the exact archived
`extension.vsixmanifest`; neither a version number nor a successful build proves
the intended channel. A future stable release requires an explicit owner
decision and corresponding packaging/metadata changes.

Squad Pod has no automated release or publication path. The inherited Squad CLI
**Squad Release**, **Squad Insider Release** and **Squad Promote** workflows are
kept only as retired, report-only jobs: they run solely when started manually,
have no token permissions, and write a job summary. They do not check out code,
run tests, create tags or GitHub releases, merge or push branches, or publish
packages. `node --test scripts/release-workflows.test.cjs`, which CI runs with
the other script tests, fails if any of them regains those capabilities, for
example after a Squad template refresh.

The maintainer path is the ordinary **Squad Pod CI** run on `master`: it builds,
audits and uploads the `squad-pod-vsix` artifact with its identity receipt. That
artifact is a candidate, not a release. Marketplace publication is a separate
owner and Scout step tracked in
[#158](https://github.com/swigerb/squad-pod/issues/158); it requires explicit
approval of the publisher, version, channel and exact artifact.

## Native VS Code and real Squad

Synthetic test success, including browser automation against fixtures, is not
native acceptance and does not prove that a real Squad process emits the observed
events. Native VS Code, real producer, office-control, and owned-terminal runs
have separate approval, isolation, credential, and evidence requirements. Follow
the [native acceptance plan](native-acceptance.md); do not treat this guide or CI
as authorization to run those tests.

## Read and verify committed evidence

Each `docs/acceptance/<run-id>/` directory is a run-specific evidence package.
Read `report.md` first for scope, candidate identity, outcomes, limitations, and
sign-off status. `run-manifest.json` records the run, product/plan identity and
environment. `case-ledger.json` groups acceptance cases; `case-ledger-atomic.json`
records the individual statements. `observations.jsonl` is the chronological
observation record. The `evidence/` directory contains supporting logs, images,
and other retained artifacts. File names and schema details can vary between
runs; the evidence index is the integrity manifest for that run.

Outcome meanings are:

| Outcome | Meaning |
|---|---|
| PASS | The applicable check ran and direct evidence supports its expected result. |
| FAIL | The prerequisite and source existed, but the result contradicted the expected result. |
| BLOCKED | Approval, environment, tool, artifact identity, or implementation was missing. |
| NOT-PRODUCED | An approved actual run completed, but its runtime did not emit the required source or fields. |

An outcome is not a defect count or release-readiness percentage. A blocked or
not-run check is not a pass. Evidence provenance matters: `FIXTURE` is synthetic
input, `BROWSER` is browser observation, `NATIVE` is the installed extension in
desktop VS Code, and `REAL` is data emitted by an approved actual producer. A
fixture or browser pass does not prove native or REAL behavior. Read the report's
limitations and approval state before relying on any result.

Verify committed package bytes from the repository root:

```powershell
node scripts/verify-acceptance-index.cjs docs\acceptance\20261031T135929Z-fresh-25a14517
node scripts/verify-acceptance-index.cjs docs\acceptance\20261031T170436Z-gate-blocked
```

The verifier reads canonical Git blob bytes at `HEAD`, so Windows checkout
line-ending conversion does not change the result. It supports both recorded
entry field spellings (`path` and `relativePath`), checks byte count and SHA-256,
and requires the index to declare that it excludes its own hash. Generate a
read-only, single-run progress report with
`node scripts/acceptance-progress.cjs docs\acceptance\<run-id>`. It uses the
verified committed ledgers, keeps original IDs and outcomes, and does not
aggregate runs or count parsed prose as executed tests. It verifies
committed content, not uncommitted edits. A matching index establishes file
integrity only; it does not prove who produced the evidence, that the observations
were correct, or that acceptance was complete. Do not edit a committed package to
make a hash check pass; publish a separate corrected run instead.
