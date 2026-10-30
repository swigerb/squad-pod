# Native VS Code and real Squad acceptance

> **Execution handoff:** The user and Microsoft Scout run this plan after approval. Writing this plan does not authorize installation, authentication, AI spending, private-log access, deletion, or publication. No native or real-session result is preapproved.

## Copy-ready Scout instruction

```text
Drive the Squad Pod acceptance plan in docs/native-acceptance.md.
First complete the run manifest, applicability matrix, and approval gates with me.
Use only capabilities actually available to you; do not assume a Scout API.
Use an isolated VS Code environment and disposable, nonproduction Squad workspaces.
Do not use my normal VS Code profile, workspaces, credentials, or home logs.
Pause for explicit approval before installation/running software, authentication,
billable AI tasks, private-log reads, deletion, or any other sensitive action
under your policies. Never bypass trust, permission, or security warnings.
Run the quick smoke first, then the approved full suites against the same
identified artifact. Separate native UI evidence, actual copilot --agent squad
producer evidence, and synthetic fixtures. Record each test and subcheck as
PASS, FAIL, BLOCKED, or NOT-PRODUCED with evidence and cleanup.
Missing context, lifecycle, or usage data is not zero and is not an integration
pass. Leave unavailable or unimplemented capabilities BLOCKED / NOT IMPLEMENTED.
Treat office viewing, office-control writes, terminal authority, and each real launch as separate
approvals with separate credentials; never infer network or auth compatibility.
Stop on data loss, privacy leaks, wrong-member attribution, or unintended launches.
Keep evidence local and redacted. Do not delete, post to GitHub, publish,
merge, or change permissions automatically. Return results and defects for
my review and explicit sign-off; do not claim acceptance on my behalf.
Save the full report as report.md with relative links to redacted evidence.
Keep the report and evidence local, outside the product workspace; do not
commit, upload, or publish them without my explicit approval.
```

## Scope and outcomes

This plan accepts a **specific installed build**, not a branch name or extension version; any later build requires a new manifest and rerun of affected cases. Master `4dbc53151aa36f025c281dc7bf69bb3c62c2c505`, tree `dc1453e62e3480e2d0c3c210f167f6358b357633`, is a **historical baseline**, not the source of every procedure now below. Scout's separately tracked `e9fde5616f0a85c9aa5c2238b5e8ec169b383e25` baseline likewise does not establish acceptance of later heads. Use the implementing references below and the installed artifact's exact manifest for later capabilities; do not transfer baseline evidence to new source.

