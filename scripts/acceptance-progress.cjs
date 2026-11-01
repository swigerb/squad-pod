#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { verifyAcceptanceIndex } = require('./verify-acceptance-index.cjs');

const INPUT_FILES = ['case-ledger.json', 'case-ledger-atomic.json'];
const OUTCOMES = ['PASS', 'FAIL', 'BLOCKED', 'NOT-PRODUCED'];
const EVIDENCE_MODES = ['NATIVE', 'REAL', 'BROWSER', 'FIXTURE'];

function readBlob(repoRoot, commit, relativePath) {
  return execFileSync('git', ['show', `${commit}:${relativePath}`], {
    cwd: repoRoot,
    maxBuffer: 128 * 1024 * 1024,
  });
}

const parseJson = (bytes, file) => {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw new Error(`Invalid JSON in ${file}: ${error.message}`); }
};

const countOutcomes = records => records.reduce((counts, { outcome }) => {
  counts[outcome] = (counts[outcome] ?? 0) + 1;
  return counts;
}, Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0])));

function reasonCategory(outcome, reason) {
  if (outcome === 'NOT-PRODUCED') return 'NOT-PRODUCED';
  if (typeof reason !== 'string' || reason.trim() === '') return 'UNKNOWN';
  if (/^NOT (?:EXECUTED|RUN|STARTED|ATTEMPTED)\b/i.test(reason.trim())) return 'UNEXECUTED';
  const blocker = /^\s*(?:blocked\s+(?:by|pending|on)|waiting\s+for|awaiting|requires?)\s+(?:an?\s+)?(approval|environment|implementation)\b/i.exec(reason);
  const blockers = blocker ? [blocker[1].toLowerCase()] : [];
  return blockers.length ? `BLOCKER (${blockers.join(', ')})` : 'UNKNOWN';
}

const display = value => String(value ?? '<no reason supplied>').replace(/[\r\n|]/g, ' ');

function groupReasons(records) {
  const groups = records.reduce((map, { scope, record }) => {
    if (record.outcome === 'PASS') return map;
    const category = reasonCategory(record.outcome, record.reason);
    const reason = typeof record.reason === 'string' && record.reason.length ? record.reason : '<no reason supplied>';
    const key = JSON.stringify([category, reason]);
    const group = map.get(key) ?? { category, reason, scopes: {} };
    group.scopes[scope] = (group.scopes[scope] ?? 0) + 1;
    return map.set(key, group);
  }, new Map());
  return [...groups.values()].sort((a, b) => a.category.localeCompare(b.category) || a.reason.localeCompare(b.reason));
}

