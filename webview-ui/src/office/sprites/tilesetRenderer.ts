/**
 * Tileset Renderer
 *
 * Draws furniture/tileset items from the PNG tileset sprite sheet using
 * `ctx.drawImage()` source-rectangle clipping.
 *
 * Supports two paths:
 *   1. Metadata-driven — uses tileset-metadata.json item bounds (preferred)
 *   2. Legacy — uses tileset.json object map via FurnitureType mapping
 *
 * Falls back silently when the tileset isn't loaded yet.
 */

import {
  getTilesetData,
  getTilesetMetadataImage,
  getItemById,
} from './assetLoader.js';
import type { TilesetItem } from './assetLoader.js';
import { FurnitureType, TileType, TILE_SIZE } from '../types.js';

const _loggedTilesetIssues = new Set<string>();

function logTilesetIssueOnce(key: string, ...args: unknown[]): void {
  if (_loggedTilesetIssues.has(key)) return;
  _loggedTilesetIssues.add(key);
  console.warn(...args);
}

// ── Legacy FurnitureType → tileset.json name mapping ──────────────

const furnitureToTileset: Record<string, string> = {
  [FurnitureType.DESK]: 'work_desk_v1',
  [FurnitureType.BOOKSHELF]: 'bookshelf_full',
  [FurnitureType.PLANT]: 'potted_plant',
  [FurnitureType.COOLER]: 'water_dispenser',
  [FurnitureType.WHITEBOARD]: 'large_whiteboard',
  [FurnitureType.PC]: 'computer_monitor',
};

// ── Metadata-driven rendering ─────────────────────────────────────

/**
 * Draw a tileset item by its metadata id (e.g. "desk_work_monitor").
 * Uses the item's precise pixel bounds from tileset-metadata.json.
 * Multi-tile items (bounds wider/taller than TILE_SIZE) render
 * correctly spanning the full destination area.
 *
 * @returns `true` if drawn, `false` if metadata or image not available.
 */
export function drawMetadataItem(
  ctx: CanvasRenderingContext2D,
  itemId: string,
  destX: number,
  destY: number,
  zoom: number,
): boolean {
  const image = getTilesetMetadataImage();
  if (!image) {
    logTilesetIssueOnce(`metadata-image:${itemId}`, '[tilesetRenderer] Metadata image not ready for item', itemId);
    return false;
  }

  const item = getItemById(itemId);
  if (!item) {
    logTilesetIssueOnce(`metadata-item:${itemId}`, '[tilesetRenderer] Metadata item not found:', itemId);
    return false;
  }

  ctx.imageSmoothingEnabled = false;
  const { x, y, width, height } = item.bounds;
  ctx.drawImage(
    image,
    x, y, width, height,
    destX, destY, width * zoom, height * zoom,
  );
  return true;
}

/**
 * Draw a tileset item scaled to fit a specific destination rectangle.
 * Useful when the layout dictates the footprint size.
 */
export function drawMetadataItemScaled(
  ctx: CanvasRenderingContext2D,
  itemId: string,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
): boolean {
  const image = getTilesetMetadataImage();
  if (!image) {
    logTilesetIssueOnce(`metadata-scaled-image:${itemId}`, '[tilesetRenderer] Metadata image not ready for scaled item', itemId);
    return false;
  }

  const item = getItemById(itemId);
  if (!item) {
    logTilesetIssueOnce(`metadata-scaled-item:${itemId}`, '[tilesetRenderer] Metadata item not found for scaled draw:', itemId);
    return false;
  }

  ctx.imageSmoothingEnabled = false;
  const { x, y, width, height } = item.bounds;
  ctx.drawImage(
    image,
    x, y, width, height,
    destX, destY, destW, destH,
  );
  return true;
}

/**
 * Calculate how many grid tiles an item occupies based on its
 * pixel bounds and TILE_SIZE.  Always rounds up so partial tiles
 * are included in the footprint.
 */
export function getItemGridSize(item: TilesetItem): { cols: number; rows: number } {
  return {
    cols: Math.ceil(item.bounds.width / TILE_SIZE),
    rows: Math.ceil(item.bounds.height / TILE_SIZE),
  };
}

/**
 * Validate that an item's bounds are grid-aligned (origin and
 * dimensions are multiples of TILE_SIZE, or at least the placement
 * col/row snaps to the grid).  Returns true if the item's pixel
 * dimensions are clean multiples of TILE_SIZE.
 */
export function isGridAligned(item: TilesetItem): boolean {
  return (
    item.bounds.width % TILE_SIZE === 0 &&
    item.bounds.height % TILE_SIZE === 0
  );
}

