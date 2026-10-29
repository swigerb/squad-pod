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
const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsixPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, `${name}-${version}.vsix`);
const archive = fs.readFileSync(vsixPath);

function readZipEntry(entryName) {
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
  assert.fail(`VSIX is missing ${entryName}`);
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
    assert.deepEqual(readZipEntry(archivePath), committedBytes, `${archivePath} must match the committed Git blob`);
    console.log(`PASS ${archivePath}: exact committed bytes (${committedBlob})`);
  }
}
