'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach, test } = require('node:test');
const { generateAcceptanceProgress } = require('./acceptance-progress.cjs');

const roots = [];
const reason = 'NOT EXECUTED IN THIS RUN';
const subcheck = (id, kind, outcome, why, mode, commonRequirementId) =>
  ({ id, caseId: 'N-01', kind, outcome, reason: why, atomicIds: [`${id}-A001`],
    applicability: { evidenceModes: [mode] }, ...(commonRequirementId ? { commonRequirementId } : {}) });
const atom = (id, outcome, why, mode, evidenceClass = null, evidenceRefs = []) =>
  ({ id, caseId: 'N-01', subcheckId: id.slice(0, -5), outcome, reason: why,
    evidenceClass, evidenceRefs, eligibleEvidenceModes: [mode] });

async function makeRun() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squad-acceptance-progress-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const run = path.join(root, 'docs', 'acceptance', 'run');
  await fs.mkdir(run, { recursive: true });
  const subchecks = [
    subcheck('N-01-S001', 'setup', 'BLOCKED', reason, 'NATIVE'),
    subcheck('N-01-S002', 'actions', 'BLOCKED', 'Unclassified dependency delay', 'BROWSER'),
    subcheck('N-01-S003', 'expected', 'PASS', 'Direct evidence', 'NATIVE'),
    subcheck('N-01-S004', 'common', 'NOT-PRODUCED', 'Producer omitted source', 'REAL', 'C-01'),
  ];
  const ledger = { runId: 'test-run',
    commonRequirements: [{ id: 'C-01', requirement: 'Shared traceability obligation' }],
    cases: [{ id: 'N-01', title: 'Sample case', outcome: 'BLOCKED', reason, subchecks }] };
  const rows = [
    atom('N-01-S001-A001', 'BLOCKED', reason, 'NATIVE'), atom('N-01-S002-A001', 'BLOCKED', 'Unclassified dependency delay', 'BROWSER'),
    atom('N-01-S003-A001', 'PASS', 'Direct evidence', 'NATIVE', 'NATIVE', ['evidence/native.json']), atom('N-01-S004-A001', 'NOT-PRODUCED', 'Producer omitted source', 'REAL'),
  ];
  const entries = await Promise.all([
    ['case-ledger.json', ledger], ['case-ledger-atomic.json', { runId: 'test-run', rows }],
  ].map(async ([file, value]) => {
    const bytes = Buffer.from(JSON.stringify(value));
    await fs.writeFile(path.join(run, file), bytes);
    return { relativePath: file, bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  await fs.writeFile(path.join(run, 'evidence-index.json'), JSON.stringify({ runId: 'test-run', excludesSelf: true, entries }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Acceptance Test', '-c', 'user.email=acceptance@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return run;
}

const snapshot = async directory => new Map(await Promise.all((await fs.readdir(directory))
  .map(async file => [file, await fs.readFile(path.join(directory, file))])));

afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))));

test('shows missing evidence without treating eligibility as observed evidence', async () => {
  const report = await generateAcceptanceProgress(await makeRun());
  assert.match(report, /atomics missing class or evidence reference: 1\/1/);
  assert.match(report, /Eligible evidence modes \(not observed evidence\)/);
  assert.match(report, /REAL: 1 atomic requirements/);
  assert.match(report, /NATIVE: 2 atomic requirements/);
});

test('keeps partially passing cases incomplete and preserves original IDs and outcomes', async () => {
  const report = await generateAcceptanceProgress(await makeRun());
  assert.match(report, /N-01 — Sample case — BLOCKED \(PARTIAL; INCOMPLETE\)/);
  assert.match(report, /`N-01-S003-A001`=PASS \[NATIVE/);
  assert.match(report, /`N-01-S001-A001`=BLOCKED/);
  assert.equal((report.match(/Shared traceability obligation/g) ?? []).length, 1);
});

test('keeps unexecuted, unknown, and NOT-PRODUCED reasons distinct', async () => {
  const report = await generateAcceptanceProgress(await makeRun());
  assert.match(report, /\*\*UNEXECUTED\*\*.*"NOT EXECUTED IN THIS RUN"/);
  assert.match(report, /\*\*UNKNOWN\*\*.*"Unclassified dependency delay"/);
  assert.match(report, /\*\*NOT-PRODUCED\*\*.*"Producer omitted source"/);
  assert.doesNotMatch(report, /BLOCKER \(approval|BLOCKER \(environment|BLOCKER \(implementation/);
});

test('leaves every committed run input byte-identical after reporting', async () => {
  const run = await makeRun();
  const before = await snapshot(run);
  await generateAcceptanceProgress(run);
  const after = await snapshot(run);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [file, bytes] of before) assert.deepEqual(after.get(file), bytes, `${file} changed`);
});
