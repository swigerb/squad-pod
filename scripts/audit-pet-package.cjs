const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');

const root = path.resolve(__dirname, '..');
const manifestPaths = [
  'webview-ui/public/assets/pets/claudio/manifest.json',
  'webview-ui/public/assets/pets/gitcat/manifest.json',
];
const requiredRuntimeEntries = [
  'extension/package.json',
  'extension/LICENSE.txt',
  'extension/THIRD_PARTY_NOTICES.md',
  'extension/dist/extension.js',
  'extension/dist/webview/index.html',
  'extension/dist/webview/assets/index.js',
  'extension/dist/webview/assets/index.css',
  ...[
    'characters/char_0.png',
    'floors/floor_0.png',
    'walls/wall_0.png',
    'furniture/DESK/DESK_FRONT.png',
    'pets/claudio/manifest.json',
    'pets/claudio/pet.png',
    'pets/gitcat/manifest.json',
    'pets/gitcat/pet.png',
  ].flatMap(asset => [
    `extension/dist/assets/${asset}`,
    `extension/dist/webview/assets/${asset}`,
  ]),
];

function readZipEntry(archive, entryName) {
  const searchStart = Math.max(0, archive.length - 65_557);
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= searchStart; offset--) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  assert.notEqual(endOffset, -1, 'VSIX ZIP end record must exist');

  const entryCount = archive.readUInt16LE(endOffset + 10);
  const entries = [];
  let offset = archive.readUInt32LE(endOffset + 16);
  for (let index = 0; index < entryCount; index++) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50, 'ZIP central directory entry must be valid');
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ name, compressedSize, uncompressedSize });

    if (name === entryName) {
      assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, 'ZIP local file header must be valid');
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
      const content = method === 0 ? Buffer.from(compressed)
        : method === 8 ? inflateRawSync(compressed)
          : assert.fail(`Unsupported ZIP compression method ${method}`);
      assert.equal(content.length, uncompressedSize, `${entryName} size must match its ZIP metadata`);
      return content;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (entryName === undefined) return entries;
  assert.fail(`VSIX is missing ${entryName}`);
}

function validateInventory(inventory) {
  const entryNames = new Set(inventory.map(entry => entry.name));
  for (const requiredEntry of requiredRuntimeEntries) {
    assert(entryNames.has(requiredEntry), `VSIX is missing required runtime entry ${requiredEntry}`);
  }

  for (const entry of inventory) {
    assert.doesNotMatch(entry.name, /\.map$/i, `VSIX must not contain source maps: ${entry.name}`);
    assert.doesNotMatch(entry.name,
      /(?:^|\/)(?:standalone|node_modules|terminal-licenses|acceptance(?:-evidence)?|artifacts|coverage|evidence|fixtures|playwright-report|scripts|src|test-results|webview-ui|tests?|__tests__|docs|\.github|\.squad|\.copilot)(?:\/|$)|(?:^|\/)(?:esbuild\.js|pixel-agents-source\.json|package-lock\.json|npm-shrinkwrap\.json|tsconfig(?:\.[^/]*)?\.json|eslint\.config\.[^/]+|vite\.config\.[^/]+|vitest\.config\.[^/]+)(?:$|\/)|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$|node-pty|conpty|OpenConsole|TERMINAL_NOTICES|\.(?:[cm]?ts|tsx|node)$/i,
      `VSIX must not contain source, tooling, acceptance-evidence, standalone, or native-terminal payloads: ${entry.name}`);
  }
}

function auditPackage() {
  const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const vsixPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, `${name}-${version}.vsix`);
  const archive = fs.readFileSync(vsixPath);
  const inventory = readZipEntry(archive);
  validateInventory(inventory);

  for (const filename of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const packagedName = filename === 'LICENSE' ? 'LICENSE.txt' : filename;
    assert.deepEqual(readZipEntry(archive, `extension/${packagedName}`), fs.readFileSync(path.join(root, filename)),
      `VSIX ${filename} must match canonical bytes`);
  }
  console.log('PASS VSIX boundaries: required runtime entries and canonical notices intact; no source maps or forbidden payloads');
  if (process.env.PACKAGE_ARTIFACTS) {
    fs.mkdirSync(process.env.PACKAGE_ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(process.env.PACKAGE_ARTIFACTS, 'vsix-inventory.json'), JSON.stringify({
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sha256: crypto.createHash('sha256').update(archive).digest('hex'),
      inventory,
    }, null, 2));
  }

  for (const sourcePath of manifestPaths) {
    const sourceBytes = fs.readFileSync(path.join(root, ...sourcePath.split('/')));
    const committedBytes = execFileSync('git', ['show', `HEAD:${sourcePath}`], { cwd: root });
    const committedBlob = execFileSync('git', ['rev-parse', `HEAD:${sourcePath}`], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const actualBlob = crypto.createHash('sha1')
      .update(Buffer.from(`blob ${sourceBytes.length}\0`))
      .update(sourceBytes)
      .digest('hex');
    assert.deepEqual(sourceBytes, committedBytes, `${sourcePath} must match its committed bytes`);
    assert.equal(actualBlob, committedBlob, `${sourcePath} must retain its committed Git blob`);

    for (const assetRoot of ['extension/dist/assets', 'extension/dist/webview/assets']) {
      const archivePath = `${assetRoot}/${sourcePath.split('/').slice(-3).join('/')}`;
      assert.deepEqual(readZipEntry(archive, archivePath), committedBytes, `${archivePath} must match the committed Git blob`);
      console.log(`PASS ${archivePath}: exact committed bytes (${committedBlob})`);
    }
  }
}

module.exports = { readZipEntry, validateInventory };
if (require.main === module) auditPackage();
