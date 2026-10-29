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

export function getCatalogEntry(type: string): FurnitureCatalogEntry | undefined {
  return FURNITURE_CATALOG.find((entry) => entry.type === type)
    ?? dynamicCatalog.find((entry) => entry.type === type);
}

export function buildDynamicCatalog(assets?: ManifestFurniture[]): FurnitureCatalogEntry[] {
  if (assets) {
    dynamicCatalog = assets.map((asset) => ({ ...asset }));
    window.dispatchEvent(new Event('officeAssetsChanged'));
  }
  return [...dynamicCatalog];
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
