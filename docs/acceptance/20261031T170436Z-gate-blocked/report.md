# Bounded Squad Pod acceptance

**STOPPED: native host isolation unresolved.** Selected package payload **MATCH**; no Squad Pod behavioral variant accepted. Native host opened at `2026-10-31T17:30:23.162Z` and was stopped at `2026-10-31T17:32:55.216Z`. All owned startup PIDs were absent by `2026-10-31T17:32:58.235Z`.

Original limits unchanged: start `2026-10-31T17:04:36.279Z`, testing deadline `2026-10-31T18:49:36.279Z`, hard stop `2026-10-31T19:04:36.279Z`. Zero test-launched AI tasks/spending; automatically created `copilot-runtime` process is recorded without attributing a paid task. Human acceptance pending.

Current outcomes: **0 PASS / 0 FAIL / 1,932 BLOCKED / 0 NOT-PRODUCED** atomic statements; **20/20 compact variants BLOCKED**. Most recent remotely verified initial checkpoint: `c85a3ce7655ac64f971ba665562922909e2400c4`, [draft PR 144](https://github.com/swigerb/squad-pod/pull/144). This stop update awaits publication/readback and does not claim a future commit.

## Historical initial checkpoint text

The following section describes the pre-testing state published at `c85a3ce7655ac64f971ba665562922909e2400c4`, not the current runtime state. The current stop/cleanup appears after it.

### Initial pre-testing checkpoint

Run `20261031T170436Z-gate-blocked` resumes the original clock. **Preflight verified; runtime acceptance not started.**

Start: `2026-10-31T17:04:36.279Z`. Testing stop: `2026-10-31T18:49:36.279Z`. Hard stop: `2026-10-31T19:04:36.279Z`. Last 15 minutes reserved for remote readback/accounting/cleanup. No extension and zero AI tasks launched by tests.

## Candidate and installed identity

Product CI checkout `f3f080d4ce7bec009df2c62648f4ad0c4ea505a6`, tree `a70bfda8186eceaee97c68544e767eaa99b9a402`; [CI attempt 1](https://github.com/swigerb/squad-pod/actions/runs/41219175729) succeeded. PR head and merged master are separate roles with the identical tree. [Membership replay fix, PR 143](https://github.com/swigerb/squad-pod/pull/143), `2522124e48b46a702427692869470680e832351e`, is included. No fix is intentionally withheld; later/unpublished changes are excluded.

VSIX artifact `13048334827`, `squad-pod-0.1.0.vsix`: 578477 bytes, SHA-256 `1790a5c133063a5e4aa1a43d96bb00c40795f4e9307decd51721b02de56a50f3`. Standalone artifact `13049980047`, `squad-pod-observer-0.1.0.tgz`: 423982 bytes, SHA-256 `1f7bbb5c7cd35764e5c417dccd2ce38d21e73f82e78ae104af148fa48ef0633a`. Both extracted package identities matched.

The fresh isolated VSIX was compared with its package. Only installed `package.json` raw bytes differed: VS Code added `__metadata`. Runtime testing stopped while this was investigated. Every original manifest property and every other executable/asset file matched. The exact raw manifest and installed bundle hashes are in [the manifest](run-manifest.json#gate). No credential-bearing installer metadata values are published. Version/filename/size alone were not accepted as identity.

## Scope and baseline

The [frozen record](frozen-candidate.json) supersedes only the pinned plan's historical package selection; its procedures and stable IDs remain applicable. [Historical PR 141 evidence](https://github.com/swigerb/squad-pod/tree/a6047b4dad447092de57342f131090c7dedac208/docs/acceptance/20261031T135929Z-fresh-25a14517) belongs to product `25a14517`. Its 42 PASS statements are not passes for this candidate. Missing historical originals remain missing; no search or reconstruction occurred.

The existing 27 cases, 1,932 atomic IDs, 8 common definitions and exactly-once mappings are reused unchanged. Current outcomes: **0 PASS / 0 FAIL / 1,932 BLOCKED / 0 NOT-PRODUCED**. These include setup prose and are not a product defect count or release-readiness percentage. The [compact behavioral matrix](behavioral-matrix.json) governs this bounded pass; individual variants will have distinct observations. No combined subcheck becomes PASS from one variant.

Profile, workspace and folder fixture settings explicitly start with live activity and directory suggestions off. Fixture roots are aliased; no real usage file, real launch or normal CLI root is configured. Native UI effective configuration and internal absence of reads remain unproved. No inference is made about the old run's earlier consent or scope.

## Runtime, issues and cleanup

No native/browser product window, observer server, synthetic terminal or REAL producer has been launched for this run. Authentication has not occurred. Native export/new-file/overwrite/cancel, membership boundaries, desktop controls and separate standalone authorities remain BLOCKED pending execution. Human assistance will be labeled only if actually performed. No media is claimed.

Refs [#123](https://github.com/swigerb/squad-pod/issues/123) and [#143](https://github.com/swigerb/squad-pod/pull/143): **blocked for behavioral acceptance**, with no issue closure or merge recommendation yet. No product code, permissions or Marketplace release changes. Human acceptance remains pending.

No run-owned runtime process remains running. Frozen packages, fresh isolated installation, exact historical mapping source copies and evidence are retained. Historical gate checkpoint bytes are immutable under [checkpoints/gate-20261031T170632Z](checkpoints/gate-20261031T170632Z/). Publication/readback must complete before runtime testing. Current remote verification is not yet claimed.

[Case ledger](case-ledger.json) | [Atomic ledger](case-ledger-atomic.json) | [Observations](observations.jsonl) | [Standalone setup](standalone-setup.json) | [Evidence index](evidence-index.json)

## Native startup safety stop

At `2026-10-31T17:30:23.162Z`, the identified installed native host opened `WORKSPACE_A`. A read-only native workbench snapshot displayed the exact parent-repository discovery warning quoted in [the actual startup observation](evidence/logs/native-startup-stop.json). The run-owned process inventory also contained an automatically started `copilot-runtime` descendant. No product panel or consent settings were opened, no prompt was accepted, and no keyboard/selector campaign or reload followed.

**Runtime stopped at `2026-10-31T17:32:55.216Z`; effective isolation remains BLOCKED.** These observations do not prove paid AI execution, a Squad producer, out-of-scope file contents, or a Squad Pod privacy defect. They do not prove absence of reads either. The separately identified native host was gracefully closed, and all 11 recorded owned PIDs were absent by `2026-10-31T17:32:58.235Z`. No other session was inspected or stopped.

The expanded installed-payload classifier at `2026-10-31T17:34:26.502Z` is **MATCH**: 187 non-manifest files byte-identical; all original `package.json` properties equal after removing only `__metadata` with the three documented keys; installed `.vsixmanifest` identical to packaged `extension.vsixmanifest`; `[Content_Types].xml` absent as expected. Both bundle and map have the supplied NEW hashes, not historical ones. This does not resolve the independent runtime safety stop.

Initial durable checkpoint [`c85a3ce7655ac64f971ba665562922909e2400c4`](https://github.com/swigerb/squad-pod/commit/c85a3ce7655ac64f971ba665562922909e2400c4) was read back before the native launch: [immutable receipt](checkpoints/remote-readback-c85a3ce7655a.json). Draft evidence [PR 144](https://github.com/swigerb/squad-pod/pull/144) targets master and has no closing issue references.

Outcome delta: **no behavioral/atomic PASS or FAIL added; all 1,932 statements and all 20 compact variants remain BLOCKED**. One actual NATIVE host-safety observation is added, distinct from package identity. Native membership cold/recreation/reload/project-switch, new-file export/overwrite/cancel, layout/seat/desktop/directory controls, all authenticated standalone variants and motion evidence remain unexecuted. No bounded clip was produced. The startup screenshot includes a sign-in welcome dialog and is excluded from publication; no auth image or console is published.

Issue recommendations against actual criteria: [#4](https://github.com/swigerb/squad-pod/issues/4) **blocked**, installed native membership/runtime acceptance not exercised; [#123](https://github.com/swigerb/squad-pod/issues/123) **blocked**, no manual native export destination or overwrite outcome established. [PR 143](https://github.com/swigerb/squad-pod/pull/143) membership fix is included in the verified package but **native acceptance remains blocked**. No closure/merge/release action, and human acceptance stays pending.

Current setup: no run-owned native host, observer, helper or terminal running. Frozen packages, isolated installation, synthetic projects and checkpoint files are retained. The one unreviewed startup screenshot remains local and excluded. No dependency installation or public registry contact occurred; standalone dependency resolution reached ancestors, so its isolated installation is not established and it was never executed. Native warning/root isolation must be resolved explicitly before any continuation; original `18:49:36Z` testing and `19:04:36Z` hard limits still apply.