async function generateAcceptanceProgress(directory) {
  const runRoot = await fs.realpath(directory);
  const verification = await verifyAcceptanceIndex(runRoot);
  const repoRoot = await fs.realpath(execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: runRoot,
    encoding: 'utf8',
  }).trim());
  const relativeRun = path.relative(repoRoot, runRoot).split(path.sep).join('/');
  const index = parseJson(readBlob(repoRoot, verification.commit,
    path.posix.join(relativeRun, 'evidence-index.json')), 'evidence-index.json');
  const indexedFiles = new Set(index.entries.map(entry => entry.relativePath ?? entry.path));
  for (const file of INPUT_FILES) {
    if (!indexedFiles.has(file)) throw new Error(`Evidence index does not include ${file}.`);
  }
  const [ledger, atomicLedger] = INPUT_FILES.map(file =>
    parseJson(readBlob(repoRoot, verification.commit, path.posix.join(relativeRun, file)), file));
  if (!Array.isArray(ledger.cases) || !Array.isArray(ledger.commonRequirements) ||
      !Array.isArray(atomicLedger.rows)) {
    throw new Error('Acceptance ledgers are missing cases, common requirements, or atomic rows.');
  }
  if (ledger.runId !== atomicLedger.runId) throw new Error('Acceptance ledgers have different run IDs.');

  const atomics = new Map();
  for (const atom of atomicLedger.rows) {
    if (!atom.id || atomics.has(atom.id)) throw new Error(`Missing or duplicate atomic ID: ${atom.id}`);
    atomics.set(atom.id, atom);
  }
  const mappedAtoms = new Set();
  const subchecks = [];
  const cases = ledger.cases.map(item => {
    if (!item.id || !Array.isArray(item.subchecks)) throw new Error('Case is missing its ID or subchecks.');
    const caseAtoms = [];
    for (const subcheck of item.subchecks) {
      if (!subcheck.id || !Array.isArray(subcheck.atomicIds)) throw new Error(`Subcheck in ${item.id} is missing its ID or atomic mapping.`);
      const mapped = subcheck.atomicIds.map(id => {
        const atom = atomics.get(id);
        if (!atom || atom.caseId !== item.id || atom.subcheckId !== subcheck.id || mappedAtoms.has(id)) {
          throw new Error(`Invalid or duplicate atomic mapping: ${id}`);
        }
        mappedAtoms.add(id);
        caseAtoms.push(atom);
        return atom;
      });
      subchecks.push({ caseId: item.id, record: subcheck, atoms: mapped });
    }
    return { record: item, atoms: caseAtoms };
  });
  if (mappedAtoms.size !== atomics.size) throw new Error('Atomic ledger contains unmapped rows.');

  const commonIds = new Set();
  for (const requirement of ledger.commonRequirements) {
    if (!requirement.id || commonIds.has(requirement.id)) {
      throw new Error(`Missing or duplicate common requirement ID: ${requirement.id}`);
    }
    commonIds.add(requirement.id);
  }
  for (const { record } of subchecks) {
    if (record.commonRequirementId && !commonIds.has(record.commonRequirementId)) {
      throw new Error(`Unknown inherited common requirement: ${record.commonRequirementId}`);
    }
  }

  const formatCounts = counts => OUTCOMES.map(outcome => `${outcome} ${counts[outcome] ?? 0}`).join(', ');
  const atomOutcomes = countOutcomes(atomicLedger.rows);
  const subcheckOutcomes = countOutcomes(subchecks.map(item => item.record));
  const caseOutcomes = countOutcomes(ledger.cases);
  const observedClasses = new Map();
  const eligibleModes = new Map(EVIDENCE_MODES.map(mode => [mode, 0]));
  for (const atom of atomicLedger.rows) {
    const evidenceClass = atom.evidenceClass ?? 'NONE RECORDED';
    observedClasses.set(evidenceClass, (observedClasses.get(evidenceClass) ?? 0) + 1);
    for (const mode of atom.eligibleEvidenceModes ?? []) {
      eligibleModes.set(mode, (eligibleModes.get(mode) ?? 0) + 1);
    }
  }
  const reasons = [
    ...cases.map(({ record }) => ({ scope: 'case', record })),
    ...subchecks.map(({ record }) => ({ scope: 'subcheck', record })),
    ...atomicLedger.rows.map(record => ({ scope: 'atomic', record })),
  ];
  const isComplete = ({ record, atoms }) => record.outcome === 'PASS' &&
    subchecks.filter(item => item.caseId === record.id)
      .every(item => item.record.outcome === 'PASS' && item.atoms.every(atom => atom.outcome === 'PASS')) &&
    atoms.every(atom => atom.outcome === 'PASS');
  const incompleteCases = cases.filter(item => !isComplete(item));
  const partialCount = incompleteCases.filter(({ atoms }) => atoms.some(atom => atom.outcome === 'PASS')).length;
  const lines = [
    `# Acceptance progress: ${display(ledger.runId)}`,
    '',
    `Verified ${verification.count} indexed files at commit ${verification.commit}. This report reads committed ledger bytes and does not modify the run.`,
    '',
    `- Cases: ${cases.length} (${formatCounts(caseOutcomes)})`,
    `- Mapped subchecks: ${subchecks.length} (${formatCounts(subcheckOutcomes)})`,
    `- Atomic statements: ${atomicLedger.rows.length} (${formatCounts(atomOutcomes)}); these and parsed prose groups are requirements, not an executable-test count.`,
    `- Incomplete cases: ${incompleteCases.length}; partial cases with passing atomic rows: ${partialCount}.`,
    '',
    '## Evidence classes observed',
    '',
    'Observed evidence class is separate from eligible evidence mode; the four modes are never interchangeable.',
    '',
    ...[...observedClasses.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => `- ${display(name)}: ${count}`),
    '',
    '## Eligible evidence modes (not observed evidence)',
    '',
    ...EVIDENCE_MODES.map(mode => `- ${mode}: ${eligibleModes.get(mode) ?? 0} atomic requirements`),
    '',
    '## Inherited common requirements',
    '',
    ...ledger.commonRequirements.map(item => `- **${display(item.id)}** — ${display(item.requirement)}`),
    '',
    'Each case retains its own mapped common subchecks and atomic obligations below; these eight definitions are listed only once.',
    '',
    '## Remaining reasons',
    '',
    ...groupReasons(reasons).map(group => {
      const occurrences = Object.entries(group.scopes).map(([scope, count]) => `${scope} ${count}`).join(', ');
      return `- **${group.category}** (${occurrences}): ${JSON.stringify(group.reason)}`;
    }),
    '',
    '## Cases and mapped subchecks',
    '',
  ];

  for (const { record, atoms } of cases) {
    const passingAtoms = atoms.filter(atom => atom.outcome === 'PASS').length;
    const complete = isComplete({ record, atoms });
    const completeness = complete ? 'COMPLETE' :
      passingAtoms ? 'PARTIAL; INCOMPLETE' : 'INCOMPLETE';
    lines.push(`### ${display(record.id)} — ${display(record.title)} — ${display(record.outcome)} (${completeness})`);
    lines.push(`Reason: ${JSON.stringify(record.reason ?? '<no reason supplied>')}`);
    for (const { record: subcheck, atoms: mapped } of subchecks.filter(item => item.caseId === record.id)) {
      const modes = subcheck.applicability?.evidenceModes ?? [];
      const evidenceRefs = new Set(mapped.flatMap(atom => atom.evidenceRefs ?? []));
      const missing = mapped.filter(atom => !atom.evidenceClass || !atom.evidenceRefs?.length).length;
      const common = subcheck.commonRequirementId ? `; common ${subcheck.commonRequirementId}` : '';
      lines.push(`- **${display(subcheck.id)}** — ${display(subcheck.outcome)}; ${display(subcheck.kind)}${common}; eligible modes: ${modes.length ? modes.join(', ') : 'none'}; evidence refs: ${evidenceRefs.size}; atomics missing class or evidence reference: ${missing}/${mapped.length}.`);
      lines.push(`  - Atomic IDs and original outcomes: ${mapped.map(atom => `\`${display(atom.id)}\`=${display(atom.outcome)} [${display(atom.evidenceClass ?? 'NONE RECORDED')}; ${JSON.stringify(atom.reason ?? '<no reason supplied>')}]`).join('; ') || 'none'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

if (require.main === module) {
  const directory = process.argv[2];
  if (!directory || process.argv.length !== 3) {
    console.error('Usage: node scripts/acceptance-progress.cjs <run-directory>');
    process.exitCode = 2;
  } else {
    generateAcceptanceProgress(directory)
      .then(report => process.stdout.write(`${report}\n`))
      .catch(error => {
        console.error(`Acceptance progress failed: ${error.message}`);
        process.exitCode = 1;
      });
  }
}

module.exports = { generateAcceptanceProgress };
