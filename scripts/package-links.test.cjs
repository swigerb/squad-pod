const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { masterBlobPrefix, validatePackagedMarkdown } = require('./package-links.cjs');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const verifyScript = path.join(__dirname, 'verify-package-links.cjs');
const packagedReadme = [
  `[Testing guide](${masterBlobPrefix}docs/testing.md)`,
  `[Standalone guide](${masterBlobPrefix}standalone/README.md#optional-live-activity)`,
  `[Acceptance plan](${masterBlobPrefix}docs/native-acceptance.md#cli-import-contract)`,
  `[Third-party notices](${masterBlobPrefix}THIRD_PARTY_NOTICES.md)`,
  `[License](${masterBlobPrefix}LICENSE)`,
  '<img src="https://example.com/squad.png" alt="Squad">',
].join('\n');

function packageEntries({ preview = false, preRelease, version = manifest.version, publisher = manifest.publisher, galleryFlags = 'Public' } = {}) {
  return {
    'extension/readme.md': packagedReadme,
    'extension/changelog.md': '# Changelog',
    'extension/package.json': JSON.stringify({ ...manifest, preview }),
    'extension.vsixmanifest': `<PackageManifest><Metadata><Identity Id="${manifest.name}" Version="${version}" Publisher="${publisher}" /><GalleryFlags>${galleryFlags}</GalleryFlags><Properties>${preRelease === undefined ? '' : `<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="${preRelease}" />`}</Properties></Metadata></PackageManifest>`,
  };
}

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

test('personal branding uses square PNG assets and HTTPS theme-aware original logos', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.equal(manifest.author.name, 'Brian Swiger');
  assert.equal(manifest.author.url, 'https://www.mightybs.com/');
  assert.equal(manifest.homepage, manifest.author.url);
  assert.equal(manifest.bugs.url, 'https://github.com/swigerb/squad-pod/issues');
  assert.equal(manifest.icon, 'assets/squad-pod-icon.png');
  assert.equal(manifest.publisher, 'brianswiger');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lockfile.version, manifest.version);
  assert.equal(lockfile.packages[''].version, manifest.version);
  assert.equal(manifest.preview, false);
  assert.match(manifest.scripts.package, /^vsce package\b/);
  assert.doesNotMatch(manifest.scripts.package, /--pre-release\b/);
  assert.match(readme, /code --install-extension brianswiger\.squad-pod\r?\n/);
  assert.doesNotMatch(readme, /code --install-extension[^\r\n]*--pre-release/);

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

  for (const theme of ['white', 'black']) {
    const image = fs.readFileSync(path.join(root, 'assets', `squad-pod-logo-${theme}.jpg`));
    assert.deepEqual(image.subarray(0, 3), Buffer.from([255, 216, 255]));
  }
  assert.match(readme, /<source media="\(prefers-color-scheme: dark\)" srcset="https:\/\/raw\.githubusercontent\.com\/swigerb\/squad-pod\/master\/assets\/squad-pod-logo-black\.jpg"/);
  assert.match(readme, /<img src="https:\/\/raw\.githubusercontent\.com\/swigerb\/squad-pod\/master\/assets\/squad-pod-logo-white\.jpg" alt="Squad Pod:/);
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

test('storefront leads with the pitch, showcase and separate host onboarding within the copy budget', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const wordCount = readme.trim().split(/\s+/).length;
  assert(wordCount >= 500 && wordCount <= 850, `README word count: ${wordCount}`);
  const sections = [
    'Your Squad AI team, brought to life in a pixel-art office.',
    'Squad-Pod-Sizzle-preview.gif',
    '## Get started',
    '## What you can do',
    '## Settings',
    '## Compatibility and privacy',
    '## Learn more',
  ].map(text => readme.indexOf(text));
  assert(sections.every((position, index) => position >= 0 && (index === 0 || position > sections[index - 1])));
  const onboarding = readme.slice(sections[2], sections[3]);
  const appStart = onboarding.indexOf('### GitHub Copilot app');
  const vscodeStart = onboarding.indexOf('### VS Code');
  assert(appStart >= 0 && vscodeStart > appStart);
  assert(onboarding.includes('### Choose your host'));
  assert(onboarding.includes('canvas-v0.1.3'));
  assert(onboarding.includes('releases/tag/v1.0.1'));
  assert(onboarding.includes('releases/download/v1.0.1/squad-pod-1.0.1.vsix'));
  assert(onboarding.includes('swigerb/squad-pod'));
  assert(onboarding.includes('squad-pod-plugins'));
  assert(onboarding.includes('not GitHub Desktop'));
  assert(onboarding.includes('**Enable editing** is a separate opt-in'));
  assert(onboarding.includes('issuecomment-6689294756'));
  for (const section of [onboarding.slice(appStart, vscodeStart), onboarding.slice(vscodeStart)]) {
    assert.deepEqual([...section.matchAll(/^(\d+)\. /gm)].map(match => match[1]), ['1', '2', '3']);
  }
  const features = readme.slice(sections[3], sections[4]);
  const featureCount = [...features.matchAll(/^- \*\*/gm)].length;
  assert(featureCount >= 5 && featureCount <= 6, `Feature count: ${featureCount}`);
  assert(!readme.includes('## Preview release scope'));
});

