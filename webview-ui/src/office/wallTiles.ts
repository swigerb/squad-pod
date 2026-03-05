import type { FloorColor, SpriteData, FurnitureInstance } from './types.js';
import { TileType, TILE_SIZE } from './types.js';
import { getColorizedSprite } from './colorize.js';

let wallSprites: SpriteData[] = [];

export function setWallSprites(sprites: SpriteData[]): void {
  wallSprites = sprites;
}

export function hasWallSprites(): boolean {
  return wallSprites.length === 16;
}

export function getWallSprite(
  tiles: TileType[],
  cols: number,
  rows: number,
  col: number,
  row: number
): { sprite: SpriteData; offsetY: number } {
  if (!hasWallSprites()) {
    return { sprite: [[]], offsetY: 0 };
  }

  const idx = row * cols + col;
  if (tiles[idx] !== TileType.WALL) {
    return { sprite: [[]], offsetY: 0 };
  }

  const n = row > 0 && tiles[(row - 1) * cols + col] === TileType.WALL;
  const e = col < cols - 1 && tiles[row * cols + (col + 1)] === TileType.WALL;
  const s = row < rows - 1 && tiles[(row + 1) * cols + col] === TileType.WALL;
  const w = col > 0 && tiles[row * cols + (col - 1)] === TileType.WALL;

  const bitmask = (n ? 8 : 0) | (e ? 4 : 0) | (s ? 2 : 0) | (w ? 1 : 0);

  const sprite = wallSprites[bitmask];
  const offsetY = n ? -TILE_SIZE : 0;

  return { sprite, offsetY };
}

export function getColorizedWallSprite(
  tiles: TileType[],
  cols: number,
  rows: number,
  col: number,
  row: number,
  color: FloorColor
): { sprite: SpriteData; offsetY: number } {
  const { sprite, offsetY } = getWallSprite(tiles, cols, rows, col, row);
  if (sprite.length === 0 || sprite[0].length === 0) {
    return { sprite, offsetY };
  }

  const idx = row * cols + col;
  const n = row > 0 && tiles[(row - 1) * cols + col] === TileType.WALL;
  const e = col < cols - 1 && tiles[row * cols + (col + 1)] === TileType.WALL;
  const s = row < rows - 1 && tiles[(row + 1) * cols + col] === TileType.WALL;
  const w = col > 0 && tiles[row * cols + (col - 1)] === TileType.WALL;
  const bitmask = (n ? 8 : 0) | (e ? 4 : 0) | (s ? 2 : 0) | (w ? 1 : 0);

  const cacheKey = `wall_${bitmask}_${color.h}_${color.s}_${color.b}_${color.c}_${color.colorize}`;
  const colorizedSprite = getColorizedSprite(cacheKey, sprite, color);

  return { sprite: colorizedSprite, offsetY };
}

export function getWallInstances(
  tiles: TileType[],
  cols: number,
  rows: number,
  color: FloorColor
): FurnitureInstance[] {
  const instances: FurnitureInstance[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (tiles[idx] === TileType.WALL) {
        const { sprite, offsetY } = getColorizedWallSprite(
          tiles,
          cols,
          rows,
          col,
          row,
          color
        );
        if (sprite.length > 0 && sprite[0].length > 0) {
          instances.push({
            sprite,
            x: col * TILE_SIZE,
            y: row * TILE_SIZE + offsetY,
            zY: row * TILE_SIZE,
          });
        }
      }
    }
  }

  return instances;
}

export function wallColorToHex(color: FloorColor): string {
  const h = color.h;
  const s = color.s / 100;
  const l = 0.5 + color.b / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else if (h >= 300 && h < 360) {
    r = c;
    g = 0;
    b = x;
  }

  const rByte = Math.round(Math.max(0, Math.min(255, (r + m) * 255)));
  const gByte = Math.round(Math.max(0, Math.min(255, (g + m) * 255)));
  const bByte = Math.round(Math.max(0, Math.min(255, (b + m) * 255)));

  return (
    '#' +
    rByte.toString(16).padStart(2, '0') +
    gByte.toString(16).padStart(2, '0') +
    bByte.toString(16).padStart(2, '0')
  );
}
