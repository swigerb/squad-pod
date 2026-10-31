# Acceptance evidence

This directory preserves reviewed, run-specific evidence. Start with the
[testing guide](../testing.md) to run the repository's observer harness yourself.
Native VS Code and real Squad checks follow the separate
[approval-gated acceptance plan](../native-acceptance.md).

## Read an existing run

Read its `report.md` and `run-manifest.json` before interpreting a screenshot or
PASS. Confirm the product commit, package hash, test scope and actual run times.
Then follow the ledger's observation references to the supporting files.
Different runs can use different schemas; do not combine results from different
builds or replace missing evidence with assumptions.

Use the testing guide's [integrity commands](../testing.md#read-and-verify-committed-evidence)
to check indexed files using canonical Git bytes. Matching hashes establish
integrity, not successful behavior, completeness or human sign-off.

## Save a new run

Create a new timestamped directory here rather than overwriting an older run.
Include a concise report, source/package identity, exact commands and exit
codes, actual start/stop times, relevant machine/tool versions, and process
cleanup results. Retain the harness JSON reports and captures that were actually
produced; label skipped or blocked checks explicitly.

If you use an existing acceptance ledger, preserve its complete mapping and
update only checks supported by this run's observations. Keep fixture, browser,
native and real-producer evidence distinct. A screenshot alone does not prove
every statement in a case.

Review and redact local paths, credentials and private content before committing.
Record each retained file's byte count and SHA-256 in `evidence-index.json`,
excluding the index's own hash. Open a draft evidence PR with non-closing issue
references; record the head SHA and CI result, and read the committed files back.
Do not close acceptance issues just because the evidence PR or CI passed.
