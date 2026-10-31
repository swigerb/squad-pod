'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach, test } = require('node:test');
const { verifyAcceptanceIndex } = require('./verify-acceptance-index.cjs');

const roots = [];

async function makePackage(index, evidence = 'verified evidence\n') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squad-evidence-index-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const run = path.join(root, 'docs', 'acceptance', 'run');
  await fs.mkdir(run, { recursive: true });
  const bytes = Buffer.from(evidence);
  await fs.writeFile(path.join(run, 'report.md'), bytes);
  const entry = {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await fs.writeFile(path.join(run, 'evidence-index.json'), JSON.stringify({
    ...index,
    entries: [index.entry(entry)],
  }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Acceptance Test', '-c', 'user.email=acceptance@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'evidence'], { cwd: root });
  return run;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

test('verifies a legacy path index', async () => {
  const root = await makePackage({
    selfHashExcluded: true,
    entry: metadata => ({ ...metadata, path: 'report.md' }),
  });
  assert.equal((await verifyAcceptanceIndex(root)).count, 1);
});

test('verifies a relativePath index and checks product identity', async () => {
  const root = await makePackage({
    excludesIndexItself: true,
    productSha: 'candidate-sha',
    entry: metadata => ({ ...metadata, relativePath: 'report.md', productSha: 'candidate-sha' }),
  });
  assert.equal((await verifyAcceptanceIndex(root)).count, 1);
});

test('rejects an incorrect indexed byte count', async () => {
  const root = await makePackage({
    selfHashExcluded: true,
    entry: metadata => ({ ...metadata, bytes: metadata.bytes + 1, path: 'report.md' }),
  });
  await assert.rejects(verifyAcceptanceIndex(root), /Byte count mismatch/);
});

test('verifies binary evidence without text conversion', async () => {
  const root = await makePackage({
    selfHashExcluded: true,
    entry: metadata => ({ ...metadata, path: 'report.md' }),
  }, Buffer.from([0, 255, 13, 10, 128]));
  assert.equal((await verifyAcceptanceIndex(root)).count, 1);
});

test('rejects a different product identity', async () => {
  const root = await makePackage({
    selfHashExcluded: true,
    productSha: 'candidate-sha',
    entry: metadata => ({ ...metadata, path: 'report.md', productSha: 'other-candidate' }),
  });
  await assert.rejects(verifyAcceptanceIndex(root), /different product SHA/);
});

test('rejects an incorrect indexed digest', async () => {
  const root = await makePackage({
    selfHashExcluded: true,
    entry: metadata => ({ ...metadata, sha256: '0'.repeat(64), path: 'report.md' }),
  }, 'original\n');
  await assert.rejects(verifyAcceptanceIndex(root), /SHA-256 mismatch/);
});

test('verifies canonical Git bytes despite working-tree line-ending changes', async () => {
  const root = await makePackage({
    selfHashExcluded: true,
    entry: metadata => ({ ...metadata, path: 'report.md' }),
  }, 'canonical\n');
  await fs.writeFile(path.join(root, 'report.md'), 'canonical\r\n');
  assert.equal((await verifyAcceptanceIndex(root)).count, 1);
});

test('rejects unsafe and recursive index paths', async () => {
  for (const entryPath of ['../outside.txt', 'evidence-index.json']) {
    const root = await makePackage({
      selfHashExcluded: true,
      entry: metadata => ({ ...metadata, path: entryPath }),
    });
    await assert.rejects(verifyAcceptanceIndex(root), /unsafe or recursive path/);
  }
});
