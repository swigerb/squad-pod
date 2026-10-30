import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { PNG } from 'pngjs';

export interface FurnitureGroupMetadata {
  groupId?: string;
  groupType?: 'rotation' | 'state' | 'animation';
  rotationScheme?: '2-way' | '3-way-mirror' | '4-way';
  orientation?: 'front' | 'back' | 'side' | 'left' | 'right';
  state?: 'on' | 'off';
  frame?: number;
  mirrorSide?: boolean;
}

export interface ManifestFurniture extends FurnitureGroupMetadata {
  type: string;
  label: string;
  width: number;
  height: number;
  sprite: string[][];
  isDesk: boolean;
  category: string;
  canPlaceOnSurfaces: boolean;
  canPlaceOnWalls: boolean;
}

export interface AssetSnapshot {
  furniture: ManifestFurniture[];
  floors: string[][][];
  walls: string[][][];
  carpets: string[][][][];
  pets: Array<{ id: string; name: string; petType: number; sprite: string[][] }>;
  directories: string[];
  diagnostics: string[];
}

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_PET_PNG_BYTES = 512 * 1024;
export const PET_SHEET_SIZE = 96;
const MAX_ENTRIES = 128;
// Independent root allowances prevent one import from consuming another root's work.
// Nine roots together: 18 MiB read/hashed, 1152 reads, 18432 enumeration calls,
// 512 attempted furniture decodes / 1048576 pixels (including failed manifests).
// Bundled floor/wall/carpet sheets share that root's decode allowance too.
export const ASSET_ROOT_LIMITS = {
  bytes: 2 * 1024 * 1024,
  files: 128,
  entries: 2048,
  bundled: { assets: 128, pixels: 262144 },
  external: { assets: 48, pixels: 98304 },
} as const;
class RootBudget {
  private bytes = 0;
  private files = 0;
  private entries = 0;
  private assets = 0;
  private pixels = 0;
  constructor(private readonly bundled: boolean) {}
  read(bytes: number): void {
    if (this.files + 1 > ASSET_ROOT_LIMITS.files || this.bytes + bytes > ASSET_ROOT_LIMITS.bytes) {
      throw new Error('Root read budget exceeded (128 files / 2097152 bytes per pass)');
    }
    this.files++;
    this.bytes += bytes;
  }
  entry(): void {
    if (this.entries >= ASSET_ROOT_LIMITS.entries) {
      throw new Error('Root enumeration budget exceeded (2048 entries per pass)');
    }
    this.entries++;
  }
  furniture(leaves: Leaf[]): void {
    const pixels = leaves.reduce((sum, leaf) => sum + leaf.width * leaf.height, 0);
    this.reserve(leaves.length, pixels);
  }
  sheet(width: number, height: number): void {
    this.reserve(1, width * height);
  }
  private reserve(assets: number, pixels: number): void {
    const limit = this.bundled ? ASSET_ROOT_LIMITS.bundled : ASSET_ROOT_LIMITS.external;
    if (this.assets + assets > limit.assets || this.pixels + pixels > limit.pixels) {
      throw new Error(`Root decode budget exceeded (${limit.assets} assets / ${limit.pixels} pixels per pass)`);
    }
    // Reserve the entire manifest before reading PNGs. Failed attempts are not refunded.
    this.assets += assets;
    this.pixels += pixels;
  }
}
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

