// Adapted from Pixel Agents v1.5.0 (MIT); see THIRD_PARTY_NOTICES.md.
import type { CarpetTile, FloorColor, SpriteData } from '../types.js';
import { CARPET_DEFAULT_COLOR, CARPET_DEFAULT_ACCENT_COLOR } from '../../constants.js';
import { flatColorizeSprite } from '../colorize.js';

let sets: SpriteData[][] = [];
let palettes: string[][] = [];
const cache = new Map<string, SpriteData>();
const CACHE_LIMIT = 1024;

export function setCarpetSprites(sprites: SpriteData[][]): void {
  sets = sprites;
  palettes = sprites.map((variant) => [...new Set(variant.flat(2).filter(Boolean).map((hex) => hex.slice(0, 7)))]
    .sort((a, b) => luminance(a) - luminance(b)));
  cache.clear();
}

function luminance(hex: string): number {
  return 0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16)
    + 0.114 * parseInt(hex.slice(5, 7), 16);
}

export function hasCarpetVariant(variant: number): boolean {
  return sets[variant]?.length === 16;
}

export function getCarpetPaletteKey(color: FloorColor, accent: FloorColor): string {
  return [color, accent].map((c) => `${c.h}|${c.s}|${c.b}|${c.c}|${c.colorize ? 1 : 0}`).join('#');
}

export function carpetJunctionCase(
  jx: number, jy: number, variant: number, tiles: Array<CarpetTile | null>,
  cols: number, rows: number, paletteKey?: string,
): number {
  let mask = 0;
  for (const [dx, dy, bit] of [[-1, -1, 1], [0, -1, 2], [0, 0, 4], [-1, 0, 8]]) {
    const col = jx + dx, row = jy + dy;
    if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
    const tile = tiles[row * cols + col];
    if (tile?.variant === variant && (paletteKey === undefined
      || getCarpetPaletteKey(tile.color ?? CARPET_DEFAULT_COLOR, tile.accentColor ?? CARPET_DEFAULT_ACCENT_COLOR) === paletteKey)) {
      mask |= bit;
    }
  }
  return mask;
}

export function getCarpetSprite(
  variant: number, mask: number, color: FloorColor = CARPET_DEFAULT_COLOR, accent: FloorColor = CARPET_DEFAULT_ACCENT_COLOR,
): SpriteData | null {
  const base = sets[variant]?.[mask];
  const palette = palettes[variant];
  if (!base || !palette?.length || mask === 0) return null;
  const key = `${variant}:${mask}:${getCarpetPaletteKey(color, accent)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const main = flatColorizeSprite(base, color);
  const trim = flatColorizeSprite(base, accent);
  const sprite = base.map((row, y) => row.map((hex, x) => {
    if (!hex) return '';
    return hex.slice(0, 7) === palette.at(-1) ? trim[y][x] : main[y][x];
  }));
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, sprite);
  return sprite;
}

/** A two-tile patch exposes the border as well as the interior in the palette. */
export function getCarpetPreview(variant: number, color: FloorColor, accent: FloorColor): SpriteData {
  const preview = Array.from({ length: 32 }, () => Array<string>(48).fill(''));
  const tiles = [{ variant }, { variant }];
  for (let jy = 0; jy <= 1; jy++) {
    for (let jx = 0; jx <= 2; jx++) {
      const sprite = getCarpetSprite(variant, carpetJunctionCase(jx, jy, variant, tiles, 2, 1), color, accent);
      sprite?.forEach((row, y) => row.forEach((hex, x) => { if (hex) preview[jy * 16 + y][jx * 16 + x] = hex; }));
    }
  }
  return preview;
}
