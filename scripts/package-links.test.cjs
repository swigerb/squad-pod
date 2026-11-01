const assert = require('node:assert/strict');
const test = require('node:test');
const { masterBlobPrefix, validatePackagedMarkdown } = require('./package-links.cjs');

const packagedReadme = [
  `[Testing guide](${masterBlobPrefix}docs/testing.md)`,
  `[Standalone guide](${masterBlobPrefix}standalone/README.md#optional-live-activity)`,
  `[Third-party notices](${masterBlobPrefix}THIRD_PARTY_NOTICES.md)`,
  `[License](${masterBlobPrefix}LICENSE)`,
  '<img src="https://example.com/squad.png" alt="Squad">',
].join('\n');

test('accepts packaged master links, preserved anchors, and HTTPS images', () => {
  assert.doesNotThrow(() => validatePackagedMarkdown(packagedReadme, 'README.md'));
  assert.match(packagedReadme, /standalone\/README\.md#optional-live-activity/);
});

test('accepts packaged Markdown without links or images', () => {
  assert.doesNotThrow(() => validatePackagedMarkdown('# Changelog', 'CHANGELOG.md'));
});

test('rejects repository links rewritten against main', () => {
  const wrongBranch = packagedReadme.replace('/blob/master/', '/blob/main/');
  assert.throws(() => validatePackagedMarkdown(wrongBranch, 'README.md'), /must target master/);
});

test('rejects unresolved relative links', () => {
  const relativeLink = packagedReadme.replace(
    `[Testing guide](${masterBlobPrefix}docs/testing.md)`,
    '[Testing guide](docs/testing.md)',
  );
  assert.throws(() => validatePackagedMarkdown(relativeLink, 'README.md'), /must not retain relative links/);
});

test('rejects non-HTTPS images', () => {
  const insecureImage = packagedReadme.replace('https://example.com/squad.png', 'http://example.com/squad.png');
  assert.throws(() => validatePackagedMarkdown(insecureImage, 'README.md'), /images must use HTTPS/);
});
