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

test('allows valid repository issues, PRs, releases, pinned content and master raw images', () => {
  const validDestinations = [
    'https://github.com/swigerb/squad-pod/issues/new',
    'https://github.com/swigerb/squad-pod/pull/163',
    'https://github.com/swigerb/squad-pod/releases/tag/v0.1.0',
    'https://github.com/swigerb/squad-pod/blob/4393a84c406bd032b71957b88c88db1dafd7e085/README.md',
    'https://github.com/swigerb/squad-pod/raw/master/Screenshot.jpg',
    'https://raw.githubusercontent.com/swigerb/squad-pod/master/Screenshot.jpg',
  ].map((url, index) => `[Link ${index}](${url})`).join('\n');
  assert.doesNotThrow(() => validatePackagedMarkdown(`${packagedReadme}\n${validDestinations}`, 'README.md'));
});

test('rejects main-branch repository content and image URLs only', () => {
  for (const wrongUrl of [
    'https://github.com/swigerb/squad-pod/blob/main/docs/testing.md',
    'https://github.com/swigerb/squad-pod/raw/main/Screenshot.jpg',
    'https://raw.githubusercontent.com/swigerb/squad-pod/main/Screenshot.jpg',
  ]) {
    const markdown = `${packagedReadme}\n![Wrong branch](${wrongUrl})`;
    assert.throws(() => validatePackagedMarkdown(markdown, 'README.md'), /content URL must not target main/);
  }
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
