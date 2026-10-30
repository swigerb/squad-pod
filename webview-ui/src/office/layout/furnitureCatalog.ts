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

export function getRotatedType(type: string, direction: 'cw' | 'ccw' = 'cw'): string | null {
  const group = rotationGroups.get(type);
  if (!group) return null;
  return group[(group.indexOf(type) + (direction === 'cw' ? 1 : -1) + group.length) % group.length];
}

export function isRotatable(type: string): boolean {
  return rotationGroups.has(type);
}

export function getCatalogEntry(type: string): FurnitureCatalogEntry | undefined {
  return FURNITURE_CATALOG.find((entry) => entry.type === type)
    ?? dynamicCatalog.find((entry) => entry.type === type);
}

export function buildDynamicCatalog(assets?: ManifestFurniture[]): FurnitureCatalogEntry[] {
  if (assets) {
    dynamicCatalog = assets.map((asset) => ({ ...asset }));
    rotationGroups.clear();
    const groups = new Map<string, Map<string, string>>();
    for (const asset of assets) {
      if (asset.groupId && asset.mirrorSide && asset.orientation === 'side') {
        dynamicCatalog.push({
          ...asset, type: `${asset.type}:left`, orientation: 'left',
          sprite: asset.sprite.map((row) => [...row].reverse()),
        });
      }
      if (!asset.groupId || !asset.orientation || (asset.state && asset.state !== 'off')) continue;
      const members = groups.get(asset.groupId) ?? new Map<string, string>();
      groups.set(asset.groupId, members);
      members.set(asset.orientation === 'side' ? 'right' : asset.orientation, asset.type);
      if (asset.orientation === 'side' && asset.mirrorSide) members.set('left', `${asset.type}:left`);
    }
    const hidden = new Set<string>();
    for (const [id, members] of groups) {
      const scheme = assets.find((asset) => asset.groupId === id && asset.rotationScheme)?.rotationScheme;
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
