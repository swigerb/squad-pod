import {
  OfficeLayout,
  FurnitureInstance,
  Seat,
  PlacedFurniture,
  Direction,
  TileType,
  SpriteData,
  TILE_SIZE,
} from '../types.js';
import { DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_FLOOR_COLOR } from '../../constants.js';
import { getCatalogEntry, createPlaceholderSprite } from './furnitureCatalog.js';
import { getItemById } from '../sprites/assetLoader.js';
import { defaultFurniture } from '../../../../src/defaultFurniture.js';
import { isValidCarpetLayer } from '../../../../src/carpetValidation.js';
import { isValidLayout } from '../../../../src/layoutValidation.js';
import { getColorizedSprite } from '../colorize.js';

const spriteIds = new WeakMap<SpriteData, number>();
let nextSpriteId = 1;

function validFurnitureColor(color: unknown): color is NonNullable<PlacedFurniture['color']> {
  if (!color || typeof color !== 'object' || Array.isArray(color)) return false;
  const value = color as Record<string, unknown>;
  return ['h', 's', 'b', 'c'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && (value.colorize === undefined || typeof value.colorize === 'boolean');
}

function furnitureColorKey(
  type: string,
  sprite: SpriteData,
  placeholder: boolean,
  color: NonNullable<PlacedFurniture['color']>,
): string {
  let spriteId = spriteIds.get(sprite);
  if (spriteId === undefined) {
    spriteId = nextSpriteId++;
    spriteIds.set(sprite, spriteId);
  }
  const baseKey = placeholder
    ? `${type}-placeholder-${sprite[0]?.length ?? 0}x${sprite.length}`
    : `${type}-catalog-${sprite[0]?.length ?? 0}x${sprite.length}-${spriteId}`;
  return `furn-${baseKey}-${color.h}-${color.s}-${color.b}-${color.c}-${color.colorize ? 1 : 0}`;
}

function colorizableSprite(sprite: SpriteData): SpriteData {
  const hasShortHex = sprite.some((row) => row.some((pixel) => /^#[\da-f]{3,4}$/i.test(pixel)));
  if (!hasShortHex) return sprite;
  return sprite.map((row) => row.map((pixel) => {
    const match = /^#([\da-f])([\da-f])([\da-f])([\da-f])?$/i.exec(pixel);
    if (!match) return pixel;
    const [, red, green, blue, alpha] = match;
    return `#${red}${red}${green}${green}${blue}${blue}${alpha ? `${alpha}${alpha}` : ''}`;
  }));
}

export function createDefaultLayout(): OfficeLayout {
  const tiles: number[] = [];
  for (let row = 0; row < DEFAULT_ROWS; row++) {
    for (let col = 0; col < DEFAULT_COLS; col++) {
      if (row === 0 || row === DEFAULT_ROWS - 1 || col === 0 || col === DEFAULT_COLS - 1) {
        tiles.push(TileType.WALL);
      } else {
        tiles.push(TileType.FLOOR_1);
      }
    }
  }

  const furniture = defaultFurniture();

  const tileColors = new Map<string, typeof DEFAULT_FLOOR_COLOR>();
  for (let row = 0; row < DEFAULT_ROWS; row++) {
    for (let col = 0; col < DEFAULT_COLS; col++) {
      tileColors.set(`${col},${row}`, { ...DEFAULT_FLOOR_COLOR });
    }
  }

  return {
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    tiles,
    furniture,
    pets: [],
    tileColors: Object.fromEntries(tileColors)
  };
}

export function layoutToTileMap(layout: OfficeLayout): number[][] {
  const tileMap: number[][] = [];
  for (let row = 0; row < layout.rows; row++) {
    const rowData: number[] = [];
    for (let col = 0; col < layout.cols; col++) {
      const index = row * layout.cols + col;
      rowData.push(layout.tiles[index]);
    }
    tileMap.push(rowData);
  }
  return tileMap;
}

export function getFurnitureFootprint(furniture: PlacedFurniture): { width: number; height: number } | undefined {
  if (furniture.assetFootprint) {
    const { width, height } = furniture.assetFootprint;
    if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 16)) return undefined;
    return furniture.rotation === 90 || furniture.rotation === 270
      ? { width: height, height: width } : { width, height };
  }
  const entry = getCatalogEntry(furniture.type);
  if (entry) {
    if (/^(pa_|local_)/.test(furniture.type)) return undefined;
    return furniture.rotation === 90 || furniture.rotation === 270
      ? { width: entry.height, height: entry.width }
      : { width: entry.width, height: entry.height };
  }
  const item = getItemById(furniture.type);
  if (!item) return undefined;
  return {
    width: Math.ceil(item.bounds.width / TILE_SIZE),
    height: Math.ceil(item.bounds.height / TILE_SIZE),
  };
}

export function layoutToFurnitureInstances(furniture: PlacedFurniture[]): FurnitureInstance[] {
  const instances: FurnitureInstance[] = [];
  for (const furn of furniture) {
    const entry = getCatalogEntry(furn.type);
    if (entry) {
      const saved = getFurnitureFootprint(furn) ? furn.assetFootprint : undefined;
      const footprintMismatch = !!saved && (saved.width !== entry.width || saved.height !== entry.height);
      let sprite = footprintMismatch
        ? createPlaceholderSprite(saved.width * TILE_SIZE, saved.height * TILE_SIZE) : entry.sprite;
      const { width, height } = getFurnitureFootprint(furn) ?? { width: 1, height: 1 };
      const invalidFootprint = !getFurnitureFootprint(furn);
      if (invalidFootprint) sprite = createPlaceholderSprite(TILE_SIZE, TILE_SIZE);
      const color = validFurnitureColor(furn.color) ? { ...furn.color } : undefined;
      if (color) {
        sprite = getColorizedSprite(
          furnitureColorKey(furn.type, sprite, footprintMismatch || invalidFootprint, color),
          colorizableSprite(sprite),
          color,
        );
      }

      if (furn.rotation === 90 || furn.rotation === 270) {
        sprite = rotateSprite(sprite, furn.rotation);
      } else if (furn.rotation === 180) {
        sprite = rotateSprite(sprite, furn.rotation);
      }

      instances.push({
        uid: furn.uid,
        type: furn.type,
        col: furn.col,
        row: furn.row,
        width,
        height,
        sprite,
        rotation: furn.rotation,
        ...(color ? { color } : {}),
      });
    } else {
      // Tileset metadata item — look up bounds from the asset loader
      const metaItem = getItemById(furn.type);
      if (metaItem) {
        const pixelW = metaItem.bounds.width;
        const pixelH = metaItem.bounds.height;
        const { width, height } = getFurnitureFootprint(furn)!;
        const baseSprite = createPlaceholderSprite(pixelW, pixelH);
        const color = validFurnitureColor(furn.color) ? { ...furn.color } : undefined;
        const sprite = color
          ? getColorizedSprite(furnitureColorKey(furn.type, baseSprite, true, color), colorizableSprite(baseSprite), color)
          : baseSprite;

        instances.push({
          uid: furn.uid,
          type: furn.type,
          col: furn.col,
          row: furn.row,
          width,
          height,
          sprite,
          rotation: furn.rotation,
          ...(color ? { color } : {}),
        });
      } else {
        const { width, height } = getFurnitureFootprint(furn) ?? { width: 1, height: 1 };
        const baseSprite = createPlaceholderSprite(width * TILE_SIZE, height * TILE_SIZE);
        const color = validFurnitureColor(furn.color) ? { ...furn.color } : undefined;
        const sprite = color
          ? getColorizedSprite(furnitureColorKey(furn.type, baseSprite, true, color), colorizableSprite(baseSprite), color)
          : baseSprite;
        instances.push({
          uid: furn.uid, type: furn.type, col: furn.col, row: furn.row, width, height,
          sprite, rotation: furn.rotation,
          ...(color ? { color } : {}),
          ...(furn.state === undefined ? {} : { state: furn.state }),
        });
      }
    }
  }
  return instances;
}

function rotateSprite(sprite: SpriteData, rotation: number): SpriteData {
  if (rotation === 0) return sprite;
  
  if (rotation === 90) {
    const height = sprite.length;
    const width = sprite[0].length;
    const rotated: SpriteData = [];
    for (let x = 0; x < width; x++) {
      const row: string[] = [];
      for (let y = height - 1; y >= 0; y--) {
        row.push(sprite[y][x]);
      }
      rotated.push(row);
    }
    return rotated;
  }
  
  if (rotation === 180) {
    return sprite.map(row => [...row].reverse()).reverse();
  }
  
  if (rotation === 270) {
    const height = sprite.length;
    const width = sprite[0].length;
    const rotated: SpriteData = [];
    for (let x = width - 1; x >= 0; x--) {
      const row: string[] = [];
      for (let y = 0; y < height; y++) {
        row.push(sprite[y][x]);
      }
      rotated.push(row);
    }
    return rotated;
  }
  
  return sprite;
}

export function layoutToSeats(furniture: PlacedFurniture[]): Seat[] {
  const seats: Seat[] = [];
  const chairMap = new Map<string, PlacedFurniture>();
  const deskMap = new Map<string, PlacedFurniture>();

  for (const furn of furniture) {
    if (furn.type === 'chair' || furn.assetRole === 'seat' || (getCatalogEntry(furn.type)?.category === 'chairs'
      && getFurnitureFootprint(furn)?.width === 1 && getFurnitureFootprint(furn)?.height === 1)) {
      chairMap.set(`${furn.col},${furn.row}`, furn);
    } else if (furn.assetRole === 'desk' || getCatalogEntry(furn.type)?.isDesk) {
      deskMap.set(`${furn.col},${furn.row}`, furn);
    }
  }

  for (const chair of chairMap.values()) {
    const directions = [
      { dir: Direction.UP, dc: 0, dr: -1 },
      { dir: Direction.DOWN, dc: 0, dr: 1 },
      { dir: Direction.LEFT, dc: -1, dr: 0 },
      { dir: Direction.RIGHT, dc: 1, dr: 0 }
    ];

    for (const d of directions) {
      const deskCol = chair.col + d.dc;
      const deskRow = chair.row + d.dr;
      const key = `${deskCol},${deskRow}`;
      if (deskMap.has(key) || [...deskMap.values()].some((desk) => {
        const size = getFurnitureFootprint(desk);
        return size && deskCol >= desk.col && deskCol < desk.col + size.width
          && deskRow >= desk.row && deskRow < desk.row + size.height;
      })) {
        seats.push({
          id: chair.uid,
          col: chair.col,
          row: chair.row,
          direction: d.dir
        });
        break;
      }
    }
  }

  return seats;
}

export function getBlockedTiles(furniture: PlacedFurniture[]): Set<string> {
  const blocked = new Set<string>();
  const instances = layoutToFurnitureInstances(furniture);

  for (const furn of instances) {
    for (let r = 0; r < furn.height; r++) {
      for (let c = 0; c < furn.width; c++) {
        blocked.add(`${furn.col + c},${furn.row + r}`);
      }
    }
  }

  return blocked;
}

export function getSeatTiles(furniture: PlacedFurniture[]): Set<string> {
  const seats = layoutToSeats(furniture);
  const seatTiles = new Set<string>();
  for (const seat of seats) {
    seatTiles.add(`${seat.col},${seat.row}`);
  }
  return seatTiles;
}

export function serializeLayout(layout: OfficeLayout): string {
  return JSON.stringify(layout);
}

export function deserializeLayout(json: string): OfficeLayout {
  const parsed: unknown = JSON.parse(json);
  if (!isValidLayout(parsed)) {
    throw new Error('Invalid layout format');
  }
  const layout = parsed as OfficeLayout;
  
  if (!layout.cols || !layout.rows || !layout.tiles || !Array.isArray(layout.furniture)) {
    throw new Error('Invalid layout format');
  }
  
  if (layout.tiles.length !== layout.cols * layout.rows) {
    throw new Error('Tile array length does not match dimensions');
  }
  if (!isValidCarpetLayer(layout.carpetTiles, layout.cols * layout.rows)) {
    throw new Error('Invalid carpet layer');
  }
  return layout;
}
