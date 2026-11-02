const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readZipEntry } = require('./audit-pet-package.cjs');
const { extractImageUrls, masterBlobPrefix, validatePackagedMarkdown } = require('./package-links.cjs');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { name, version } = manifest;
const vsixPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, `${name}-${version}.vsix`);
const archive = fs.readFileSync(vsixPath);
const readme = readZipEntry(archive, 'extension/readme.md').toString('utf8');
const changelog = readZipEntry(archive, 'extension/changelog.md').toString('utf8');

validatePackagedMarkdown(readme, 'README.md');
validatePackagedMarkdown(changelog, 'CHANGELOG.md');
assert(extractImageUrls(readme).length > 0, 'Packaged README must contain an image URL');

const packagedManifest = JSON.parse(readZipEntry(archive, 'extension/package.json').toString('utf8'));
for (const field of ['name', 'publisher', 'version']) {
  assert.equal(packagedManifest[field], manifest[field], `Packaged ${field} must match the release source`);
}
assert.equal(packagedManifest.preview, false, 'Stable package must not use the preview listing label');
const vsixManifest = readZipEntry(archive, 'extension.vsixmanifest').toString('utf8');
const identity = vsixManifest.match(/<Identity\b[^>]*>/)?.[0];
assert(identity, 'VSIX manifest must declare its identity');
const attribute = (element, key) => element.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1];
for (const [field, expected] of [['Id', name], ['Publisher', manifest.publisher], ['Version', version]]) {
  assert.equal(attribute(identity, field), expected, `VSIX ${field} must match the release source`);
}
const galleryFlags = vsixManifest.match(/<GalleryFlags>([^<]*)<\/GalleryFlags>/)?.[1];
assert(galleryFlags, 'VSIX manifest must declare gallery flags');
assert.doesNotMatch(galleryFlags, /\bPreview\b/i, 'Stable VSIX must not use the preview gallery flag');
for (const [property] of vsixManifest.matchAll(/<Property\b[^>]*>/g)) {
  if (attribute(property, 'Id') === 'Microsoft.VisualStudio.Code.PreRelease') {
    assert.equal(attribute(property, 'Value'), 'false', 'Stable VSIX must not use the pre-release update channel');
  }
}

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
console.log(`PASS stable VSIX identity: ${manifest.publisher}.${name}@${version}; no preview label or pre-release channel`);
