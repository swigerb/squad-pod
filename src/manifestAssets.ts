import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { PNG } from 'pngjs';

export interface ManifestFurniture {
  type: string;
  label: string;
  width: number;
  height: number;
  sprite: string[][];
  isDesk: boolean;
  category: string;
  orientation?: string;
  canPlaceOnSurfaces: boolean;
  canPlaceOnWalls: boolean;
}

export interface AssetSnapshot {
  furniture: ManifestFurniture[];
  floors: string[][][];
  walls: string[][][];
  directories: string[];
  diagnostics: string[];
}

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ENTRIES = 128;
const MAX_ASSETS = 512;
const MAX_PIXELS = 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const PNG_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}\.png$/i;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a manifest object');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || (pattern && !pattern.test(value))) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function integer(value: unknown, name: string, max: number, min = 1): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function flag(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') { throw new Error(`${name} must be boolean`); }
  return value;
}

/** Resolve every component, not just the lexical path: junctions/symlinks cannot escape the approved root. */
function safePath(root: string, segments: string[]): string {
  let current = fs.realpathSync(root);
  const base = current;
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\\/:]/.test(segment)) {
      throw new Error('Asset paths must be local filenames');
    }
    const candidate = path.join(current, segment);
    if (fs.lstatSync(candidate).isSymbolicLink()) { throw new Error('Asset symlinks/junctions are not allowed'); }
    current = fs.realpathSync(candidate);
    const relative = path.relative(base, current);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Asset path escapes its approved directory');
    }
  }
  return current;
}

function readBounded(file: string, max: number): Buffer {
  if (!fs.lstatSync(file).isFile()) { throw new Error('Asset is not a regular file'); }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) { throw new Error(`File exceeds ${max} bytes or is not a regular file`); }
    const buffer = Buffer.alloc(stat.size);
    if (fs.readSync(fd, buffer, 0, buffer.length, 0) !== buffer.length) {
      throw new Error('Asset changed while reading');
    }
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function decode(root: string, segments: string[], width: number, height: number): string[][] {
  const buffer = readBounded(safePath(root, segments), MAX_FILE_BYTES);
  if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || buffer.readUInt32BE(8) !== 13
    || buffer.toString('ascii', 12, 16) !== 'IHDR'
    || buffer.readUInt32BE(16) !== width || buffer.readUInt32BE(20) !== height) {
    throw new Error(`PNG dimensions/signature must match ${width}x${height}`);
  }
  // pngjs's interlaced sync path inflates without an output limit. Keep decoding bounded.
  if (buffer[28] !== 0) { throw new Error('Interlaced PNGs are not supported; export a non-interlaced PNG'); }
  let ended = false;
  for (let offset = 8; offset < buffer.length;) {
    if (offset + 12 > buffer.length) { throw new Error('Truncated PNG chunk'); }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const next = offset + length + 12;
    if (next > buffer.length || (offset !== 8 && type === 'IHDR')) { throw new Error('Invalid PNG chunk/header'); }
    if (type === 'IEND') {
      if (length !== 0 || next !== buffer.length) { throw new Error('Invalid PNG end'); }
      ended = true;
    }
    offset = next;
  }
  if (!ended) { throw new Error('PNG is missing IEND'); }
  const png = PNG.sync.read(buffer, { checkCRC: true });
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const i = (y * width + x) * 4;
    const alpha = png.data[i + 3];
    if (alpha < 2) { return ''; }
    return '#' + png.data.subarray(i, i + (alpha === 255 ? 3 : 4)).toString('hex');
  }));
}

interface Leaf {
  id: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  orientation?: string;
}