// ── Legacy rendering (backward compat) ────────────────────────────

/**
 * Try to draw a furniture item from the PNG tileset using the legacy
 * FurnitureType → tileset.json object mapping.
 *
 * @returns `true` if drawn, `false` if the caller should fall back
 *          to inline sprite rendering.
 */
export function drawTilesetFurniture(
  ctx: CanvasRenderingContext2D,
  furnitureType: string,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
): boolean {
  const tileset = getTilesetData();
  if (!tileset) {
    logTilesetIssueOnce(`legacy-tileset:${furnitureType}`, '[tilesetRenderer] Legacy tileset not ready for furniture type', furnitureType);
    return false;
  }

  const objectName = furnitureToTileset[furnitureType];
  if (!objectName) {
    logTilesetIssueOnce(`legacy-map:${furnitureType}`, '[tilesetRenderer] No legacy tileset mapping for furniture type', furnitureType);
    return false;
  }

  const obj = tileset.objects[objectName];
  if (!obj) {
    logTilesetIssueOnce(`legacy-object:${objectName}`, '[tilesetRenderer] Legacy tileset object missing:', objectName);
    return false;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    tileset.image,
    obj.x, obj.y, obj.w, obj.h,
    destX, destY, destW, destH,
  );
  return true;
}

/**
 * Draw a named tileset object at its native pixel size (scaled by zoom).
 * Useful for rendering tileset objects that aren't mapped to FurnitureType.
 */
export function drawTilesetObjectNative(
  ctx: CanvasRenderingContext2D,
  objectName: string,
  destX: number,
  destY: number,
  zoom: number,
): boolean {
  const tileset = getTilesetData();
  if (!tileset) {
    logTilesetIssueOnce(`native-tileset:${objectName}`, '[tilesetRenderer] Legacy tileset not ready for native object', objectName);
    return false;
  }

  const obj = tileset.objects[objectName];
  if (!obj) {
    logTilesetIssueOnce(`native-object:${objectName}`, '[tilesetRenderer] Native tileset object missing:', objectName);
    return false;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    tileset.image,
    obj.x, obj.y, obj.w, obj.h,
    destX, destY, obj.w * zoom, obj.h * zoom,
  );
  return true;
}

// ── TileType → tileset metadata item mapping ──────────────────────

/** Map TileType values to tileset-metadata.json item IDs for tile grid rendering. */
const tileTypeToMetadataItem: Record<number, string> = {
  [TileType.FLOOR_1]: 'floor_wood',
  [TileType.FLOOR_2]: 'floor_blue_diamond',
  [TileType.FLOOR_3]: 'floor_wood',
  [TileType.FLOOR_4]: 'floor_blue_diamond',
  [TileType.FLOOR_5]: 'floor_wood',
  [TileType.FLOOR_6]: 'floor_blue_diamond',
  [TileType.FLOOR_7]: 'floor_wood',
  [TileType.WALL]: 'wall_white_panel',
};

/**
 * Draw a floor or wall tile from the tileset PNG using metadata bounds.
 * For wall items taller than TILE_SIZE (e.g. wall_white_panel at 16×32),
 * clips to the top TILE_SIZE rows so it fits in a single grid cell.
 *
 * @returns `true` if drawn, `false` if tileset metadata/image not available.
 */
export function drawTilesetTile(
  ctx: CanvasRenderingContext2D,
  tileType: number,
  destX: number,
  destY: number,
  zoom: number,
): boolean {
  const image = getTilesetMetadataImage();
  if (!image) {
    logTilesetIssueOnce(`tile-image:${tileType}`, '[tilesetRenderer] Metadata image not ready for tile type', tileType);
    return false;
  }

  const itemId = tileTypeToMetadataItem[tileType];
  if (!itemId) {
    logTilesetIssueOnce(`tile-map:${tileType}`, '[tilesetRenderer] No metadata mapping for tile type', tileType);
    return false;
  }

  const item = getItemById(itemId);
  if (!item) {
    logTilesetIssueOnce(`tile-item:${itemId}`, '[tilesetRenderer] Metadata item missing for tile type', tileType, itemId);
    return false;
  }

  ctx.imageSmoothingEnabled = false;
  const { x, y, width, height } = item.bounds;
  // Clip source height to one tile for multi-tile items (wall_white_panel is 16×32)
  const srcH = Math.min(height, TILE_SIZE);

  ctx.drawImage(
    image,
    x, y, width, srcH,
    destX, destY, TILE_SIZE * zoom, TILE_SIZE * zoom,
  );
  return true;
}