function readBounded(file: string, max: number, budget: RootBudget): Buffer {
  if (!fs.lstatSync(file).isFile()) { throw new Error('Asset is not a regular file'); }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) { throw new Error(`File exceeds ${max} bytes or is not a regular file`); }
    budget.read(stat.size);
    const buffer = Buffer.alloc(stat.size);
    if (fs.readSync(fd, buffer, 0, buffer.length, 0) !== buffer.length) {
      throw new Error('Asset changed while reading');
    }
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function decode(buffer: Buffer, width: number, height: number, allowPetPadding = false): string[][] {
  if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || buffer.readUInt32BE(8) !== 13
    || buffer.toString('ascii', 12, 16) !== 'IHDR'
    || buffer.readUInt32BE(16) !== width || buffer.readUInt32BE(20) !== height) {
    throw new Error(`PNG dimensions/signature must match ${width}x${height}`);
  }
  // pngjs's interlaced sync path inflates without an output limit. Keep decoding bounded.
  if (buffer[28] !== 0) { throw new Error('Interlaced PNGs are not supported; export a non-interlaced PNG'); }
  let ended = false;
  let pngEnd = buffer.length;
  for (let offset = 8; offset < buffer.length;) {
    if (offset + 12 > buffer.length) { throw new Error('Truncated PNG chunk'); }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const next = offset + length + 12;
    if (next > buffer.length || (offset !== 8 && type === 'IHDR')) { throw new Error('Invalid PNG chunk/header'); }
    if (type === 'IEND') {
      const padding = buffer.subarray(next);
      if (length !== 0 || (padding.length !== 0
        && (!allowPetPadding || padding.length !== 2 || padding[0] !== 0 || padding[1] !== 0))) {
        throw new Error('Invalid PNG end');
      }
      // The pinned Gitcat sheet has two zero padding bytes after IEND.
      ended = true;
      pngEnd = next;
      break;
    }
    offset = next;
  }
  if (!ended) { throw new Error('PNG is missing IEND'); }
  const png = PNG.sync.read(buffer.subarray(0, pngEnd), { checkCRC: true });
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const i = (y * width + x) * 4;
    const alpha = png.data[i + 3];
    if (alpha < 2) { return ''; }
    return '#' + png.data.subarray(i, i + (alpha === 255 ? 3 : 4)).toString('hex');
  }));
}

interface Leaf extends FurnitureGroupMetadata {
  id: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
}

