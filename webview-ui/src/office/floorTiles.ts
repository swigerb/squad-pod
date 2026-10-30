import type { FloorColor, SpriteData } from './types.js';
import { TileType } from './types.js';
import { getColorizedTileSprite, clearColorizeCache } from './colorize.js';

// Pattern indices name the bundled floor_N.png sheets, not persisted tile IDs.
// ID 8 must remain VOID; sheet 7 is exposed additively as ID 10.
export const FLOOR_PATTERNS = [
  { type: TileType.FLOOR_1, patternIndex: 0 },
  { type: TileType.FLOOR_2, patternIndex: 1 },
  { type: TileType.FLOOR_3, patternIndex: 2 },
  { type: TileType.FLOOR_4, patternIndex: 3 },
  { type: TileType.FLOOR_5, patternIndex: 4 },
  { type: TileType.FLOOR_6, patternIndex: 5 },
  { type: TileType.FLOOR_7, patternIndex: 6 },
  { type: TileType.FLOOR_9, patternIndex: 8 },
  { type: TileType.FLOOR_10, patternIndex: 7 },
] as const;

export function getFloorPatternIndex(tile: number): number {
  return FLOOR_PATTERNS.find(({ type }) => type === tile)?.patternIndex ?? -1;
}

const DEFAULT_FLOOR_SPRITE: SpriteData = Array(16).fill(
  Array(16).fill('#808080')
);

let floorSprites: SpriteData[] = [];

export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites;
  clearColorizeCache();
}

export function getFloorSprite(patternIndex: number): SpriteData {
  if (!hasFloorSprites() || patternIndex < 0 || patternIndex >= floorSprites.length) {
    return DEFAULT_FLOOR_SPRITE;
  }
  return floorSprites[patternIndex];
}

export function hasFloorSprites(): boolean {
  return floorSprites.length > 0;
}

export function getFloorPatternCount(): number {
  return floorSprites.length;
}

export function getAllFloorSprites(): SpriteData[] {
  return floorSprites;
}

export function getColorizedFloorSprite(
  patternIndex: number,
  color: FloorColor
): SpriteData {
  const baseSprite = getFloorSprite(patternIndex);
  const cacheKey = `floor_${patternIndex}_${color.h}_${color.s}_${color.b}_${color.c}_${color.colorize}`;
  return getColorizedTileSprite(cacheKey, baseSprite, color);
}

export const WALL_COLOR = { h: 30, s: 15, b: -20, c: 0 };
