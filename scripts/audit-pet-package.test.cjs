const assert = require('node:assert/strict');
const test = require('node:test');
const { readZipEntry, validateInventory } = require('./audit-pet-package.cjs');

const requiredEntries = [
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

function inventory(names) {
  return names.map(name => ({ name, compressedSize: 0, uncompressedSize: 0 }));
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
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    localRecords.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
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

test('accepts a valid runtime inventory', () => {
  assert.doesNotThrow(() => validateInventory(inventory(requiredEntries)));
});

test('rejects nested source maps', () => {
  assert.throws(
    () => validateInventory(inventory([...requiredEntries, 'extension/dist/webview/assets/index.js.map'])),
    /source maps/,
  );
});

test('rejects source, tooling, evidence, standalone, and native-terminal payloads', () => {
  for (const forbidden of [
    'extension/src/extension.ts',
    'extension/scripts/audit.cjs',
    'extension/acceptance-evidence/result.json',
    'extension/standalone/server.js',
    'extension/node_modules/node-pty/build/pty.node',
    'extension/dist/webview-ui/src/main.tsx',
    'extension/dist/esbuild.js',
    'extension/dist/assets/pixel-agents-source.json',
  ]) {
    assert.throws(() => validateInventory(inventory([...requiredEntries, forbidden])), /must not contain/);
  }
});

test('rejects a missing required runtime entry', () => {
  assert.throws(
    () => validateInventory(inventory(requiredEntries.filter(name => name !== 'extension/dist/webview/assets/index.js'))),
    /missing required runtime entry extension\/dist\/webview\/assets\/index\.js/,
  );
});

test('exposes archive entry listing and file reads for downstream package checks', () => {
  const archive = storedZip({
    'extension/README.md': '# Package docs',
    'extension/CHANGELOG.md': '# Changes',
  });
  assert.deepEqual(readZipEntry(archive).map(entry => entry.name), [
    'extension/README.md',
    'extension/CHANGELOG.md',
  ]);
  assert.equal(readZipEntry(archive, 'extension/README.md').toString(), '# Package docs');
});
