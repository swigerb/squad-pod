import type { FloorColor, SpriteData } from './types.js';
import { getColorizedSprite } from './colorize.js';

const DEFAULT_FLOOR_SPRITE: SpriteData = Array(16).fill(
  Array(16).fill('#808080')
);

let floorSprites: SpriteData[] = [];

export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites;
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
  return getColorizedSprite(cacheKey, baseSprite, color);
}

export const WALL_COLOR = { h: 30, s: 15, b: -20, c: 0 };
