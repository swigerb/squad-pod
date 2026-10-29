import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { createHash } from 'crypto';
import { assetSourceFingerprint, loadAssetSnapshot, validateManifest, watchAssetSnapshots } from './manifestAssets.js';
import { parseLayoutJson, writePersistedLayout, readPersistedLayout } from './layoutPersistence.js';

const bundled = path.resolve('webview-ui', 'public', 'assets');
const manifest = {
  id: 'TEST', name: 'Test fixture', category: 'desks', type: 'asset',
  canPlaceOnWalls: false, canPlaceOnSurfaces: false, backgroundTiles: 0,
  width: 16, height: 16, footprintW: 1, footprintH: 1,
};

describe('validated manifest assets', () => {
  let root: string;
  function pack(name: string, value: unknown = manifest): string {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(value));
    const png = new PNG({ width: 16, height: 16 });
    png.data.fill(255);
    fs.writeFileSync(path.join(dir, 'TEST.png'), PNG.sync.write(png));
    return dir;
  }
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-assets-')); });
  afterEach(() => { vi.useRealTimers(); fs.rmSync(root, { recursive: true, force: true }); });

  it('decodes the actual verified bundle, including exact desk footprints and all tile sheets', () => {
    const snapshot = loadAssetSnapshot(bundled);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.furniture).toHaveLength(38);
    expect(snapshot.furniture.find((a) => a.type === 'pa_DESK_FRONT')).toMatchObject({ width: 3, height: 2 });
    expect(snapshot.furniture.find((a) => a.type === 'pa_DESK_SIDE')).toMatchObject({ width: 1, height: 4 });
    expect(snapshot.floors).toHaveLength(9);
    expect(snapshot.floors.every((sprite) => sprite.length === 16 && sprite.every((row) => row.length === 16))).toBe(true);
    expect(snapshot.walls).toHaveLength(16);
    expect(snapshot.walls.every((sprite) => sprite.length === 32 && sprite.every((row) => row.length === 16))).toBe(true);
    expect(snapshot.furniture.every((a) => a.sprite.some((row) => row.some(Boolean)))).toBe(true);
    expect(fs.existsSync(path.join(bundled, 'tileset_office.png'))).toBe(false);
  });

  it('matches every original bundled byte against the recorded source pin checksum', () => {
    const provenance = JSON.parse(fs.readFileSync(path.join(bundled, 'pixel-agents-source.json'), 'utf8'));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(path.join(bundled, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(relative); } else { files.push(relative); }
      }
    };
    for (const dir of ['furniture', 'floors', 'walls']) { walk(dir); }
    const hash = createHash('sha256');
    for (const relative of files.sort()) {
      hash.update(`${relative}\0`);
      hash.update(fs.readFileSync(path.join(bundled, relative)));
    }
    expect(files).toHaveLength(73);
    expect(hash.digest('hex')).toBe(provenance.sha256);
    expect(provenance.commit).toBe('b1bafd02896d90d83457266575a1e8e5011ce997');
  });

  it.each(['../escape.png', '..\\escape.png', '/tmp/escape.png', 'C:\\escape.png', 'https://host/x.png', 'x.svg', 'x.png:stream'])(
    'rejects untrusted file reference %s', (file) => {
      expect(() => validateManifest({ ...manifest, file })).toThrow('PNG filename');
    },
  );
  it.each([
    { width: 0 }, { width: 257 }, { height: 1e9 }, { width: 15 },
    { footprintW: 17 }, { footprintH: 0 }, { footprintH: 1.5 },
    { canPlaceOnWalls: 'false' }, { category: null }, { id: '../x' }, { type: 'pet' },
  ])('rejects malformed or out-of-bound schema %j', (invalid) => {
    expect(() => validateManifest({ ...manifest, ...invalid })).toThrow();
  });

  it('bounds recursive trees and rejects duplicate IDs atomically', () => {
    const group = { ...manifest, type: 'group', groupType: 'rotation', members: [manifest, manifest] };
    expect(() => validateManifest(group)).toThrow('Duplicate');
    let node: unknown = manifest;
    for (let i = 0; i < 10; i++) { node = { ...group, members: [node] }; }
    expect(() => validateManifest(node)).toThrow('depth');
    expect(() => validateManifest({ ...group, members: Array(65).fill(manifest) })).toThrow('members');
  });

  it('isolates malformed JSON, missing/wrong PNGs and ID conflicts without losing bundled or valid assets', () => {
    pack('good');
    const badJson = pack('json');
    fs.writeFileSync(path.join(badJson, 'manifest.json'), '{');
    const badPng = pack('png', { ...manifest, id: 'OTHER' });
    fs.writeFileSync(path.join(badPng, 'OTHER.png'), Buffer.from('not PNG'));
    pack('duplicate');
    const snapshot = loadAssetSnapshot(bundled, [root]);
    expect(snapshot.furniture.filter((a) => a.type === 'local_TEST_TEST')).toHaveLength(1);
    expect(snapshot.furniture.filter((a) => a.type.startsWith('pa_'))).toHaveLength(38);
    expect(snapshot.diagnostics).toHaveLength(3);
    expect(snapshot.diagnostics.join('\n')).toMatch(/Duplicate/);
    expect(snapshot.diagnostics.join('\n')).toMatch(/PNG/);
  });

  it('rejects directory junctions escaping the approved directory', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-outside-'));
    try {
      fs.symlinkSync(other, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      const snapshot = loadAssetSnapshot(bundled, [root]);
      expect(snapshot.diagnostics.join('\n')).toMatch(/symlinks|escapes/);
      expect(snapshot.furniture).toHaveLength(38);
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });

  it('checks IHDR before decoding and enforces byte limits for both JSON and PNG', () => {
    const dir = pack('bad');
    const file = path.join(dir, 'TEST.png');
    const buffer = fs.readFileSync(file);
    buffer.writeUInt32BE(100000, 16);
    fs.writeFileSync(file, buffer);
    expect(loadAssetSnapshot(bundled, [root]).diagnostics.join('\n')).toContain('dimensions');
    fs.writeFileSync(file, Buffer.alloc(1024 * 1024 + 1));
    expect(loadAssetSnapshot(bundled, [root]).diagnostics.join('\n')).toContain('exceeds');
    fs.writeFileSync(path.join(dir, 'manifest.json'), ' '.repeat(64 * 1024 + 1));
    expect(loadAssetSnapshot(bundled, [root]).diagnostics.join('\n')).toContain('65536');
  });

  it('rejects interlacing and repeated IHDR chunks before entering the PNG decoder', () => {
    const dir = pack('bad');
    const file = path.join(dir, 'TEST.png');
    const original = fs.readFileSync(file);
    const interlaced = Buffer.from(original);
    interlaced[28] = 1;
    fs.writeFileSync(file, interlaced);
    expect(loadAssetSnapshot(bundled, [root]).diagnostics.join('\n')).toContain('Interlaced');
    fs.writeFileSync(file, Buffer.concat([original.subarray(0, 33), original.subarray(8)]));
    expect(loadAssetSnapshot(bundled, [root]).diagnostics.join('\n')).toContain('chunk/header');
    const badCrc = Buffer.from(original);
    badCrc[badCrc.length - 13] ^= 1;
    fs.writeFileSync(file, badCrc);
    const snapshot = loadAssetSnapshot(bundled, [root]);
    expect(snapshot.diagnostics.join('\n')).toMatch(/Crc|end of stream/i);
    expect(snapshot.furniture).toHaveLength(38);
  });

  it('bounds root and item directory enumeration, missing roots and independent root recovery', () => {
    const dir = pack('item');
    for (let i = 0; i < 128; i++) { fs.writeFileSync(path.join(dir, `${i}.txt`), ''); }
    expect(loadAssetSnapshot(bundled, [root]).diagnostics.join('\n')).toContain('128');
    for (let i = 0; i < 128; i++) { fs.writeFileSync(path.join(root, `${i}.txt`), ''); }
    const snapshot = loadAssetSnapshot(bundled, [root, path.join(root, 'missing')]);
    expect(snapshot.diagnostics).toHaveLength(2);
    expect(snapshot.furniture).toHaveLength(38);
    expect(loadAssetSnapshot(bundled, Array(9).fill(root)).diagnostics.join('\n')).toContain('eight');
  });

  it('enforces aggregate pixel and asset budgets atomically while allowing smaller later manifests', () => {
    const oversized = {
      ...manifest, type: 'group', groupType: 'rotation',
      members: Array.from({ length: 16 }, (_, i) => ({
        ...manifest, id: `LARGE_${i}`, width: 256, height: 256, footprintW: 16, footprintH: 16,
      })),
    };
    const dir = pack('large', oversized);
    expect(loadAssetSnapshot(bundled, [root]).diagnostics.join('\n')).toContain('budget');
    fs.rmSync(dir, { recursive: true });
    for (let i = 0; i < 8; i++) {
      pack(`batch${i}`, {
        ...manifest, id: `BATCH${i}`, type: 'group', groupType: 'rotation',
        members: Array.from({ length: 64 }, (_, j) => ({ ...manifest, id: `LEAF_${j}`, file: 'TEST.png' })),
      });
    }
    pack('zgood');
    const snapshot = loadAssetSnapshot(bundled, [root]);
    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.diagnostics[0]).toContain('budget');
    expect(snapshot.furniture).toHaveLength(38 + 7 * 64 + 1);
    expect(snapshot.furniture.some((f) => f.type === 'local_TEST_TEST')).toBe(true);
  });

  it('reloads content, additions, deletion, failure and recovery in the same running watcher; disposal stops it', () => {
    vi.useFakeTimers();
    const dir = pack('one');
    const publish = vi.fn();
    const load = vi.fn(() => loadAssetSnapshot(bundled, [root]));
    const watcher = watchAssetSnapshots(load, publish, 10, () => assetSourceFingerprint(bundled, [root]));
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    const png = new PNG({ width: 16, height: 16 });
    png.data.fill(0);
    fs.writeFileSync(path.join(dir, 'TEST.png'), PNG.sync.write(png));
    vi.advanceTimersByTime(10);
    expect(publish.mock.lastCall![0].furniture.find((a: { type: string }) => a.type === 'local_TEST_TEST').sprite[0][0]).toBe('');
    pack('two', { ...manifest, id: 'SECOND', file: 'TEST.png' });
    vi.advanceTimersByTime(10);
    expect(publish.mock.lastCall![0].furniture).toHaveLength(40);
    fs.writeFileSync(path.join(dir, 'manifest.json'), 'invalid');
    vi.advanceTimersByTime(10);
    expect(publish.mock.lastCall![0].diagnostics).toHaveLength(1);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    vi.advanceTimersByTime(10);
    expect(publish.mock.lastCall![0].diagnostics).toEqual([]);
    fs.rmSync(path.join(root, 'two'), { recursive: true });
    vi.advanceTimersByTime(10);
    expect(publish.mock.lastCall![0].furniture).toHaveLength(39);
    watcher.dispose();
    const count = publish.mock.calls.length;
    fs.writeFileSync(path.join(dir, 'manifest.json'), 'invalid');
    vi.advanceTimersByTime(100);
    expect(publish).toHaveBeenCalledTimes(count);
  });

  it('round-trips saved legacy and unknown IDs without revision reset, remapping, movement or loss', () => {
    const layout = {
      version: 2, layoutRevision: 0, cols: 5, rows: 4, tiles: Array(20).fill(1),
      furniture: [
        { uid: 'old', type: 'desk', col: 1, row: 1, rotation: 0 },
        { uid: 'neighbor', type: 'unknown-old-premium-id', col: 3, row: 1, rotation: 90, state: 'off', vendorData: { keep: true } },
        { uid: 'new', type: 'local_TEST_TEST', col: 1, row: 2, rotation: 0, assetFootprint: { width: 1, height: 1 } },
      ], tileColors: { '0,0': { h: 12, s: 3, b: 4, c: 5 } },
    };
    const parsed = parseLayoutJson(JSON.stringify(layout))!;
    expect(parsed).toEqual(layout);
    writePersistedLayout(root, parsed);
    loadAssetSnapshot(bundled, [root]);
    expect(readPersistedLayout(root)).toEqual(layout);
    expect(parseLayoutJson(JSON.stringify({ ...layout, furniture: [{ ...layout.furniture[2], assetFootprint: { width: 1e9, height: 1 } }] }))).toBeNull();
  });
});
