'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { verifyPackageReceipt } = require('./verify-package-receipt.cjs');

const roots = [];
const checkoutSha = 'a'.repeat(40);
const workflowSha = checkoutSha;
const pullRequestHeadSha = 'b'.repeat(40);
const vsixBytes = Buffer.from('audited VSIX bytes');

function fixture({ files = ['squad-pod-0.1.0.vsix'], receiptSha = createHash('sha256').update(vsixBytes).digest('hex'), receiptHead = checkoutSha } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-vsix-receipt-'));
  roots.push(root);
  const artifactsDir = path.join(root, 'artifacts');
  const vsixDir = path.join(root, 'package');
  fs.mkdirSync(artifactsDir);
  fs.mkdirSync(vsixDir);
  for (const filename of files) fs.writeFileSync(path.join(vsixDir, filename), vsixBytes);
  fs.writeFileSync(path.join(artifactsDir, 'vsix-inventory.json'), JSON.stringify({
    head: receiptHead,
    sha256: receiptSha,
    inventory: [],
  }));
  return { artifactsDir, vsixDir };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('verifies the package receipt and records checkout and PR head separately', () => {
  const paths = fixture();
  const result = verifyPackageReceipt({
    ...paths,
    checkoutSha,
    workflowSha,
    pullRequestHeadSha,
  });
  assert.deepEqual(result, {
    checkoutSha,
    checkoutType: 'pull-request-merge',
    pullRequestHeadSha,
    vsix: {
      name: 'squad-pod-0.1.0.vsix',
      sha256: createHash('sha256').update(vsixBytes).digest('hex'),
    },
  });
  assert.deepEqual(fs.readFileSync(path.join(paths.artifactsDir, result.vsix.name)), vsixBytes);
});

test('accepts a push receipt with no PR head', () => {
  const result = verifyPackageReceipt({
    ...fixture(),
    checkoutSha,
    workflowSha,
    pullRequestHeadSha: null,
  });
  assert.equal(result.checkoutType, 'workflow-commit');
  assert.equal(result.pullRequestHeadSha, null);
});

test('rejects a missing receipt', () => {
  const paths = fixture();
  fs.rmSync(path.join(paths.artifactsDir, 'vsix-inventory.json'));
  assert.throws(() => verifyPackageReceipt({ ...paths, checkoutSha, workflowSha }), /Missing package receipt/);
});

test('rejects zero or multiple VSIX files', () => {
  for (const files of [[], ['one.vsix', 'two.vsix']]) {
    assert.throws(
      () => verifyPackageReceipt({ ...fixture({ files }), checkoutSha, workflowSha }),
      /Expected exactly one VSIX/,
    );
  }
});

test('rejects a digest mismatch', () => {
  const paths = fixture({ receiptSha: '0'.repeat(64) });
  assert.throws(() => verifyPackageReceipt({ ...paths, checkoutSha, workflowSha }), /SHA-256 does not match/);
});

test('rejects a receipt for a different checkout identity', () => {
  const paths = fixture({ receiptHead: 'c'.repeat(40) });
  assert.throws(() => verifyPackageReceipt({ ...paths, checkoutSha, workflowSha }), /checkout identity/);
});

test('rejects a workflow SHA that does not match the checked-out commit', () => {
  const paths = fixture();
  assert.throws(
    () => verifyPackageReceipt({ ...paths, checkoutSha, workflowSha: 'c'.repeat(40) }),
    /GITHUB_SHA must match/,
  );
});