export function validateManifest(value: unknown): { root: Record<string, unknown>; leaves: Leaf[] } {
  const root = record(value);
  text(root.id, 'id', ID);
  text(root.name, 'name');
  text(root.category, 'category', ID);
  flag(root.canPlaceOnWalls, 'canPlaceOnWalls');
  flag(root.canPlaceOnSurfaces, 'canPlaceOnSurfaces');
  integer(root.backgroundTiles, 'backgroundTiles', 16, 0);
  const leaves: Leaf[] = [];
  const ids = new Set<string>();
  let nodes = 0;
  const visit = (value: unknown, depth: number, orientation?: string): void => {
    if (++nodes > 128 || depth >= 8) { throw new Error('Manifest tree exceeds node/depth limit'); }
    const node = record(value);
    if (node.orientation !== undefined) { orientation = text(node.orientation, 'orientation', ID); }
    if (node.state !== undefined) { text(node.state, 'state', ID); }
    if (node.frame !== undefined) { integer(node.frame, 'frame', 63, 0); }
    if (node.mirrorSide !== undefined) { flag(node.mirrorSide, 'mirrorSide'); }
    if (node.type === 'group') {
      if (!['rotation', 'state', 'animation'].includes(String(node.groupType))
        || !Array.isArray(node.members) || !node.members.length || node.members.length > 64) {
        throw new Error('Invalid group type or members');
      }
      if (node.rotationScheme !== undefined) {
        if (!['2-way', '3-way-mirror', '4-way'].includes(String(node.rotationScheme))) {
          throw new Error('Invalid rotationScheme');
        }
      }
      for (const member of node.members) { visit(member, depth + 1, orientation); }
    } else if (node.type === 'asset') {
      const id = text(node.id, 'asset id', ID);
      if (ids.has(id)) { throw new Error(`Duplicate asset id: ${id}`); }
      ids.add(id);
      const width = integer(node.width, 'width', 256);
      const height = integer(node.height, 'height', 256);
      const footprintW = integer(node.footprintW, 'footprintW', 16);
      const footprintH = integer(node.footprintH, 'footprintH', 16);
      if (width !== footprintW * 16 || height !== footprintH * 16) {
        throw new Error('Sprite dimensions must equal the tile footprint (16 pixels per tile)');
      }
      leaves.push({
        id, file: text(node.file ?? `${id}.png`, 'PNG filename', PNG_FILE),
        width, height, footprintW, footprintH, orientation,
      });
    } else {
      throw new Error('Manifest type must be asset or group');
    }
  };
  visit(root, 0);
  return { root, leaves };
}

function entries(root: string): fs.Dirent[] {
  const directory = fs.opendirSync(root);
  const result: fs.Dirent[] = [];
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      result.push(entry);
      if (result.length > MAX_ENTRIES) { throw new Error(`Directory exceeds ${MAX_ENTRIES} entries`); }
    }
    return result;
  } finally { directory.closeSync(); }
}

function directories(root: string): string[] {
  return entries(root).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name).sort();
}

