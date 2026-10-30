import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { PNG } from 'pngjs';
import type { CharacterAssetEntry } from './types.js';

export const CHARACTER_LIMITS = {
  roots: 8, entries: 256, attempts: 16, perRoot: 8, total: 32,
  fileBytes: 512 * 1024, rootBytes: 2 * 1024 * 1024,
  width: 224, height: 128,
} as const;
// Multiples of 48 preserve the complete legacy sheet/hue cycle on fallback.
export const EXTERNAL_CHARACTER_BASE = 48 * 0x1000000;

export interface CharacterSnapshot {
  characters: CharacterAssetEntry[];
  diagnostics: string[];
}

function safePath(root: string, segments: string[]): string {
  let current = fs.realpathSync(root);
  const base = current;
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\\/:]/.test(segment)) {
      throw new Error('Character paths must be local filenames');
    }
    const candidate = path.join(current, segment);
    if (fs.lstatSync(candidate).isSymbolicLink()) { throw new Error('Character symlinks/junctions are not allowed'); }
    current = fs.realpathSync(candidate);
    const relative = path.relative(base, current);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Character path escapes its approved directory');
    }
  }
  return current;
}

function validatePng(buffer: Buffer): void {
  const { width, height } = CHARACTER_LIMITS;
  if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Invalid character PNG signature/header');
  }
  if (buffer.readUInt32BE(16) === 112 && buffer.readUInt32BE(20) === 96) {
    throw new Error('Pixel Agents 112x96 sheets are not drop-in compatible; export a native 224x128 sheet');
  }
  if (buffer.readUInt32BE(16) !== width || buffer.readUInt32BE(20) !== height) {
    throw new Error('Character PNG must be 224x128 (7 frames x 4 rows of 32x32)');
  }
  if (buffer[28] !== 0) { throw new Error('Interlaced character PNGs are not supported'); }
  let ended = false;
  for (let offset = 8; offset < buffer.length;) {
    if (offset + 12 > buffer.length) { throw new Error('Truncated PNG chunk'); }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const next = offset + length + 12;
    if (next > buffer.length || (offset !== 8 && type === 'IHDR')) { throw new Error('Invalid PNG chunk/header'); }
    if (type === 'IEND') {
      if (length !== 0 || next !== buffer.length) { throw new Error('Invalid PNG trailer'); }
      ended = true;
      break;
    }
    offset = next;
  }
  if (!ended) { throw new Error('PNG is missing IEND'); }
  PNG.sync.read(buffer, { checkCRC: true });
}

function scan(roots: string[], decode: boolean): { snapshot: CharacterSnapshot; fingerprint: string } {
  const snapshot: CharacterSnapshot = { characters: [], diagnostics: [] };
  const hash = createHash('sha256');
  const names = new Set<string>();
  const palettes = new Set<number>();
  const attempt = (label: string, work: () => void): void => {
    hash.update(label);
    try { work(); } catch (error) {
      const diagnostic = `${label}: ${error instanceof Error ? error.message : String(error)}`;
      snapshot.diagnostics.push(diagnostic);
      hash.update(diagnostic);
    }
  };
  if (roots.length > CHARACTER_LIMITS.roots) { snapshot.diagnostics.push('Characters: only eight external directories can be loaded'); }
  hash.update(String(roots.length));
  // Root order is not identity. The same approved set always yields the same snapshot.
  for (const root of [...new Set(roots.slice(0, CHARACTER_LIMITS.roots))].sort()) {
    attempt(root, () => {
      if (!path.isAbsolute(root)) { throw new Error('Character asset directory must be absolute'); }
      const base = fs.realpathSync(root);
      if (!fs.existsSync(path.join(base, 'characters'))) { return; }
      const directory = safePath(base, ['characters']);
      const entries: string[] = [];
      const handle = fs.opendirSync(directory);
      try {
        let entry;
        while ((entry = handle.readSync())) {
          if (entries.length >= CHARACTER_LIMITS.entries) { throw new Error('Character enumeration budget exceeded (256 entries)'); }
          entries.push(entry.name);
        }
      } finally { handle.closeSync(); }
      let bytes = 0;
      let reads = 0;
      let accepted = 0;
      const candidates = entries.filter((name) => /\.png$/i.test(name)).sort();
      hash.update(JSON.stringify(entries.sort()));
      for (const name of candidates) {
        attempt(`${root} / characters / ${name}`, () => {
          if (++reads > CHARACTER_LIMITS.attempts) { throw new Error('Character read/decode budget exceeded (16 attempts)'); }
          if (decode && (accepted >= CHARACTER_LIMITS.perRoot || snapshot.characters.length >= CHARACTER_LIMITS.total)) {
            throw new Error('Character sheet cap exceeded (8 per root / 32 total)');
          }
          if (!/^char_[A-Za-z0-9][A-Za-z0-9_-]{0,79}\.png$/i.test(name)) {
            throw new Error('Character filename must be char_NAME.png (letters, digits, underscore or hyphen)');
          }
          const file = safePath(base, ['characters', name]);
          if (!fs.lstatSync(file).isFile()) { throw new Error('Character is not a regular file'); }
          const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
          let buffer: Buffer;
          try {
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.size > CHARACTER_LIMITS.fileBytes) { throw new Error('Character file exceeds 524288 bytes or is not regular'); }
            if (bytes + stat.size > CHARACTER_LIMITS.rootBytes) { throw new Error('Character root read budget exceeded (2097152 bytes)'); }
            bytes += stat.size;
            buffer = Buffer.alloc(stat.size);
            if (fs.readSync(fd, buffer, 0, buffer.length, 0) !== buffer.length) { throw new Error('Character changed while reading'); }
          } finally { fs.closeSync(fd); }
          hash.update(buffer);
          if (!decode) { return; }
          validatePng(buffer);
          const normalized = name.toLowerCase();
          if (names.has(normalized)) { throw new Error(`Duplicate character filename: ${name}`); }
          const identity = createHash('sha256').update(JSON.stringify([base, normalized])).digest('hex');
          const paletteIndex = EXTERNAL_CHARACTER_BASE + Number.parseInt(identity.slice(0, 8), 16) * 48;
          if (palettes.has(paletteIndex)) { throw new Error('Character identity collision; rename this sheet'); }
          names.add(normalized);
          palettes.add(paletteIndex);
          accepted++;
          snapshot.characters.push({
            id: `external_${identity}`, uri: `data:image/png;base64,${buffer.toString('base64')}`,
            paletteIndex, source: root, file: name,
            sha256: createHash('sha256').update(buffer).digest('hex'),
          });
        });
        if (reads > CHARACTER_LIMITS.attempts) { break; }
      }
    });
  }
  return { snapshot, fingerprint: hash.digest('hex') };
}

export function loadCharacterSnapshot(roots: string[]): CharacterSnapshot {
  return scan(roots, true).snapshot;
}

/** Idle polls hash bounded bytes, never decode images. */
export function characterSourceFingerprint(roots: string[]): string {
  return scan(roots, false).fingerprint;
}

export function watchCharacterSnapshots(
  roots: () => string[], publish: (snapshot: CharacterSnapshot) => void, interval = 1000,
): { dispose: () => void } {
  let previous = '';
  const refresh = (): void => {
    const directories = roots();
    const fingerprint = characterSourceFingerprint(directories);
    if (fingerprint === previous) { return; }
    previous = fingerprint;
    publish(loadCharacterSnapshot(directories));
  };
  refresh();
  const timer = setInterval(refresh, interval);
  return { dispose: () => clearInterval(timer) };
}
