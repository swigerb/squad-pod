import type { LayoutData } from './types.js';
import { isValidCarpetLayer } from './carpetValidation.js';

export const MAX_LAYOUT_PETS = 32;

function isGridSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 256;
}

/** Structural validation only: unknown asset IDs and extra metadata are preserved. */
export function isValidLayout(data: unknown): data is LayoutData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {return false;}
  const layout = data as Partial<LayoutData>;
  if (layout.version !== undefined && (!Number.isSafeInteger(layout.version) || layout.version < 1)) {return false;}
  if (!isGridSize(layout.cols) || !isGridSize(layout.rows)) {return false;}
  if (!Array.isArray(layout.tiles) || layout.tiles.length !== layout.cols * layout.rows) {return false;}
  if (!layout.tiles.every((t) => Number.isInteger(t))) {return false;}
  if (!isValidCarpetLayer(layout.carpetTiles, layout.cols * layout.rows)) {return false;}
  if (layout.pets !== undefined && (
    !Array.isArray(layout.pets) || layout.pets.length > MAX_LAYOUT_PETS
    || !layout.pets.every((pet) => !!pet && typeof pet === 'object'
      && typeof pet.id === 'string' && pet.id.length > 0 && pet.id.length <= 120
      && Number.isSafeInteger(pet.petType) && pet.petType >= 0 && pet.petType < 512)
    || new Set(layout.pets.map((pet) => pet.id)).size !== layout.pets.length
  )) {return false;}
  if (layout.furniture !== undefined) {
    if (!Array.isArray(layout.furniture)) {return false;}
    if (!layout.furniture.every((f) =>
      !!f && typeof f === 'object'
      && typeof f.uid === 'string' && typeof f.type === 'string'
      && Number.isInteger(f.col) && Number.isInteger(f.row)
      && (f.rotation === undefined || Number.isFinite(f.rotation))
      && (f.assetRole === undefined || f.assetRole === 'desk' || f.assetRole === 'seat')
      && (f.assetFootprint === undefined || (
        !!f.assetFootprint && typeof f.assetFootprint === 'object'
        && isGridSize(f.assetFootprint.width) && f.assetFootprint.width <= 16
        && isGridSize(f.assetFootprint.height) && f.assetFootprint.height <= 16
      )))) {return false;}
  }
  if (layout.tileColors !== undefined && (
    !layout.tileColors || typeof layout.tileColors !== 'object' || Array.isArray(layout.tileColors)
    || !Object.values(layout.tileColors).every((color) =>
      !!color && typeof color === 'object'
      && ['h', 's', 'b', 'c'].every((key) => Number.isFinite(color[key as keyof typeof color])))
  )) {return false;}
  try {
    JSON.stringify(data);
  } catch {
    return false;
  }
  return true;
}

export function layoutContent(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item);
}
