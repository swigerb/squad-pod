import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_LIMITS, EXTERNAL_CHARACTER_BASE, loadCharacterSnapshot,
  characterSourceFingerprint, watchCharacterSnapshots,
} from './characterAssets.js';
import { assetSourceFingerprint, loadAssetSnapshot } from './manifestAssets.js';

function png(width = 224, height = 128, red = 91): Buffer {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data.set([red, 42, 190, 255], i);
  }
  return PNG.sync.write(image);
}

describe('bounded external characters', () => {
  let directory: string;
  const roots: string[] = [];
  function root(): string {
    const value = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-character-'));
    roots.push(value);
    fs.mkdirSync(path.join(value, 'characters'));
    return value;
  }
  const write = (name: string, buffer = png(), base = directory) =>
    fs.writeFileSync(path.join(base, 'characters', name), buffer);

  beforeEach(() => { directory = root(); });
  afterEach(() => {
    vi.useRealTimers();
    roots.splice(0).forEach((value) => fs.rmSync(value, { recursive: true, force: true }));
  });

  it('accepts native frames with stable identity, provenance and content SHA-256', () => {
    write('char_z.png');
    write('char_a.png');
    const result = loadCharacterSnapshot([directory]);
    expect(result.diagnostics).toEqual([]);
    expect(result.characters.map((entry) => entry.file)).toEqual(['char_a.png', 'char_z.png']);
    expect(result.characters[0]).toMatchObject({ source: directory, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.characters[0].paletteIndex).toBeGreaterThanOrEqual(EXTERNAL_CHARACTER_BASE);
    expect(result.characters[0].paletteIndex % 48).toBe(0);
    const original = result.characters[0];
    write('char_a.png', png(224, 128, 99));
    const updated = loadCharacterSnapshot([directory]).characters[0];
    expect(updated.paletteIndex).toBe(original.paletteIndex);
    expect(updated.id).toBe(original.id);
    expect(updated.sha256).not.toBe(original.sha256);
  });

  it.each([
    ['dimensions', () => png(224, 96), '224x128'],
    ['upstream', () => png(112, 96), 'not drop-in compatible'],
    ['interlaced', () => { const data = png(); data[28] = 1; return data; }, 'Interlaced'],
    ['oversize', () => Buffer.alloc(CHARACTER_LIMITS.fileBytes + 1), '524288'],
    ['signature', () => Buffer.from('not PNG'), 'signature'],
    ['trailer', () => Buffer.concat([png(), Buffer.from([0])]), 'trailer'],
    ['missing end', () => png().subarray(0, -12), 'missing IEND'],
    ['chunk', () => { const data = png(); data.writeUInt32BE(0xffffffff, 33); return data; }, 'chunk'],
    ['CRC', () => { const data = png(); data[29] ^= 1; return data; }, 'stream'],
  ])('isolates %s failures without losing a valid sibling', (_label, invalid, diagnostic) => {
    write('char_bad.png', invalid());
    write('char_good.png');
    const result = loadCharacterSnapshot([directory]);
    expect(result.characters.map((entry) => entry.file)).toEqual(['char_good.png']);
    expect(result.diagnostics.join()).toContain(diagnostic);
  });

  it('rejects symlink/junction escapes without reading their content', () => {
    const outside = root();
    write('char_outside.png', png(), outside);
    fs.rmSync(path.join(directory, 'characters'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'characters'), path.join(directory, 'characters'), 'junction');
    const result = loadCharacterSnapshot([directory]);
    expect(result.characters).toEqual([]);
    expect(result.diagnostics.join()).toContain('symlinks/junctions');
  });

  it('diagnoses duplicate names deterministically across reordered roots', () => {
    const other = root();
    write('char_same.png');
    write('char_same.png', png(), other);
    const first = loadCharacterSnapshot([directory, other]);
    expect(first.characters).toHaveLength(1);
    expect(first.diagnostics.join()).toContain('Duplicate character filename');
    expect(loadCharacterSnapshot([other, directory])).toEqual(first);
  });

  it('caps accepted sheets, attempted reads and root bytes independently', () => {
    for (let i = 0; i < 20; i++) { write(`char_${String(i).padStart(2, '0')}.png`); }
    const result = loadCharacterSnapshot([directory]);
    expect(result.characters).toHaveLength(8);
    expect(result.diagnostics.join()).toContain('sheet cap');
    expect(result.diagnostics.join()).toContain('16 attempts');
    for (let i = 0; i < 20; i++) { write(`char_${String(i).padStart(2, '0')}.png`, Buffer.alloc(500000)); }
    expect(loadCharacterSnapshot([directory]).diagnostics.join()).toContain('root read budget');
  });

  it('caps total sheets and roots and bounds directory enumeration', () => {
    const many = [directory, root(), root(), root(), root(), root(), root(), root(), root()];
    many.forEach((base, n) => {
      for (let i = 0; i < 8; i++) { write(`char_${n}_${i}.png`, png(), base); }
    });
    const result = loadCharacterSnapshot(many);
    expect(result.characters).toHaveLength(32);
    expect(result.diagnostics.join()).toContain('eight external');
    expect(result.diagnostics.join()).toContain('sheet cap');
    for (let i = 0; i < 257; i++) { fs.writeFileSync(path.join(directory, 'characters', `entry_${i}`), ''); }
    expect(loadCharacterSnapshot([directory]).diagnostics.join()).toContain('enumeration budget');
  });

  it('fingerprints add, same-size edits, remove and files after failed siblings', () => {
    const empty = characterSourceFingerprint([directory]);
    for (let i = 0; i < 8; i++) { write(`char_a${i}.png`, Buffer.from('bad')); }
    write('char_z.png');
    const added = characterSourceFingerprint([directory]);
    expect(added).not.toBe(empty);
    expect(characterSourceFingerprint([directory])).toBe(added);
    write('char_z.png', png(224, 128, 92));
    const edited = characterSourceFingerprint([directory]);
    expect(edited).not.toBe(added);
    fs.unlinkSync(path.join(directory, 'characters', 'char_z.png'));
    expect(characterSourceFingerprint([directory])).not.toBe(edited);
  });

  it('publishes exactly once per changed fingerprint and disposes its only timer', () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const watcher = watchCharacterSnapshots(() => [directory], publish);
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(publish).toHaveBeenCalledTimes(1);
    write('char_new.png');
    vi.advanceTimersByTime(3000);
    expect(publish).toHaveBeenCalledTimes(2);
    write('char_new.png', png(224, 128, 100));
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(3);
    fs.unlinkSync(path.join(directory, 'characters', 'char_new.png'));
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(4);
    watcher.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reserves characters alongside pets: no furniture or missing-manifest diagnostics', () => {
    const bundled = path.resolve('webview-ui', 'public', 'assets');
    write('char_fixture.png');
    let result = loadAssetSnapshot(bundled, [directory]);
    expect(result.diagnostics).toEqual([]);
    expect(result.furniture.filter((item) => item.type.startsWith('local_'))).toEqual([]);
    // Even an otherwise valid furniture item may no longer claim this reserved folder.
    write('char_fixture.png', png(16, 16));
    fs.writeFileSync(path.join(directory, 'characters', 'manifest.json'), JSON.stringify({
      id: 'TEST', name: 'Reserved furniture', type: 'asset', category: 'decor',
      file: 'char_fixture.png', width: 16, height: 16, footprintW: 1, footprintH: 1,
      canPlaceOnWalls: false, canPlaceOnSurfaces: false, backgroundTiles: 0,
    }));
    result = loadAssetSnapshot(bundled, [directory]);
    expect(result.diagnostics).toEqual([]);
    expect(result.furniture.filter((item) => item.type.startsWith('local_'))).toEqual([]);
  });

  it('furniture fingerprint ignores characters contents but still observes ordinary folders', () => {
    const bundled = path.resolve('webview-ui', 'public', 'assets');
    const meta = {
      id: 'TEST', name: 'Fingerprint fixture', type: 'asset', category: 'decor',
      file: 'char_fixture.png', width: 16, height: 16, footprintW: 1, footprintH: 1,
      canPlaceOnWalls: false, canPlaceOnSurfaces: false, backgroundTiles: 0,
    };
    // A manifest makes an accidentally re-enabled furniture scan actually hash this PNG.
    fs.writeFileSync(path.join(directory, 'characters', 'manifest.json'), JSON.stringify(meta));
    write('char_fixture.png');
    const before = assetSourceFingerprint(bundled, [directory]);
    write('char_fixture.png', png(224, 128, 99));
    expect(assetSourceFingerprint(bundled, [directory])).toBe(before);
    fs.mkdirSync(path.join(directory, 'ordinary'));
    fs.writeFileSync(path.join(directory, 'ordinary', 'manifest.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(directory, 'ordinary', 'char_fixture.png'), png(16, 16));
    const ordinary = assetSourceFingerprint(bundled, [directory]);
    expect(ordinary).not.toBe(before);
    fs.writeFileSync(path.join(directory, 'ordinary', 'char_fixture.png'), png(16, 16, 99));
    expect(assetSourceFingerprint(bundled, [directory])).not.toBe(ordinary);
  });
});
