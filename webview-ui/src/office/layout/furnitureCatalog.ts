import type { FurnitureCatalogEntry, SpriteData, PlacedFurniture } from '../types.js';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';

// Geometry only: legacy layout IDs must not acquire the new bundle's larger footprints.
// Grey missing-asset indicators are UI markers, not replacement furniture artwork.
export const FURNITURE_CATALOG: FurnitureCatalogEntry[] = [
  legacy('desk', 2, 1, true),
  legacy('chair', 1, 1),
  legacy('bookshelf', 1, 2),
  legacy('plant', 1, 1),
  legacy('cooler', 1, 1),
  legacy('whiteboard', 2, 1),
  { ...legacy('pc', 1, 1), canPlaceOnSurfaces: true },
  { ...legacy('lamp', 1, 1), canPlaceOnSurfaces: true },
];

function legacy(type: string, width: number, height: number, isDesk = false): FurnitureCatalogEntry {
  return {
    type, label: `Missing legacy asset: ${type}`, width, height, isDesk,
    sprite: createPlaceholderSprite(width * 16, height * 16),
  };
}

let dynamicCatalog: FurnitureCatalogEntry[] = [];
let paletteCatalog: FurnitureCatalogEntry[] = [];
const rotationGroups = new Map<string, string[]>();
const toggledTypes = new Map<string, string>();
const onStateTypes = new Map<string, string>();
const animationFrames = new Map<string, string[]>();
const animationGroupByType = new Map<string, string>();

function compareTypes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function animationGroupKey(entry: FurnitureCatalogEntry): string | null {
  if (entry.groupType !== 'animation' || !entry.groupId || !entry.orientation || !entry.state) return null;
  return `${entry.groupId}|${entry.orientation}|${entry.state}`;
}

function hasConsistentFootprint(entries: FurnitureCatalogEntry[]): boolean {
  const first = entries[0];
  return first !== undefined && entries.every((entry) =>
    entry.width === first.width && entry.height === first.height);
}

function buildAnimationGroups(): void {
  animationFrames.clear();
  animationGroupByType.clear();
  const grouped = new Map<string, FurnitureCatalogEntry[]>();
  for (const entry of dynamicCatalog) {
    const key = animationGroupKey(entry);
    if (!key) continue;
    const entries = grouped.get(key) ?? [];
    entries.push(entry);
    grouped.set(key, entries);
  }

  for (const [key, entries] of grouped) {
    if (!hasConsistentFootprint(entries)) continue;
    const frameTypes = new Map<number, string>();
    for (const entry of entries) {
      if (!Number.isInteger(entry.frame) || entry.frame! < 0) continue;
      const frame = entry.frame!;
      const current = frameTypes.get(frame);
      if (current === undefined || compareTypes(entry.type, current) < 0) frameTypes.set(frame, entry.type);
    }
    const frames = [...frameTypes].sort(([left], [right]) => left - right).map(([, type]) => type);
    if (!frames.length) continue;
    animationFrames.set(key, frames);
    for (const type of frames) animationGroupByType.set(type, key);
  }
}

function buildStatePairs(): void {
  toggledTypes.clear();
  onStateTypes.clear();
  const grouped = new Map<string, Map<string, FurnitureCatalogEntry[]>>();
  for (const entry of dynamicCatalog) {
    if (!entry.groupId || !entry.state) continue;
    const key = `${entry.groupId}|${entry.orientation ?? ''}`;
    const states = grouped.get(key) ?? new Map<string, FurnitureCatalogEntry[]>();
    const entries = states.get(entry.state) ?? [];
    entries.push(entry);
    states.set(entry.state, entries);
    grouped.set(key, states);
  }

  const representative = (entries: FurnitureCatalogEntry[] | undefined): FurnitureCatalogEntry | undefined => {
    if (!entries?.length) return undefined;
    const regular = entries.filter((entry) => entry.groupType !== 'animation').sort((a, b) => compareTypes(a.type, b.type));
    if (regular.length) return regular[0];
    return entries
      .filter((entry) => entry.frame === 0)
      .sort((a, b) => compareTypes(a.type, b.type))[0];
  };

  for (const states of grouped.values()) {
    const onEntries = states.get('on');
    const offEntries = states.get('off');
    const on = representative(onEntries);
    const off = representative(offEntries);
    if (!on || !off || !hasConsistentFootprint([...(onEntries ?? []), ...(offEntries ?? [])])) continue;

    const onFrames = animationGroupByType.get(on.type);
    const offFrames = animationGroupByType.get(off.type);
    const pairedOnTypes = onFrames ? animationFrames.get(onFrames) ?? [on.type] : [on.type];
    const pairedOffTypes = offFrames ? animationFrames.get(offFrames) ?? [off.type] : [off.type];
    for (const type of pairedOnTypes) {
      toggledTypes.set(type, off.type);
      onStateTypes.set(type, on.type);
    }
    for (const type of pairedOffTypes) {
      toggledTypes.set(type, on.type);
      onStateTypes.set(type, on.type);
    }
  }
}