/** Each manifest is atomic; a bad pack never discards another pack or the bundled catalog. */
export function loadAssetSnapshot(bundledRoot: string, externalRoots: string[] = []): AssetSnapshot {
  const snapshot: AssetSnapshot = { furniture: [], floors: [], walls: [], directories: externalRoots, diagnostics: [] };
  const ids = new Set<string>();
  let pixels = 0;
  const attempt = (label: string, work: () => void): void => {
    try { work(); } catch (error) {
      snapshot.diagnostics.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const [index, root] of [bundledRoot, ...externalRoots.slice(0, 8)].entries()) {
    attempt(root, () => {
      if (!path.isAbsolute(root)) { throw new Error('Asset directory must be absolute'); }
      // External roots contain item folders, each with manifest.json and sibling PNGs.
      const furnitureRoot = index === 0 ? safePath(root, ['furniture']) : fs.realpathSync(root);
      for (const folder of directories(furnitureRoot)) {
        attempt(`${root} / ${folder}`, () => {
          entries(safePath(furnitureRoot, [folder]));
          const manifest = JSON.parse(readBounded(safePath(furnitureRoot, [folder, 'manifest.json']), MAX_MANIFEST_BYTES).toString('utf8'));
          const { root: meta, leaves } = validateManifest(manifest);
          const addedPixels = leaves.reduce((sum, leaf) => sum + leaf.width * leaf.height, 0);
          if (snapshot.furniture.length + leaves.length > MAX_ASSETS || pixels + addedPixels > MAX_PIXELS) {
            throw new Error('Asset catalog exceeds asset/pixel budget');
          }
          const loaded = leaves.map((leaf): ManifestFurniture => {
            // Separate namespaces protect old layout IDs and the verified bundled assets.
            const type = index === 0 ? `pa_${leaf.id}` : `local_${text(meta.id, 'id', ID)}_${leaf.id}`;
            if (ids.has(type)) { throw new Error(`Duplicate asset id: ${type}`); }
            return {
              type, label: `${meta.name} (${leaf.id})`, width: leaf.footprintW, height: leaf.footprintH,
              sprite: decode(furnitureRoot, [folder, leaf.file], leaf.width, leaf.height),
              isDesk: meta.category === 'desks', category: String(meta.category), orientation: leaf.orientation,
              canPlaceOnSurfaces: meta.canPlaceOnSurfaces === true, canPlaceOnWalls: meta.canPlaceOnWalls === true,
            };
          });
          for (const asset of loaded) { ids.add(asset.type); }
          snapshot.furniture.push(...loaded);
          pixels += addedPixels;
        });
      }
    });
  }
  if (externalRoots.length > 8) { snapshot.diagnostics.push('Only eight external directories can be loaded'); }
  for (let i = 0; i < 9; i++) {
    attempt(`Bundled floor ${i}`, () => { snapshot.floors[i] = decode(bundledRoot, ['floors', `floor_${i}.png`], 16, 16); });
    snapshot.floors[i] ??= Array.from({ length: 16 }, () => Array<string>(16).fill(''));
  }
  attempt('Bundled walls', () => {
    const sheet = decode(bundledRoot, ['walls', 'wall_0.png'], 64, 128);
    snapshot.walls = Array.from({ length: 16 }, (_, mask) => sheet
      .slice(Math.floor(mask / 4) * 32, Math.floor(mask / 4) * 32 + 32)
      .map((row) => row.slice((mask % 4) * 16, (mask % 4) * 16 + 16)));
  });
  return snapshot;
}

/** Hash bounded input files so idle polling does not repeatedly decode PNGs or allocate sprite arrays. */
export function assetSourceFingerprint(bundledRoot: string, externalRoots: string[]): string {
  const hash = createHash('sha256');
  const attempt = (work: () => void): void => {
    try { work(); } catch (error) {
      // The loader surfaces this same filesystem failure as a visible diagnostic.
      hash.update(error instanceof Error ? error.message : String(error));
    }
  };
  const file = (root: string, segments: string[]): void => {
    hash.update(JSON.stringify([root, segments]));
    attempt(() => {
      hash.update(readBounded(safePath(root, segments), segments.at(-1) === 'manifest.json' ? MAX_MANIFEST_BYTES : MAX_FILE_BYTES));
    });
  };
  for (const [index, root] of [bundledRoot, ...externalRoots.slice(0, 8)].entries()) {
    hash.update(root);
    attempt(() => {
      if (!path.isAbsolute(root)) { throw new Error('Asset directory must be absolute'); }
      const furnitureRoot = index === 0 ? safePath(root, ['furniture']) : fs.realpathSync(root);
      for (const folder of directories(furnitureRoot)) {
        hash.update(folder);
        attempt(() => {
          const names = entries(safePath(furnitureRoot, [folder])).map((e) => e.name).sort();
          for (const name of names) {
            if (name === 'manifest.json' || PNG_FILE.test(name)) { file(furnitureRoot, [folder, name]); }
          }
        });
      }
    });
  }
  for (let i = 0; i < 9; i++) { file(bundledRoot, ['floors', `floor_${i}.png`]); }
  file(bundledRoot, ['walls', 'wall_0.png']);
  return hash.digest('hex');
}

/** Content fingerprints catch atomic saves and same-size edits even without native filesystem events. */
export function watchAssetSnapshots(
  load: () => AssetSnapshot, publish: (snapshot: AssetSnapshot) => void, interval = 1000,
  fingerprint?: () => string,
): { dispose: () => void } {
  let previous = '';
  let previousSource = '';
  const refresh = (): void => {
    if (fingerprint) {
      const source = fingerprint();
      if (source === previousSource) { return; }
      previousSource = source;
    }
    const snapshot = load();
    const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    if (hash !== previous) {
      previous = hash;
      publish(snapshot);
    }
  };
  refresh();
  const timer = setInterval(refresh, interval);
  return { dispose: () => clearInterval(timer) };
}
