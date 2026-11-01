'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function verifyPackageReceipt({ artifactsDir, vsixDir, checkoutSha, workflowSha, pullRequestHeadSha }) {
  assert.ok(artifactsDir, 'PACKAGE_ARTIFACTS must identify the receipt directory');
  assert.ok(vsixDir, 'VSIX directory must be provided');
  assert.match(checkoutSha ?? '', /^[a-f0-9]{40}$/i, 'Git checkout SHA must be a full commit SHA');
  assert.equal(workflowSha, checkoutSha, 'GITHUB_SHA must match the checked-out commit');

  const receiptPath = path.join(artifactsDir, 'vsix-inventory.json');
  assert.ok(fs.existsSync(receiptPath), `Missing package receipt: ${receiptPath}`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.head, checkoutSha, 'Package receipt checkout identity does not match Git HEAD');
  assert.match(receipt.sha256 ?? '', /^[a-f0-9]{64}$/i, 'Package receipt must contain a SHA-256 digest');
  assert.ok(Array.isArray(receipt.inventory), 'Package receipt must contain the VSIX inventory');

  const vsixFiles = fs.readdirSync(vsixDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.vsix$/i.test(entry.name))
    .map(entry => entry.name);
  assert.equal(vsixFiles.length, 1, `Expected exactly one VSIX, found ${vsixFiles.length}`);

  const vsixName = vsixFiles[0];
  const vsixBytes = fs.readFileSync(path.join(vsixDir, vsixName));
  const digest = createHash('sha256').update(vsixBytes).digest('hex');
  assert.equal(digest, receipt.sha256, 'VSIX SHA-256 does not match the package receipt');

  if (pullRequestHeadSha != null) {
    assert.match(pullRequestHeadSha, /^[a-f0-9]{40}$/i, 'PR head must be a full commit SHA');
  }
  fs.writeFileSync(path.join(artifactsDir, vsixName), vsixBytes);
  return {
    checkoutSha,
    checkoutType: pullRequestHeadSha ? 'pull-request-merge' : 'workflow-commit',
    pullRequestHeadSha: pullRequestHeadSha ?? null,
    vsix: { name: vsixName, sha256: digest },
  };
}

if (require.main === module) {
  const artifactsDir = process.env.PACKAGE_ARTIFACTS;
  assert.ok(process.env.GITHUB_EVENT_PATH, 'GITHUB_EVENT_PATH is required');
  const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const workflowSha = process.env.GITHUB_SHA;
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pullRequestHeadSha = event.pull_request?.head?.sha ?? null;
  const result = verifyPackageReceipt({
    artifactsDir,
    vsixDir: process.cwd(),
    checkoutSha,
    workflowSha,
    pullRequestHeadSha,
  });
  fs.writeFileSync(path.join(artifactsDir, 'source-identity.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`PASS VSIX receipt: ${result.vsix.name} (${result.vsix.sha256}); ${result.checkoutType} checkout ${result.checkoutSha}; PR head ${result.pullRequestHeadSha ?? 'not applicable'}`);
}

module.exports = { verifyPackageReceipt };
