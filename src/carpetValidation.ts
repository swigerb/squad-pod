import type { CarpetTile } from './types.js';

function isColor(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return false; }
  const c = value as Record<string, unknown>;
  const ranges: Array<[string, number, number]> = [['h', 0, 360], ['s', 0, 100], ['b', -100, 100], ['c', -100, 100]];
  return ranges.every(([key, min, max]) =>
    typeof c[key] === 'number' && Number.isFinite(c[key]) && c[key] >= min && c[key] <= max)
    && (c.colorize === undefined || typeof c.colorize === 'boolean');
}

export function isValidCarpetTile(value: unknown): value is CarpetTile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return false; }
  const tile = value as Partial<CarpetTile>;
  return Number.isInteger(tile.variant) && tile.variant! >= 0 && tile.variant! < 3
    && (tile.color === undefined || isColor(tile.color))
    && (tile.accentColor === undefined || isColor(tile.accentColor))
    && (tile.order === undefined || (Number.isSafeInteger(tile.order) && tile.order >= 0));
}

export function isValidCarpetLayer(value: unknown, cells: number): boolean {
  return value === undefined || (Array.isArray(value) && value.length === cells
    && value.every((tile) => tile === null || isValidCarpetTile(tile)));
}
