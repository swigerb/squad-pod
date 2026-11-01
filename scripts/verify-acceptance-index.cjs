#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

function gitBlob(repoRoot, commit, relativePath) {
  return execFileSync('git', ['cat-file', 'blob', `${commit}:${relativePath}`], {
    cwd: repoRoot,
    maxBuffer: 128 * 1024 * 1024,
  });
}

async function verifyAcceptanceIndex(directory) {
  const root = await fs.realpath(directory);
  const repoRoot = await fs.realpath(execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
  }).trim());
  const relativeDirectory = path.relative(repoRoot, root);
  if (!relativeDirectory || relativeDirectory === '..' || relativeDirectory.startsWith(`..${path.sep}`)) {
    throw new Error('Run directory must be inside the Git repository.');
  }
  const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const indexRelativePath = path.posix.join(relativeDirectory.split(path.sep).join('/'), 'evidence-index.json');
  const index = JSON.parse(gitBlob(repoRoot, commit, indexRelativePath).toString('utf8'));

  if (index.selfHashExcluded !== true && index.excludesIndexItself !== true && index.excludesSelf !== true) {
    throw new Error('Evidence index must declare that it excludes its own hash.');
  }
  if (!Array.isArray(index.entries) || index.entries.length === 0) {
    throw new Error('Evidence index must contain at least one entry.');
  }

  for (const [position, entry] of index.entries.entries()) {
    const relativePath = entry.relativePath ?? entry.path;
    if (typeof relativePath !== 'string' || relativePath.length === 0 ||
        relativePath.includes('\\') || path.posix.isAbsolute(relativePath)) {
      throw new Error(`Entry ${position + 1} has an invalid relative path.`);
    }

    const parts = relativePath.split('/');
    if (parts.some(part => part === '' || part === '.' || part === '..') ||
        relativePath === 'evidence-index.json') {
      throw new Error(`Entry ${position + 1} has an unsafe or recursive path.`);
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
        !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`Entry ${position + 1} has invalid size or SHA-256 metadata.`);
    }
    if (index.productSha && entry.productSha && index.productSha !== entry.productSha) {
      throw new Error(`Entry ${position + 1} has a different product SHA.`);
    }

    const entryRelativePath = path.posix.join(indexRelativePath.slice(0, -'evidence-index.json'.length), ...parts);
    const content = gitBlob(repoRoot, commit, entryRelativePath);
    if (content.byteLength !== entry.bytes) {
      throw new Error(`Byte count mismatch: ${relativePath}`);
    }
    const actualHash = createHash('sha256').update(content).digest('hex');
    if (actualHash !== entry.sha256) {
      throw new Error(`SHA-256 mismatch: ${relativePath}`);
    }
  }

  return { count: index.entries.length, commit };
}

if (require.main === module) {
  const directory = process.argv[2];
  if (!directory || process.argv.length !== 3) {
    console.error('Usage: node scripts/verify-acceptance-index.cjs <run-directory>');
    process.exitCode = 2;
  } else {
    verifyAcceptanceIndex(directory)
      .then(({ count, commit }) => console.log(`Verified ${count} indexed files in ${directory} at ${commit}`))
      .catch(error => {
        console.error(`Evidence index verification failed: ${error.message}`);
        process.exitCode = 1;
      });
  }
}

module.exports = { verifyAcceptanceIndex };
