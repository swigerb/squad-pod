import type { FloorColor, SpriteData } from './types.js';
import { TileType } from './types.js';
import { createTileRecolorCache } from './colorize.js';

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

/** Creates floor sheets and recolors owned exclusively by one office. */
export function createFloorAssets() {
  const defaultFloorSprite: SpriteData = Array.from({ length: 16 }, () => Array<string>(16).fill('#808080'));
  let floorSprites: SpriteData[] = [];
  let revision = 0;
  const cache = createTileRecolorCache();

  function setFloorSprites(sprites: SpriteData[]): void {
    floorSprites = sprites.map(sprite => sprite.map(row => [...row]));
    revision++;
    cache.clear();
  }

  function getFloorSprite(patternIndex: number): SpriteData {
    if (!hasFloorSprites() || patternIndex < 0 || patternIndex >= floorSprites.length) {
      return defaultFloorSprite;
    }
    return floorSprites[patternIndex];
  }

  function hasFloorSprites(): boolean {
    return floorSprites.length > 0;
  }

  function getFloorPatternCount(): number {
    return floorSprites.length;
  }

  function getAllFloorSprites(): SpriteData[] {
    return floorSprites;
  }

  function getColorizedFloorSprite(patternIndex: number, color: FloorColor): SpriteData {
    return cache.get(`floor_${patternIndex}`, getFloorSprite(patternIndex), color);
  }

  return {
    get revision() { return revision; },
    setFloorSprites, getFloorSprite, hasFloorSprites, getFloorPatternCount, getAllFloorSprites,
    getColorizedFloorSprite,
  };
}

export type FloorAssets = ReturnType<typeof createFloorAssets>;

export const WALL_COLOR = { h: 30, s: 15, b: -20, c: 0 };