test('current Canvas installation and feature guidance distinguish preview waiver from native acceptance', () => {
  const install = fs.readFileSync(path.join(root, 'docs', 'canvas-install.md'), 'utf8');
  const matrix = fs.readFileSync(path.join(root, 'docs', 'canvas-feature-matrix.md'), 'utf8');
  const currentInstall = install.split('## Published 0.1.2 preview provenance')[0];
  const currentFeatures = matrix.split('## Canvas 0.1.3 published features')[1];
  assert(install.indexOf('## Quick installation') < install.indexOf('## Agent-runnable qualification'));
  for (const text of [currentInstall, matrix]) {
    assert(text.includes('issuecomment-6689294756'));
    assert(text.includes('issuecomment-6689750551'));
  }
  assert(currentInstall.includes('COPILOT_HOME'));
  assert(currentInstall.includes('ghapp://plugins/marketplace/add?source=swigerb%2Fsquad-pod'));
  assert(currentInstall.includes('ghapp://plugins/install?source=squad-pod%40squad-pod-plugins'));
  assert(currentInstall.includes('1bc0d4165bea309715bd8c7ec5fc5cbf7c2cee8e'));
  assert(currentInstall.includes('1bea647a596fd6c55db7c8240693db978b3cfdf6aed385a3319214f3c98aef25'));
  assert.doesNotMatch(currentInstall, /remains pending #218|v1\.0\.0` remains Latest/);
  assert(matrix.includes('## What ships in the current preview'));
  assert(matrix.includes('## Unverified native coverage and preview limits'));
  assert(matrix.includes('id="canvas-013-published-candidates-native-acceptance-pending-218"'));
  assert(matrix.includes('id="remaining--open-release-gates"'));
  assert(currentFeatures.includes('native coverage unverified; owner waiver applies'));
  assert.doesNotMatch(currentFeatures, /native retest pending|native retesting in #218/);
});

test('storefront settings reflect the manifest and preserve consent and explicit launch boundaries', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const properties = manifest.contributes.configuration.properties;
  const settings = [...readme.matchAll(/^\|\s*`(squad-pod\.[^`]+)`\s*\|\s*`(true|false)`\s*\|/gm)];
  assert.deepEqual(settings.map(match => match[1]).sort(), Object.keys(properties).sort());
  for (const [, setting, defaultValue] of settings) {
    assert.equal(defaultValue, String(properties[setting].default), setting);
  }
  assert(!readme.includes('squad-pod.soundNotifications'));
  assert(readme.includes('Sound notifications are in the office **Settings** panel'));
  assert(readme.includes('Live activity is opt-in'));
  assert(readme.includes('Opening the panel never starts a task'));
  assert(readme.includes('only when you select **Launch**'));
  assert(readme.includes('## Compatibility and privacy'));
});

test('storefront links to preserved user and contributor guidance, credits and compatibility limits', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const guide = fs.readFileSync(path.join(root, 'docs', 'user-guide.md'), 'utf8');
  const contributing = fs.readFileSync(path.join(root, 'docs', 'contributing.md'), 'utf8');
  for (const target of [
    'docs/user-guide.md',
    'docs/user-guide.md#compatibility-and-privacy',
    'docs/user-guide.md#showcase-credits',
    'docs/contributing.md',
    'docs/native-acceptance.md#cli-import-contract',
    'standalone/README.md#optional-live-activity',
    'assets/showcase/Squad-Pod-Sizzle.srt',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    assert(readme.includes(`](${target})`), `Missing README link: ${target}`);
  }
  assert(guide.includes('not permanent reporting lines or automatic roster promotions'));
  assert(guide.includes('not a remote-access service or a supported phone/tablet product'));
  assert(guide.includes('Switch to Release Version'));
  assert(guide.includes('Squad-Pod-Soundtrack.mp3'));
  assert(guide.includes('## Showcase credits'));
  assert(contributing.includes('npm run install:all'));
  assert(contributing.includes('npm run package'));
  assert(readme.includes('docs/testing.md#stable-10-release-scope'));
  assert(readme.includes('Squad-Pod-Sizzle-preview.gif'));
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
  fs.writeFileSync(archivePath, storedZip(packageEntries()));
  const result = spawnSync(process.execPath, [verifyScript, archivePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS packaged README and CHANGELOG links/);
  assert.match(result.stdout, /PASS stable VSIX identity/);
});

test('archive verifier rejects mismatched identity and either pre-release marker', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-stable-package-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  for (const [options, expected] of [
    [{ preview: true }, /preview listing label/],
    [{ galleryFlags: 'Public, Preview' }, /preview gallery flag/],
    [{ preRelease: 'true' }, /pre-release update channel/],
    [{ version: '0.0.0' }, /VSIX Version/],
    [{ publisher: 'wrong-publisher' }, /VSIX Publisher/],
  ]) {
    const archivePath = path.join(tempDir, 'invalid.vsix');
    fs.writeFileSync(archivePath, storedZip(packageEntries(options)));
    const result = spawnSync(process.execPath, [verifyScript, archivePath], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, JSON.stringify(options));
    assert.match(result.stderr, expected);
  }
});

test('archive verifier accepts an explicit false pre-release property', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-stable-channel-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const archivePath = path.join(tempDir, 'stable.vsix');
  fs.writeFileSync(archivePath, storedZip(packageEntries({ preRelease: 'false' })));
  const result = spawnSync(process.execPath, [verifyScript, archivePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
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
