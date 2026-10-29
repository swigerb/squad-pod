import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { createHash } from 'crypto';
import { ASSET_ROOT_LIMITS, assetSourceFingerprint, loadAssetSnapshot, validateManifest, watchAssetSnapshots } from './manifestAssets.js';
import { parseLayoutJson, writePersistedLayout, readPersistedLayout } from './layoutPersistence.js';

const work = vi.hoisted(() => ({ bytes: 0, reads: 0, enumeration: 0 }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
      work.reads++;
      const read = actual.readSync(fd, buffer, offset, length, position);
      work.bytes += read;
      return read;
    },
    opendirSync: (directory: string) => {
      const dir = actual.opendirSync(directory);
      return {
        readSync: () => { work.enumeration++; return dir.readSync(); },
        closeSync: () => dir.closeSync(),
      };
    },
  };
});

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
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); fs.rmSync(root, { recursive: true, force: true }); });

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
    expect(snapshot.carpets).toHaveLength(3);
    expect(snapshot.carpets.every((set) => set.length === 16 && set.every((sprite) =>
      sprite.length === 16 && sprite.every((row) => row.length === 16)))).toBe(true);
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
    for (const dir of ['furniture', 'floors', 'walls', 'carpets']) { walk(dir); }
    const hash = createHash('sha256');
    for (const relative of files.sort()) {
      hash.update(`${relative}\0`);
      hash.update(fs.readFileSync(path.join(bundled, relative)));
    }
    expect(files).toHaveLength(76);
    expect(hash.digest('hex')).toBe(provenance.sha256);
    expect(provenance.commit).toBe('b1bafd02896d90d83457266575a1e8e5011ce997');
    expect(provenance.directories).toEqual(['furniture', 'floors', 'walls', 'carpets']);
    expect(provenance.fileCount).toBe(files.length);
    const blobs = ['67fe2cd77038247a84c1a66fb9592ba3ee41a780', '25c9c0105fc0373cfcf89176101035bf64a5010c', '28907dc0181b713bf9da57cfac6148a7f7ca6122'];
    const sizes = [394, 380, 363];
    for (let i = 0; i < 3; i++) {
      const bytes = fs.readFileSync(path.join(bundled, 'carpets', `carpet_${i}.png`));
      expect(bytes.length).toBe(sizes[i]);
      expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')).toBe(blobs[i]);
      expect(provenance.carpets.files[i]).toEqual({ path: `carpets/carpet_${i}.png`, gitBlob: blobs[i], bytes: sizes[i] });
    }
  });

  it('isolates a corrupt fixed carpet sheet without shifting style IDs and detects restoration', () => {
    const copy = path.join(root, 'bundle');
    fs.cpSync(bundled, copy, { recursive: true });
    const target = path.join(copy, 'carpets', 'carpet_1.png');
    const original = fs.readFileSync(target);
    const before = assetSourceFingerprint(copy, []);
    const invalid = Buffer.from(original);
    invalid.writeUInt32BE(0x7fffffff, 16);
    fs.writeFileSync(target, invalid);
    expect(assetSourceFingerprint(copy, [])).not.toBe(before);
    const broken = loadAssetSnapshot(copy);
    expect(broken.carpets.map((set) => set.length)).toEqual([16, 0, 16]);
    expect(broken.furniture).toHaveLength(38);
    expect(broken.diagnostics).toEqual([expect.stringContaining('Bundled carpet 1: PNG dimensions/signature must match 64x64')]);
    fs.writeFileSync(target, original);
    expect(assetSourceFingerprint(copy, [])).toBe(before);
    const restored = loadAssetSnapshot(copy);
    expect(restored.carpets.map((set) => set.length)).toEqual([16, 16, 16]);
    expect(restored.diagnostics).toEqual([]);
  }, 20_000);

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

  it('reserves decode work even for failed manifests, while allowing smaller later manifests', () => {
    const oversized = {
      ...manifest, type: 'group', groupType: 'rotation',
      members: Array.from({ length: 16 }, (_, i) => ({
        ...manifest, id: `LARGE_${i}`, width: 256, height: 256, footprintW: 16, footprintH: 16,
      })),
    };
    const dir = pack('large', oversized);
    expect(loadAssetSnapshot(bundled, [root]).diagnostics.join('\n')).toContain('budget');
    fs.rmSync(dir, { recursive: true });
    for (let i = 0; i < 2; i++) {
      pack(`batch${i}`, {
        ...manifest, id: `BATCH${i}`, type: 'group', groupType: 'rotation',
        members: Array.from({ length: 32 }, (_, j) => ({ ...manifest, id: `LEAF_${j}`, file: 'TEST.png' })),
      });
    }
    pack('zgood');
    const snapshot = loadAssetSnapshot(bundled, [root]);
    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.diagnostics[0]).toContain('budget');
    expect(snapshot.furniture).toHaveLength(38 + 32 + 1);
    expect(snapshot.furniture.some((f) => f.type === 'local_TEST_TEST')).toBe(true);
  });

  it('does not read/hash unreferenced PNGs or PNGs mentioned by invalid manifests', () => {
    const dir = pack('valid');
    const bad = pack('invalid', { ...manifest, type: 'invalid' });
    work.bytes = work.reads = work.enumeration = 0;
    const before = assetSourceFingerprint(bundled, [root]);
    const beforeReads = work.reads;
    const beforeBytes = work.bytes;
    fs.writeFileSync(path.join(dir, 'UNREFERENCED.png'), Buffer.alloc(1024 * 1024));
    fs.writeFileSync(path.join(bad, 'TEST.png'), Buffer.alloc(1024 * 1024));
    work.bytes = work.reads = work.enumeration = 0;
    expect(assetSourceFingerprint(bundled, [root])).toBe(before);
    expect(work.reads).toBe(beforeReads);
    expect(work.bytes).toBe(beforeBytes);
    fs.writeFileSync(path.join(dir, 'UNREFERENCED.png'), Buffer.alloc(1024 * 1024, 1));
    expect(assetSourceFingerprint(bundled, [root])).toBe(before);
    expect(loadAssetSnapshot(bundled, [root]).furniture).toHaveLength(39);
  }, 20000);

  it('reads a shared PNG once per manifest but reserves every leaf decode', () => {
    pack('shared', {
      ...manifest, type: 'group', groupType: 'state',
      members: Array.from({ length: 48 }, (_, i) => ({ ...manifest, id: `LEAF${i}`, file: 'TEST.png' })),
    });
    for (const scan of [
      (roots: string[]) => assetSourceFingerprint(bundled, roots),
      (roots: string[]) => loadAssetSnapshot(bundled, roots),
    ]) {
      work.reads = 0;
      scan([]);
      const baselineReads = work.reads;
      work.reads = 0;
      scan([root]);
      expect(work.reads - baselineReads).toBe(2); // One manifest, one PNG.
    }
    pack('z_extra');
    expect(loadAssetSnapshot(bundled, [root]).diagnostics).toEqual([
      expect.stringContaining('z_extra: Root decode budget'),
    ]);
  }, 20000);

  it('allows exactly the external decode count and reports overflow without starving other roots', () => {
    for (let i = 0; i <= ASSET_ROOT_LIMITS.external.assets; i++) {
      pack(`item${String(i).padStart(3, '0')}`, { ...manifest, id: `ITEM${i}`, file: 'TEST.png' });
    }
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-independent-'));
    try {
      const good = path.join(other, 'good');
      fs.mkdirSync(good);
      fs.copyFileSync(path.join(root, 'item000', 'TEST.png'), path.join(good, 'TEST.png'));
      fs.writeFileSync(path.join(good, 'manifest.json'), JSON.stringify(manifest));
      for (const roots of [[root, other], [other, root]]) {
        const snapshot = loadAssetSnapshot(bundled, roots);
        expect(snapshot.furniture).toHaveLength(38 + 48 + 1);
        expect(snapshot.furniture.some((f) => f.type === 'local_TEST_TEST')).toBe(true);
        expect(snapshot.diagnostics).toHaveLength(1);
        expect(snapshot.diagnostics[0]).toContain(`${root} / item048: Root decode budget`);
      }
      fs.rmSync(path.join(root, 'item000'), { recursive: true });
      expect(loadAssetSnapshot(bundled, [root, other]).diagnostics).toEqual([]);
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  }, 20_000);

  it('counts attempted decode pixels even when corrupt art causes atomic failure', () => {
    const size = { width: 256, height: 256, footprintW: 16, footprintH: 16 };
    const failed = pack('a_failed', { ...manifest, ...size, id: 'FAILED', file: 'TEST.png' });
    fs.writeFileSync(path.join(failed, 'TEST.png'), 'invalid PNG');
    pack('b_large', { ...manifest, ...size, id: 'LARGE', file: 'TEST.png' });
    pack('z_small');
    const snapshot = loadAssetSnapshot(bundled, [root]);
    expect(snapshot.diagnostics).toHaveLength(2);
    expect(snapshot.diagnostics[0]).toContain('a_failed');
    expect(snapshot.diagnostics[1]).toContain('b_large: Root decode budget');
    expect(snapshot.furniture.some((f) => f.type === 'local_TEST_TEST')).toBe(true);
    expect(snapshot.furniture).toHaveLength(39);
  });

  it('accepts the exact byte allowance, rejects overflow visibly and recovers in the same watcher', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 32; i++) {
      const dir = pack(`item${String(i).padStart(3, '0')}`, { ...manifest, id: `BYTE${i}`, file: 'TEST.png' });
      const file = path.join(dir, 'manifest.json');
      const contents = fs.readFileSync(file, 'utf8');
      const target = 65536 - fs.statSync(path.join(dir, 'TEST.png')).size;
      fs.writeFileSync(file, contents.padEnd(target, ' '));
    }
    const snapshot = loadAssetSnapshot(bundled, [root]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.furniture).toHaveLength(70);
    work.bytes = work.reads = work.enumeration = 0;
    assetSourceFingerprint(bundled, []);
    const bundledBytes = work.bytes;
    work.bytes = work.reads = work.enumeration = 0;
    assetSourceFingerprint(bundled, [root]);
    expect(work.bytes - bundledBytes).toBe(ASSET_ROOT_LIMITS.bytes);
    const publish = vi.fn();
    const watcher = watchAssetSnapshots(() => loadAssetSnapshot(bundled, [root]), publish, 10,
      () => assetSourceFingerprint(bundled, [root]));
    pack('z_overflow', { ...manifest, id: 'EXTRA', file: 'TEST.png' });
    vi.advanceTimersByTime(10);
    expect(publish.mock.lastCall![0].diagnostics).toEqual([
      expect.stringContaining(`${root} / z_overflow: Root read budget exceeded`),
    ]);
    expect(publish.mock.lastCall![0].furniture).toHaveLength(70);
    fs.rmSync(path.join(root, 'item000'), { recursive: true });
    vi.advanceTimersByTime(10);
    expect(publish.mock.lastCall![0].diagnostics).toEqual([]);
    expect(publish.mock.lastCall![0].furniture.some((f: { type: string }) => f.type === 'local_EXTRA_EXTRA')).toBe(true);
    watcher.dispose();
  }, 20_000);

  it('bounds total actual reads, bytes and enumeration across eight hostile roots on both paths', () => {
    const roots = Array.from({ length: 8 }, (_, i) => path.join(root, `root${i}`));
    for (const [index, dir] of roots.entries()) {
      fs.mkdirSync(dir);
      for (let i = 0; i < 34; i++) {
        const folder = path.join(dir, `item${String(i).padStart(3, '0')}`);
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, 'manifest.json'), '{'.padEnd(65536));
        if (index === 0) {
          for (let j = 0; j < 80; j++) { fs.writeFileSync(path.join(folder, `${j}.png`), 'unreferenced'); }
        }
      }
    }
    for (const scan of [
      () => assetSourceFingerprint(bundled, roots),
      () => loadAssetSnapshot(bundled, roots),
    ]) {
      work.bytes = work.reads = work.enumeration = 0;
      scan();
      expect(work.bytes).toBeLessThanOrEqual(9 * ASSET_ROOT_LIMITS.bytes);
      expect(work.reads).toBeLessThanOrEqual(9 * ASSET_ROOT_LIMITS.files);
      expect(work.enumeration).toBeLessThanOrEqual(9 * ASSET_ROOT_LIMITS.entries);
    }
    const snapshot = loadAssetSnapshot(bundled, roots);
    for (const dir of roots.slice(1)) {
      expect(snapshot.diagnostics.some((d) => d.startsWith(dir) && d.includes('Root read budget'))).toBe(true);
    }
    expect(snapshot.diagnostics.some((d) => d.startsWith(roots[0]) && d.includes('Root enumeration budget'))).toBe(true);
    expect(snapshot.furniture).toHaveLength(38);
  }, 30000);

  it('bounds file reads for empty malformed manifests without consuming other roots allowances', () => {
    for (let i = 0; i < 128; i++) {
      const dir = path.join(root, `item${String(i).padStart(3, '0')}`);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'manifest.json'), '');
    }
    // Exactly 128 manifests fit the read-count allowance, independent of byte size.
    work.bytes = work.reads = work.enumeration = 0;
    const baseline = loadAssetSnapshot(bundled);
    const bundledReads = work.reads;
    work.bytes = work.reads = work.enumeration = 0;
    const snapshot = loadAssetSnapshot(bundled, [root]);
    expect(work.reads - bundledReads).toBe(ASSET_ROOT_LIMITS.files);
    expect(snapshot.diagnostics).toHaveLength(128);
    expect(snapshot.furniture).toEqual(baseline.furniture);
    expect(snapshot.diagnostics.every((d) => d.startsWith(`${root} / item`))).toBe(true);
    fs.writeFileSync(path.join(root, 'item127', 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(root, 'item127', 'TEST.png'), PNG.sync.write(new PNG({ width: 16, height: 16 })));
    const overflow = loadAssetSnapshot(bundled, [root]);
    expect(overflow.diagnostics.at(-1)).toContain('item127: Root read budget exceeded');
    expect(overflow.furniture).toEqual(baseline.furniture);
  });

  it('accepts exactly the per-root pixel allowance across multiple manifests', () => {
    for (const [folder, width] of [['large', 256], ['small', 128]] as const) {
      const dir = pack(folder, {
        ...manifest, id: folder, file: 'TEST.png', width, height: 256, footprintW: width / 16, footprintH: 16,
      });
      const png = new PNG({ width, height: 256 });
      png.data.fill(255);
      fs.writeFileSync(path.join(dir, 'TEST.png'), PNG.sync.write(png));
    }
    expect(loadAssetSnapshot(bundled, [root]).diagnostics).toEqual([]);
    pack('z_overflow');
    const snapshot = loadAssetSnapshot(bundled, [root]);
    expect(snapshot.furniture).toHaveLength(40);
    expect(snapshot.diagnostics).toEqual([expect.stringContaining('z_overflow: Root decode budget')]);
  });

  it('reserves equal decode shares across eight roots and bounds actual decoder calls/pixels', () => {
    expect(ASSET_ROOT_LIMITS.bundled.assets + 8 * ASSET_ROOT_LIMITS.external.assets).toBe(512);
    expect(ASSET_ROOT_LIMITS.bundled.pixels + 8 * ASSET_ROOT_LIMITS.external.pixels).toBe(1048576);
    const roots = Array.from({ length: 8 }, (_, i) => path.join(root, `root${i}`));
    for (const [index, dir] of roots.entries()) {
      fs.mkdirSync(dir);
      for (const [folder, width] of [['large', 256], ['small', 128], ['z_overflow', 16]] as const) {
        const item = path.join(dir, folder);
        fs.mkdirSync(item);
        const height = width === 16 ? 16 : 256;
        fs.writeFileSync(path.join(item, 'manifest.json'), JSON.stringify({
          ...manifest, id: `ROOT${index}_${folder}`, file: 'TEST.png',
          width, height, footprintW: width / 16, footprintH: height / 16,
        }));
        const png = new PNG({ width, height });
        png.data.fill(255);
        fs.writeFileSync(path.join(item, 'TEST.png'), PNG.sync.write(png));
      }
    }
    const decode = vi.spyOn(PNG.sync, 'read');
    const snapshot = loadAssetSnapshot(bundled, roots);
    expect(snapshot.furniture).toHaveLength(38 + 16);
    expect(snapshot.diagnostics).toHaveLength(8);
    for (const dir of roots) {
      expect(snapshot.diagnostics).toContainEqual(expect.stringContaining(`${dir} / z_overflow: Root decode budget`));
    }
    expect(decode).toHaveBeenCalledTimes(38 + 16 + 13);
    const pixels = decode.mock.results.reduce((sum, result) =>
      sum + (result.type === 'return' ? result.value.width * result.value.height : 0), 0);
    expect(pixels).toBeLessThanOrEqual(1048576);
    expect(pixels).toBeGreaterThanOrEqual(8 * ASSET_ROOT_LIMITS.external.pixels);
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
  }, 20_000);

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