export function validateManifest(value: unknown): { root: Record<string, unknown>; leaves: Leaf[]; diagnostics: string[] } {
  const root = record(value);
  text(root.id, 'id', ID);
  text(root.name, 'name');
  text(root.category, 'category', ID);
  flag(root.canPlaceOnWalls, 'canPlaceOnWalls');
  flag(root.canPlaceOnSurfaces, 'canPlaceOnSurfaces');
  integer(root.backgroundTiles, 'backgroundTiles', 16, 0);
  const leaves: Leaf[] = [];
  const ids = new Set<string>();
  const diagnostics: string[] = [];
  let nodes = 0;
  class TreeLimitError extends Error {}
  const visit = (value: unknown, depth: number, inherited: FurnitureGroupMetadata = {}): void => {
    if (++nodes > 128 || depth >= 8) { throw new TreeLimitError('Manifest tree exceeds node/depth limit'); }
    const node = record(value);
    const metadata = { ...inherited };
    if (node.orientation !== undefined) {
      if (!['front', 'back', 'side', 'left', 'right'].includes(String(node.orientation))) {
        throw new Error('Invalid orientation');
      }
      metadata.orientation = node.orientation as FurnitureGroupMetadata['orientation'];
    }
    if (node.state !== undefined) {
      if (node.state !== 'on' && node.state !== 'off') { throw new Error('Invalid state'); }
      metadata.state = node.state;
    }
    if (node.frame !== undefined) { metadata.frame = integer(node.frame, 'frame', 63, 0); }
    if (node.mirrorSide !== undefined) { metadata.mirrorSide = flag(node.mirrorSide, 'mirrorSide'); }
    if (node.type === 'group') {
      if (!['rotation', 'state', 'animation'].includes(String(node.groupType))
        || !Array.isArray(node.members) || !node.members.length || node.members.length > 64) {
        throw new Error('Invalid group type or members');
      }
      if (node.rotationScheme !== undefined) {
        if (!['2-way', '3-way-mirror', '4-way'].includes(String(node.rotationScheme))) {
          throw new Error('Invalid rotationScheme');
        }
        metadata.rotationScheme = node.rotationScheme as FurnitureGroupMetadata['rotationScheme'];
      }
      metadata.groupId = String(root.id);
      metadata.groupType = node.groupType as FurnitureGroupMetadata['groupType'];
      for (const [index, member] of node.members.entries()) {
        const start = leaves.length;
        const previousIds = new Set(ids);
        try { visit(member, depth + 1, metadata); } catch (error) {
          // A bad subtree must not remove independent siblings. Global work limits remain fatal.
          if (error instanceof TreeLimitError || record(member).type !== 'group') { throw error; }
          leaves.splice(start);
          ids.clear();
          for (const id of previousIds) { ids.add(id); }
          diagnostics.push(`Group member ${index}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
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
        width, height, footprintW, footprintH, ...metadata,
      });
    } else {
      throw new Error('Manifest type must be asset or group');
    }
  };
  visit(root, 0);
  return { root, leaves, diagnostics };
}

function readManifest(
  root: string, folder: string, budget: RootBudget,
  observe: (name: string, bytes: Buffer) => void = () => {},
): { root: Record<string, unknown>; leaves: Leaf[]; diagnostics: string[]; buffers: Map<string, Buffer> } {
  entries(safePath(root, [folder]), budget);
  const manifest = readBounded(safePath(root, [folder, 'manifest.json']), MAX_MANIFEST_BYTES, budget);
  observe('manifest.json', manifest);
  const validated = validateManifest(JSON.parse(manifest.toString('utf8')));
  budget.furniture(validated.leaves);
  const buffers = new Map<string, Buffer>();
  for (const leaf of validated.leaves) {
    if (!buffers.has(leaf.file)) {
      const buffer = readBounded(safePath(root, [folder, leaf.file]), MAX_FILE_BYTES, budget);
      observe(leaf.file, buffer);
      buffers.set(leaf.file, buffer);
    }
  }
  return { ...validated, buffers };
}

function getPetRoot(root: string): string | null {
  const candidate = path.join(root, 'pets');
  try {
    fs.lstatSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return null; }
    throw error;
  }
  const resolved = safePath(root, ['pets']);
  if (!fs.statSync(resolved).isDirectory()) { throw new Error('Pets path is not a directory'); }
  return resolved;
}

function readPetManifest(
  root: string, folder: string, budget: RootBudget,
  observe: (name: string, bytes: Buffer) => void = () => {},
): { id: string; name: string; petType: number } {
  const manifest = readBounded(safePath(root, [folder, 'manifest.json']), MAX_MANIFEST_BYTES, budget);
  observe(`${folder}/manifest.json`, manifest);
  const meta = record(JSON.parse(manifest.toString('utf8')));
  const id = text(meta.id, 'pet id', ID);
  if (id !== folder) { throw new Error('Pet folder must match manifest id'); }
  const name = text(meta.name, 'pet name');
  const petType = integer(meta.petType, 'pet type', 511, 0);
  return { id, name, petType };
}

function readPetImage(
  root: string, folder: string, budget: RootBudget,
  observe: (name: string, bytes: Buffer) => void = () => {},
): Buffer {
  budget.sheet(PET_SHEET_SIZE, PET_SHEET_SIZE);
  const buffer = readBounded(safePath(root, [folder, 'pet.png']), MAX_PET_PNG_BYTES, budget);
  observe(`${folder}/pet.png`, buffer);
  return buffer;
}

function loadPetSprites(
  root: string, budget: RootBudget, ids: Set<string>, petTypes: Set<number>, snapshot: AssetSnapshot,
): void {
  if (!path.isAbsolute(root)) { throw new Error('Asset directory must be absolute'); }
  const petRoot = getPetRoot(root);
  if (!petRoot) { return; }
  for (const folder of directories(petRoot, budget)) {
    try {
      const { id, name, petType } = readPetManifest(petRoot, folder, budget);
      if (ids.has(id)) { throw new Error(`Duplicate pet id: ${id}`); }
      if (petTypes.has(petType)) { throw new Error(`Duplicate pet type: ${petType}`); }
      ids.add(id);
      petTypes.add(petType);
      const buffer = readPetImage(petRoot, folder, budget);
      const sprite = decode(buffer, PET_SHEET_SIZE, PET_SHEET_SIZE, true);
      snapshot.pets.push({ id, name, petType, sprite });
    } catch (error) {
      snapshot.diagnostics.push(`${root} / pets / ${folder}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function entries(root: string, budget: RootBudget): fs.Dirent[] {
  const directory = fs.opendirSync(root);
  const result: fs.Dirent[] = [];
  try {
    for (;;) {
      budget.entry();
      const entry = directory.readSync();
      if (!entry) { break; }
      result.push(entry);
      if (result.length > MAX_ENTRIES) { throw new Error(`Directory exceeds ${MAX_ENTRIES} entries`); }
    }
    return result;
  } finally { directory.closeSync(); }
}

function directories(root: string, budget: RootBudget): string[] {
  return entries(root, budget).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name).sort();
}

/** Independent root budgets protect other roots and the bundled catalog. */
export function loadAssetSnapshot(bundledRoot: string, externalRoots: string[] = []): AssetSnapshot {
  const snapshot: AssetSnapshot = { furniture: [], floors: [], walls: [], carpets: [], pets: [], directories: externalRoots, diagnostics: [] };
  const ids = new Set<string>();
  const petIds = new Set<string>();
  const petTypes = new Set<number>();
  const bundledBudget = new RootBudget(true);
  const attempt = (label: string, work: () => void): void => {
    try { work(); } catch (error) {
      snapshot.diagnostics.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const [index, root] of [bundledRoot, ...externalRoots.slice(0, 8)].entries()) {
    const budget = index === 0 ? bundledBudget : new RootBudget(false);
    attempt(root, () => {
      if (!path.isAbsolute(root)) { throw new Error('Asset directory must be absolute'); }
      // External roots contain item folders, each with manifest.json and sibling PNGs.
      const furnitureRoot = index === 0 ? safePath(root, ['furniture']) : fs.realpathSync(root);
      for (const folder of directories(furnitureRoot, budget)) {
        if (index !== 0 && (folder === 'pets' || folder === 'characters')) { continue; }
        attempt(`${root} / ${folder}`, () => {
          const { root: meta, leaves, buffers, diagnostics } = readManifest(furnitureRoot, folder, budget);
          snapshot.diagnostics.push(...diagnostics.map((message) => `${root} / ${folder}: ${message}`));
          const loaded = leaves.map((leaf): ManifestFurniture => {
            // Separate namespaces protect old layout IDs and the verified bundled assets.
            const type = index === 0 ? `pa_${leaf.id}` : `local_${text(meta.id, 'id', ID)}_${leaf.id}`;
            if (ids.has(type)) { throw new Error(`Duplicate asset id: ${type}`); }
            return {
              type, label: leaf.groupId ? String(meta.name) : `${meta.name} (${leaf.id})`, width: leaf.footprintW, height: leaf.footprintH,
              sprite: decode(buffers.get(leaf.file)!, leaf.width, leaf.height),
              isDesk: meta.category === 'desks', category: String(meta.category),
              groupId: leaf.groupId ? (index === 0 ? `pa_${leaf.groupId}` : `local_${meta.id}_${leaf.groupId}`) : undefined,
              groupType: leaf.groupType, rotationScheme: leaf.rotationScheme, orientation: leaf.orientation,
              state: leaf.state, frame: leaf.frame, mirrorSide: leaf.mirrorSide,
              canPlaceOnSurfaces: meta.canPlaceOnSurfaces === true, canPlaceOnWalls: meta.canPlaceOnWalls === true,
            };
          });
          for (const asset of loaded) { ids.add(asset.type); }
          snapshot.furniture.push(...loaded);
        });
      }
    });
    attempt(`${root} / pets`, () => loadPetSprites(root, budget, petIds, petTypes, snapshot));
  }
  if (externalRoots.length > 8) { snapshot.diagnostics.push('Only eight external directories can be loaded'); }
  for (let i = 0; i < 9; i++) {
    attempt(`Bundled floor ${i}`, () => {
      bundledBudget.sheet(16, 16);
      snapshot.floors[i] = decode(readBounded(safePath(bundledRoot, ['floors', `floor_${i}.png`]), MAX_FILE_BYTES, bundledBudget), 16, 16);
    });
    snapshot.floors[i] ??= Array.from({ length: 16 }, () => Array<string>(16).fill(''));
  }
  attempt('Bundled walls', () => {
    bundledBudget.sheet(64, 128);
    const sheet = decode(readBounded(safePath(bundledRoot, ['walls', 'wall_0.png']), MAX_FILE_BYTES, bundledBudget), 64, 128);
    snapshot.walls = Array.from({ length: 16 }, (_, mask) => sheet
      .slice(Math.floor(mask / 4) * 32, Math.floor(mask / 4) * 32 + 32)
      .map((row) => row.slice((mask % 4) * 16, (mask % 4) * 16 + 16)));
  });
  for (let i = 0; i < 3; i++) {
    attempt(`Bundled carpet ${i}`, () => {
      bundledBudget.sheet(64, 64);
      const sheet = decode(readBounded(safePath(bundledRoot, ['carpets', `carpet_${i}.png`]), MAX_FILE_BYTES, bundledBudget), 64, 64);
      snapshot.carpets[i] = Array.from({ length: 16 }, (_, mask) => sheet
        .slice(Math.floor(mask / 4) * 16, Math.floor(mask / 4) * 16 + 16)
        .map((row) => row.slice((mask % 4) * 16, (mask % 4) * 16 + 16)));
    });
    snapshot.carpets[i] ??= [];
  }
  return snapshot;
}

/** Hash bounded input files so idle polling does not repeatedly decode PNGs or allocate sprite arrays. */
export function assetSourceFingerprint(bundledRoot: string, externalRoots: string[]): string {
  const hash = createHash('sha256');
  const attempt = (label: string, work: () => void): void => {
    hash.update(label);
    try { work(); } catch (error) {
      // The loader surfaces this same filesystem failure as a visible diagnostic.
      hash.update(error instanceof Error ? error.message : String(error));
    }
  };
  const file = (root: string, segments: string[], budget: RootBudget): void => {
    hash.update(JSON.stringify([root, segments]));
    attempt(segments.join('/'), () => {
      hash.update(readBounded(safePath(root, segments), MAX_FILE_BYTES, budget));
    });
  };
  const bundledBudget = new RootBudget(true);
  hash.update(JSON.stringify([externalRoots.length, externalRoots.slice(0, 8)]));
  for (const [index, root] of [bundledRoot, ...externalRoots.slice(0, 8)].entries()) {
    const budget = index === 0 ? bundledBudget : new RootBudget(false);
    hash.update(root);
    attempt(root, () => {
      if (!path.isAbsolute(root)) { throw new Error('Asset directory must be absolute'); }
      const furnitureRoot = index === 0 ? safePath(root, ['furniture']) : fs.realpathSync(root);
      for (const folder of directories(furnitureRoot, budget)) {
        if (index !== 0 && (folder === 'pets' || folder === 'characters')) { continue; }
        hash.update(folder);
        attempt(folder, () => {
          readManifest(furnitureRoot, folder, budget, (name, bytes) => {
            hash.update(name);
            hash.update(bytes);
          });
        });
      }
    });
    attempt(`${root} / pets`, () => {
      if (!path.isAbsolute(root)) { throw new Error('Asset directory must be absolute'); }
      const petRoot = getPetRoot(root);
      if (!petRoot) { return; }
      for (const folder of directories(petRoot, budget)) {
        hash.update(`pets/${folder}`);
        attempt(`pets/${folder}`, () => {
          readPetManifest(petRoot, folder, budget, (_name, bytes) => { hash.update(bytes); });
          readPetImage(petRoot, folder, budget, (_name, bytes) => { hash.update(bytes); });
        });
      }
    });
  }
  for (let i = 0; i < 9; i++) { file(bundledRoot, ['floors', `floor_${i}.png`], bundledBudget); }
  file(bundledRoot, ['walls', 'wall_0.png'], bundledBudget);
  for (let i = 0; i < 3; i++) { file(bundledRoot, ['carpets', `carpet_${i}.png`], bundledBudget); }
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
