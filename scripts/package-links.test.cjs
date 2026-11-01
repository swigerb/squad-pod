const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { masterBlobPrefix, validatePackagedMarkdown } = require('./package-links.cjs');

const root = path.resolve(__dirname, '..');
const verifyScript = path.join(__dirname, 'verify-package-links.cjs');
const packagedReadme = [
  `[Testing guide](${masterBlobPrefix}docs/testing.md)`,
  `[Standalone guide](${masterBlobPrefix}standalone/README.md#optional-live-activity)`,
  `[Acceptance plan](${masterBlobPrefix}docs/native-acceptance.md#cli-import-contract)`,
  `[Third-party notices](${masterBlobPrefix}THIRD_PARTY_NOTICES.md)`,
  `[License](${masterBlobPrefix}LICENSE)`,
  '<img src="https://example.com/squad.png" alt="Squad">',
].join('\n');

function storedZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    localRecords.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt32LE(localOffset, 42);
    nameBytes.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

test('accepts packaged master links, preserved anchors, and HTTPS images', () => {
  assert.doesNotThrow(() => validatePackagedMarkdown(packagedReadme, 'README.md'));
  assert.match(packagedReadme, /standalone\/README\.md#optional-live-activity/);
});

test('accepts packaged Markdown without links or images', () => {
  assert.doesNotThrow(() => validatePackagedMarkdown('# Changelog', 'CHANGELOG.md'));
});

test('personal branding uses packaged square PNG assets and a theme-aware README logo', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.equal(manifest.author.name, 'Brian Swiger');
  assert.equal(manifest.author.url, 'https://www.mightybs.com/');
  assert.equal(manifest.homepage, manifest.author.url);
  assert.equal(manifest.bugs.url, 'https://github.com/swigerb/squad-pod/issues');
  assert.equal(manifest.icon, 'assets/squad-pod-icon.png');

  for (const [filename, size] of [
    [manifest.icon, 256],
    ['assets/squad-pod-logo-white.png', 640],
    ['assets/squad-pod-logo-black.png', 640],
  ]) {
    const image = fs.readFileSync(path.join(root, filename));
    assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(image.readUInt32BE(16), size, `${filename} width`);
    assert.equal(image.readUInt32BE(20), size, `${filename} height`);
  }

  assert.match(readme, /<source media="\(prefers-color-scheme: dark\)" srcset="https:\/\/raw\.githubusercontent\.com\/swigerb\/squad-pod\/master\/assets\/squad-pod-logo-black\.png"/);
  assert.match(readme, /<img src="assets\/squad-pod-logo-white\.png" alt="Squad Pod:/);
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

test('archive verifier reads the exact lowercase Markdown entries emitted by vsce', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-package-links-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const archivePath = path.join(tempDir, 'lowercase.vsix');
  fs.writeFileSync(archivePath, storedZip({
    'extension/readme.md': packagedReadme,
    'extension/changelog.md': '# Changelog',
  }));
  const result = spawnSync(process.execPath, [verifyScript, archivePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS packaged README and CHANGELOG links/);
});

test('archive verifier rejects uppercase Markdown entry names', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-package-links-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const archivePath = path.join(tempDir, 'uppercase.vsix');
  fs.writeFileSync(archivePath, storedZip({
    'extension/README.md': packagedReadme,
    'extension/CHANGELOG.md': '# Changelog',
  }));
  const result = spawnSync(process.execPath, [verifyScript, archivePath], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VSIX is missing extension\/readme\.md/);
});
