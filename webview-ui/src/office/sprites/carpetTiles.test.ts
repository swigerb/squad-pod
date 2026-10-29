import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import type { CarpetTile, SpriteData } from '../types.js';
import { carpetJunctionCase, getCarpetPaletteKey, getCarpetPreview, getCarpetSprite, hasCarpetVariant, setCarpetSprites } from './carpetTiles.js';
import { renderCarpetLayer } from './carpetRenderer.js';
import { CARPET_DEFAULT_COLOR as main, CARPET_DEFAULT_ACCENT_COLOR as accent } from '../../constants.js';

vi.mock('./spriteCache.js', () => ({ getCachedSprite: (sprite: SpriteData) => sprite }));

const sheets = [0, 1, 2].map((i) => {
  const png = PNG.sync.read(fs.readFileSync(path.resolve('public', 'assets', 'carpets', `carpet_${i}.png`)));
  return Array.from({ length: 16 }, (_, mask) => Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => {
      const p = ((Math.floor(mask / 4) * 16 + y) * png.width + (mask % 4) * 16 + x) * 4;
      return png.data[p + 3] ? '#' + png.data.subarray(p, p + 3).toString('hex') : '';
    })));
});

beforeEach(() => setCarpetSprites(sheets));

describe('pinned three-style marching-squares carpet sprites', () => {
  it.each([0, 1, 2])('uses every case of the real sheet for style %i, retaining transparent pixels', (variant) => {
    expect(hasCarpetVariant(variant)).toBe(true);
    const allColors = new Set<string>();
    for (let mask = 0; mask < 16; mask++) {
      const tiles: Array<CarpetTile | null> = [1, 2, 8, 4].map((bit) => mask & bit ? { variant } : null);
      expect(carpetJunctionCase(1, 1, variant, tiles, 2, 2)).toBe(mask);
      const sprite = getCarpetSprite(variant, mask);
      if (!mask) { expect(sprite).toBeNull(); continue; }
      expect(sprite).toHaveLength(16);
      expect(sprite?.map((row) => row.map(Boolean))).toEqual(sheets[variant][mask].map((row) => row.map(Boolean)));
      const colors = new Set(sprite?.flat().filter(Boolean));
      for (const hex of colors) {
        expect(['#941919', '#dba35a']).toContain(hex);
        allColors.add(hex);
      }
    }
    expect([...allColors].sort()).toEqual(['#941919', '#dba35a']);
    expect(getCarpetPreview(variant, main, accent).flat().some(Boolean)).toBe(true);
  });

  it('joins matching style/palette only and handles grid edges without row wrapping', () => {
    const red = { variant: 0, color: main, accentColor: accent };
    const blue = { ...red, color: { ...main, h: 210 } };
    const tiles = [red, blue, { variant: 1 }, red];
    expect(carpetJunctionCase(1, 1, 0, tiles, 2, 2)).toBe(7);
    expect(carpetJunctionCase(1, 1, 0, tiles, 2, 2, getCarpetPaletteKey(main, accent))).toBe(5);
    expect(carpetJunctionCase(0, 0, 0, tiles, 2, 2)).toBe(4);
    expect(carpetJunctionCase(2, 2, 0, tiles, 2, 2)).toBe(1);
    expect(carpetJunctionCase(-1, 1, 0, tiles, 2, 2)).toBe(0);
    expect(getCarpetSprite(3, 15)).toBeNull();
  });

  it('changes main and accent independently, preserves alpha, and invalidates caches on reload', () => {
    const base = sheets[0][1];
    const palette = [...new Set(base.flat().filter(Boolean))].sort();
    const original = getCarpetSprite(0, 1)!;
    const recolored = getCarpetSprite(0, 1, { ...main, h: 120 }, { ...accent, h: 240 })!;
    expect(recolored).not.toEqual(original);
    expect(recolored.flat()).toContain('#199419');
    expect(recolored.flat()).toContain('#5a5adb');
    expect(palette.length).toBe(2);
    const translucent = Array.from({ length: 16 }, () => [['#11111180', '#eeeeee40', '']]);
    setCarpetSprites([translucent]);
    expect(getCarpetSprite(0, 15)).toEqual([['#94191980', '#dba35a40', '']]);
    setCarpetSprites([]);
    expect(hasCarpetVariant(0)).toBe(false);
    expect(getCarpetSprite(0, 15)).toBeNull();
  });

  it('draws centered junctions above floors, orders overlapping palettes, and hides carpet on wall/void', () => {
    const ctx = { drawImage: vi.fn() };
    const red = { variant: 0, color: main, accentColor: accent, order: 2 };
    const blue = { ...red, color: { ...main, h: 210 }, order: 1 };
    const tiles = [red, blue];
    renderCarpetLayer(ctx as unknown as CanvasRenderingContext2D, tiles, [[1, 1]], 2, 1, 10, 20, 2);
    expect(ctx.drawImage.mock.calls[0].slice(1)).toEqual([-6, 4]);
    const atShared = ctx.drawImage.mock.calls.filter((call) => call[1] === 26 && call[2] === 4);
    expect(atShared).toHaveLength(2);
    expect(atShared[0][0]).toEqual(getCarpetSprite(0, 4, blue.color, accent));
    expect(atShared[1][0]).toEqual(getCarpetSprite(0, 8, main, accent));
    ctx.drawImage.mockClear();
    renderCarpetLayer(ctx as unknown as CanvasRenderingContext2D, tiles, [[0, 8]], 2, 1, 0, 0, 1);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(tiles).toEqual([red, blue]);
  });
});
