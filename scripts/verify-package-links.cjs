const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readZipEntry } = require('./audit-pet-package.cjs');
const { extractImageUrls, masterBlobPrefix, validatePackagedMarkdown } = require('./package-links.cjs');

const root = path.resolve(__dirname, '..');
const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsixPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, `${name}-${version}.vsix`);
const archive = fs.readFileSync(vsixPath);
const readme = readZipEntry(archive, 'extension/readme.md').toString('utf8');
const changelog = readZipEntry(archive, 'extension/changelog.md').toString('utf8');

validatePackagedMarkdown(readme, 'README.md');
validatePackagedMarkdown(changelog, 'CHANGELOG.md');
assert(extractImageUrls(readme).length > 0, 'Packaged README must contain an image URL');

for (const target of [
  'docs/testing.md',
  'standalone/README.md',
  'standalone/README.md#optional-live-activity',
  'docs/native-acceptance.md#cli-import-contract',
  'THIRD_PARTY_NOTICES.md',
  'LICENSE',
]) {
  assert(readme.includes(`${masterBlobPrefix}${target}`), `Packaged README must link to ${target} on master`);
}

console.log('PASS packaged README and CHANGELOG links target master; required links, anchors, and HTTPS images are intact');