| Later capability | Implementing source and applicability |
|---|---|
| Transient hierarchy and selected-instance identity (#111) | [#114](https://github.com/swigerb/squad-pod/pull/114), merged as `6296485e0f4f8997273ca0ae413b9616e6c531c5`. Durable hierarchy/promotion remain unsupported, not implemented by this transient view. |
| Authoritative emitted runtime models (#110) | [#116](https://github.com/swigerb/squad-pod/pull/116), merged as `c22d27dd2bc720436d35e9f3deb66f82cc7cb62e`. F-01's emitted-model procedure requires this source; it is separate from declared preferences. |
| Explicit historical CLI usage import (#109) | [#113](https://github.com/swigerb/squad-pod/pull/113), merged as `3f43faeaa82ddda0aead93fa0c057707b14e5fb9`. Source-pinned fixture acceptance only; real-export acceptance remains open and standalone has no importer authority. |
| Standalone opted-in live observation (#112) | [#115](https://github.com/swigerb/squad-pod/pull/115), implementing adapter/model integration at `dee622a7cb23e7a7280009fa4ff7c9e646e675d4` plus subsequent fixes and acceptance refinements. This branch integrates the three refs above; record the exact final frozen source SHA and tarball digest from its PR evidence, not an earlier baseline or branch name. Native/REAL acceptance remains separate. |

Implementing references in the applicability table carry the stated CI and maintainer evidence for each feature. All of that is implementation/synthetic evidence, **not user-run observation of an approved project, real Squad-session acceptance, native VS Code acceptance, or physical mobile-device acceptance**. Rerun affected cases against each later installed build.

| Outcome | Use when |
|---|---|
| PASS | The applicable check ran and its expected result has direct evidence. |
| FAIL | The prerequisite and source exist, but the result contradicts the oracle. |
| BLOCKED | Approval, environment, tool, artifact identity, or implementation is missing. Use reason `NOT IMPLEMENTED` for pending features. |
| NOT-PRODUCED | An approved actual run completed, but its runtime did not emit the required source or fields. Record the runtime/format and missing fields. This is not PASS. |

Record independent subchecks separately. For example, live tool labels can PASS while context is NOT-PRODUCED. A missing ledger message can PASS as native fallback behavior while real usage integration remains NOT-PRODUCED. Do not convert a blocked test into an exclusion or silently reduce the acceptance scope.

**Evidence classes:** `NATIVE` means the installed extension in desktop VS Code; `REAL` means data actually emitted by the approved supported Squad process; `FIXTURE` means deliberately authored test data or the standalone `--fixture` synthetic terminal; `BROWSER` means browser-only evidence. Fixtures and browser tests cannot establish real producer or native-host acceptance. Record browser device emulation or narrow desktop windows as BROWSER, and physical phone/tablet results separately with the device model, OS and browser; an emulated pass never satisfies a physical-device subcheck.

## Expected run output

Produce a **Markdown acceptance report and a folder of supporting evidence**. No Word document is required. Choose a local results directory outside the product workspace and use a unique Run ID, for example:

```text
acceptance-results\<run-id>\
  report.md
  evidence\
    screenshots\
    recordings\
    build-and-test-logs\
```

In `report.md`, include the completed run manifest (including exact source SHA and VSIX SHA-256), approvals, applicability decisions, results for every full-suite test and subcheck, relative links to redacted evidence, defects, cleanup status, and separate native and real Squad acceptance decisions for human sign-off. Use the results, defect, and sign-off templates below. For a smoke-only run, identify that limited scope and leave the unexecuted full-suite checks explicitly BLOCKED with the reason.

Give every result an outcome of **PASS, FAIL, BLOCKED, or NOT-PRODUCED**. Keep missing producer data and pending implementations explicit; do not summarize them as passes. Include the evidence index and any running processes, retained data, or cleanup still awaiting approval.

Keep the report and evidence local. Apply the evidence-handling rules below, and retain any restricted originals separately from redacted material intended for review. Do not commit, upload, post to GitHub, or publish the report or evidence without separate explicit approval.

## Run manifest

Copy this template into the run's `report.md` outside the product workspace. Complete it before execution; do not put secrets in it.

```text
Run ID / UTC start and end:
Executor / human approver:
Plan source SHA and document revision:
Product source SHA (full 40 characters) / dirty status:
Included implementation PRs and exact commits:
Pending implementations and applicability decisions:
Build machine OS/version/architecture:
Node / npm versions; approved dependency registry:
Build commands, timestamps, exit results, and build log references:
VSIX absolute path / filename / byte size / SHA-256:
VSIX package identity (publisher.name) / manifest version:
Installed extension path in isolated extensions directory:
Installed manifest and bundle/asset identity comparison to this VSIX:
VS Code version / commit / architecture; desktop OS/version:
Isolated user-data directory / extensions directory / profile:
Copilot CLI version / executable path / shell and PATH source:
Standalone tarball path/bytes/SHA-256 and installed package comparison (F-02 only):
node-pty source: platform prebuild or source rebuild, helper permissions (F-02 only):
Excluded proxy/CA/token variables required? User resolution (F-02 terminals only):
Workspace Squad agent/template version or source marker/commit:
Global Squad CLI version (only if relevant; not the agent version):
Squad agent/template marker unavailable? Explicit reason:
Disposable workspace A / B and roster names/slugs (redacted aliases):
Observed root and Squad directory shown by Settings:
CLI log root and how both CLI and extension resolve it:
Producer session ID, cwd, timestamps, format/version or observed schema:
Ledger source, record version, byte size, line count, scope:
Settings baseline / saved-layout and recovery backup references:
Panel size, display scaling, zoom, sound device:
Approvals (action, exact scope, approver, time, limits):
Suite selection / time and AI-spend budget / stop conditions:
Evidence directory and redaction reviewer:
Results / defects / cleanup left pending / user sign-off:
```

Current packages report extension version `0.1.0`. That value alone cannot identify the installed artifact. Record both **source SHA and VSIX SHA-256**, then compare the intended VSIX's manifest and packaged extension/webview/assets with the isolated installed extension. Capture the verification method and result. If you cannot prove which artifact is loaded, stop with BLOCKED.

An implementing commit in a clean source checkout does not prove that an existing bundle or VSIX includes it. Rebuild/package that source and verify the installed artifact before applying its new capability checks.

Record the Copilot CLI and workspace Squad agent/template independently. A global `squad` version is not a substitute for either. A changed or undocumented producer envelope is compatibility evidence, not proof that historical and current formats are equivalent.

## Preflight and approval gates

1. **Agree on scope.** Select smoke or full suites, OS, spend/time limits, evidence location, and the approving human. Review the manifest and applicability table. Do not run native VS Code or real Squad while merely preparing this document.
2. **Approve build and installation.** Obtain approval to build/run tools and install/run the exact VSIX in an isolated environment. Use the organization's configured package registry; do not switch to the public npm registry. A builder can supply an already-built, traceable VSIX instead. Inspect the checked-out `package.json`; current requirements are VS Code **1.107 or later** and Node **22.13 or later** for builds.
3. **Prepare the artifact.** On the intended clean product commit, the builder runs `npm run install:all` if dependencies need restoration, then `npm run verify`, then `npm run package`. Record the exact commands and outputs; packaging invokes the build through the prepublish hook and audits pet packaging. Hash the resulting VSIX. Do not reuse stale `dist` output or an unnamed older VSIX. An F5 development-host run is separate evidence, not a substitute for VSIX installation.
4. **Approve isolation and workspace setup.** Use a fresh VS Code user-data directory and extensions directory, with Settings Sync off and only required extensions. VS Code's `--user-data-dir` and `--extensions-dir` options can isolate local desktop runs; pass both on installation and every test launch. Record the actual directories. A named profile alone does not isolate external CLI logs. Preserve normal profiles, settings, terminals, and workspaces.
5. **Prepare disposable data.** Create A and B under a dedicated run directory, not inside the product checkout. Use nonsecret files and a reviewed disposable Squad team. Record roster names, charter slugs, template source and expected visible members. Use existing approved local templates, or obtain approval for any new software/template initialization. Keep a second empty folder and a legacy `.ai-team` fixture for negative/source-selection checks.
6. **Approve log scope before reading.** In the isolated profile, set `squad-pod.liveActivity=false`, `squad-pod.directorySuggestions=false`, and `squad-pod.autoShowPanel=false` before opening Directories or enabling live activity. Suggestions default to **true** and can read local CLI working-directory metadata independently of live consent. The extension resolves an absolute `COPILOT_HOME`, otherwise the user's `.copilot` home. If using a dedicated log root, verify that the installed CLI also supports and actually writes there, and launch the isolated extension host with the intended environment. Do not assume the variable changes the CLI. If isolation is unavailable, obtain separate approval for the exact existing metadata/events paths or block the log-dependent cases. Never bulk-read real home logs.
7. **Approve trust, authentication, and spending separately.** The human handles required authentication without sharing credentials. A launch approval must name the workspace, command, bounded task, data access, and spend limit. Trust only reviewed disposable content after explicit approval; do not bypass Restricted Mode or security warnings. Permission prompts belong to the CLI/host, not Squad Pod.
8. **Capture the baseline.** Inventory terminal ownership and settings; export or copy any run-owned layout before changing it. Keep fixture evidence separate from actual producer output. Preapprove no deletion: cleanup that removes files, profiles, saved entries, or asset registrations needs its own scoped approval under Scout's policies.

If Scout cannot observe a required control or source with its available tools, record BLOCKED and hand that step to the user. Do not substitute invented controls or hidden APIs.

## Source and timing reference

Recheck these contracts against each new product SHA before running affected tests.

| Surface | Current contract and oracle |
|---|---|
| Native activation | **Squad Pod: Show Panel** (`squad-pod.showPanel`) and **Squad Pod: Export Default Layout** (`squad-pod.exportDefaultLayout`). `autoShowPanel` defaults off; it only focuses once on extension activation, not on each refocus, and never starts a process. |
| Workspace choice | First workspace folder containing `.squad` or `.ai-team`; otherwise first folder. `.squad` takes precedence over `.ai-team` when both directories exist, even if its roster is missing. A launch directory does not switch the observed root. |
| Roster | Table under `## Members` in `team.md`; charter folder supplies the slug. Scribe roles, silent rows, and Ralph in a monitor role are hidden from the office. Team information can list hidden members. |
| File observations | Sessions, Markdown logs, orchestration logs, decision inbox, and agent files. Initial scan is a historical baseline, not a live replay. Changed files infer activity; the watcher does not establish a supported producer API. `usage.jsonl` never drives activity. |
| Historical sessions | `.squad\sessions` JSON envelopes require `id` and `createdAt`, with optional `agent`, `lastActiveAt`, `messages`. They are not Copilot CLI `events.jsonl` envelopes. Do not manufacture them to claim a real producer works. |
| Live discovery | Opt-in local CLI session-file integration. `session-state\<id>\workspace.yaml` supplies exact `cwd`; `events.jsonl` must contain the top-level Squad selection marker. Chooses newest matching candidate by session-directory modification time within bounded discovery. The model projection's field contract is pinned to the shipped Copilot CLI 1.0.105 event declarations; local file access is not a supported Squad Pod API. |
| Live identity | Case-insensitive exact visible roster **slug** only in the current provider (ID and folder are the same slug). The supported task shape is `task` with `agent_type=general-purpose` and the exact member slug in `arguments.name`, followed by correlated subagent/tool IDs. Display-name guesses, first-name guesses, unknown names, and ambiguous case-folded collisions must not attach to another member. File-observed aliases are a separate, more permissive mechanism. Live task activity is a transient overlay on the authoritative roster; it does not create durable parent/member edges or mutate `team.md`. |
| Live display | Short task description (40 characters), labels (30 characters), file basenames and command names only. `view` reads, `edit` edits, `create` writes. Context requires a tool completion's finite `toolTelemetry.metrics.context_current_tokens >= 0` and `context_token_limit > 0`. Never infer these from historical token totals. |
| Observed transient tasks | Telemetry lists session-local `task` calls separately from roster animation and recorded usage. Same names with distinct call IDs stay separate. Only uniquely exact visible slugs with `agent_type=general-purpose` receive a roster match; unknown names and other types remain visible but unattributed. Parent links require an explicitly observed, retained same-session parent and an acyclic chain; otherwise `Parent: unknown`. This is not durable hierarchy or membership discovery. |
| Recorded usage | Selected Squad directory's `log\usage.jsonl`, complete newline-terminated version-1 `turn-start` and `usage` records. A pinned `squad` 1.1.0 shell explicitly wires this ledger; `copilot --agent squad` is distinct and not guaranteed to emit it. Every valid complete local usage row is summed without time/member filters or usage-row deduplication; at most 40 recent reports. Estimated cost is the producer's USD estimate, not invoice-grade billing. Historical ledger reports are not current model or live context. |
| CLI usage export | Separate VS Code-only **Copilot CLI usage export** section: **Select CLI usage JSON...**, native confirmation, **Refresh selected export**, **Forget export**. In-memory, exact workspace-local regular JSON selection, manual reads only; no home/session discovery, producer writes or launch. CLI 1.0.105 shipped metrics projection, source-pinned synthetic fixtures only; real-export compatibility acceptance remains BLOCKED pending a separately approved existing sanitized export. Premium-request cost and optional nano-AI units are not USD. No source/model/agent/provider rollup, invented turn coverage or current-model/context update. Session/workspace/agent identity, completeness and resumed history stay unknown. Standalone import is unavailable. |
| Telemetry drawer | Header **Telemetry** with **Clear activity** (activity feed only; observed tasks, ledger and imported CLI usage unchanged). Content order: **Activity events (N)**, **Recorded usage / model history - state**, separate **Copilot CLI usage export**, **Observation settings and consent** (opens Settings, enables nothing; read-only notice in observer), **Activity source diagnostics**, then **Observed transient tasks**. Missing/idle sources are not zero usage. |
| Layout persistence | `.squad-pod\layout.json`, then valid workspace cache, then bundled default, then minimal fallback. Drafts are not disk saves. Save checks raw disk revision and workspace identity; prior disk contents get recovery files under `.squad-pod\recovery`. Panel recovery state is not a durable backup. |
| Timing | File polling 1 second plus native notifications (150 ms debounce); file activity idle timeout 30 seconds renewed on each activity. Live polling 1 second, discovery 5 seconds, stale after 5 minutes without new bytes; a correlated live run is not subject to the 30-second file timer. Usage and layout polling 2 seconds. |

For responsive checks, allow **10 seconds** after a settled change (discovery plus polling) and record actual latency; repeat once if host load obscures the result. For file-only idle, observe through **40 seconds after the last attributable write**. For live staleness, observe through **5 minutes plus 10 seconds**. These are execution windows, not product SLAs. Persistent delay with a verified source is FAIL; an absent producer is NOT-PRODUCED. Do not extend billable work just to reach a timeout.

## Applicability and suites

Create one row per check/subcheck with the implementing commit, prerequisite, and evidence class. Unless those prerequisites change, use these defaults:

| Check | Applicability |
|---|---|
| Native controls, editor, layouts, directory catalog | Implemented at the reference SHA; test in the installed VSIX. |
| Real file activity, live lifecycle/tools/context, usage | Require separately observed producer sources; record each missing capability as NOT-PRODUCED after an approved run, or BLOCKED if no run is authorized. |
| Explicit CLI usage import (U-01/R-05 subchecks, no new case ID) | Applies only to rebuilt artifacts containing `src/cliUsage.ts` and the separate Telemetry import controls. Source-pinned synthetic fixtures establish parser/host/webview behavior only. Native dialog/consent checks require the installed VSIX. REAL compatibility remains BLOCKED until an explicitly selected, approved existing sanitized export, exact CLI version/argv, cwd binding, completion observation and resumed/non-resumed status are supplied. Do not close #109 or claim parity from fixtures. Standalone has no importer; verify its explicit unavailable notice without offering file selection. |
| All nine bundled floor styles selectable | Implemented by [#78](https://github.com/swigerb/squad-pod/pull/78), merged as `a706de0b286dc393c032b743707ad497046d1cdc`. IDs are 1-7, 9 and 10; new ID 10 maps to `floor_7.png` (source pattern index 7). Legacy IDs retain meaning and 8 remains VOID. L-05's nine-style checks apply to rebuilt artifacts containing this commit; on older artifacts record that subcheck BLOCKED / NOT IMPLEMENTED. |
| Session-local observed task inventory and explicit parent links | Implemented by [#80](https://github.com/swigerb/squad-pod/pull/80), merged as `111e0641ef0daaf60e828d344e8be87ed7df26c2`. R-06 applies only when its code is in the rebuilt, installed artifact. Real coverage still requires emitted task metadata; fixture coverage cannot establish that the producer emits it. |
| Durable parent-child hierarchy, authoritative teammate deduplication/promotion | [Transient hierarchy and identity contract](team-hierarchy.md): running explicit-parent calls render temporary subtask characters, deduplicated by producer instance identity; exact custom-agent selection can reconcile to an existing roster member. These are session-local, not durable hierarchy or automatic membership promotion. Durable hierarchy/promotion remain unsupported by the pinned Squad producer; runtime model display is a separate #110 capability. Native subchecks need the exact implementing commit and approved actual emitted data. |
| Squad Info member details and charter states | Implemented by [#94](https://github.com/swigerb/squad-pod/pull/94) ([acceptance](https://github.com/swigerb/squad-pod/pull/94#issuecomment-6529102656)) for [#88](https://github.com/swigerb/squad-pod/issues/88). Applies to N-03 steps 2-6 in artifacts containing the accepted source; on older artifacts record those subchecks BLOCKED / NOT IMPLEMENTED. |
| Squad Info live status/count, stale-response rejection, and keyboard focus | Implemented by [#106](https://github.com/swigerb/squad-pod/pull/106) (head `f2ae14ac4f26383007c8742c084e410e4c01fa92`) for [#99](https://github.com/swigerb/squad-pod/issues/99) and [#100](https://github.com/swigerb/squad-pod/issues/100), with [parent acceptance](https://github.com/swigerb/squad-pod/pull/106#issuecomment-6531135965). N-03's regression subcheck is applicable in artifacts containing this source. Report its installed production-browser/mock-boundary evidence as BROWSER / FIXTURE only; it is not NATIVE or REAL acceptance. |
| Standalone read-only observer/browser runtime | Implemented by [#82](https://github.com/swigerb/squad-pod/pull/82) ([acceptance](https://github.com/swigerb/squad-pod/pull/82#issuecomment-6527080180)); telemetry labels by [#92](https://github.com/swigerb/squad-pod/pull/92) ([acceptance](https://github.com/swigerb/squad-pod/pull/92#issuecomment-6528183133)); read-only Squad Info by [#94](https://github.com/swigerb/squad-pod/pull/94). Includes an authenticated loopback listener and production browser office for one explicit local project; the office stays read-only by default. Use F-02's procedure, exact installed-package identity and separate approvals. Existing synthetic evidence is not a user-run project observation or NATIVE/REAL acceptance. |
| Standalone owned terminals | Implemented by [#93](https://github.com/swigerb/squad-pod/pull/93) ([acceptance](https://github.com/swigerb/squad-pod/pull/93#issuecomment-6528461097); [exact-head CI](https://github.com/swigerb/squad-pod/actions/runs/41093901469) and [post-merge CI](https://github.com/swigerb/squad-pod/actions/runs/41094658138) include the scoped macOS standalone source-build job): opt-in `--terminals`, separate terminal credential/cookie, fixed `copilot --agent squad` in the canonical selected project, PTY reconnect/replay/resync and owned-run close/shutdown. Use F-02's owned-terminal procedure. Synthetic `--fixture` evidence is FIXTURE; a REAL subcheck requires a separately approved, spend-bounded real launch. |
| Standalone live observation | Applicable only to artifacts containing [#112](https://github.com/swigerb/squad-pod/issues/112)'s `--live-activity` flag. Use F-02's optional live-observation procedure below, independently of terminal/control authority. Default-off observation remains file-only. This reuses the bounded native live adapter, preferring an exact server-generated owned-session UUID and otherwise explicitly labeling project fallback/unavailable correlation. Synthetic installed Edge/session evidence is BROWSER/FIXTURE, not REAL or NATIVE. |
| Selected-project authenticated office controls | Implemented by [#95](https://github.com/swigerb/squad-pod/pull/95) for [#90](https://github.com/swigerb/squad-pod/issues/90), with [parent browser acceptance](https://github.com/swigerb/squad-pod/pull/95#issuecomment-6530351013). F-02's office-control procedure covers separate authority, revision-protected layout/seat/settings writes and browser draft/import/export/recovery. This browser evidence is not native or real-session approval. |
| Unavailable observed activity time | Implemented by [#98](https://github.com/swigerb/squad-pod/pull/98) for [#97](https://github.com/swigerb/squad-pod/issues/97): zero or invalid activity timestamps display **Activity time unavailable**, not an epoch-derived age or invented timestamp. Check N-03/F-02 without adding a case ID. |
| Truthful attributable activity time | Tracked by [#119](https://github.com/swigerb/squad-pod/issues/119): a never-observed native roster member has no timestamp; initialization, reconnect/replay, file hints, and idle/status bookkeeping do not create or advance one. Only attributable live lifecycle/tool events with validated producer timestamps update it, and replay retains that source time. Future producer timestamps are ignored and surfaced as clock skew; a later valid event can update the time. Both native detail surfaces say **No attributable activity observed** while none exists. Keep #97's zero/invalid formatting behavior unchanged. |
| Conference-table accessory depth composition | Implemented by [#105](https://github.com/swigerb/squad-pod/pull/105) for [#103](https://github.com/swigerb/squad-pod/issues/103), with [parent production-browser acceptance](https://github.com/swigerb/squad-pod/pull/105#issuecomment-6531386399) and exact-head Ubuntu/Windows/macOS CI green. L-06's conference-table subcheck applies to artifacts containing the accepted source. Evidence is a strict-CSP production-bundle fixture with mocked VS Code/save boundary, not installed-package persistence, native VS Code or REAL acceptance. |
| Mobile office and owned-terminal interactions | Implemented by [#107](https://github.com/swigerb/squad-pod/pull/107), with [parent acceptance](https://github.com/swigerb/squad-pod/pull/107#issuecomment-6532361962), all three [exact-head CI jobs](https://github.com/swigerb/squad-pod/actions/runs/41119576933) green, and all three [post-merge CI jobs](https://github.com/swigerb/squad-pod/actions/runs/41120201090) green. F-02 applies to artifacts containing this source. The accepted installed tarball SHA-256 is `c10db8ac97e1a007dddc4ee1d6bd0d6ee81db026c9e1faa1840720f41267ac59`; the final source delta was test-fixture-only. Installed Edge touch emulation with synthetic PTYs is BROWSER/FIXTURE evidence, not physical-device acceptance; iOS/Android touch and software-keyboard behavior remain unverified. |
| Remote access/TLS and persistent credentials | Not implemented or claimed. Do not add a remote binding, tunnel, TLS bypass, or persistent credential flow to satisfy acceptance. |
| Declared and runtime model metadata | Declared model metadata was implemented by [#96](https://github.com/swigerb/squad-pod/pull/96) for [#89](https://github.com/swigerb/squad-pod/issues/89), with [maintainer acceptance](https://github.com/swigerb/squad-pod/pull/96#issuecomment-6529523669) and all three [exact-head CI jobs](https://github.com/swigerb/squad-pod/actions/runs/41100753921) green. Runtime model observation is implemented separately by #110; apply the F-01 model procedure only to artifacts containing that source. Producer-contract verification and synthetic tests are not REAL-session evidence. |
| File-activity task-hint quality | Implemented by [#104](https://github.com/swigerb/squad-pod/pull/104) for [#101](https://github.com/swigerb/squad-pod/issues/101), with [parent acceptance](https://github.com/swigerb/squad-pod/pull/104#issuecomment-6531622824), exact-head CI [41113975613](https://github.com/swigerb/squad-pod/actions/runs/41113975613) green and post-merge CI [41114745909](https://github.com/swigerb/squad-pod/actions/runs/41114745909) green. R-03's file-hint checks apply to artifacts containing the accepted source. Report synthetic and installed-browser evidence as BROWSER / FIXTURE only, not NATIVE or REAL acceptance. |
| Bounded usage-producer research ([#102](https://github.com/swigerb/squad-pod/issues/102)) | The research itself implemented no importer or read authority. The later explicit #113 importer has the separate scope and acceptance boundary above; it never creates a ledger. Missing ledger after a supported native launch remains missing/unavailable, not zero consumption or collector failure. |

**Quick smoke (about 15-25 minutes after setup):** N-01, N-02, N-04, D-01, L-01, L-02, U-01, V-01, X-01. With separate real-run approval, add D-03 and R-01 through R-03 using one small task, and inspect R-06's basic list if that task emits metadata. Record unselected R-04, R-05 and remaining R-06 subchecks as BLOCKED, not as smoke passes.

**Full suites:** All N, D, L, U, V, R, F, and X cases below, including conditional rows and explicit gaps. Reuse an approved real task across observations to avoid extra spending. Run native-only and fixture cases even when real producer integration is unavailable. A smoke pass is not full acceptance.

### Common case setup, evidence, and cleanup

Every case inherits the completed manifest, approval gates, isolated profile, and disposable workspace A. Do not proceed when its additional setup is missing. Each result references the Run ID, test ID, subcheck, timestamps, exact installed artifact, evidence class, source status, and approval. Capture before/after screenshots or short video, relevant run-owned file hashes/diffs, and redacted diagnostics as specified.

After each case, close its dialog, leave data in the last documented safe state, and record deviations. Export valuable drafts before panel disposal or workspace changes. Restore only run-owned settings/files from the recorded baseline; stop only the exact test process/terminal you own after approval. Do not delete anything automatically. X-01 governs final cleanup and rollback. Case-specific cleanup below supplements these rules.

## Native host suite

### N-01: Install, activate, and reload

- **Setup:** Approved, identified VSIX; blank isolated environment; live activity and suggestions disabled.
- **Actions:** Install the intended artifact with both isolation directories in effect. Confirm its loaded identity. Open A, run **Squad Pod: Show Panel**, hide/show the panel, then use **Developer: Reload Window** and open the panel again. Check the native Output channel **Squad Pod** and host errors.
- **Expected:** Office loads with assets, roster and source status; no duplicate characters, missing-resource/CSP errors, CLI launches, or unrelated-terminal changes. A full host reload reestablishes observation; hiding/showing does not duplicate watchers or agents.
- **Evidence:** Install identity comparison, command/panel screenshots, source root and redacted host diagnostics.
- **Cleanup:** Keep A open; retain installation evidence.

### N-02: Roster identity, appearance, and seats

- **Setup:** A has a reviewed roster with at least two visible members and known hidden members, plus valid charter files.
- **Actions:** Compare roster with characters and team information. Select one member, then another free seat. Reload; reorder roster rows and change one display name without changing its charter slug. Add one disposable member, then remove only that row after approval.
- **Expected:** Exactly the visible roster appears. Existing members retain identity, appearance and seats through reload/reorder; no duplicate or ghost members. A newly added member appears, and removal does not remove other members. Only the executor's explicit roster edits change `team.md`; observed activity never mutates the roster or promotes an unknown task name to a member.
- **Evidence:** Roster diff, slug-to-character/seat table and before/after screenshots.
- **Cleanup:** Restore the approved roster snapshot and seat baseline; keep identity evidence.

### N-03: Click, keyboard, details, and charter

- **Setup:** N-02. In A, visible member M1 has a run-owned `charter.md` with a `#` title followed by a summary paragraph, a `- **Expertise:** …` line, and `## Responsibilities` (or `## What I Own`) and `## Boundaries` sections. Disposable visible member M2 has no charter file. For the unreadable path, use a reviewed run-owned charter copy that is larger than 64 KiB or is not valid UTF-8; do not change permissions on, or corrupt, any file you do not own.
- **Actions:**
  1. **Agent card:** Click character, name, occupied desk and occupied chair. Focus the member label and press Enter, then Space. Inspect the card and **View Charter**.
  2. **Squad Info access:** Open **Squad Info** from the bottom toolbar. Confirm the dialog is named "Squad Info", then close it with **Close Squad Info**, Escape and an outside click. Reopen it, Tab to a member row ("Show details for <name>") and expand it with Enter, then Space; collapse it ("Hide details for <name>"). Repeat with the mouse.
  3. **Declared details:** Expand M1. Record **Observed status**, **Observed task**, **Charter summary (from charter.md)**, **Declared expertise**, **Declared responsibilities**, **Declared boundaries** and **Recent activity (from workspace activity logs; no timestamps supplied)**. Expand **Charter source text**, then choose **Open charter**.
  4. **Refresh and removal:** Collapse M1, edit only the run-owned charter's summary and one declared section, then expand again. Remove M2's disposable roster row (approved in N-02) while its row is expanded. Confirm the detail row closes/is removed and the unavailable-member message appears. Restore M2's approved roster row from the N-02 snapshot without adding a charter file, then wait for the roster row to reappear before continuing.
  5. **Missing/unreadable:** Expand the restored M2 row (still missing its charter) and the unreadable copy's member.
  6. **Read-only observer (BROWSER, only with F-02's approval):** In F-02's observer office, open **Squad Info** and expand a member.
- **Expected:**
  - The correct member's details appear from every entry point. **View Charter** and **Open charter** open that member's own native `charter.md` (history fallback, folder reveal or explicit unavailable notice where appropriate). No interaction opens a terminal; selecting another seat moves the selected member.
  - A never-observed native roster member retains no activity timestamp through initialization, reconnect/replay, file hints or idle/status bookkeeping. The agent card and expanded Squad Info both say **No attributable activity observed**. An attributable live event displays its validated producer timestamp as a relative age; replay does not advance it. A future timestamp is not displayed as fresh activity; if a prior valid timestamp exists its age remains visible with a clock-skew notice, and a later valid event clears that notice. Do not treat approximate file hints as a live timestamp.
  - The dialog and disclosures work fully by keyboard; `aria-expanded` follows the visible state; "Loading observed details…" may appear only briefly.
  - Declared fields show only text present in that charter; absent sections are omitted, never inferred from role, history or activity. **Charter source text** is inert plain text: Markdown is not rendered, links are not active and nothing executes.
  - Every expansion requests fresh details: the edited summary and section appear without reload, with no stale same-ID cache. A removed member shows "This agent is no longer available in the current workspace."
  - Missing charter shows "Charter content is missing." and "Charter text is missing."; the unreadable copy shows the same messages with "unreadable", with no partial text or declared fields.
  - Read-only observer: Squad Info is available with observed status/task only. Charter content reads "unavailable", **Open charter** is disabled, and the note says opening a charter in the editor is unavailable in the read-only observer. Open the member's agent card too: with `lastActiveAt` unavailable/zero, expect **Activity time unavailable**, never an age measured from the Unix epoch or a fabricated activity time. A known valid timestamp still shows its relative age; test invalid/nonfinite values only through a reviewed synthetic component fixture. Project hashes are unchanged.
- **Evidence:** Member-to-native-file path mapping, keyboard capture, before/after charter hashes for the refresh step, and screenshots of the missing, unreadable and read-only states.
- **Cleanup:** Close test editors/cards/dialogs, restore the run-owned charter copies and roster snapshot, and restore any moved seat.

#### Squad Info live and keyboard regression (#99 / #100)

Keep Squad Info open with a member expanded through idle -> active -> changed task -> idle.
Member status/task and the active count must follow the selected workspace without collapsing
the member, moving focus, or rereading charter/model metadata on every activity event. A
missing observation is unavailable, not idle. Remove the member or switch workspaces while
a detail reply is pending; old replies must not restore removed members or prior-workspace data.
Tab and Shift+Tab stay within the dialog, Space and Enter activate native buttons, and closing
returns focus to the opener. With the dialog closed, focus/click the office canvas and verify
Space-drag still pans; Space and editor shortcut letters must remain ordinary text in inputs.
The installed production-browser harness exercised both wide and narrow viewports with a
mocked VS Code boundary; record this separately as BROWSER / FIXTURE, never as native or
real-session sign-off. The user's installed-VSIX reproductions were issue reports, not a
completed 27-case acceptance report.

The bounded synthetic production-browser counterpart is
`node scripts/acceptance-interaction.cjs --squad-info-only --evidence <local-results-directory>`
after `npm run build`, using an existing Playwright installation via `PLAYWRIGHT_MODULE`
and an existing Edge executable via `EDGE_PATH` where needed. It captures both 1280x900
and 360x640 with source SHA/dirty state and bundle hashes. This is **BROWSER / FIXTURE**
evidence with a mocked VS Code boundary, not NATIVE or REAL acceptance.

### N-04: Startup history and source selection

- **Setup:** Live off. Before opening A, place clearly labeled historical fixtures in its sessions/log/orchestration/decision/agent directories. Keep B distinct. Use a legacy-only folder, a folder with both state directories, and an empty folder in separate subchecks.
- **Actions:** Open A and observe before making writes. Check **Settings** source status. Change workspace folder ordering/add/remove folders to exercise the selection rule. Open legacy-only and empty workspaces; return to A.
- **Expected:** Historical files do not replay as fresh activity on startup. Empty/missing roster is explicit rather than showing a stale team. Selected root follows the reference rule; `.squad` wins over `.ai-team`. B's members/events never silently populate A. This is fixture/native evidence, not evidence that Squad emitted these envelopes.
- **Evidence:** Fixture inventory/timestamps, ordered workspace-folder list, status and idle screenshots.
- **Cleanup:** Export drafts before switches; restore A's folder order. Retain fixtures as labeled fixtures.

### N-05: Default-off consent, off clearing, and privacy

- **Setup:** Approved isolated CLI log scope. Record independent settings for live activity and directory suggestions.
- **Actions:** Verify default live off. Request live activity, cancel its native confirmation, and verify it stays off. After explicit log-read approval, enable via **Live Activity (opt-in)** (also reachable from Telemetry's **Observation settings and consent**) and accept **Enable Live Activity**. Confirm opening Settings from Telemetry enables nothing by itself. During R-02/R-03, turn it off with tools/context visible. Reload the host and verify no silent consent bypass. Test an unavailable source without accessing unapproved paths.
- **Expected:** Cancel starts no live reader. Enabled status distinguishes off/searching/following/error in Settings and in Telemetry's **Activity source diagnostics** (`Live CLI observer`); missing status reads unavailable, not off. `following` alone is not proof of attribution. Off stops the live reader and clears tool/context displays; file observation may still show activity. New host consent is required before reading again. Prompts, full paths, tool arguments/outputs and shell flags are absent from live display/retained telemetry; allowed short task descriptions must also contain no secrets.
- **Evidence:** Consent decisions, settings/source status and before/after clearing. Where an approved read monitor is available, capture scoped reads; otherwise mark the internal no-read assertion BLOCKED, not proven by a screenshot alone.
- **Cleanup:** Set live off and suggestions off; retain no raw private events. Any privacy leak stops the run.

### N-06: Settings and notification sound

- **Setup:** Isolated settings baseline; approved audible output; a visible member can transition active to inactive (fixture or R-02, labeled accordingly).
- **Actions:** Verify Sound Notifications defaults on, Debug View off, Show Named Areas off. Toggle each and reload. Test active-to-inactive with sound off and on; open diagnostics. Set `squad-pod.autoShowPanel=true`, reactivate/reload, then refocus windows; repeat false.
- **Expected:** Settings persist in this isolated environment. Sound off is silent; on gives a short chime for the transition, not recurring idle chimes. Debug View provides diagnostics and Areas toggles overlay only. Auto-show focuses once per activation, never launches Squad or terminals. Muted audio or an unobservable device blocks audible confirmation.
- **Evidence:** Settings snapshots, transition timestamps/audio observation and terminal inventory.
- **Cleanup:** Restore isolated setting baseline, including auto-show false.

## Directory and launch suite

### D-01: Add, edit, validate, and suggest directories

- **Setup:** A observed; disposable B with a path containing spaces; suggestions off.
- **Actions:** Open **Directories**. Add B with a unique name; use **Save name** and **Change folder** to another disposable path. Cancel a picker. Try an empty/duplicate name, duplicate workspace/saved path, nonexistent path, and file instead of folder. After metadata-read approval only, enable suggestions and choose a **Recent Squad directories** item.
- **Expected:** Workspace folders, saved directories, and recent launch requests are distinct. Valid edits persist; invalid inputs report errors without saving or launching. A suggestion fills the form only: it neither saves nor launches. Suggestions remain absent/off when their setting is false; do not infer privacy from live consent alone.
- **Evidence:** Catalog snapshots, validation messages, saved-entry identity and terminal counts.
- **Cleanup:** Disable suggestions; leave only documented run-owned entries pending approved cleanup.

### D-02: Trust and PATH failures

- **Setup:** Separate disposable Restricted Mode window and an approved isolated host environment without Copilot on PATH. Do not edit the machine's global PATH.
- **Actions:** If the extension is available in Restricted Mode, attempt Launch. In the trusted test window without Copilot on its host PATH, attempt Launch again.
- **Expected:** Trust rejection or host-level extension restriction prevents launch. Missing PATH reports the Copilot executable was not found and creates no terminal/process. Do not install/authenticate or grant trust to force a pass. If host restrictions prevent reaching the extension's trust guard, record that subcheck BLOCKED and the host restriction separately.
- **Evidence:** Trust state, approved PATH summary, error and unchanged terminal inventory.
- **Cleanup:** Return to the recorded isolated host environment.

### D-03: Explicit real launch and terminal ownership

- **Setup:** Separate approval for running `copilot --agent squad` in B, trust, authentication and bounded AI spending. A stays observed. Create an identifiable, idle unrelated test terminal first.
- **Actions:** Click B's **Launch** once. Verify the new terminal name `Squad: <directory name>`, actual cwd, submitted command, and CLI startup. Use the bounded task below only after approval. Hide/show and close/reopen the native panel. With separate removal approval, remove B's saved entry while its terminal exists. Optionally forget its run-owned recent launch after approval.
- **Expected:** One explicit click creates one new normal VS Code terminal; no deprecated `squad shell`, embedded terminal, automatic launch on refocus/reload, or process start from catalog edits. Recent request records prove submission only, not CLI success. A remains the observed office. Panel closure or directory removal must not kill either an unrelated terminal or an already launched terminal; removal/forget does not delete folders.
- **Evidence:** Before/after terminal IDs, cwd, command/startup outcome, request timestamp and unchanged A source root.
- **Cleanup:** Leave the unrelated terminal untouched. Ask to stop only the owned CLI session when its observations finish; document any running terminal.

## Real Squad session suite

Use the supported **`copilot --agent squad`** process. Do not start a deprecated Squad shell to populate telemetry. Use the workspace's actual agent/template and observe its output rather than imposing a made-up format.

After approval, hand this bounded request to the disposable Squad session. Replace the placeholder with an actual visible member slug; this is a natural-language request, not a guarantee of tool names or envelopes:

```text
In this disposable workspace only, ask <exact-visible-member-slug> to read
acceptance-input.txt and summarize it in two sentences. Do not access files
outside this workspace, browse the web, install anything, commit, or publish.
Then, only if separately approved, ask the same member to create
acceptance-result.txt with that summary and revise one word in that file.
Stop after these small tasks. Ask before any additional command or spending.
```

Prepare `acceptance-input.txt` with a few nonsecret sentences. A harmless unique marker in its content can test that tool outputs/full content do not leak; keep secrets out of the task description too. Use two small turns for usage comparison. Do not force delegation, failures, retries or long paid tasks solely to make the visualization move. If the runtime does not produce correlated member events, record that limitation.

### R-01: Producer discovery and exact workspace attribution

- **Setup:** Actual approved run in A; live-read approval/consent; B has a distinguishable session if separately approved.
- **Actions:** Compare Settings' observed root/source ID with the approved session metadata's cwd and timestamps. Inspect only approved, bounded producer excerpts for the Squad marker and task/lifecycle shapes. If there are multiple sessions, record which eligible candidate is newest by directory modification time; do not assume last event time controls discovery.
- **Expected:** Source selection uses the exact observed workspace and Squad marker; B or a non-Squad session cannot attach to A. Short source IDs alone cannot prove identity. Discovery examines at most 500 entries and considers 32 recent candidates; marker scans cover the head/tail 64 KiB, and replay uses at most the last 2 MiB with 64 KiB line limits. An out-of-bound marker/session or changed producer shape is a documented compatibility gap, not a functioning producer.
- **Evidence:** Redacted cwd/session/time correlation and field-presence matrix; format/version mismatch details. If no qualifying events exist, real discovery/attribution is NOT-PRODUCED.
- **Cleanup:** Keep approved evidence projections only; never edit real logs to force discovery.

### R-02: Continuous activity, completion, wait, and fallback

- **Setup:** R-01 has an actually correlated visible member; record emitted lifecycle and attributable file writes separately.
- **Actions:** Observe task start, repeated work, and natural completion. If work naturally lasts longer than 30 seconds, observe across that boundary without extending it. With live off, observe actual Squad file writes and eventual file-only idle. Record a wait/failure/abort only if the runtime naturally emits it. If permitted, leave the session quiescent to observe stale clearing.
- **Expected:** Member stays present when work ends. File writes renew the 30-second idle timer; idle follows the last attributable write, not the first. A correlated live run stays active until completion/failure/abort or source clearing, not a file timer. Finish clears task/tools/context and returns idle. After 5 minutes without new bytes the live source clears and searches. Current file watcher emits active observations; the live reader has no dedicated permission-wait event mapping. Do not require a waiting indicator from a source that does not supply a supported wait signal, or call inferred idle proof of completion.
- **Evidence:** Timeline pairing actual source events/writes with visible state, including timer boundaries. Unemitted lifecycle/wait subchecks are NOT-PRODUCED; unsupported wait mapping is BLOCKED / NOT IMPLEMENTED. Short tasks do not prove continuous activity beyond 30 seconds.
- **Cleanup:** Turn live off after dependent cases; leave no unapproved work running.

### R-03: Tools, read-versus-work poses, context, and privacy

- **Setup:** Correlated actual member run; native observation and approved bounded field inspection.
- **Actions:** Observe read, create/edit, and any naturally used shell/search tools. Compare tool labels with emitted names/IDs. When context metrics exist on a completion, compare counts and percentage. Check label alignment while sitting/walking and after tools finish. Turn live off and verify clearing (N-05).
- **Expected:** Read operations use supported reading animation, not typing/walk frames mislabeled as reading; edits/writes use work poses. Tool start/done correlate to that member, not the coordinator or another run. Basenames/command names appear without arguments, full paths or content. Gauge percentage is rounded `100 * current / limit`, clamped to 0-100; counts remain the source counts. Tool completion can update context, and run finish/off clears it. Missing metrics show no fabricated gauge and are NOT-PRODUCED for context integration, not 0%. Unsupported tool names/shape are compatibility evidence. Separately, file-derived task text excludes HTML comments, empty scaffolding and structural headings, uses a neutral file-change hint when meaningful text is absent, identifies itself as a file hint rather than a live task, honors live-source precedence, and clears/relabels when file activity expires. Cover comment-only history, meaningful updates, idle expiry and live/file overlap; do not edit the underlying history files. The fallback wording is surface-specific: in native VS Code, expect the **File activity hint** label with `File changed: <basename>` from the watcher; in the standalone observer, expect **File activity hint: Approximate local file activity (not live tool execution)**. Do not require the standalone wording in native VS Code. The accepted 14-check installed observer run proves only BROWSER / FIXTURE coverage; repeat the functional check against the intended native artifact, and require an approved real source for REAL producer claims.
- **Evidence:** Short native video plus redacted tool IDs/names and metric-only projection. Observe current values without exposing raw arguments.
- **Cleanup:** Retain only redacted projection; clear live displays.

### R-04: Unknown identities, collisions, and session replacement

- **Setup:** Safe actual emitted negative examples if available. Otherwise use a separately labeled fixture-only log root whose isolation has been verified; never alter actual CLI history. Prepare visible slugs that collide under case folding in the disposable roster.
- **Actions:** Exercise an exact valid slug, unknown name, ambiguous collision, display-name/first-name near match, wrong parent/tool ID, and wrong workspace. In fixtures, replace/truncate the test event file and select a newer eligible session. Reload while a fixture task is in flight.
- **Expected:** Only uniquely exact live slugs and correlated IDs affect the right member. Unknown/colliding/near matches never borrow another identity or context, create roster members, or mutate `team.md`. New source/replaced file clears old tools/gauges; rehydration does not replay seed telemetry as new work or create duplicate members. Reload restores only the valid in-flight state.
- **Evidence:** Case-to-slug/source mapping, fixture provenance and before/after displays. Actual negative examples unavailable means NOT-PRODUCED for real negative coverage; a fixture pass remains FIXTURE.
- **Cleanup:** Restore roster, disable live, and retain fixture files separately pending scoped cleanup approval.

### R-05: Actual recorded usage and correct comparison scope

- **Setup:** Reuse an already approved, completed small REAL task and inspect only the disposable workspace's selected Squad ledger if emitted. Record the exact launcher and version. Do not start another task solely to manufacture a ledger; any additional task requires separate approval. The pinned `squad` 1.1.0 shell explicitly wires `.squad/log/usage.jsonl`; `copilot --agent squad` is a different launcher and is not guaranteed to emit that ledger. Do not treat other event logs or historical session JSON as ledger substitutes.
- **Actions:** Open **Telemetry**; **Recorded usage / model history** is always visible. Expand **Usage coverage and source diagnostics**. If the run emitted a ledger, compare totals, record count, distinct-turn coverage, latest timestamps, attribution and recent history with an independent calculation over complete valid local version-1 records. If the selected ledger is missing, verify that the UI reports missing/unavailable rather than zero. Do not add a collector, importer or file to manufacture output.
- **Expected:** For an emitted ledger, totals sum every valid complete usage event, including repeated events, without time/member filters; coverage uses distinct `turnId` values, not event count or `(sessionId, turnId)` pairs. A matching start covers that turn once; unlinked reports remain visible. Exact unique roster name/slug can attribute historical reports, including hidden roster members; unknown/colliding names remain unattributed. History is newest first, at most 40. Displayed models are historical reports, not a live/current-model selector. Estimated cost is the producer's USD estimate, not invoice-grade/billing cost. Normalized zero/unknown values are not proof that usage was measured. If no ledger appears after `copilot --agent squad`, missing/unavailable is the correct source state: usage integration is NOT-PRODUCED, not zero consumption or collector failure.
- **Evidence:** Record launcher/version, selected project/root, ledger presence/state/path, source version/size/time bounds when present, independent sums and distinct-ID sets, redacted recent reports and comparison-report scope. A separately approved existing `--usage-output-file` export may be explicitly selected in the separate CLI section, never passed to the ledger parser. Record exact version/sanitized argv, cwd binding, completion observation and resumed status. Compare displayed raw quantities against the reviewed export, without sums across sources/breakdowns. Recovered serializer/types and synthetic fixtures do not establish native aggregation, session/workspace identity or completion; keep those unknown. Without that existing export/approval, mark real-import compatibility BLOCKED, not PASS.
- **Cleanup:** Do not create a ledger or convert raw metrics JSON to fill a producer gap. No ledger/fields means that ledger integration is NOT-PRODUCED even if missing-source UI is correct. Forget the selected export; retain only approved redacted evidence. No new paid run/export is authorized by this case.

### R-06: Observed transient tasks, explicit links, and clearing

- **Setup:** Rebuilt, installed artifact containing #80; R-01's approvals and source qualification. Open **Telemetry > Observed transient tasks**. Use actual metadata when produced. Exercise unavailable/edge-case combinations only in the approved fixture log root using the recipe below, with a separate result and evidence class for every subcheck.
- **Actions:** Observe a `task` start before its lifecycle start, then its actual started and terminal events. Compare two same-name calls with distinct IDs, an unknown name, a non-general-purpose call using a roster slug, and a valid general-purpose roster match. Observe an explicit parent call and child link; exercise unknown, self and cyclic parents in fixtures. Send dispatch/tool completion before lifecycle completion; replay a repeated start and late conflicting lifecycle in fixtures. Exercise bounded/truncated metadata and task-history limits. Cancel consent/turn live off, observe staleness, lose/replace the fixture source, reconnect/reopen the panel, and change to a fresh session reusing a call ID. Test **Clear activity** in Telemetry separately from disabling live activity. Compare the roster file/character count and recorded-usage snapshot before and after.
- **Expected:** Call identity is `(sessionId, toolCallId)`, not display name; duplicate names have separate numbered rows. Call start is `observed`, `subagent.started` is `running`, and only `subagent.completed`, `subagent.failed` or `subagent.aborted` sets that terminal state. `tool.execution_complete` is dispatch completion, not task completion; repeated starts cannot rename, reattribute or resurrect an already retained call, and later lifecycle events cannot change its terminal state. Unknown/non-general-purpose calls remain listed as **Unattributed** and never animate/create roster members or inherit member context. An exact general-purpose match can animate the existing member; concurrent same-member calls remain separate inventory rows even though the office has one character. Parent labels reference only retained explicit same-session calls with no cycle, never inferred membership. No task count changes ledger totals or `team.md`; Telemetry **Clear activity** clears activity event rows only, not this source-backed inventory or recorded usage.
- **Expected bounds and recovery:** At most 64 total tasks and 16 recent terminal calls; at capacity, terminal history is evicted before in-flight calls, or excess calls are omitted when all 64 are nonterminal. Coverage is explicitly partial when limits omit source/history/identity. Name over 160 characters is omitted, type/mode are bounded to 160, description to 40; display truncation is disclosed. Call/parent IDs over 160 characters, with outer whitespace or control characters are rejected, not shortened into aliases. Prompt/argument/output content must not leak. Startup/source re-seeding restores only observed/running calls, not old terminal history; reconnect to a still-valid reader preserves its current bounded state without duplicates. Off/searching/error hides and clears task rows; source status alone must not resurrect them. Stale/lost/replaced sources clear old state; renewed source growth can reconstruct only eligible in-flight calls from its bounded seed. A new session cannot inherit old parent links even with a reused call ID or identical shortened source label.
- **Evidence:** Per-subcheck native screenshots/video and field-only correlation of approved session/call/parent IDs, name/type/mode, states and timestamps; roster/ledger before-and-after hashes or snapshots; limit counts and warnings. REAL results require actual emitted metadata. Missing real task, parent or lifecycle metadata is NOT-PRODUCED for that integration, not PASS; fixture successes remain FIXTURE. Do not spend AI budget manufacturing 65 real calls or failures.
- **Cleanup:** Set live off, restore fixture roster/root and run-owned source files only after approval, export any protected layout drafts, and retain redacted evidence separately. Never edit real logs or stop unrelated terminals.

## Recorded-usage fallback suite

#### CLI import contract

The importer projects the Copilot CLI **1.0.105 shipped `UsageGetMetricsResult`**
declaration and raw `JSON.stringify(metrics)` writer inspected in
[#102 artifact 1](https://github.com/swigerb/squad-pod/issues/102/artifacts/1).
[`cli-usage-1.0.105.synthetic.json`](../src/__fixtures__/cli-usage-1.0.105.synthetic.json)
is authored from that contract, not an observed export. Actual producer version is
unverified; file location and session start are not identity or completeness evidence.
Native accumulator overlap, resumed history and all-agent coverage remain unknown.

Interpreted JSON pointers: `/sessionStartTime`, `/totalUserRequests`,
`/totalPremiumRequestCost`, `/totalApiDurationMs`, optional `/totalNanoAiu`, and
`/modelMetrics/*/{requests/{count,cost},usage/{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,reasoningTokens?},totalNanoAiu?}`.
Required last-call token and code-change shapes are validated but not retained/displayed.
`currentModel`, task descriptions, code-change paths, provider/agent breakdowns,
token details and unknown fields are not displayed or used for live state.
Optional interpreted quantities may be omitted, not null; missing says **not reported**.
Fractional raw quantities use round-trip numeric text, not default locale rounding.

One selection replaces one report; repeated refresh never accumulates. No multi-file,
cross-source, parent/agent/provider summation or inferred model-token rollup. Cache,
reasoning and token details are not assumed disjoint. The ledger's sum-every-row
behavior is unchanged. CLI units are premium-request cost (multiplier applied),
milliseconds and optional nano-AI units, never USD or inferred credit conversions.

Bounds: regular workspace-local JSON file, 2 MiB before allocation, strict UTF-8,
one document, depth 8, 1,000 entries per object/array, 10,000 total fields/entries,
128 model keys (128 characters each) and 40 rendered rows. Counters are nonnegative
safe integers; other interpreted quantities finite, nonnegative and at most
`Number.MAX_SAFE_INTEGER`. Unsupported version envelopes, duplicate keys,
invalid JSON/UTF-8 and bounds failures visibly withhold the report, never retain stale
quantities or zero-fill. Links/junctions, hardlinks and workspace escapes are rejected.
Root/file identity changes revoke selection; changed reads fail without quantities.
Consent is exact root/file, in-memory only, with manual refresh and no background
discovery/polling. Standalone import remains unavailable, even with office control.

### U-01: Missing source, partial data, and no deduplication

- **Setup:** Native installed build; a separate disposable fixture workspace, not the actual producer workspace. Back up any run-owned ledger before approved replacement.
- **Actions:** Start with no ledger, then an empty ledger. Add newline-terminated version-1 fixtures: two starts with the same turn ID, another distinct start, repeated valid usage reports for the first turn, and an unlinked report. Use explicit known nonnegative counts/costs and fixed timestamps. Add unknown/ambiguous agent names, an invalid line, unsupported version, and an incomplete final line. Complete that final line later; rewrite the ledger with fewer valid reports. Exercise the documented 2 MiB/10,000-complete-line bounds only with approved fixture files. Separately, after R-05's approved REAL `copilot --agent squad` task, inspect for a produced ledger without creating one; inspect any `--usage-output-file` only as separate raw metrics JSON, not as an input to this parser.
- **Expected:** Missing/empty is unavailable totals, not zero; the always-visible usage section states that a missing/empty/rejected source is not recorded zero and that enabling live observation does not create a ledger. When a REAL `copilot --agent squad` run emits no ledger, report missing/unavailable, not zero consumption or collector failure; ledger integration coverage is NOT-PRODUCED. A raw `--usage-output-file` is not the `.squad/log/usage.jsonl` ledger and can only be selected in the separate CLI importer. All valid fixture ledger usage events count, including duplicates; duplicate starts count once. Distinct coverage, unlinked count, normalized-value warnings and history match the independent calculation. Invalid/unsupported/pending lines produce partial diagnostics; completed data appears after polling. Rewrite replaces totals rather than accumulating stale values. Oversized input withholds totals. Ledger writes alone never animate an agent.
- **Separate CLI fixture subchecks (same U-01 ID):** Use `src/__fixtures__/cli-usage-1.0.105.synthetic.json` only in the approved disposable workspace and label FIXTURE. Cancel selection/confirmation and verify no read/import; confirm selection and verify 2 user requests, 0.5 premium-request cost, 1,200 API ms, 450,000 nano-AI units, and independent model quantities (120 input/30 output/40 cache-read/10 cache-write). Missing reasoning says not reported. Refresh twice: unchanged quantities, no background polling or duplication. Clear activity: unchanged import. Forget, switch workspaces or restart extension: no retained selection. Invalid JSON/UTF-8, duplicate keys, explicit null interpreted metrics, unsupported version, unsafe/fractional counters, oversized/deep/too-many-entry documents, links/junctions/hardlinks, escapes and replaced identities must withhold reports with diagnostics. File changes during read must not yield stale success. No activity/model/context/roster effects, source sums or private fields displayed. See README for exact pointers and bounds. These subchecks never satisfy REAL export compatibility; standalone must show importer unavailable.
- **Evidence:** Fixture contents/hashes, hand calculation, native diagnostics and before/after totals. PASS here is native parser/fallback evidence only, not real usage integration.
- **Cleanup:** Restore only the run-owned fixture baseline or retain labeled fixtures for review. Do not write to real logs.

## Layout, editor, and asset suite

### L-01: Saved layout, cache, and reload

- **Setup:** A; exported run baseline; valid saved layout with recognizable furniture/colors.
- **Actions:** Change a small feature and **Save**. Compare `.squad-pod\layout.json`, reload and reopen. In a separate disposable subcheck, move the run-owned saved file to a backup after approval and reload with its workspace cache intact. Test a fresh workspace without either saved file or cache. Restore the original file.
- **Expected:** Disk layout wins; absent disk can use valid workspace cache; a fresh workspace uses bundled default (minimal fallback only if bundled data is unavailable). Appearance, furniture, colors and metadata survive. Loading alone must not silently overwrite malformed or saved content.
- **Evidence:** File hashes/JSON diff, before/after screenshots and source chosen.
- **Cleanup:** Restore approved baseline, with backup retained outside the active layout path.

### L-02: Starter export, import draft, Save, and Reset

- **Setup:** A has a saved custom layout distinct from the bundled starter. Keep a hash and export of it.
- **Actions:** Run **Squad Pod: Export Default Layout** to a new run-owned file. Verify export alone leaves disk/canvas unchanged. From Settings, **Import Layout** that file. Inspect the starter draft before Save; use **Reset**, then import again and explicitly **Save**. Reload. Make another unsaved edit and Reset. Also exercise Settings **Export Layout** with an unsaved draft present.
- **Expected:** Starter export never overwrites the office. Import changes the working draft only until Save; Reset returns to the current saved baseline, not factory defaults, and does not delete disk data. After Save/reload the starter persists and becomes the new baseline. Settings Export Layout exports the persisted office (or bundled default if absent), not an arbitrary unsaved canvas; use recovery export for drafts. Save errors must not look like success.
- **Evidence:** Export filenames/hashes and saved-layout hash at every boundary, dirty indicator and reload screenshots.
- **Cleanup:** Reimport and Save the baseline only after approval; retain prior recovery files.

### L-03: Dirty drafts, external conflicts, and recovery

- **Setup:** Saved baseline S; local draft A with visible change. Create valid external snapshots B and C by exporting alternate run-owned layouts. Keep copies outside `.squad-pod`.
- **Actions:** While A is dirty, externally replace only the disposable layout with B, then C (after approval). Import another distinct layout. Try Save and Reset with pending snapshots. Inspect/export local, incoming and retained versions. Exercise **Keep local draft** for one snapshot and **Use incoming...**, cancel, then confirm for another. Resolve every pending snapshot before Save.
- **Expected:** No incoming version silently replaces dirty A. Save and Reset are blocked pending resolution. Every distinct snapshot remains inspectable/exportable; incoming replacement requires confirmation and retains the displaced local draft. Saving after all resolutions uses the latest disk revision, not an older chosen snapshot's revision. Prior disk content remains in recovery files. Exports must actually contain the intended snapshots.
- **Evidence:** S/A/B/C hashes and unique markers, pending/recovery screenshots, export content comparisons and final disk/recovery diff.
- **Cleanup:** Export all valuable copies before closing; restore the run baseline explicitly, never discard another writer's content silently.

### L-04: Save races, malformed input, and workspace protection

- **Setup:** Disposable layout backed up; optional second native window uses the same workspace. Keep recovery exports outside it.
- **Actions:** Edit externally just before Save, or save from the second window. Try malformed imported JSON and a malformed external saved file. Test save failure with approved run-local write restrictions if available, without changing system permissions. Restore valid data. With a dirty draft, change the observed workspace from A to B; inspect protection. Separately reload a webview with recoverable draft state and compare it.
- **Expected:** Concurrent revisions are surfaced rather than overwritten; malformed files/imports cannot replace valid drafts. Disk write failure is explicit and keeps the draft. A's draft cannot Save into B; export and return to A to recover. Valid panel state can recover drafts, but is not a durable backup across panel disposal/profile loss. If a race or write failure cannot be induced safely, record that subcheck BLOCKED instead of assuming it passed.
- **Evidence:** Raw revision/file hashes, error messages, workspace identities and exported recovery comparisons.
- **Cleanup:** Remove only approved test-local restrictions, return to A and restore from preserved copies; never close a valuable unexported draft.

### L-05: Floors, walls, carpets, and Areas

- **Setup:** Small empty run-owned canvas with walkable seats; record available palette items from the installed build.
- **Actions:** In **Layout**, on a rebuilt artifact containing #78, select and paint each of the nine floor IDs **1-7, 9 and 10**, then wall/color and carpet styles with main/accent colors. Eyedrop and repaint ID 10; erase and undo/redo a multi-tile stroke. Add/rename/recolor a named Area and paint its tiles. Map a listed directory to it; observe seating preference for that observed root, and toggle **Show Named Areas**. Move a character between seats across ID 10 and around a VOID tile. Save, export/import, Save and reload; inspect that ID 10 stays serialized as 10. Compare a preserved legacy saved/cached layout containing IDs 1-7, 9 and VOID 8 before and after the build upgrade.
- **Expected:** All nine choices are selectable and map to bundled sheets: IDs 1-7 map to pattern indices 0-6, ID 9 to 8, and ID 10 to 7 (`floor_7.png`), each exactly once. ID 10 renders and is walkable like other floors; legacy VOID 8 remains empty/non-walkable, never renumbered or repurposed. Existing floor meanings/pixels, cached/saved content, colors, carpets, Areas and furniture survive. A paint stroke is one undo step; redo restores it. Eyedropper and export/import preserve ID 10. Overlay toggling does not erase definitions. Area mappings prefer matching seats for observed agents and do not launch or retarget observation. On an older installed artifact, test its existing choices separately and keep the nine-style subcheck BLOCKED / NOT IMPLEMENTED rather than expecting made-up controls.
- **Evidence:** Palette inventory, labeled painted grid, layout diff and agent-to-Area/seat mapping.
- **Cleanup:** Restore the small canvas baseline through approved Save or Reset as appropriate.

### L-06: Furniture, transforms, states, and history

- **Setup:** Available furniture includes an ungrouped item, directional group, desk with overlapping computer/lamp, and stateful item.
- **Actions:** Place/color items; select/drag, Alt-release to copy, press **R** or **Rotate**; move/rotate a desk assembly. Exercise bounds/occupied-placement rejection. Toggle a stateful item's available state control and observe it at an active desk. Undo/redo, save/export/import and reload. Inspect all four conference-table PCs on the tabletop, then move and rotate the grouped table and accessories and save/reload.
- **Expected:** Ungrouped items rotate geometrically; directional groups cycle available views (do not demand missing orientations). Desk assembly keeps attachments coherent; copying creates a distinct assembly without corrupting the source. Invalid transforms show feedback without partial mutation. Supported stateful art/manual toggles and furniture colors persist as defined; ordinary static custom assets need not animate. The #103 correction must keep all four PCs visibly on the tabletop with correct orientation while preserving ordinary character/furniture occlusion and other desks. Do not apply a blanket computers-always-on-top rule or alter unrelated assets. The accepted production-browser fixture checks rendered pixels plus grouped move, four rotations and the save/reload message boundary; it mocks the VS Code/save boundary and does not prove installed-provider disk persistence.
- **Evidence:** Short transform video, feedback, before/after layout and UID comparison. For #103, retain the production-render screenshot and grouped move/rotate/save-load results locally; do not attach or publish screenshots without separate approval.
- **Cleanup:** Restore baseline; do not leave furniture blocking R/V movement checks.

### L-07: Local assets, character stability, and pets

- **Setup:** Reviewed run-owned assets following [Custom asset manifests](custom-assets.md), including valid furniture, a 224x128 `characters\char_NAME.png`, a 96x96 custom pet sheet, and deliberately invalid/duplicate fixtures. No downloaded unapproved software.
- **Actions:** In Settings, **Add Asset Directory**. Place custom furniture and pet; add/remove Claudio and Gitcat via **Layout > Pets**. Observe wandering and click reactions. Edit art at the same path; add a new roster member to exercise unused custom character assignment. After separate approval, unload the directory; then add the same path again.
- **Expected:** Valid assets load/refresh, invalid/duplicate assets show warnings without breaking the office. Existing agents keep saved appearances; new members can claim unused custom sheets. Missing sheets use stable bundled fallback and restoring the same path restores art. Unloaded placed furniture remains in the layout with missing-art feedback; unloading does not delete files. Pets stay in valid space, react to clicks, and survive Save/reload when included in layout.
- **Evidence:** Asset provenance/paths aliased, warnings and before/after assignment table, video and layout exports.
- **Cleanup:** Restore roster/layout and registrations only after approval. Keep fixtures and recovery copies pending review.

## Visual and interaction suite

### V-01: Desktop, narrow panel, and natural movement

- **Setup:** Native desktop, at least two visible members, free seats, paths with corners, pets and labels. Record viewport/scaling/zoom.
- **Actions:** At a wide panel (for example 1200x700) and narrow desktop panel (about 360x640), open Settings, Directories, Telemetry (recorded usage, diagnostics and the observed task list), details, Layout, Area mappings, asset warnings and recovery UI. Scroll and use keyboard focus/Enter/Space. Resize while these are open. Pan/zoom the office. Observe 60 seconds of idle wandering and a seat move through corners; repeat during R-03 if produced.
- **Expected:** Controls remain reachable without clipping essential actions or modal traps. Text and path wrapping remain readable; labels, status/tool bubbles and context gauges stay aligned to the correct character while moving, sitting, turning and resizing. Walking uses natural directional frames, turns at corners without teleporting/jitter/sliding through obstacles, and pets do not strand agents. Active read/work poses remain distinct when their sources exist. Narrow desktop success is not mobile acceptance.
- **Evidence:** Wide/narrow screenshots, dimensions and short corner/seat/label video. List subjective defects with exact steps, not just "looks wrong."
- **Cleanup:** Restore viewport and zoom baseline; retain evidence before disposing the panel.

## Future capability gates

### F-01: Conditional durable hierarchy, model observation, and teammate deduplication

- **Setup:** Declared and runtime model metadata are separate capabilities. The model event contract was checked against the checksum-verified Copilot CLI 1.0.105 package recorded in [#102's artifact](https://github.com/swigerb/squad-pod/issues/102/artifacts/1): `session.start.selectedModel`, `session.resume.selectedModel`, `session.model_change.newModel`, persisted `assistant.message.model`, and `tool.execution_complete.model`; per-member candidates are `subagent.started.model`/`subagent.configured.model` and agent-scoped assistant messages. Tool-call models require an observed root start or an exact member task/tool-call owner; unknown calls are not presumed root. `assistant.usage.model` is explicitly ephemeral and is not read from `events.jsonl`. This contract is not proof that a particular real session emitted a field. Run with an identified native artifact containing #110 and approved live-log consent; never infer a model from declarations, usage history, or configuration. Each remaining conditional subcheck requires its own included implementing commit, documented native control and producer contract, plus approved actual source data. R-06's session-local task links do not satisfy durable hierarchy or teammate discovery. Without those prerequisites, record that subcheck BLOCKED / NOT IMPLEMENTED.
- **Actions:** Complete both declared-model and runtime-model procedures below. For any separately implemented conditional capability, append its exact controls and expected source fields to this run's applicability record. Separately observe a real parent/child relationship, and deduplication when an authoritative provider discovers that a transient task represents an existing teammate.
- **Expected:** Each display matches its implementing contract and emitted evidence. Do not treat generic roster promotion as the teammate-deduplication contract. A runtime model appears only from a producer field in the exact matched session; member attribution requires the event's subagent/task relationship to resolve to exactly one roster member. Each displayed value includes its source event field and timestamp. Selection fields, assistant-message models and positively owned tool-call models remain distinguishable; ephemeral usage, history, declarations, context gauges and configuration never backfill a missing value. Switching sessions, stale/disabled sources, shutdown, and subagent completion clear their live observations. Context gauges do not require a current-model label. Historical reports, manual roster edits, or inferred file activity cannot substitute for provider discovery or durable relationships. Missing actual fields after an approved run are NOT-PRODUCED for that integration.
- **Evidence:** Implementing commit, contract/control references and redacted before/after correlations.
- **Cleanup:** Follow the shipped capability's scoped cleanup; preserve the normal roster. Do not invent discovery/promotion controls or write roster entries to force a pass.

#### Declared-model procedure

This procedure is source-verified at the accepted baseline for [#89](https://github.com/swigerb/squad-pod/issues/89). Confirm the installed artifact includes the implementation before running; on older artifacts record these subchecks BLOCKED / NOT IMPLEMENTED. Implementation acceptance and CI do not establish native VS Code or real Squad-session acceptance.

Use N-03's disposable member M1 and approved run-owned files only. Record M1's exact display name separately from its slug. In its charter, add one unfenced `## Model` section with non-empty `**Preferred:**`, `**Rationale:**` and `**Fallback:**` fields. In the resolved `.squad/config.json` (or legacy `.ai-team/config.json` when that is the selected Squad root), use this valid JSON, replacing `M1 exact display name` with the exact roster name:

```json
{
  "defaultModel": "auto",
  "agentModelOverrides": {
    "M1 exact display name": "fixture-declared-model",
    "M1-slug-or-different-case": "fixture-nonmatching-model"
  }
}
```

These are inert test declarations, not CLI settings or a request to execute any model. Keep the fixture values distinct from charter preferences so a precedence guess is detectable. Record each row independently under F-01; authored inputs are FIXTURE even when displayed in the native host.

| Subcheck | Deliberate action and expected result |
|---|---|
| Runtime model provenance | With Live Activity's separate consent, open Squad Info during an approved `copilot --agent squad` session. Compare the root label only with the latest emitted `session.start.selectedModel`, `session.resume.selectedModel`, `session.model_change.newModel`, `assistant.message.model`, or positively root-owned `tool.execution_complete.model` in that exact session. Compare an expanded member's model only when a `subagent.started`/`subagent.configured` model, agent-scoped assistant event, or tool-call model is linked by the runtime task/tool-call identity to exactly one roster member. Record the source field and producer timestamp; authored/synthetic fixtures establish FIXTURE only. |
| Separate provenance | In **Squad Info**, expand M1 and inspect **Model metadata**. **Declared model metadata (not effective runtime selection)** lists the charter source path with Preferred/Rationale/Fallback, the JSON source path with `defaultModel` and `agentModelOverrides["M1 exact display name"]`, and each source's read state/diagnostic. The nonmatching name/slug entry is not attributed to M1. Conflicting declarations stay separate; no precedence winner or effective model appears. |
| Automatic versus current | With `defaultModel` set to `auto`, expect **Automatic selection (auto; not a concrete model)** for the declaration, while any runtime observation is independently sourced and timestamped. If no model field was emitted, **Current-session model: unavailable** remains explicit with the source state/reason; declared values, roles, history, usage reports and context gauges never fill it. |
| Refresh and removal | Collapse M1, change one charter model field and its exact-name JSON override, then re-expand. The new declarations appear without reload. Remove only the run-owned override and re-expand: the old override disappears; `defaultModel` remains separately attributed. Change only the roster display name in the approved fixture and verify exact-name matching, not slug/case-insensitive matching. Restore the name afterward. |
| Missing and partial declarations | In separate reversible fixtures, omit the charter's Model section, omit one field, and remove the run-owned JSON file. Expect `missing` for absent section/file, or `ready` with a diagnostic naming undeclared fields for a partial section. Fenced Model examples and unrelated sections do not supply declarations. A valid JSON object with no matching supported preferences is `ready` with an explicit no-supported-preferences diagnostic, not a runtime-model conclusion. |
| Malformed and ambiguous | Separately try invalid JSON, an invalid supported value (for example `defaultModel: 7` in otherwise valid JSON), an empty charter field, duplicate JSON keys, repeated Model sections and repeated Model fields. Invalid JSON/values/fields read `malformed`; duplicate keys/sections/fields read `ambiguous`. These error states withhold values rather than choosing a last declaration or retaining cached values. |
| Bounded/unreadable source | Use approved run-owned fixtures over 64 KiB, invalid UTF-8 and a non-regular source; do not alter permissions on existing files. Oversized/non-regular JSON reads `unreadable`, invalid UTF-8 JSON reads `malformed`; a rejected charter reads `unreadable`. No partial or stale values survive. For a changing-read or symlink/junction refusal, use only a reviewed synthetic reader fixture; capture its explicit `ambiguous`/`unreadable` diagnostic rather than manipulating unrelated paths. Any unexercised variant stays BLOCKED with a reason. |
| Legacy presence only | Use approved inert, run-owned `squad.config.ts` fixtures at the project root and selected Squad root. Present legacy files read `unsupported` with a not-imported/executed/resolved diagnostic; absent ones read `missing`, inspection failures `unreadable`. No values are read or inferred from executable config, and legacy presence does not mask a missing/malformed JSON source. Use hashes and synthetic reader evidence to establish no import/execution; do not create an executable side-effect probe. |
| Read-only observer | With F-02's separate approval, open Squad Info in the observer. Without `--live-activity`, current-session/member models remain unavailable with local CLI-only consent/restart guidance. With explicit local live-read consent, emitted models/source timestamps can appear; a following source with no supported emitted field says the runtime has not emitted one, while searching/error states give the actual source reason. Declared metadata still reports **Declared model metadata is unavailable in the read-only observer.** No charter/configuration preferences are invented or copied from native state. Browser fixture results remain BROWSER/FIXTURE, not NATIVE or REAL. |

Capture source paths/keys, exact input hashes, read states/diagnostics and before/after screenshots in the local report. Preserve historical recorded-usage evidence separately. Restore only run-owned charter/config/legacy fixtures and the roster name from their approved snapshots; no automatic deletion or cleanup permission is implied.

### F-02: Standalone observer, owned terminals, and other runtimes

- **Setup:** Use the read-only observer procedure, then the office-control and owned-terminal procedures only with their separate approvals on an approved local desktop/browser host. All common approval gates still apply; observation and office control need no native VS Code launch or real Squad process. Other runtimes require their own included implementation and approved procedure; otherwise BLOCKED / NOT IMPLEMENTED.
- **Actions:** Complete each observer, office-control and terminal subcheck independently. Reuse applicable privacy, layout and attribution oracles without assuming native controls or live CLI sources exist in this host.
- **Expected:** Results establish only the identified installed package. Office viewing stays read-only by default and terminal authority never grants office writes. Only separately opted-in and authenticated office control changes the selected project's supported data. Mobile office/owned-terminal gestures, keyboard and clipboard are implemented at this source; installed Edge emulation with synthetic PTYs is BROWSER/FIXTURE evidence only. Physical iOS/Android touch and software-keyboard behavior remain unverified. Remote/TLS and persistent credential protection remain BLOCKED / NOT IMPLEMENTED.
- **Evidence:** Record host/package identity and local redacted results under F-02 subcheck names, not new case IDs. Label browser observations BROWSER, authored inputs and `--fixture` terminals FIXTURE, and add REAL only for separately approved actual `copilot --agent squad` output. Record emulated and physical mobile devices separately. A synthetic browser pass, external VS Code terminal or narrow panel is not native, real-session or mobile acceptance.
- **Cleanup:** Use the graceful stop below and X-01. No deletion, deployment or publication is authorized.

#### Accepted read-only observer procedure

This procedure is source-checked at the accepted source in [Scope and outcomes](#scope-and-outcomes). Run it **without** `--office-control`, `--terminals` or `--fixture` so neither mutation nor terminal authority is enabled. Follow the linked [package instructions](../standalone/README.md) and source anchors below. These are instructions for the user/Scout; no steps or outcomes are claimed executed by this document.

1. **Approve and identify the host.** Record the selected OS/version/architecture, Node (22.13+), npm/feed, browser version, full product SHA/tree and clean status. Approve building, installing/running this private local package, runtime authentication, and reads of the exact selected disposable project and listed sources. No approval here covers other projects, private/home logs, AI spending or real Copilot/Squad execution. Use an owned results directory and empty install directory outside the product checkout. Keep the existing manifest/report/evidence contract; supplement it with observer tarball absolute path/name/bytes/SHA-256, installed package path/manifest version, and installed-file comparison. VSIX identity fields still govern any native run; leave unexecuted native checks BLOCKED, never substitute a tarball for a VSIX.
2. **Build and package the exact source.** From the clean product checkout, restore dependencies only if needed, using the configured organizational feed (never switch registries):

   ```powershell
   npm run install:all
   npm ci --prefix standalone
   npm run check --prefix standalone
   npm test --prefix standalone
   npm run build --prefix standalone
   npm pack .\standalone --pack-destination "C:\Acceptance\run-id\packages"
   Get-FileHash "C:\Acceptance\run-id\packages\squad-pod-observer-0.1.0.tgz" -Algorithm SHA256
   ```

   The build creates `standalone\dist\cli.mjs`, `standalone\dist\browser\index.html` and bundled `standalone\dist\assets`, and copies canonical LICENSE and THIRD_PARTY_NOTICES.md into the package root. `npm pack` alone does **not** build; do not package stale output. Record command exits and build logs. This private package is not published and is separate from the VSIX.
3. **Install and start on Windows (PowerShell).** Replace example paths with approved precreated run-owned paths, including a project path with spaces. From the empty install directory:

   ```powershell
   Set-Location "C:\Acceptance\run-id\observer install"
   npm install "C:\Acceptance\run-id\packages\squad-pod-observer-0.1.0.tgz"
   ```

   Inspect/hash the tarball and compare its unpacked manifest, runtime files, bundled assets and notices to the installed `node_modules\squad-pod-observer` files **before launch**; record the method and result. Resolve runtime dependencies only through the approved feed or an independently approved offline installation; do not assume this manual install is offline. Complete step 4's private-console precautions before either CLI launch:

   ```powershell
   node node_modules\squad-pod-observer\dist\cli.mjs "C:\Acceptance\run-id\project A" --port 0
   ```

   For a POSIX host, use its approved absolute paths and `node node_modules/squad-pod-observer/dist/cli.mjs "/approved/run-id/project A" --port 0`; record that host separately. A source-only diagnostic launch from the product root is `node standalone\dist\cli.mjs "C:\Acceptance\run-id\project A" --port 0`, not installed-package acceptance. `--port 0` selects a free port; omission uses 3210. The CLI requires an explicit absolute project path and canonicalizes it; it does not select recent projects, open a browser, install Squad or start Copilot.
4. **Authenticate without capturing secrets.** Disable console transcripts, screen recording and command-output capture **before starting the CLI**: it prints a tokenless `http://127.0.0.1:PORT` address, separate observation and terminal credentials, and terminal availability. An additional office-control credential is printed only with `--office-control`; it must be absent in this observer-only run. Never use the terminal credential here; terminal authority must report disabled/unavailable. Open only that exact address manually (not `localhost`, another machine or a proxy); never put a credential in a URL, shell argument, environment file, screenshot or saved evidence. Leave **Use separate office-control authority** unchecked. The human pastes the observation credential privately into **Runtime credential from the observer console**, then selects **Connect read-only office**. Do not save it in a password manager or capture auth request bodies, cookies, browser storage/network exports or the console. The form clears its input; auth posts JSON and uses an HttpOnly/SameSite=Strict session cookie. Credentials are runtime-only; no credential file or persistent Windows ACL protection is claimed. Protect the console/machine account: same-user local processes are not an isolated trust boundary. Capture only the authenticated office and redacted status, never credential values.
5. **Observe the approved project and negative fixtures.** Compare the canonical selected root recorded from the startup path with **Telemetry > Recorded usage / model history > Usage coverage and source diagnostics**, which shows the local ledger path even when missing (redact personal paths in evidence). Telemetry shows a read-only notice instead of **Observation settings and consent**, and **Activity source diagnostics** reports the live CLI observer off in artifacts with the optional live adapter (unavailable in older builds). Settings is disabled here; do not demand its native source-status control. Run the subchecks below with individually approved, nonsecret disposable inputs; keep before/after hashes and source changes separate from observer-caused writes. For actual producer coverage, use only output from a separately approved user-run project/session, not manufactured files. Missing fields after such a run are NOT-PRODUCED; no run/read approval means BLOCKED.

   | F-02 subcheck | Procedure and expected result |
   |---|---|
   | Selected-project read scope | Only the explicit root is observed: `.squad\team.md` (use `.ai-team` only if `.squad` is absent), `.squad-pod\layout.json`, Squad `sessions\*.json`, `log\*.md`, `orchestration-log\*.md`, and `log\usage.jsonl`. No recent-directory discovery, decision inbox/agent-file watching, charter reads, home `events.jsonl` discovery or external assets. Change an approved unrelated fixture project and verify it never appears. Internal symlinks/junctions, escapes, non-regular/oversized files and changed file identities are rejected; do not create links to private data. This is bounded trusted-project reading, not a sandbox against concurrent hostile directory replacement. |
   | Office and read-only authority | Inspect roster, built-in art, validated saved layout or bundled starter, **Squad Info** with per-member observed details (N-03 step 6: charter content "unavailable", **Open charter** disabled; agent card shows **Activity time unavailable** rather than an epoch age), pan/zoom and Telemetry's recorded usage. Existing members retain identity-based built-in appearances across roster reorder and reconnect without metadata writes. Layout/editor/seat/appearance/settings mutations, directory management, asset registration, native dialogs and charter opening are disabled; the office channel has no terminal/process control, and the **Owned terminals** panel stays unauthenticated or reports unavailability. Compare project hashes: viewing must not write. If exercising forged commands, use only a reviewed synthetic transport fixture; the server accepts readiness/settings/detail reads and rejects mutation/terminal messages before dispatch. Preserve L-05's Floor10/VOID8 oracle if checking saved floors; do not replace R-06's native task-inventory oracle with file activity. |
   | Approximate file activity | Seed an old recognized session/log before first connection: no historical animation. While connected, create then edit a recognized source for an unambiguous visible member (use the historical/file-idle recipe only as FIXTURE). Polling is 1 second while at least one viewer is connected. A new/content-changed source marks the member active for approximately 30 seconds; unchanged polls do not renew it. Allow 10 seconds for observation, then observe through 40 seconds after the last write for idle. Native file aliases are reused with ambiguity rejection. No live tools, context counters, task inventory or durable hierarchy is supplied; usage writes do not drive activity. |
   | Recorded usage | Inspect only the selected Squad `log\usage.jsonl`. Reuse U-01 and the usage arithmetic fixture as FIXTURE: complete newline-terminated version-1 records; every valid complete usage row counts, without time/member filtering or usage-row deduplication; turn coverage is distinct-turn based; show at most 40 recent reports. Missing ledger displays missing, not zero usage; invalid/unsupported/incomplete records show the parser's partial diagnostics. Bounds include 2 MiB and 10,000 complete lines. The pinned `squad` 1.1.0 shell explicitly wires this ledger; `copilot --agent squad` is not guaranteed to emit it. If an already-approved real launch produces no ledger, report missing/unavailable, not zero or collector failure; do not launch another task only to manufacture a ledger. Copilot CLI `--usage-output-file` is separate raw metrics JSON, not ingested or the ledger, and its premium-request/nano-AI cost units are not USD. Recorded ledger cost is a producer USD estimate, not invoice-grade/billing cost; models/costs are historical, not live model/context or proof that a runtime emits the ledger. |
   | Malformed/missing sources | In separate backed-up fixture variants, invalidate the saved layout, roster and ledger. Invalid saved layout shows a source diagnostic and bundled starter without overwriting disk; an unusable Members table shows a diagnostic and empty office. A missing roster yields no agents; missing ledger reports missing, read failures report errors. Malformed session JSON cannot identify an agent and must not animate it; Markdown can still identify via a recognized filename. Do not require a diagnostic for every unattributable activity record. Restore the fixtures and confirm recovery on polling; never modify actual private producer logs. |
   | Disconnect and resume | Disconnect/reconnect an approved browser viewer without restarting the CLI. Expect disconnected/retrying status, observation-only WebSocket retries with the existing cookie and a fresh office snapshot, never a process launch. Retries back off from 500 ms to 10 seconds; allow that plus the observation window. With **all** viewers disconnected, polling stops. Make an approved fixture edit while paused; reconnect: existing files are rebaselined without historical animation. Make a new edit after reconnect to verify fresh activity. Another connected viewer prevents that pause; do not confuse it with all-viewers-disconnected behavior. |

6. **Revoke and stop gracefully.** Outside all capture, type `rotate` in the owned CLI console: all observation, office-control and terminal viewers/cookies are revoked and new credentials are printed. The old credential cannot reauthenticate; the viewer uses **Authenticate again** and private entry of the new one. Restarting also revokes credentials/cookies. After scoped stop approval, type `quit` in that console, press Ctrl+C, or send SIGTERM only to the exact owned PID. Expect process exit, closed listener/sockets, disposed subscriptions/polling and browser disconnected status; verify the tokenless endpoint no longer responds. Close owned browser tabs to stop retries; keep redacted evidence and record any retained console/clipboard material for human cleanup. No credential persistence, project writes or automatic deletion is expected. Follow X-01 for any separately approved restoration/deletion.
7. **Return the local report, not an acceptance claim.** Save `report.md` and relative redacted evidence links outside the product workspace. Record every observer subcheck independently as PASS/FAIL/BLOCKED/NOT-PRODUCED. Record office-control, owned-terminal and mobile subchecks separately under the following procedures (BLOCKED if not approved). Keep synthetic installed-browser evidence, approved-project observation, REAL producer evidence and NATIVE VS Code evidence separate; physical-device mobile results remain unverified unless separately tested. Require human sign-off. Do not upload, publish, merge or close broad trackers.

#### Optional standalone live-observation procedure

These are additional **F-02 subchecks**, not new case IDs. Keep all 27 IDs and
NATIVE/REAL/FIXTURE/BROWSER outcomes separate. Apply only to an installed artifact
with `--live-activity`; baseline `e9fde56` does not contain this feature.

1. **Approve private-read scope independently.** Default-off startup must not
   discover/read home sessions. For the FIXTURE pass, create an isolated run-owned
   `COPILOT_HOME` with only the sanitized live recipe from this plan; set its
   `workspace.yaml` cwd to the canonical disposable project. Do not copy real logs.
   Record the CLI version and `copilot help environment` support for `COPILOT_HOME`.
   Before REAL reads, approve the actual resolved home/session paths separately,
   verify the producer writes there and retain the existing spend/permission gates.
   No private-log approval is implied by office, terminal or control authentication.
2. **Start and authenticate.** Outside console capture, start the identified
   installed CLI with `--port 0 --live-activity`, initially without terminals or
   office control. Confirm the printed read scope: bounded session directory
   metadata and `workspace.yaml` cwd discovery, then `events.jsonl` only for
   exact-canonical-workspace Squad candidates. Authenticate only observation.
   Telemetry must show actual off/searching/following/error state and the short
   session label. The browser has no live-consent checkbox/action.
3. **Prove attribution and precedence.** Append the sanitized live recipe one
   event at a time: exact member task, correlated start, child tool, context-bearing
   tool completion and member completion. Compare labels, status, context gauge,
   Squad Info detail and bounded transient inventory. An active live task must
   survive the 30-second file timeout; file writes cannot replace it. Completing
   the run clears tools/context and must not revive ignored file hints. A new
   recognized file edit may provide a hint after completion. Unknown names,
   mismatched cwd, non-Squad sources and non-general-purpose calls must not
   animate a roster member. Record actual producer shapes, never fabricate REAL data.
4. **Exercise recovery/bounds with fixtures only.** Reconnect during a live tool,
   refresh the roster and verify tools/context are restored after its snapshot.
   All viewers leaving stops polling; resuming restores only current in-flight
   calls, not completed history. Source rotation/truncation, deletion/read errors
   and five minutes plus 10 seconds without new bytes clear live displays.
   Oversized lines/seed tails mark partial coverage rather than replaying invented
   state. Limits are 500 directory entries, newest 32 candidates, 8 KiB cwd files,
   64 KiB head/tail marker scans, 2 MiB event reads per poll, 64 KiB lines,
   64 transient tasks and 16 recent completions. Never modify real producer logs.
5. **Preserve authority and privacy.** Observation-only viewers still cannot
   mutate settings/layout/seats, enable live reads, launch/attach/input/terminate.
   Check runtime rotation, canonical Host/Origin checks and separate credentials
   as in F-02. Prompts, outputs, arguments/scripts, private full file paths and
   credentials must not appear in UI/wire evidence. Session-local display metadata
   is not durable membership or recorded/billable usage.
6. **Verify owned-run correlation independently (REAL).** With separate approval, combine
   `--live-activity --terminals` for the supported fixed `copilot --agent squad`
   REAL run and record both terminal lifecycle and matching-project observation.
   The opt-in fixed command adds only `--session-id <server-generated fresh v4 UUID>`
   when observer and sanitized child homes match. Installed CLI 1.0.105 documents
   this new-UUID/resume selection; the host checks for collisions and never accepts
   a client-chosen/resume target. Compare the locally approved exact session source
   with the generated launch identity without publishing private bindings. Verify
   canonical cwd and Squad marker; another same-project session cannot take over.
   Missing marker/file, wrong cwd or stale exact data must show waiting, not
   unrelated project activity. Exit/close selects another active owned run or
   matching-project fallback, excluding previously issued IDs. Rotation revokes
   exact observation without terminating owned terminals. Confirm private
   run/session binding is absent from terminal wire inventory.
   `COPILOT_HOME` remains excluded from the child environment: if homes differ,
   default launch argv is retained and correlation must say unavailable, not read
   another home or silently forward the override. Synthetic terminals also report
   unavailable exact correlation. Synthetic broker tests establish wiring only;
   do not claim #8's REAL lifecycle from cwd equality, timing or fixtures. No extra
   paid task is authorized just to produce evidence.
7. **Revoke and stop.** Follow F-02's private-console rotation and scoped shutdown.
   Restart without `--live-activity` and verify source off/no live reads. Record
   installed tarball/runtime/browser identities, scope, redacted screenshots and
   each subcheck result. REAL or physical/native evidence remains user/Scout-owned;
   this procedure and fixture results do not waive those gates.

#### Selected-project office-control procedure

Use the same identified installed package and canonical disposable project as the observer procedure. Approve this mutation scope separately: `.squad-pod/layout.json`, `.squad-pod/office-preferences.json`, prior-byte copies under `.squad-pod/recovery/`, cooperating-writer lock/staged files, and browser recovery storage/downloads. Snapshot run-owned files and export valuable drafts before any server restart. No native settings, charter/config reads, directory management, external assets, private logs, terminal actions or real AI spending are authorized by office control.

1. With console capture disabled, start the installed CLI with `--port 0 --office-control`, **without** `--terminals` or `--fixture`. The default browser form still connects read-only. In a separate approved viewer/browser context, select **Use separate office-control authority (requires server --office-control opt-in)**, privately enter only its distinct credential, and choose **Connect office control**.
2. Verify the scope reads **Authenticated selected-project office control. Layout, seats and local settings only.** Use two separately authenticated control viewers for revision/convergence checks and an observation-only context for authority checks; record which context owns each action. Never capture credentials/cookies.
3. Perform each row below independently, recording deliberate writes, committed file hashes, UI acknowledgements and retained drafts. Do not infer success from optimistic display or a sent request.

| F-02 office-control subcheck | Procedure and expected result |
|---|---|
| Three separate authorities | Observation uses `/auth` and `/office`; control uses `/control-auth` and `/control`; terminals use `/terminal-auth` and `/terminal`. Swapped credentials fail; observation/terminal credentials grant no writes, and control grants no terminal authority. A read-only viewer stays read-only even with server opt-in. All channels retain exact canonical loopback Host/Origin checks. Unsupported keys/actions are rejected before dispatch; use reviewed synthetic transport fixtures for forged settings, paths, argv/env or native commands, never private files. |
| Editor and committed layout | With deliberate gestures, exercise floors (L-05's nine-style/VOID 8 mapping), carpets, furniture colors/states, pets, named Areas, undo/redo and manual **Save**. Reuse L-suite data-safety oracles, not native dialog assumptions. Save acknowledges only committed, validated bytes at the fixed layout target. A reload/second viewer sees the committed layout; no observer/terminal authentication writes anything. |
| Seats/settings and detail interleaving | Viewer A moves M1 and changes a supported sound/debug/Areas setting; wait for committed acknowledgements. In viewer B open member details, then move another member and toggle another setting. Both viewers converge; the later whole-map seat write preserves A's committed move and unrelated settings/appearances. Detail replies cannot advance a revision without its corresponding state. Existing identities are reconciled rather than duplicated/recreated, including return of a removed member's unchanged saved identity. Removed members cannot authorize new seat writes. |
| Two-viewer/external revision conflict | Retain a draft in A; commit a different change in B or make an approved valid external edit to a run-owned target. A's stale save conflicts instead of overwriting newer bytes. Compare exact-byte revisions and retained drafts/recovery copies. A locked target, invalid saved file, revoked authority or failed storage cannot produce successful acknowledgement. Exercise commit-time identity/storage failure only with reviewed synthetic store fixtures, never hostile replacement of real directories. |
| Browser import/export | **Settings > Import Layout** uses deliberate browser file selection of approved bounded JSON (maximum 2 MiB), creates a draft and requires **Save** to reach disk. Malformed/oversized imports visibly fail without losing the prior draft. **Export Layout** downloads the current validated draft; compare its contents/hash. Conflict-panel **Export local draft**, **Export snapshot #...** and **Export retained #...** preserve the respective copies. These are local browser selection/downloads, not arbitrary filesystem/native-dialog bridges. |
| Layout recovery and storage limits | With a run-owned unsaved/conflicting draft, reload within the same project/server instance: recovery stays inspectable and pending snapshots must be resolved before saving. Storage is bounded to 8 MiB and scoped to project plus server instance, contains no credentials and is not durable backup. Storage denial/quota or invalid recovery stays visible and preserves original data. Export before restarting/clearing storage; a new server instance/project never automatically applies the old recovery state. Use reviewed synthetic storage fixtures for nondeterministic quota failures. |
| Preference recovery and deliberate retry | Disconnect/not-ready, then attempt one supported setting/seat change. **Unacknowledged settings/seat draft** retains the attempt, reconciles display to authoritative state and offers **Export preference draft**, **Retry this preference change deliberately** and **Discard preference draft**. Reconnect/reload never resends it automatically. While unresolved, a different preference change is explicitly rejected, not queued or substituted. Inspect/reconcile any recovered full seat map before deliberate retry; exporting/discarding requires its own scoped approval, and discard is blocked while a save awaits acknowledgement. |
| Revocation and unavailable bridges | Rotate outside capture: all three authorities/cookies are revoked. Unacknowledged work remains visible; reconnect fetches snapshots only, never replays saves. Reauthenticate with the proper new credential and retry only deliberately after reconciliation. Charter contents/editor opening, directories, external asset registration and private/live-log consent remain explicitly unavailable. An owned process, if separately tested later, is not killed by credential rotation. |

4. Export needed drafts and record recovery/lock/staged artifacts before approved graceful shutdown. Stop only the owned server PID, verify the endpoint is closed and restore only the explicitly approved run-owned files/settings. List retained downloads/browser recovery data and cleanup decisions in `report.md`; no automatic deletion, publication or upload is authorized. Label results BROWSER/FIXTURE as applicable, never NATIVE/REAL.

#### Owned terminal procedure

Source-checked at the accepted source ([#93](https://github.com/swigerb/squad-pod/pull/93)); see [package instructions](../standalone/README.md#optional-owned-terminals) and [terminal notices](../standalone/TERMINAL_NOTICES.md). Terminal authority is opt-in and separate from office viewing. Run the FIXTURE pass first; a REAL launch needs its own approval naming the disposable project, fixed command, bounded task (reuse the Real Squad suite's bounded request), authentication and spend limit. These are user/Scout instructions only.

1. **Identify the runtime and native dependency.** Reuse the observer tarball and installed-package comparison from steps 1-3; additionally record the installed `node-pty` version (pinned `1.1.0`, optional dependency) and how its native code was obtained. Windows x64/arm64 use the official prebuild including the ConPTY DLL/OpenConsole helper. **macOS requires an explicit source rebuild** because the official tarball's spawn-helper files are not executable: with separate approval for Xcode command-line tools and Python/node-gyp, run `npm_config_build_from_source=true npm rebuild node-pty` in the standalone installation, then record the helper's executable permissions. Never `chmod` the shipped helper. Linux needs its own source build toolchain. Record any pre-rebuild failure; an unrun or failing platform is BLOCKED or FAIL, not a pass.
2. **Resolve real-session prerequisites explicitly (REAL only).** Launch searches absolute PATH entries only (never cwd or PATHEXT). On Windows it requires a real `copilot.exe` with an executable header; `.cmd`, PowerShell and shell wrappers are rejected with no fallback. POSIX accepts an executable or a Node entry point with a supported Node shebang. The child receives only the allowlist `PATH`, `SystemRoot`, `WINDIR`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TMPDIR`, `TMP`, `TEMP`, `LANG`, `LC_ALL`, `LC_CTYPE`, plus fixed `TERM=xterm-256color` and `COLORTERM=truecolor`. It does **not** forward Node injection/loader variables, GitHub tokens, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` or `SSL_CERT_DIR`. The user must decide, before approval, whether their Copilot authentication and network path work without those variables (for example through Copilot's normal user configuration) and record that decision. Do not infer compatibility, add variables, or bypass proxy/TLS validation; if unresolved, record REAL subchecks BLOCKED.
3. **Start with terminals enabled.** With capture disabled as in step 4, start the installed CLI with the approved project and `--port 0`, adding `--fixture` for the synthetic pass or `--terminals` for an approved REAL pass (never both in one run record). Leave `--office-control` off for this isolated terminal procedure; combining it requires the separate office-control approval and results above. Record the availability line: fixture reports synthetic terminals; `--terminals` reports `copilot --agent squad` or an explicit unavailability reason (for example no supported executable or missing native dependency), in which case the office must still work.
4. **Authenticate each channel separately.** Paste the office credential only into the office form and the terminal credential only into **Terminal credential (not the office credential)**, then **Authenticate terminals**. Exchanged credentials must fail on the other form. Do not capture either value.

| F-02 terminal subcheck | Procedure and expected result |
|---|---|
| Authority separation | Office authentication grants no terminal authority, and terminal authentication (`POST /terminal-auth`, separate HttpOnly cookie for `/terminal`) never authorizes `/office` or office mutations. Without `--terminals`/`--fixture`, terminal authentication reports **Terminals disabled. Restart with --terminals...**. Office remains read-only throughout. |
| Loopback and origin | Only exact `http://127.0.0.1:PORT` works. `localhost`, another IP spelling/DNS name, another port's Origin or a cross-origin page cannot authenticate or upgrade either channel. Do not configure remote binding, tunnels, proxies, TLS bypass or firewall exceptions to test this. |
| Fixed launch, no browser-supplied process data | **Launch selected project** starts exactly one owned run in the canonical selected project, with the fixed command (fixture script, or `copilot --agent squad` with normal Copilot permission prompts). The UI and protocol offer no directory, executable, argv or environment field; a reviewed synthetic forged message adding them is rejected. No shell, `squad shell`, permission bypass or hook installation. If the selected directory's identity changed since startup, launch is refused. Launch is never triggered by authentication, reconnect, reload or panel resize. |
| Owned versus observed identity | Each run has an opaque random runId shown as `runId · PID · state`, independent of roster members. Roster/observed agents or unrelated processes cannot be selected, written to, resized or closed; forged unknown runIds return an error without effect. Observed file activity never creates a run. |
| Input and resize | Input is disabled until replay finishes. Typing reaches only the selected running owned run; Unicode round-trips in the fixture. **Fit terminal** and window resizing change that PTY's columns/rows. Over-budget input (1 MiB outstanding/run) or rate limits produce explicit errors, never silent retries. At most 8 runs; the ninth launch is refused until one is explicitly closed. |
| Same-process reconnect and reload | **Reconnect** and an ordinary disconnect reattach to the same PID without launching or terminating anything; retained output replays without duplication. Browser reload requires terminal authentication again and rebuilds from retained history, same PID. **Authenticate again** disconnects only the viewer; status says the process was not terminated. |
| Explicit loss and resync | When continuity cannot be proven (history eviction, slow-viewer overflow, broker failure), the alert says nothing resets automatically. **Clear terminal and resync retained history** clears the screen and shows that earlier output/state may be lost; it never launches a replacement. Induce only with approved fixture output, not a paid task. |
| Safe output | Escape sequences render as terminal data, not HTML; output links do not navigate the authenticated page. Scrollback caps at 2000 lines. |
| Rotation and revoked authority | `rotate` detaches observation, opted-in office-control and terminal viewers, invalidates all channel cookies and cancels launches still waiting for the native broker, but does **not** terminate an already-owned process. Reauthenticate with the new terminal credential and confirm the same PID is still listed. |
| Close and shutdown | **Close run...** then **Confirm terminate owned process** ends only that run and its normal descendants; an exited run keeps bounded output until explicitly removed. `quit`, Ctrl+C or SIGTERM to the exact owned server PID closes all owned runs and their console/process group. Unrelated terminals, consoles and processes (including an approved idle control terminal) survive. Processes that deliberately escape their console/session are outside the contract; this is not an OS sandbox. |
| Narrow and mobile | Installed Edge touch emulation with a synthetic PTY may PASS as BROWSER/FIXTURE for responsive layout, gestures and owned-terminal controls. Rightward swipes beginning in the outermost 5 px may be intercepted by browser navigation; tested starts at x=20 and x=370 within the 24 px in-app edge zones pass. Navigation tabs remain the fallback. Record browser/version, viewport and gesture start coordinates. Physical iOS/Android touch and software-keyboard behavior remain unverified; emulation and narrow desktop screenshots cannot pass physical-device acceptance. |
| REAL session (approved only) | One bounded approved task through the owned run shows normal Copilot prompts and the Squad agent in the selected project. Observer activity remains approximate file observation; terminal output is not a telemetry producer. Missing network/auth prerequisites are BLOCKED, not FAIL of the product, unless the product contradicts the documented contract. |

5. **Stop and report.** After approval, stop the exact owned server as in step 6, verify every owned run and helper exited and the endpoint no longer responds, and record any surviving process for human cleanup. Record each terminal subcheck independently in `report.md`; synthetic acceptance helpers and CI results are context only.

#### Mobile office and owned-terminal procedure

This procedure applies to an identified installed artifact containing the accepted mobile implementation in [#107](https://github.com/swigerb/squad-pod/pull/107). Its parent acceptance and exact-head CI are recorded in the applicability table; they are implementation/synthetic evidence, not this run's result. The accepted installed tarball SHA-256 is `c10db8ac97e1a007dddc4ee1d6bd0d6ee81db026c9e1faa1840720f41267ac59`. The procedure does not authorize remote access, a device tunnel, changing browser/OS permissions, clipboard auto-read, real Copilot/Squad execution, or a physical-device claim.

1. **Prepare the installed browser fixture.** Follow the package/build and artifact-identity steps above. Use the already-installed Playwright module and Edge executable; do not download a browser. The helper is `npm run acceptance:terminals --prefix standalone`; it installs the private tarball and runs a synthetic native PTY fixture, never Copilot or Squad. Set the approved local `TERMINAL_ARTIFACTS` path only if screenshots/reports are wanted. Verify the installed tarball SHA-256 against the manifest; do not substitute a branch build or infer identity from its version.
2. **Check responsive and authority boundaries.** In a coarse-pointer 390x844 portrait and 844x390 landscape emulation, confirm the standalone mobile shell has office/terminal views, owned-run cards and an explicit launch card; observed roster members remain distinct from owned runs and selecting an observed member only follows the office camera. A run card selects that exact owned run. A page toggle, edge swipe or card selection must not launch or terminate a second process. The mobile view hides the desktop Layout editor; a fine-pointer hybrid desktop retains the desktop editor even if a touchscreen is present. Verify read-only/no-terminal mode leaves controls unavailable with an explicit reason, and loss of terminal authority or connection visibly disables input without killing the owned process.
3. **Check gestures and navigation.** With the fixture office open, select an observed member to enable camera follow. A pure two-finger pinch changes zoom without breaking follow; one-finger pan or a two-finger translation breaks follow. Check controls, terminal selection, scrolling and selection gestures do not accidentally trigger page navigation. On a 390 px-wide Edge emulation, test a leftward swipe from x=370 and a rightward swipe from x=20, on non-control surfaces, to switch between pages; the page stays within the authenticated application. A second finger interrupting an armed/claimed edge swipe settles the original page. Edge may intercept rightward swipes that begin in its outermost 5 px; use the in-app 24 px edge zone and the visible page-toggle/navigation tabs as fallback. Capture browser version, viewport, start coordinates and result. Do not change browser history, remote access or device settings to force a pass.
4. **Check terminal keyboard and viewport.** In the separately authenticated fixture terminal, use the keyboard accessory (`Tab`, `Esc`, `Ctrl+C`, `Ctrl+D` and arrow keys) and verify each deliberate key reaches only the selected owned run. Focus the terminal input and exercise the visual-viewport-safe keyboard layout. Rotate between portrait and landscape emulations and verify the terminal fits/resizes; report emulated viewport behavior as BROWSER/FIXTURE, not proof of an iOS/Android software keyboard.
5. **Check text selection, clipboard and links.** Select terminal text and explicitly choose **Copy selection**; explicitly choose **Paste** for a test clipboard value. Clipboard reads must never occur automatically. Use only a harness-provided non-secure/unavailable/denied clipboard simulation to check the **Paste text manually** fallback; if the fixture cannot provide that simulation, record BLOCKED rather than changing browser or OS permissions. Review text before deliberately sending it. No paste may be silently truncated or automatically retried after disconnect, run switch or partial send. A copied selection remains manually selectable when browser copy is unavailable. A terminal URL opens only after a short unmoved tap on a safe HTTP(S) URL with no active selection; drag, long press, unsafe scheme and malformed URL do not open it. Use only a benign synthetic fixture URL; do not navigate to unreviewed output links.
6. **Capture and report.** Record each mobile subcheck independently with installed package identity, browser/version, viewport/orientation, authority mode, action, result and local evidence links. The helper's installed Edge touch emulation is BROWSER/FIXTURE evidence. It does not establish NATIVE VS Code or REAL Squad-session acceptance. Keep actual iOS/Android physical touch and software-keyboard results separately BLOCKED / unverified until a human tests an approved device; never substitute emulation or narrow desktop screenshots. The helper cleans only its own synthetic process/fixture. Preserve the normal run cleanup and evidence/privacy approvals above.

## Rollback, evidence, and sign-off

### X-01: Stop, preserve, and clean up

- **Setup:** Inventory of test-owned terminals/processes, settings, directories, assets and layout/recovery exports.
- **Actions:** Stop testing immediately for wrong-member/workspace attribution, data loss, privacy disclosure, unintended launch, security warning, or exceeded spend limit. Record the last safe state and defect. Turn live and suggestions off. Export drafts and retain source/evidence copies before panel disposal. With explicit scoped approval, stop only test-owned CLI sessions; restore only the isolated run's backed-up layout/settings/roster. Ask separately before deleting/removing named run artifacts, saved entries, profiles or asset registrations.
- **Expected:** Normal profiles/workspaces/logs and unrelated terminals are untouched. Failed installation can be rolled back by disabling/uninstalling only the isolated extension after approval; do not change the normal installation. Recovery exports and evidence survive cleanup. Record anything still running or retained.
- **Evidence:** Before/after ownership inventory and restoration hashes, approvals and pending cleanup list.
- **Cleanup:** No recursive/broad deletion, automatic GitHub posting, publishing, permission bypass, merge, or issue closure.

### Evidence handling

Keep original evidence local with access limited to the approved reviewers. Prefer projected fields and small screenshots over raw logs. Redact usernames, absolute personal paths, repository/customer names, session identifiers, prompts, tool contents, arguments/outputs, tokens, credentials and unrelated window content before sharing. Use stable aliases (workspace A/member A/session A) so correlations survive redaction; keep the alias map local. Inspect exported layouts for private directory IDs, names and paths.

If a leak occurs, stop capture, preserve evidence in the approved restricted location, notify the human and follow their incident process. Do not copy the leaked value into a defect. The user decides whether and where to share; GitHub artifacts, screenshots, issue comments and uploads require separate approval.

### Results template

```text
Run ID / installed source SHA / VSIX SHA-256:
Test ID and subcheck:
Applicability / implementing commit / prerequisite:
Evidence class: NATIVE | REAL | FIXTURE | BROWSER
Setup and approval reference:
Actions actually performed / UTC timestamps:
Expected result:
Actual result / observed source and field presence:
Outcome: PASS | FAIL | BLOCKED | NOT-PRODUCED
Reason (including NOT IMPLEMENTED or producer compatibility gap):
Evidence references (redacted; local originals):
Defect reference:
Cleanup completed / retained data / running processes:
Executor / reviewer:
```

### Defect template and triage

```text
Title: [test ID] Short observable failure
Run ID / source SHA / VSIX SHA-256 / installed identity proof:
VS Code, OS, CLI and workspace agent/template versions:
Severity: stop-ship | major | minor
Prerequisite and evidence class:
Smallest reproducible steps in a disposable workspace:
Expected / actual:
Reproduction count / observed latency:
Producer source/format/fields present or missing:
Redacted evidence and local-original references:
Impact / last safe state / recovery steps:
Regression or compatibility hypothesis (label unverified):
Owner / disposition / retest build and result:
Posting approval (none unless separately obtained):
```

Treat privacy leaks, data loss, cross-workspace/member misattribution and unintended process launches as stop-ship. Treat broken core controls, persistence or supported-source rendering as major. Triage visual-only issues by usability impact. Record producer incompatibility and absent fields explicitly even when no extension defect is proven. Retest against a new exact artifact; do not overwrite the failed run.

### Exit criteria and user sign-off

The handoff is ready for review when every selected check has an outcome, evidence and cleanup status; pending implementations and missing producers remain explicit; artifact identity is proven; and all defects are triaged. Full native/real acceptance additionally requires actual NATIVE/REAL evidence for the agreed applicable checks, no unresolved stop-ship defects, and the user's decision on all remaining failures/gaps. Fixture passes cannot waive absent producers.

```text
Run ID / source SHA / VSIX SHA-256:
Native acceptance: accepted | rejected | pending
Real Squad acceptance: accepted | rejected | pending
Scope accepted (test IDs and evidence classes):
FAIL / BLOCKED / NOT-PRODUCED / NOT IMPLEMENTED gaps:
Defects accepted as exceptions (explicit rationale):
Cleanup reviewed / outstanding processes and retained evidence:
Human signer / date / approval reference:
Next implementing build requiring retest:
```

Do not close [#4](https://github.com/swigerb/squad-pod/issues/4), [#7](https://github.com/swigerb/squad-pod/issues/7), or [#8](https://github.com/swigerb/squad-pod/issues/8) because this plan exists or smoke passed.

## Native-only fixture recipes

Use these only in approved disposable fixture paths. They are parser examples, **not claims about what the installed CLI emits**. Replace `ada` with the fixture roster's exact visible slug. For an actual Squad run, use the reviewed workspace agent/template instead of manufacturing events.

### Historical baseline and file-idle fixture

Before opening the fixture workspace, put this JSON in `.squad\sessions\historical.json`:

```json
{"id":"fixture-history","createdAt":"2026-01-01T10:00:00Z","agent":"ada","messages":[{"role":"assistant","content":"Historical fixture only","timestamp":"2026-01-01T10:00:00Z"}]}
```

Opening the panel must not replay it. After baseline, change only its message to `Updated fixture only` and save; expect file-observed activity, then idle after the last write. For the other N-04 historical sources, use Markdown logs containing `**Agent:** Ada`, an inbox filename beginning with the exact slug (for example `ada-fixture.md`), and the fixture agent's `history.md`. Seed them before opening; later approved changes test the file watcher only.

### Live reader fixture

In the verified fixture-only Copilot home, create `session-state\fixture-session\workspace.yaml` with one absolute `cwd:` scalar pointing to the fixture workspace (for example `cwd: 'C:\Acceptance\fixture-A'`). Initially write only the first marker record below to its `events.jsonl`. After approved live consent and source discovery, append each subsequent record separately with a newline; observe each tool/state before appending the next:

```jsonl
{"type":"subagent.selected","data":{"agentName":"Squad"}}
{"type":"tool.execution_start","data":{"toolCallId":"fixture-run","toolName":"task","arguments":{"name":"ada","agent_type":"general-purpose","mode":"background","description":"Fixture live task"}}}
{"type":"subagent.started","data":{"toolCallId":"fixture-run"}}
{"type":"tool.execution_start","data":{"toolCallId":"fixture-read","parentToolCallId":"fixture-run","toolName":"view","arguments":{"path":"C:\\Acceptance\\fixture-A\\acceptance-input.txt"}}}
{"type":"tool.execution_complete","data":{"toolCallId":"fixture-read","toolTelemetry":{"metrics":{"context_current_tokens":800,"context_token_limit":1000}}}}
```

Expect the exact member to activate, the read tool/pose while the tool is in flight, then 80% context after its completion while the member run remains active. Append `{"type":"subagent.completed","data":{"toolCallId":"fixture-run"}}` plus a newline to finish and clear context. For R-04, change one variable at a time: `arguments.name`, `parentToolCallId`, lifecycle `toolCallId`, or metadata cwd. For an ambiguous identity use fixture roster slugs `ada` and `ADA`, then restore the roster. Record the original and changed files; do not generate or edit any actual producer session.

### Observed task inventory fixture

For R-06, start a fresh qualified fixture session with only the Squad marker. After consent/discovery, append these records one at a time with newlines and inspect Telemetry after each:

```jsonl
{"type":"tool.execution_start","data":{"toolCallId":"parent-a","toolName":"task","arguments":{"name":"Same task","agent_type":"explore","mode":"background","description":"Fixture parent"}}}
{"type":"subagent.started","data":{"toolCallId":"parent-a"}}
{"type":"tool.execution_start","data":{"toolCallId":"child-b","parentToolCallId":"parent-a","toolName":"task","arguments":{"name":"Same task","agent_type":"explore","mode":"background","description":"Fixture child"}}}
{"type":"subagent.started","data":{"toolCallId":"child-b"}}
{"type":"tool.execution_complete","data":{"toolCallId":"child-b"}}
{"type":"subagent.failed","data":{"toolCallId":"child-b"}}
{"type":"subagent.completed","data":{"toolCallId":"child-b"}}
{"type":"tool.execution_start","data":{"toolCallId":"child-b","toolName":"task","arguments":{"name":"Do not rename","agent_type":"general-purpose","description":"Repeated start"}}}
{"type":"tool.execution_start","data":{"toolCallId":"unknown-c","toolName":"task","arguments":{"name":"not-a-member","agent_type":"general-purpose","mode":"background","description":"Unknown member fixture"}}}
{"type":"tool.execution_start","data":{"toolCallId":"other-type-d","toolName":"task","arguments":{"name":"ada","agent_type":"explore","mode":"background","description":"Type mismatch fixture"}}}
```

Expect two distinct **Same task** rows; the child points to the parent. Both are unattributed. Dispatch completion leaves the child running; failure changes it to failed; the later completion and repeated start neither change that terminal state nor rename it. The two additional rows stay observed and unattributed. Compare with the prior live recipe's `ada`/`general-purpose` match; none of these unattributed rows may create a character, context gauge or roster entry.

Use fresh fixture sessions for these independent variants; append after discovery to avoid confusing seed filtering with new events:

| Variant | Procedure and expected result |
|---|---|
| Explicit invalid parents | Create a call with `parentToolCallId` equal to itself, one naming an absent call, and a pair naming each other. Use unique call IDs. All show `Parent: unknown`; no fabricated parent or roster edge appears. |
| Genuine terminal states | Create three unique calls, start each, then append completed/failed/aborted respectively. Each shows its own terminal state. Repeat each terminal event: no duplicate row or state transition. |
| Identity bounds | Repeat the task-start envelope with unique IDs except for the field under test. Use a 161-character call ID, outer-space ID, control-character ID (JSON escaped), then an invalid parent ID. Invalid call IDs produce no row or aliases; invalid parents produce no link. The coverage warning reports omitted identity. |
| Display bounds and privacy | Use valid unique call ID with 161-character name, 161-character type/mode, 41-character description and a nonsecret sentinel in `arguments.prompt`/an extra argument. Name is omitted, type/mode are at most 160 characters, description at most 40, and truncation/omission is disclosed. Sentinel must not reach UI or retained projected data; the oversized name must not gain a roster match. |
| Inventory bounds | In a new session, append 65 unique task-start calls (IDs `limit-1` through `limit-65`) with no terminal events. Expect 64 rows and partial coverage. Complete all 64 retained calls; expect only the 16 most recent completions. Separately fill 64 calls, complete one, then append a new unique call: the completed row is evicted before an in-flight call. |
| Source bounds | In a fresh approved fixture, keep the Squad marker in the head, add a line exceeding 64 KiB and sufficient non-event filler to exceed 2 MiB, then add a valid task-start near the tail. Expect bounded coverage warning and only eligible tail events, not a claim of complete history. |
| Startup and reconnect | Seed a finished call and an uncompleted call before discovery. Only the latter appears. Reopen/reconnect the panel while current source is valid: no duplicate call. Turn live off and cancel re-enable consent: list stays clear. Re-enable only after approval. |
| Stale, lost and renewed source | Let the fixture stop growing for 5 minutes plus 10 seconds: list clears/searches. Append a new call and confirm in-flight reconstruction, not old completions. With approval, move the fixture event file to a run-owned backup: list clears. Restore/replace it and verify new qualified state only. Use this fixture, not a paid idle task, for the timeout. |
| Cross-session isolation | Start a new eligible same-workspace session, reuse a prior call ID but omit its old parent, and make this candidate newest by its session-directory modification time. Expect only the new session's state and `Parent: unknown`. Do not use the shortened source label as identity proof. |

Use an approved local text editor or fixture-generation tool for repetitive records; record the exact generator/input and file hashes with the results. This plan does not authorize running new software or accessing actual private logs to produce fixtures.

### Usage arithmetic fixture

For U-01, this newline-terminated `.squad\log\usage.jsonl` starts with known answers:

```jsonl
{"version":1,"kind":"turn-start","sessionId":"fixture-1","turnId":"t1","timestamp":"2026-01-01T10:00:00Z"}
{"version":1,"kind":"turn-start","sessionId":"fixture-1","turnId":"t1","timestamp":"2026-01-01T10:00:00Z"}
{"version":1,"kind":"turn-start","sessionId":"fixture-2","turnId":"t2","timestamp":"2026-01-01T10:00:00Z"}
{"version":1,"kind":"usage","sessionId":"fixture-1","turnId":"t1","agentName":"ada","model":"fixture-model","inputTokens":10,"outputTokens":5,"estimatedCost":0.02,"timestamp":"2026-01-01T10:01:00Z"}
{"version":1,"kind":"usage","sessionId":"fixture-1","turnId":"t1","agentName":"ada","model":"fixture-model","inputTokens":10,"outputTokens":5,"estimatedCost":0.02,"timestamp":"2026-01-01T10:01:00Z"}
{"version":1,"kind":"usage","sessionId":"fixture-2","model":"unknown","inputTokens":0,"outputTokens":0,"estimatedCost":0.02,"timestamp":"2026-01-01T10:02:00Z"}
```

Expect 3 usage reports, 2 distinct starts, 1 covered turn, 1 unlinked report, sums of 20 input / 10 output tokens and approximately 0.06 producer cost units, and 1 normalized-value report. Repeating usage records is intentional. Change a usage `sessionId` without changing `turnId` to verify that coverage is by distinct turn ID only. Add the malformed/unsupported/incomplete variants from U-01 in separate recorded subchecks, then recompute only the valid complete records. These fixtures never prove that the real backend produces a ledger.

## Source references

These are inspection anchors, not evidence of executed acceptance. Read them at the product SHA in the manifest:

- [`package.json`](../package.json), [`src/extension.ts`](../src/extension.ts): engines, scripts, settings, native commands and activation.
- [`src/squadPaths.ts`](../src/squadPaths.ts), [`src/teamParser.ts`](../src/teamParser.ts), [`src/agentManager.ts`](../src/agentManager.ts), [`src/constants.ts`](../src/constants.ts): observed root, roster/aliases, identity persistence and timing.
- [`src/squadWatcher.ts`](../src/squadWatcher.ts), [`src/copilotSessionState.ts`](../src/copilotSessionState.ts), [`src/copilotSessionActivity.ts`](../src/copilotSessionActivity.ts): historical baseline, actual live discovery, bounded reads, supported envelopes and lifecycle.
- [`src/observedTasks.ts`](../src/observedTasks.ts), [`ObservedTasks.tsx`](../webview-ui/src/components/ObservedTasks.tsx): session/call identity, explicit safe parent links, terminal states, inventory bounds and source-status presentation.
- [`src/recordedUsage.ts`](../src/recordedUsage.ts), [`RecordedUsage.tsx`](../webview-ui/src/components/RecordedUsage.tsx): ledger validity, sums, distinct-turn coverage and diagnostics.
- [`src/declaredModels.ts`](../src/declaredModels.ts), [`src/declaredModels.test.ts`](../src/declaredModels.test.ts): separate charter/JSON declarations, exact-name matching, bounded guarded reads, legacy presence-only diagnostics and no effective-model resolution.
- [`furnitureSurfaces.ts`](../webview-ui/src/office/layout/furnitureSurfaces.ts), [`conferenceTable.test.ts`](../webview-ui/src/office/engine/conferenceTable.test.ts), [`acceptance-conference-table.cjs`](../scripts/acceptance-conference-table.cjs): surface ownership, conference accessory draw depth, grouped transforms, and strict-CSP production-browser fixture boundaries.
- [`src/agentManager.ts`](../src/agentManager.ts), [`src/squadWatcher.ts`](../src/squadWatcher.ts), [`src/copilotSessionActivity.ts`](../src/copilotSessionActivity.ts), [`AgentCard.tsx`](../webview-ui/src/components/AgentCard.tsx), [`SquadInfoCard.tsx`](../webview-ui/src/components/SquadInfoCard.tsx): filtered file-activity hints, live/file source precedence, truthful attributable activity time, and unavailable-time formatting.
- [`MobileShell.tsx`](../webview-ui/src/standalone/MobileShell.tsx), [`mobileShellState.ts`](../webview-ui/src/mobile/mobileShellState.ts), [`edgeSwipe.ts`](../webview-ui/src/mobile/edgeSwipe.ts), [`touchDecisions.ts`](../webview-ui/src/mobile/touchDecisions.ts), [`keyboardViewport.ts`](../webview-ui/src/mobile/keyboardViewport.ts), [`OwnedTerminalPanel.tsx`](../webview-ui/src/standalone/OwnedTerminalPanel.tsx), [`terminal-acceptance.mjs`](../standalone/scripts/terminal-acceptance.mjs): accepted mobile navigation/authority, touch, keyboard/clipboard and installed synthetic PTY fixture contracts.
- [`SquadInfoCard.tsx`](../webview-ui/src/components/SquadInfoCard.tsx), [`useExtensionMessages.ts`](../webview-ui/src/hooks/useExtensionMessages.ts), [`useEditorKeyboard.ts`](../webview-ui/src/hooks/useEditorKeyboard.ts), [`OfficeCanvas.tsx`](../webview-ui/src/office/components/OfficeCanvas.tsx): live member updates, stale detail-response guards, dialog focus handling, native button keys and canvas pan routing.
- [`src/directoryLaunch.ts`](../src/directoryLaunch.ts), [`src/directories.ts`](../src/directories.ts), [`src/SquadPodViewProvider.ts`](../src/SquadPodViewProvider.ts): launch validation, suggestions, consent, native terminal ownership and layout/cache/import/export.
- [`src/layoutPersistence.ts`](../src/layoutPersistence.ts), [`layoutDraft.ts`](../webview-ui/src/office/editor/layoutDraft.ts), [`LayoutConflict.tsx`](../webview-ui/src/components/LayoutConflict.tsx), [`useEditorActions.ts`](../webview-ui/src/hooks/useEditorActions.ts): revision protection, recovery, Save and Reset.
- [`SettingsModal.tsx`](../webview-ui/src/components/SettingsModal.tsx), [`EditorToolbar.tsx`](../webview-ui/src/components/EditorToolbar.tsx), [`toolUtils.ts`](../webview-ui/src/office/toolUtils.ts), [custom assets](custom-assets.md): available controls, floors, context display and asset contracts.
- [`floorTiles.ts`](../webview-ui/src/office/floorTiles.ts), [`office/types.ts`](../webview-ui/src/office/types.ts): explicit persisted-floor/source-pattern mapping and unchanged VOID 8.
- [`standalone/package.json`](../standalone/package.json), [`standalone/build.mjs`](../standalone/build.mjs), [`standalone/src/cli.ts`](../standalone/src/cli.ts), [local observer package](../standalone/README.md): accepted separate package, build/install paths, runtime credential handoff, rotation and graceful stop.
- [`standalone/src/projectFiles.ts`](../standalone/src/projectFiles.ts), [`standalone/src/observer.ts`](../standalone/src/observer.ts), [`standalone/src/transport.ts`](../standalone/src/transport.ts): selected-project bounded reads, file baseline/expiry, diagnostics, recorded usage, loopback authentication and server-side read-only authority.
- [`standalone/main.tsx`](../webview-ui/src/standalone/main.tsx), [`standalone/browserClient.ts`](../webview-ui/src/standalone/browserClient.ts): actual authentication controls, credential input clearing, cookie-based reconnect and observation-only retries.
- [`TelemetryDrawer.tsx`](../webview-ui/src/components/TelemetryDrawer.tsx), [`SourceStatusView.tsx`](../webview-ui/src/components/SourceStatusView.tsx): **Clear activity**, always-visible recorded usage, observation-settings entry and activity source diagnostics.
- [`SquadInfoCard.tsx`](../webview-ui/src/components/SquadInfoCard.tsx), [`AgentCard.tsx`](../webview-ui/src/components/AgentCard.tsx), [`useExtensionMessages.ts`](../webview-ui/src/hooks/useExtensionMessages.ts): Squad Info dialog, member disclosures, per-expansion detail requests, declared fields, inert charter text and read-only charter availability; the provider's bounded (64 KiB, UTF-8, stable-during-read) charter reader decides available/missing/unreadable.
- [`standalone/src/ownedRuns.ts`](../standalone/src/ownedRuns.ts), [`ownedPtyProcess.ts`](../standalone/src/ownedPtyProcess.ts), [`ptyHost.ts`](../standalone/src/ptyHost.ts), [`terminalSocket.ts`](../standalone/src/terminalSocket.ts), [`ownedTerminalProtocol.ts`](../src/core/ownedTerminalProtocol.ts): executable resolution, environment allowlist, fixed argv, run limits, owned identity, broker cleanup and terminal channel.
- [`OwnedTerminalPanel.tsx`](../webview-ui/src/standalone/OwnedTerminalPanel.tsx), [`terminalClient.ts`](../webview-ui/src/standalone/terminalClient.ts), [`terminal-acceptance.mjs`](../standalone/scripts/terminal-acceptance.mjs): actual terminal controls, replay/resync and the synthetic installed acceptance helper.
- [`standalone/src/officeControl.ts`](../standalone/src/officeControl.ts), [`officeStore.ts`](../standalone/src/officeStore.ts), [`officePreferences.ts`](../standalone/src/officePreferences.ts), [`office-acceptance.mjs`](../standalone/scripts/office-acceptance.mjs): opted-in control allowlist, fixed selected-project targets, revisions/atomic writes, settings/seat acknowledgements and synthetic installed control evidence.
- [Standalone channels](standalone-channels.md): host-neutral contracts, read-only office default, separately authorized selected-project controls and owned terminals, implemented mobile helpers, and unimplemented remote access.
