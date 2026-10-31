# Bounded native acceptance: 20261031T193755Z-f3f080d4

**Initial pre-testing checkpoint.** Product `f3f080d4ce7bec009df2c62648f4ad0c4ea505a6`, tree `a70bfda8186eceaee97c68544e767eaa99b9a402`, CI 41219175729 attempt 1. Membership fix `2522124` is included; the pinned plan's historical installation target is superseded by [the frozen record](frozen-candidate.json).

Start `2026-10-31T19:37:55.466Z`; testing stop `2026-10-31T21:22:55.466Z`; hard stop `2026-10-31T21:37:55.466Z`. Final 15 minutes reserved for remote verification and cleanup. Zero test-launched AI spending. Executor: agent-driven native UI tester and delegated technical reviewer, not a human.

## Identity and isolation

VSIX: artifact 13048334827, 578477 bytes, SHA-256 `1790a5c133063a5e4aa1a43d96bb00c40795f4e9307decd51721b02de56a50f3`. Standalone: artifact 13049980047, 423982 bytes, SHA-256 `1f7bbb5c7cd35764e5c417dccd2ce38d21e73f82e78ae104af148fa48ef0633a`. Preserved packages were freshly hashed and the VSIX freshly installed into this run's new isolated profile/extensions pair. [All 187 non-manifest installed files](evidence/logs/installed-payload.json) match; only documented VS Code metadata is added to the otherwise equivalent package manifest. .vsixmanifest matches the packaged extension manifest.

[Allowlisted profile/workspace/folder settings](evidence/logs/isolation-settings.json) set live observation and directory suggestions off, AI chat disabled and parent Git discovery disabled. Only [synthetic A/B rosters](evidence/logs/fixture-baselines.json) and a dedicated fixture CLI home are configured. Effective native UI values and internal absence of reads remain unproved. No native host, standalone server, terminal or producer has launched. Authentication and security prompts will not be bypassed.

## Behavioral scope

[The 20-variant matrix](behavioral-matrix.json) prioritizes effective configuration, fixed membership cold/recreation/reload/project boundaries, native export/new/overwrite/cancel, layout/seat/desktop/directory controls and separately authenticated standalone fixtures. A variant never passes an entire combined requirement. Existing 27 cases, 1,932 atomic IDs and 8 common definitions are retained with unchanged exactly-once mappings, not re-atomized. **0 PASS / 0 FAIL / 1,932 BLOCKED / 0 NOT-PRODUCED** statements initially. Historical passes do not transfer.

[Previous stopped run](https://github.com/swigerb/squad-pod/tree/b001afae667a671f242740e048dc1386e58dab09/docs/acceptance/20261031T170436Z-gate-blocked) remains immutable. Its parent-discovery/AI-host-child concern is not dismissed or converted into a pass; this run must produce new observations after the scoped recovery.

## Evidence and handoff

No runtime media yet. [Observations](observations.jsonl), [case ledger](case-ledger.json), [atomic ledger](case-ledger-atomic.json), [manifest](run-manifest.json), [standalone setup](standalone-setup.json), and [index](evidence-index.json) are current-run artifacts. Initial GitHub canonical blob readback must complete before runtime testing. No product fixes, merge, issue closure, permissions or Marketplace publication. No REAL launches, private logs or physical-device testing. Human acceptance remains pending.

Issue recommendations are initially blocked pending direct evidence: Refs [#4](https://github.com/swigerb/squad-pod/issues/4), [#7](https://github.com/swigerb/squad-pod/issues/7), [#8](https://github.com/swigerb/squad-pod/issues/8), [#123](https://github.com/swigerb/squad-pod/issues/123). Durable hierarchy/promotion (#111), actual CLI usage without a selected sanitized real file (#109), and Marketplace release (#142) remain outside achievable acceptance under this scope. No owned runtime processes; installation, synthetic fixtures and evidence retained.