export function getRotatedType(type: string, direction: 'cw' | 'ccw' = 'cw'): string | null {
  const group = rotationGroups.get(type);
  if (!group) return null;
  return group[(group.indexOf(type) + (direction === 'cw' ? 1 : -1) + group.length) % group.length];
}

export function isRotatable(type: string): boolean {
  return rotationGroups.has(type);
}

export function getToggledType(type: string): string | null {
  return toggledTypes.get(type) ?? null;
}

export function getOnStateType(type: string): string {
  return onStateTypes.get(type) ?? type;
}

export function getAnimationFrames(type: string): string[] | undefined {
  const key = animationGroupByType.get(type);
  return key ? animationFrames.get(key) : undefined;
}

export function getCatalogEntry(type: string): FurnitureCatalogEntry | undefined {
  return FURNITURE_CATALOG.find((entry) => entry.type === type)
    ?? dynamicCatalog.find((entry) => entry.type === type);
}

export function buildDynamicCatalog(assets?: ManifestFurniture[]): FurnitureCatalogEntry[] {
  if (assets) {
    dynamicCatalog = assets.map((asset) => ({ ...asset }));
    rotationGroups.clear();
    toggledTypes.clear();
    onStateTypes.clear();
    animationFrames.clear();
    animationGroupByType.clear();
    for (const asset of [...dynamicCatalog]) {
      if (asset.groupId && asset.mirrorSide && asset.orientation === 'side') {
        dynamicCatalog.push({
          ...asset, type: `${asset.type}:left`, orientation: 'left',
          sprite: asset.sprite.map((row) => [...row].reverse()),
        });
      }
    }

    buildAnimationGroups();
    buildStatePairs();

    const groups = new Map<string, Map<string, string>>();
    for (const asset of dynamicCatalog) {
      if (!asset.groupId || !asset.orientation || asset.state === 'on') continue;
      if (asset.groupType === 'animation' && asset.frame !== 0) continue;
      const members = groups.get(asset.groupId) ?? new Map<string, string>();
      groups.set(asset.groupId, members);
      const orientation = asset.orientation === 'side' ? 'right' : asset.orientation;
      const existing = members.get(orientation);
      if (!existing || (asset.state === 'off' && getCatalogEntry(existing)?.state !== 'off')
        || (asset.state === getCatalogEntry(existing)?.state && compareTypes(asset.type, existing) < 0)) {
        members.set(orientation, asset.type);
      }
    }

    const hidden = new Set<string>();
    for (const [id, members] of groups) {
      const scheme = dynamicCatalog.find((asset) => asset.groupId === id && asset.rotationScheme)?.rotationScheme;
      const order = scheme === '2-way' ? ['front', 'right'] : ['front', 'right', 'back', 'left'];
      const types = order.flatMap((orientation) => members.has(orientation) ? [members.get(orientation)!] : []);
      if (types.length < 2) continue;
      for (const type of types) rotationGroups.set(type, types);
      // Hide all variants, even those excluded by the scheme; keep every leaf addressable.
      const representative = members.get('front') ?? types[0];
      for (const entry of dynamicCatalog) {
        if (entry.groupId === id && entry.type !== representative) hidden.add(entry.type);
      }
    }

    for (const asset of dynamicCatalog) {
      if (asset.state !== 'on') continue;
      const offType = getToggledType(asset.type);
      const offGroup = offType ? rotationGroups.get(offType) : undefined;
      if (!offGroup) continue;
      const onGroup = offGroup.map((type) => getToggledType(type) ?? type);
      for (const type of onGroup) {
        if (getCatalogEntry(type)?.state === 'on') rotationGroups.set(type, onGroup);
      }
    }

    paletteCatalog = dynamicCatalog.filter((entry) => !hidden.has(entry.type)).map((entry) =>
      isRotatable(entry.type) ? {
        ...entry,
        label: entry.label.replace(/ - Front - Off$/, '').replace(/ - Front$/, '').replace(/ - Off$/, ''),
      } : entry);
    window.dispatchEvent(new Event('officeAssetsChanged'));
  }
  return [...paletteCatalog];
}

export function createPlaceholderSprite(pixelW: number, pixelH: number): SpriteData {
  return Array.from({ length: pixelH }, () => Array<string>(pixelW).fill('#444'));
}

export function getAssetProblem(item: PlacedFurniture): string | null {
  const entry = getCatalogEntry(item.type);
  if (!entry || FURNITURE_CATALOG.some((e) => e.type === item.type)) return `Unavailable asset: ${item.type}`;
  if (!item.assetFootprint) return `Unconfirmed footprint: ${item.type}`;
  if (entry.width !== item.assetFootprint.width || entry.height !== item.assetFootprint.height) {
    return `Changed footprint: ${item.type}; original dimensions retained`;
  }
  return null;
}
