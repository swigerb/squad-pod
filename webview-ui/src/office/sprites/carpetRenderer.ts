import type { CarpetTile, FloorColor, SpriteData } from '../types.js';
import { TILE_SIZE, TileType } from '../types.js';
import { CARPET_DEFAULT_COLOR, CARPET_DEFAULT_ACCENT_COLOR } from '../../constants.js';
import { carpetJunctionCase, getCarpetPaletteKey, getCarpetSprite, getCarpetSpriteRevision } from './carpetTiles.js';
import { getCachedSprite } from './spriteCache.js';

interface CarpetLayer {
  tiles: Array<CarpetTile | null>;
  tileMap: number[][];
  cols: number;
  rows: number;
  revision: number;
  junctions: Array<SpriteData[] | undefined>;
  canvas?: HTMLCanvasElement;
}

// Every editor edit/applied snapshot rebuilds tileMap. Neither input is mutated
// between rebuilds. One layer per context replaces the previous layout's cache;
// the weak key releases it when an unmounted canvas/context is collected.
const layers = new WeakMap<CanvasRenderingContext2D, CarpetLayer>();
const MAX_COMPOSITE_PIXELS = 1040 * 1040; // 64x64 plus junction edges: 4.13 MiB RGBA.

function deriveLayer(tiles: Array<CarpetTile | null>, tileMap: number[][], cols: number, rows: number): CarpetLayer {
  const layer: CarpetLayer = { tiles, tileMap, cols, rows, revision: getCarpetSpriteRevision(), junctions: [] };
  if (!tiles.some(Boolean)) return layer;
  // Keep imported overlays off walls/void without changing the saved data.
  const visible = tiles.map((tile, i) => {
    const floor = tileMap[Math.floor(i / cols)]?.[i % cols];
    return floor !== undefined && floor !== TileType.WALL && floor !== TileType.VOID ? tile : null;
  });
  for (let jy = 0; jy <= rows; jy++) {
    for (let jx = 0; jx <= cols; jx++) {
      const groups = new Map<string, { variant: number; color: FloorColor; accent: FloorColor; order: number }>();
      for (const [col, row] of [[jx - 1, jy - 1], [jx, jy - 1], [jx, jy], [jx - 1, jy]]) {
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
        const tile = visible[row * cols + col];
        if (!tile) continue;
        const color = tile.color ?? CARPET_DEFAULT_COLOR;
        const accent = tile.accentColor ?? CARPET_DEFAULT_ACCENT_COLOR;
        const key = `${tile.variant}:${getCarpetPaletteKey(color, accent)}`;
        if (!groups.has(key) || groups.get(key)!.order < (tile.order ?? 0)) {
          groups.set(key, { variant: tile.variant, color, accent, order: tile.order ?? 0 });
        }
      }
      for (const { variant, color, accent } of [...groups.values()].sort((a, b) => a.order - b.order)) {
        const mask = carpetJunctionCase(jx, jy, variant, visible, cols, rows, getCarpetPaletteKey(color, accent));
        const sprite = getCarpetSprite(variant, mask, color, accent);
        if (sprite) (layer.junctions[jy * (cols + 1) + jx] ??= []).push(sprite);
      }
    }
  }
  const width = (cols + 1) * TILE_SIZE, height = (rows + 1) * TILE_SIZE;
  if (!layer.junctions.length || width * height > MAX_COMPOSITE_PIXELS || typeof document === 'undefined') return layer;
  // Pinned sheets are opaque/transparent. Translucent replacements need direct
  // source-over draws to retain exact rounding against the floor beneath them.
  const opacity = new Map<SpriteData, boolean>();
  const opaque = layer.junctions.every(sprites => sprites?.every(sprite => {
    let result = opacity.get(sprite);
    if (result === undefined) {
      result = sprite.every(row => row.every(hex => !hex || hex.length === 7 || hex.slice(7) === 'ff'));
      opacity.set(sprite, result);
    }
    return result;
  }));
  if (!opaque) return layer;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  // Optional acceleration: unavailable detached contexts use the direct path.
  if (!context) return layer;
  context.imageSmoothingEnabled = false;
  for (let i = 0; i < layer.junctions.length; i++) {
    const sprites = layer.junctions[i];
    if (!sprites) continue;
    for (const sprite of sprites) {
      context.drawImage(getCachedSprite(sprite, 1), (i % (cols + 1)) * TILE_SIZE, Math.floor(i / (cols + 1)) * TILE_SIZE);
    }
  }
  layer.canvas = canvas;
  return layer;
}

export function renderCarpetLayer(
  ctx: CanvasRenderingContext2D, tiles: Array<CarpetTile | null> | undefined,
  tileMap: number[][], cols: number, rows: number, offsetX: number, offsetY: number, zoom: number,
): void {
  if (!tiles?.length) {
    const previous = layers.get(ctx);
    if (previous?.canvas) previous.canvas.width = previous.canvas.height = 0;
    layers.delete(ctx);
    return;
  }
  let layer = layers.get(ctx);
  if (!layer || layer.tiles !== tiles || layer.tileMap !== tileMap || layer.cols !== cols || layer.rows !== rows
    || layer.revision !== getCarpetSpriteRevision()) {
    if (layer?.canvas) layer.canvas.width = layer.canvas.height = 0;
    layer = deriveLayer(tiles, tileMap, cols, rows);
    layers.set(ctx, layer);
  }
  if (!layer.junctions.length) return;

  const s = TILE_SIZE * zoom;
  const transform = ctx.getTransform();
  const width = ctx.canvas.width / transform.a;
  const height = ctx.canvas.height / transform.d;
  // Junction sprites extend half a tile on each side. Include boundary-touching
  // sprites, in the same row/group order as the uncropped reference.
  const left = Math.max(0, Math.ceil(-offsetX / s - 0.5));
  const right = Math.min(cols, Math.floor((width - offsetX) / s + 0.5));
  const top = Math.max(0, Math.ceil(-offsetY / s - 0.5));
  const bottom = Math.min(rows, Math.floor((height - offsetY) / s + 0.5));
  if (right < left || bottom < top) return;
  // Fractional device scales can sample a scaled mosaic differently at cell
  // boundaries than separately scaled sprites. Retain the reference path.
  if (layer.canvas && Number.isInteger(zoom * transform.a) && Number.isInteger(zoom * transform.d)) {
    const w = (right - left + 1) * TILE_SIZE, h = (bottom - top + 1) * TILE_SIZE;
    ctx.drawImage(layer.canvas, left * TILE_SIZE, top * TILE_SIZE, w, h,
      offsetX + left * s - s / 2, offsetY + top * s - s / 2, w * zoom, h * zoom);
    return;
  }
  for (let jy = top; jy <= bottom; jy++) {
    const y = offsetY + jy * s - s / 2;
    for (let jx = left; jx <= right; jx++) {
      const sprites = layer.junctions[jy * (cols + 1) + jx];
      if (!sprites) continue;
      const x = offsetX + jx * s - s / 2;
      for (let i = 0; i < sprites.length; i++) {
        ctx.drawImage(getCachedSprite(sprites[i], zoom), x, y);
      }
    }
  }
}
