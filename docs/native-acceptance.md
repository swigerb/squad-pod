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
pass. Leave pending implementations BLOCKED / NOT IMPLEMENTED.
Stop on data loss, privacy leaks, wrong-member attribution, or unintended launches.
Keep evidence local and redacted. Do not delete, post to GitHub, publish,
merge, or change permissions automatically. Return results and defects for
my review and explicit sign-off; do not claim acceptance on my behalf.
Save the full report as report.md with relative links to redacted evidence.
Keep the report and evidence local, outside the product workspace; do not
commit, upload, or publish them without my explicit approval.
```

## Scope and outcomes

This plan accepts a **specific installed build**, not a branch name or extension version. The original browser-verified reference is `c5b1742b320e77c28b54490250dff5007e97a19b`. Updated floor/task oracles below are source-grounded at `a706de0b286dc393c032b743707ad497046d1cdc`, which includes the implementing commits. Neither source reference is **native-approved**. Future implementing commits require a new manifest and rerun of affected cases.

| Outcome | Use when |
|---|---|
| PASS | The applicable check ran and its expected result has direct evidence. |
| FAIL | The prerequisite and source exist, but the result contradicts the oracle. |
| BLOCKED | Approval, environment, tool, artifact identity, or implementation is missing. Use reason `NOT IMPLEMENTED` for pending features. |
| NOT-PRODUCED | An approved actual run completed, but its runtime did not emit the required source or fields. Record the runtime/format and missing fields. This is not PASS. |

Record independent subchecks separately. For example, live tool labels can PASS while context is NOT-PRODUCED. A missing ledger message can PASS as native fallback behavior while real usage integration remains NOT-PRODUCED. Do not convert a blocked test into an exclusion or silently reduce the acceptance scope.

**Evidence classes:** `NATIVE` means the installed extension in desktop VS Code; `REAL` means data actually emitted by the approved supported Squad process; `FIXTURE` means deliberately authored test data; `BROWSER` means browser-only evidence. Fixtures and browser tests cannot establish real producer or native-host acceptance.

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
| Live discovery | Opt-in, undocumented CLI format. `session-state\<id>\workspace.yaml` supplies exact `cwd`; `events.jsonl` must contain the top-level Squad selection marker. Chooses newest matching candidate by session-directory modification time within bounded discovery. |
| Live identity | Case-insensitive exact visible roster **slug** only in the current provider (ID and folder are the same slug). The supported task shape is `task` with `agent_type=general-purpose` and the exact member slug in `arguments.name`, followed by correlated subagent/tool IDs. Display-name guesses, first-name guesses, unknown names, and ambiguous case-folded collisions must not attach to another member. File-observed aliases are a separate, more permissive mechanism. Live task activity is a transient overlay on the authoritative roster; it does not create durable parent/member edges or mutate `team.md`. |
| Live display | Short task description (40 characters), labels (30 characters), file basenames and command names only. `view` reads, `edit` edits, `create` writes. Context requires a tool completion's finite `toolTelemetry.metrics.context_current_tokens >= 0` and `context_token_limit > 0`. Never infer these from historical token totals. |
| Observed transient tasks | Telemetry lists session-local `task` calls separately from roster animation and recorded usage. Same names with distinct call IDs stay separate. Only uniquely exact visible slugs with `agent_type=general-purpose` receive a roster match; unknown names and other types remain visible but unattributed. Parent links require an explicitly observed, retained same-session parent and an acyclic chain; otherwise `Parent: unknown`. This is not durable hierarchy or membership discovery. |
| Recorded usage | Selected Squad directory's `log\usage.jsonl`, complete newline-terminated version-1 `turn-start` and `usage` records. Historical event sums over all valid complete local records, no time/member filter, no usage-event deduplication; at most 40 recent reports. Not current model, live context, or billing-grade cost. |
| Layout persistence | `.squad-pod\layout.json`, then valid workspace cache, then bundled default, then minimal fallback. Drafts are not disk saves. Save checks raw disk revision and workspace identity; prior disk contents get recovery files under `.squad-pod\recovery`. Panel recovery state is not a durable backup. |
| Timing | File polling 1 second plus native notifications (150 ms debounce); file activity idle timeout 30 seconds renewed on each activity. Live polling 1 second, discovery 5 seconds, stale after 5 minutes without new bytes; a correlated live run is not subject to the 30-second file timer. Usage and layout polling 2 seconds. |

For responsive checks, allow **10 seconds** after a settled change (discovery plus polling) and record actual latency; repeat once if host load obscures the result. For file-only idle, observe through **40 seconds after the last attributable write**. For live staleness, observe through **5 minutes plus 10 seconds**. These are execution windows, not product SLAs. Persistent delay with a verified source is FAIL; an absent producer is NOT-PRODUCED. Do not extend billable work just to reach a timeout.

## Applicability and suites

Create one row per check/subcheck with the implementing commit, prerequisite, and evidence class. Unless those prerequisites change, use these defaults:

| Check | Applicability |
|---|---|
| Native controls, editor, layouts, directory catalog | Implemented at the reference SHA; test in the installed VSIX. |
| Real file activity, live lifecycle/tools/context, usage | Require separately observed producer sources; record each missing capability as NOT-PRODUCED after an approved run, or BLOCKED if no run is authorized. |
| All nine bundled floor styles selectable | Implemented by [#78](https://github.com/swigerb/squad-pod/pull/78), merged as `a706de0b286dc393c032b743707ad497046d1cdc`. IDs are 1-7, 9 and 10; new ID 10 maps to `floor_7.png` (source pattern index 7). Legacy IDs retain meaning and 8 remains VOID. L-05's nine-style checks apply to rebuilt artifacts containing this commit; on older artifacts record that subcheck BLOCKED / NOT IMPLEMENTED. |
| Session-local observed task inventory and explicit parent links | Implemented by [#80](https://github.com/swigerb/squad-pod/pull/80), merged as `111e0641ef0daaf60e828d344e8be87ed7df26c2`. R-06 applies only when its code is in the rebuilt, installed artifact. Real coverage still requires emitted task metadata; fixture coverage cannot establish that the producer emits it. |
| Durable parent-child hierarchy, optional current-model display, authoritative teammate deduplication/promotion | Not implemented by the transient task inventory. Require a separate implementing commit, documented UI and producer contract before the relevant F-01 subcheck. Otherwise BLOCKED / NOT IMPLEMENTED. These are conditional capability checks, not a claim that generic roster promotion or a current-model label is required Pixel Agents parity. |
| Standalone observer/browser runtime, embedded terminal, mobile implementation | Pending at this source reference. Host-neutral channel/replay contracts are implemented, but do not supply a listener, observer runtime, authentication, process launcher, PTY or terminal UI. Read-only observer [#82](https://github.com/swigerb/squad-pod/pull/82) is a candidate under review, not generally accepted: only qualify it with its exact implementing build, separate approval and host-specific procedure after acceptance. Terminal/mobile remain unresolved. Browser harnesses and a narrow desktop panel do not satisfy these checks. Otherwise BLOCKED / NOT IMPLEMENTED. |

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

- **Setup:** N-02; one visible member with a charter, another disposable member without a charter.
- **Actions:** Click character, name, occupied desk, and occupied chair. Focus the member label and press Enter, then Space. Inspect details and **View Charter**. Exercise the missing-file path without creating a real agent.
- **Expected:** The correct member's details/status/task/recent activity appear; **View Charter** opens that member's native charter (history fallback, folder reveal, or explicit unavailable notice when appropriate). These interactions never open a terminal. Selecting another seat moves the selected member rather than opening a process.
- **Evidence:** Member-to-native-file path mapping and short interaction capture.
- **Cleanup:** Close test editors/cards and restore any moved seat.

### N-04: Startup history and source selection

- **Setup:** Live off. Before opening A, place clearly labeled historical fixtures in its sessions/log/orchestration/decision/agent directories. Keep B distinct. Use a legacy-only folder, a folder with both state directories, and an empty folder in separate subchecks.
- **Actions:** Open A and observe before making writes. Check **Settings** source status. Change workspace folder ordering/add/remove folders to exercise the selection rule. Open legacy-only and empty workspaces; return to A.
- **Expected:** Historical files do not replay as fresh activity on startup. Empty/missing roster is explicit rather than showing a stale team. Selected root follows the reference rule; `.squad` wins over `.ai-team`. B's members/events never silently populate A. This is fixture/native evidence, not evidence that Squad emitted these envelopes.
- **Evidence:** Fixture inventory/timestamps, ordered workspace-folder list, status and idle screenshots.
- **Cleanup:** Export drafts before switches; restore A's folder order. Retain fixtures as labeled fixtures.

### N-05: Default-off consent, off clearing, and privacy

- **Setup:** Approved isolated CLI log scope. Record independent settings for live activity and directory suggestions.
- **Actions:** Verify default live off. Request live activity, cancel its native confirmation, and verify it stays off. After explicit log-read approval, enable via **Live Activity (opt-in)** and accept **Enable Live Activity**. During R-02/R-03, turn it off with tools/context visible. Reload the host and verify no silent consent bypass. Test an unavailable source without accessing unapproved paths.
- **Expected:** Cancel starts no live reader. Enabled status distinguishes off/searching/following/error; `following` alone is not proof of attribution. Off stops the live reader and clears tool/context displays; file observation may still show activity. New host consent is required before reading again. Prompts, full paths, tool arguments/outputs and shell flags are absent from live display/retained telemetry; allowed short task descriptions must also contain no secrets.
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
- **Expected:** Read operations use supported reading animation, not typing/walk frames mislabeled as reading; edits/writes use work poses. Tool start/done correlate to that member, not the coordinator or another run. Basenames/command names appear without arguments, full paths or content. Gauge percentage is rounded `100 * current / limit`, clamped to 0-100; counts remain the source counts. Tool completion can update context, and run finish/off clears it. Missing metrics show no fabricated gauge and are NOT-PRODUCED for context integration, not 0%. Unsupported tool names/shape are compatibility evidence.
- **Evidence:** Short native video plus redacted tool IDs/names and metric-only projection. Observe current values without exposing raw arguments.
- **Cleanup:** Retain only redacted projection; clear live displays.

### R-04: Unknown identities, collisions, and session replacement

- **Setup:** Safe actual emitted negative examples if available. Otherwise use a separately labeled fixture-only log root whose isolation has been verified; never alter actual CLI history. Prepare visible slugs that collide under case folding in the disposable roster.
- **Actions:** Exercise an exact valid slug, unknown name, ambiguous collision, display-name/first-name near match, wrong parent/tool ID, and wrong workspace. In fixtures, replace/truncate the test event file and select a newer eligible session. Reload while a fixture task is in flight.
- **Expected:** Only uniquely exact live slugs and correlated IDs affect the right member. Unknown/colliding/near matches never borrow another identity or context, create roster members, or mutate `team.md`. New source/replaced file clears old tools/gauges; rehydration does not replay seed telemetry as new work or create duplicate members. Reload restores only the valid in-flight state.
- **Evidence:** Case-to-slug/source mapping, fixture provenance and before/after displays. Actual negative examples unavailable means NOT-PRODUCED for real negative coverage; a fixture pass remains FIXTURE.
- **Cleanup:** Restore roster, disable live, and retain fixture files separately pending scoped cleanup approval.

### R-05: Actual recorded usage and correct comparison scope

- **Setup:** Two approved small turns completed; inspect only the disposable workspace's selected Squad ledger if emitted. Live event logs and historical session JSON are not ledger substitutes.
- **Actions:** Open **Telemetry**, expand **Recorded usage / model history** and source diagnostics. Compare totals, record count, distinct-turn coverage, latest timestamps, attribution and recent history with an independent calculation over complete valid local version-1 records. Use a CLI cost report only if this installed runtime documents/provides it, and only after confirming its source and filters match this exact ledger scope.
- **Expected:** Totals sum every valid complete usage event, including repeated events; coverage uses distinct `turnId` values, not event count or `(sessionId, turnId)` pairs. A matching start covers that turn once; unlinked reports remain visible. Exact unique roster name/slug can attribute historical reports, including hidden roster members; unknown/colliding names remain unattributed. History is newest first, at most 40. Displayed models are historical reports, not a live/current-model selector. Estimated cost uses producer units, not an asserted currency/bill. Normalized zero/unknown values are not proof that usage was measured.
- **Evidence:** Ledger source/version/size/time bounds, independent sums and distinct-ID sets, redacted recent reports and comparison report scope. Record differing CLI scope instead of demanding a false equality.
- **Cleanup:** Do not create a ledger to fill a producer gap. No ledger/fields means real usage integration NOT-PRODUCED, even if the missing-source UI is correct.

### R-06: Observed transient tasks, explicit links, and clearing

- **Setup:** Rebuilt, installed artifact containing #80; R-01's approvals and source qualification. Open **Telemetry > Observed transient tasks**. Use actual metadata when produced. Exercise unavailable/edge-case combinations only in the approved fixture log root using the recipe below, with a separate result and evidence class for every subcheck.
- **Actions:** Observe a `task` start before its lifecycle start, then its actual started and terminal events. Compare two same-name calls with distinct IDs, an unknown name, a non-general-purpose call using a roster slug, and a valid general-purpose roster match. Observe an explicit parent call and child link; exercise unknown, self and cyclic parents in fixtures. Send dispatch/tool completion before lifecycle completion; replay a repeated start and late conflicting lifecycle in fixtures. Exercise bounded/truncated metadata and task-history limits. Cancel consent/turn live off, observe staleness, lose/replace the fixture source, reconnect/reopen the panel, and change to a fresh session reusing a call ID. Test **Clear** in Telemetry separately from disabling live activity. Compare the roster file/character count and recorded-usage snapshot before and after.
- **Expected:** Call identity is `(sessionId, toolCallId)`, not display name; duplicate names have separate numbered rows. Call start is `observed`, `subagent.started` is `running`, and only `subagent.completed`, `subagent.failed` or `subagent.aborted` sets that terminal state. `tool.execution_complete` is dispatch completion, not task completion; repeated starts cannot rename, reattribute or resurrect an already retained call, and later lifecycle events cannot change its terminal state. Unknown/non-general-purpose calls remain listed as **Unattributed** and never animate/create roster members or inherit member context. An exact general-purpose match can animate the existing member; concurrent same-member calls remain separate inventory rows even though the office has one character. Parent labels reference only retained explicit same-session calls with no cycle, never inferred membership. No task count changes ledger totals or `team.md`; Telemetry **Clear** clears event rows, not this source-backed inventory.
- **Expected bounds and recovery:** At most 64 total tasks and 16 recent terminal calls; at capacity, terminal history is evicted before in-flight calls, or excess calls are omitted when all 64 are nonterminal. Coverage is explicitly partial when limits omit source/history/identity. Name over 160 characters is omitted, type/mode are bounded to 160, description to 40; display truncation is disclosed. Call/parent IDs over 160 characters, with outer whitespace or control characters are rejected, not shortened into aliases. Prompt/argument/output content must not leak. Startup/source re-seeding restores only observed/running calls, not old terminal history; reconnect to a still-valid reader preserves its current bounded state without duplicates. Off/searching/error hides and clears task rows; source status alone must not resurrect them. Stale/lost/replaced sources clear old state; renewed source growth can reconstruct only eligible in-flight calls from its bounded seed. A new session cannot inherit old parent links even with a reused call ID or identical shortened source label.
- **Evidence:** Per-subcheck native screenshots/video and field-only correlation of approved session/call/parent IDs, name/type/mode, states and timestamps; roster/ledger before-and-after hashes or snapshots; limit counts and warnings. REAL results require actual emitted metadata. Missing real task, parent or lifecycle metadata is NOT-PRODUCED for that integration, not PASS; fixture successes remain FIXTURE. Do not spend AI budget manufacturing 65 real calls or failures.
- **Cleanup:** Set live off, restore fixture roster/root and run-owned source files only after approval, export any protected layout drafts, and retain redacted evidence separately. Never edit real logs or stop unrelated terminals.

## Recorded-usage fallback suite

### U-01: Missing source, partial data, and no deduplication

- **Setup:** Native installed build; a separate disposable fixture workspace, not the actual producer workspace. Back up any run-owned ledger before approved replacement.
- **Actions:** Start with no ledger, then an empty ledger. Add newline-terminated version-1 fixtures: two starts with the same turn ID, another distinct start, repeated valid usage reports for the first turn, and an unlinked report. Use explicit known nonnegative counts/costs and fixed timestamps. Add unknown/ambiguous agent names, an invalid line, unsupported version, and an incomplete final line. Complete that final line later; rewrite the ledger with fewer valid reports. Exercise the documented 2 MiB/10,000-complete-line bounds only with approved fixture files.
- **Expected:** Missing/empty is unavailable totals, not zero. All valid usage events count, including duplicates; duplicate starts count once. Distinct coverage, unlinked count, normalized-value warnings and history match the independent calculation. Invalid/unsupported/pending lines produce partial diagnostics; completed data appears after polling. Rewrite replaces totals rather than accumulating stale values. Oversized input withholds totals. Ledger writes alone never animate an agent.
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
- **Actions:** Place/color items; select/drag, Alt-release to copy, press **R** or **Rotate**; move/rotate a desk assembly. Exercise bounds/occupied-placement rejection. Toggle a stateful item's available state control and observe it at an active desk. Undo/redo, save/export/import and reload.
- **Expected:** Ungrouped items rotate geometrically; directional groups cycle available views (do not demand missing orientations). Desk assembly keeps attachments coherent; copying creates a distinct assembly without corrupting the source. Invalid transforms show feedback without partial mutation. Supported stateful art/manual toggles and furniture colors persist as defined; ordinary static custom assets need not animate.
- **Evidence:** Short transform video, feedback, before/after layout and UID comparison.
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
- **Actions:** At a wide panel (for example 1200x700) and narrow desktop panel (about 360x640), open Settings, Directories, Telemetry (including the observed task list), details, Layout, Area mappings, asset warnings and recovery UI. Scroll and use keyboard focus/Enter/Space. Resize while these are open. Pan/zoom the office. Observe 60 seconds of idle wandering and a seat move through corners; repeat during R-03 if produced.
- **Expected:** Controls remain reachable without clipping essential actions or modal traps. Text and path wrapping remain readable; labels, status/tool bubbles and context gauges stay aligned to the correct character while moving, sitting, turning and resizing. Walking uses natural directional frames, turns at corners without teleporting/jitter/sliding through obstacles, and pets do not strand agents. Active read/work poses remain distinct when their sources exist. Narrow desktop success is not mobile acceptance.
- **Evidence:** Wide/narrow screenshots, dimensions and short corner/seat/label video. List subjective defects with exact steps, not just "looks wrong."
- **Cleanup:** Restore viewport and zoom baseline; retain evidence before disposing the panel.

## Future capability gates

### F-01: Conditional durable hierarchy, model observation, and teammate deduplication

- **Setup:** Each subcheck requires a separate included implementing commit, documented native control and producer contract, plus approved actual source data. R-06's implemented session-local task links do not satisfy these durable capabilities. Without these prerequisites, record BLOCKED / NOT IMPLEMENTED.
- **Actions:** Once implemented, append the exact controls and expected source fields to this run's applicability record. Separately observe a real parent/child relationship, any optional latest live current-session model observation, and deduplication when an authoritative provider discovers that a transient task represents an existing teammate.
- **Expected:** Each display matches its implementing contract and emitted evidence. Do not treat generic roster promotion as the teammate-deduplication contract. A future model label means the latest observed live model for that session, not a guess from historical usage. Context gauges do not require a current-model label. Historical reports, manual roster edits, or inferred file activity cannot substitute for provider discovery or durable relationships. Missing actual fields after an approved run are NOT-PRODUCED for that integration.
- **Evidence:** Implementing commit, contract/control references and redacted before/after correlations.
- **Cleanup:** Follow the shipped capability's scoped cleanup; preserve the normal roster. Do not invent discovery/promotion controls or write roster entries to force a pass.

### F-02: Other runtimes and embedded terminal

- **Setup:** An included standalone/browser, embedded-terminal, or mobile implementation and an approved host-specific procedure. Otherwise BLOCKED / NOT IMPLEMENTED for each.
- **Actions:** After implementation, attach that procedure and run manifest for each host. Reuse applicable privacy, ownership, layout and attribution checks without assuming desktop APIs exist elsewhere.
- **Expected:** Results establish only the identified implemented host. A browser fixture, external VS Code terminal, or narrow panel does not pass these pending capabilities.
- **Evidence:** Host/build identity, approved procedure and host-specific results.
- **Cleanup:** Follow the approved host procedure; no deployment or publication is authorized by this plan.

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
- [`src/directoryLaunch.ts`](../src/directoryLaunch.ts), [`src/directories.ts`](../src/directories.ts), [`src/SquadPodViewProvider.ts`](../src/SquadPodViewProvider.ts): launch validation, suggestions, consent, native terminal ownership and layout/cache/import/export.
- [`src/layoutPersistence.ts`](../src/layoutPersistence.ts), [`layoutDraft.ts`](../webview-ui/src/office/editor/layoutDraft.ts), [`LayoutConflict.tsx`](../webview-ui/src/components/LayoutConflict.tsx), [`useEditorActions.ts`](../webview-ui/src/hooks/useEditorActions.ts): revision protection, recovery, Save and Reset.
- [`SettingsModal.tsx`](../webview-ui/src/components/SettingsModal.tsx), [`EditorToolbar.tsx`](../webview-ui/src/components/EditorToolbar.tsx), [`toolUtils.ts`](../webview-ui/src/office/toolUtils.ts), [custom assets](custom-assets.md): available controls, floors, context display and asset contracts.
- [`floorTiles.ts`](../webview-ui/src/office/floorTiles.ts), [`office/types.ts`](../webview-ui/src/office/types.ts): explicit persisted-floor/source-pattern mapping and unchanged VOID 8.
- [Standalone channel prerequisite](standalone-channels.md): implemented host-neutral contracts versus pending observer/runtime, process, terminal and mobile capabilities.
