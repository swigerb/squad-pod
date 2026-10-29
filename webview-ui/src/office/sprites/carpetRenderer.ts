import type { CarpetTile, FloorColor } from '../types.js';
import { TILE_SIZE, TileType } from '../types.js';
import { CARPET_DEFAULT_COLOR, CARPET_DEFAULT_ACCENT_COLOR } from '../../constants.js';
import { carpetJunctionCase, getCarpetPaletteKey, getCarpetSprite } from './carpetTiles.js';
import { getCachedSprite } from './spriteCache.js';

export function renderCarpetLayer(
  ctx: CanvasRenderingContext2D, tiles: Array<CarpetTile | null> | undefined,
  tileMap: number[][], cols: number, rows: number, offsetX: number, offsetY: number, zoom: number,
): void {
  if (!tiles) return;
  const s = TILE_SIZE * zoom;
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
        if (sprite) ctx.drawImage(getCachedSprite(sprite, zoom), offsetX + jx * s - s / 2, offsetY + jy * s - s / 2);
      }
    }
  }
}
