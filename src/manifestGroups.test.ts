import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { loadAssetSnapshot, validateManifest } from './manifestAssets.js';

const leaf = (id: string, extra = {}) => ({
  type: 'asset', id, width: 16, height: 16, footprintW: 1, footprintH: 1, ...extra,
});
const root = (members: unknown[]) => ({
  id: 'TEST', name: 'Test', category: 'chairs', canPlaceOnWalls: false,
  canPlaceOnSurfaces: false, backgroundTiles: 0, type: 'group', groupType: 'rotation',
  rotationScheme: '3-way-mirror', members,
});
const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('manifest group metadata', () => {
  it('inherits rotation, orientation and state through nested groups and retains leaf fields', () => {
    const result = validateManifest(root([{
      type: 'group', groupType: 'state', orientation: 'side', state: 'off',
      members: [{
        type: 'group', groupType: 'animation',
        members: [leaf('SIDE', { mirrorSide: true, frame: 2 }), leaf('ON', { state: 'on', frame: 3 })],
      }],
    }]));
    expect(result.diagnostics).toEqual([]);
    expect(result.leaves[0]).toMatchObject({
      groupId: 'TEST', groupType: 'animation', rotationScheme: '3-way-mirror',
      orientation: 'side', state: 'off', frame: 2, mirrorSide: true,
    });
    expect(result.leaves[1]).toMatchObject({ state: 'on', frame: 3, orientation: 'side' });
  });

  it('diagnoses and rolls back malformed subgroups without discarding valid siblings', () => {
    const result = validateManifest(root([
      leaf('FRONT', { orientation: 'front' }),
      { type: 'group', groupType: 'rotation', rotationScheme: 'bogus', members: [leaf('BAD')] },
      { type: 'group', groupType: 'state', members: [leaf('PARTIAL'), leaf('INVALID', { orientation: 'up' })] },
      leaf('PARTIAL', { orientation: 'back' }),
    ]));
    expect(result.leaves.map((item) => item.id)).toEqual(['FRONT', 'PARTIAL']);
    expect(result.diagnostics).toEqual([
      expect.stringContaining('rotationScheme'), expect.stringContaining('orientation'),
    ]);
  });

  it('does not relax the 128-node, eight-depth or 64-member bounds during recovery', () => {
    const subgroup = { type: 'group', groupType: 'rotation', members: Array.from({ length: 64 }, (_, i) => leaf(`L${i}`)) };
    expect(() => validateManifest(root([subgroup, {
      ...subgroup, members: Array.from({ length: 64 }, (_, i) => leaf(`R${i}`)),
    }]))).toThrow('node/depth');
    let nested: unknown = leaf('DEEP');
    for (let i = 0; i < 8; i++) {
      nested = { type: 'group', groupType: 'state', members: [nested] };
    }
    expect(() => validateManifest(root([nested, leaf('OK')]))).toThrow('node/depth');
    const result = validateManifest(root([{ ...subgroup, members: Array(65).fill(leaf('BAD')) }, leaf('OK')]));
    expect(result.leaves.map((item) => item.id)).toEqual(['OK']);
    expect(result.diagnostics[0]).toContain('members');
  });

  it('publishes metadata, namespaced identities and partial-group diagnostics through the asset snapshot', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-groups-'));
    temporary.push(directory);
    const folder = path.join(directory, 'fixture');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(root([
      leaf('FRONT', { orientation: 'front', state: 'off', frame: 0 }),
      leaf('SIDE', { orientation: 'side', mirrorSide: true }),
      { type: 'group', groupType: 'invalid', members: [] },
    ])));
    const png = new PNG({ width: 16, height: 16 });
    png.data.fill(255);
    for (const id of ['FRONT', 'SIDE']) {
      fs.writeFileSync(path.join(folder, `${id}.png`), PNG.sync.write(png));
    }
    const snapshot = loadAssetSnapshot(path.resolve('webview-ui', 'public', 'assets'), [directory]);
    expect(snapshot.diagnostics).toEqual([expect.stringContaining('Invalid group')]);
    expect(snapshot.furniture.find((item) => item.type === 'local_TEST_FRONT')).toMatchObject({
      groupId: 'local_TEST_TEST', groupType: 'rotation', rotationScheme: '3-way-mirror',
      orientation: 'front', state: 'off', frame: 0,
    });
    expect(snapshot.furniture.find((item) => item.type === 'local_TEST_SIDE')).toMatchObject({ mirrorSide: true });
    expect(snapshot.furniture.find((item) => item.type === 'pa_CUSHIONED_CHAIR_SIDE')).toMatchObject({
      groupId: 'pa_CUSHIONED_CHAIR', orientation: 'side', mirrorSide: true,
    });
  });
});
