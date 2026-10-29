import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import type { CarpetTile, FloorColor, SpriteData } from '../types.js';
import * as carpetSprites from './carpetTiles.js';
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

type Draw = [SpriteData, number, number];
const composites = new WeakMap<HTMLCanvasElement, Draw[]>();
function recordedDraws(calls: unknown[][]): Draw[] {
  const output: Draw[] = [];
  for (const [image, ...args] of calls) {
    if (image instanceof HTMLCanvasElement) {
      const [sx, sy, sw, sh, dx, dy, dw] = args as number[];
      const zoom = dw / sw;
      for (const [sprite, x, y] of composites.get(image)!) {
        if (x >= sx && y >= sy && x < sx + sw && y < sy + sh) {
          output.push([sprite, dx + (x - sx) * zoom, dy + (y - sy) * zoom]);
        }
      }
    } else output.push([image as SpriteData, args[0] as number, args[1] as number]);
  }
  return output;
}

beforeEach(() => {
  setCarpetSprites(sheets);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const calls: Draw[] = [];
    composites.set(this, calls);
    return { imageSmoothingEnabled: false, drawImage: (sprite: SpriteData, x: number, y: number) => calls.push([sprite, x, y]) } as unknown as CanvasRenderingContext2D;
  });
});
afterEach(() => vi.restoreAllMocks());

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

  // Original #24 renderer, deliberately independent of the production cache/cull.
  function reference(tiles: Array<CarpetTile | null>, map: number[][], cols: number, rows: number, ox: number, oy: number, zoom: number) {
    const calls: Array<[SpriteData, number, number]> = [];
    const visible = tiles.map((tile, i) => {
      const floor = map[Math.floor(i / cols)]?.[i % cols];
      return floor !== undefined && floor !== 0 && floor !== 8 ? tile : null;
    });
    for (let jy = 0; jy <= rows; jy++) for (let jx = 0; jx <= cols; jx++) {
      const groups = new Map<string, { variant: number; color: FloorColor; accent: FloorColor; order: number }>();
      for (const [col, row] of [[jx - 1, jy - 1], [jx, jy - 1], [jx, jy], [jx - 1, jy]]) {
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
        const tile = visible[row * cols + col];
        if (!tile) continue;
        const color = tile.color ?? main, trim = tile.accentColor ?? accent;
        const key = `${tile.variant}:${getCarpetPaletteKey(color, trim)}`;
        if (!groups.has(key) || groups.get(key)!.order < (tile.order ?? 0)) {
          groups.set(key, { variant: tile.variant, color, accent: trim, order: tile.order ?? 0 });
        }
      }
      for (const { variant, color, accent: trim } of [...groups.values()].sort((a, b) => a.order - b.order)) {
        const mask = carpetJunctionCase(jx, jy, variant, visible, cols, rows, getCarpetPaletteKey(color, trim));
        const sprite = getCarpetSprite(variant, mask, color, trim);
        if (sprite) calls.push([sprite, ox + jx * 16 * zoom - 8 * zoom, oy + jy * 16 * zoom - 8 * zoom]);
      }
    }
    return calls;
  }

  it('caps composite memory, releases previous canvases and works without a detached 2D context', () => {
    const ctx = context();
    const map = Array.from({ length: 64 }, () => Array(64).fill(1));
    const tiles = Array(64 * 64).fill({ variant: 0 });
    draw(ctx, tiles, map, 64, 64);
    const image = ctx.drawImage.mock.calls[0][0] as HTMLCanvasElement;
    expect([image.width, image.height]).toEqual([1040, 1040]);
    expect(image.width * image.height * 4).toBe(4_326_400);
    draw(ctx, undefined, map, 64, 64);
    expect([image.width, image.height]).toEqual([0, 0]);
    draw(ctx, tiles, map, 64, 64);
    const next = ctx.drawImage.mock.calls[0][0] as HTMLCanvasElement;
    draw(ctx, Array(65 * 64).fill({ variant: 0 }), Array.from({ length: 64 }, () => Array(65).fill(1)), 65, 64);
    expect([next.width, next.height]).toEqual([0, 0]);
    expect(ctx.drawImage.mock.calls.every(call => !(call[0] instanceof HTMLCanvasElement))).toBe(true);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(draw(ctx, tiles, map, 64, 64).length).toBeGreaterThan(0);
    expect(ctx.drawImage.mock.calls.every(call => !(call[0] instanceof HTMLCanvasElement))).toBe(true);
  });

  function context(width = 160, height = 100, dpr = 2) {
    return { drawImage: vi.fn(), canvas: { width: width * dpr, height: height * dpr }, getTransform: vi.fn(() => ({ a: dpr, d: dpr })) };
  }
  function draw(ctx: ReturnType<typeof context>, tiles: Array<CarpetTile | null> | undefined, map: number[][],
    cols: number, rows: number, x = 0, y = 0, zoom = 1) {
    ctx.drawImage.mockClear();
    renderCarpetLayer(ctx as unknown as CanvasRenderingContext2D, tiles, map, cols, rows, x, y, zoom);
    return recordedDraws(ctx.drawImage.mock.calls);
  }

  describe('viewport-bounded immutable carpet cache', () => {
    it.each([[0, 0, 1], [-73, -45, 1], [-311, -207, 4], [151, 92, 3], [-600, -600, 2], [-73.25, -45.5, 1], [-311.5, -207.25, 4]])(
      'matches original visible sprites, pixels and overlap order at pan %i,%i zoom %i', (x, y, zoom) => {
        const cols = 16, rows = 12, ctx = context();
        const tiles: Array<CarpetTile | null> = Array.from({ length: cols * rows }, (_, i) =>
          i % 7 === 0 ? null : {
            variant: i % 3, order: i % 5,
            color: { ...main, h: i % 2 ? 210 : 0 }, accentColor: { ...accent, h: i % 4 ? 40 : 270 },
          });
        const map = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) =>
          (r + c) % 11 === 0 ? 0 : (r + c) % 13 === 0 ? 8 : 1));
        const unchanged = JSON.stringify({ tiles, map });
        const expected = reference(tiles, map, cols, rows, x, y, zoom).filter(([, dx, dy]) =>
          dx <= 160 && dy <= 100 && dx + 16 * zoom >= 0 && dy + 16 * zoom >= 0);
        expect(draw(ctx, tiles, map, cols, rows, x, y, zoom)).toEqual(expected);
        // Draw calls contain the actual real-sheet RGBA sprite pixels, not IDs.
        expect(JSON.stringify({ tiles, map })).toBe(unchanged);
      });

    it('does no re-derivation or input scanning on unchanged frames, pan or zoom', () => {
      const cols = 64, rows = 64, map = Array.from({ length: rows }, () => Array(cols).fill(1));
      let reads = 0;
      const tiles = new Proxy(Array<CarpetTile | null>(cols * rows).fill({ variant: 0 }), {
        get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); },
      });
      const palette = vi.spyOn(carpetSprites, 'getCarpetPaletteKey');
      const sprite = vi.spyOn(carpetSprites, 'getCarpetSprite');
      const ctx = context(1280, 720);
      draw(ctx, tiles, map, cols, rows, -600, -400, 4);
      const derived = palette.mock.calls.length, colored = sprite.mock.calls.length, scanned = reads;
      for (const zoom of [4, 4, 1, 3]) {
        const calls = draw(ctx, tiles, map, cols, rows, -605, -413, zoom);
        expect(calls.length).toBeLessThanOrEqual((Math.ceil(1280 / (16 * zoom)) + 2) * (Math.ceil(720 / (16 * zoom)) + 2));
        expect(ctx.drawImage).toHaveBeenCalledTimes(1);
      }
      // The only repeated array read is the constant-time length guard.
      expect(reads - scanned).toBe(4);
      expect(palette).toHaveBeenCalledTimes(derived);
      expect(sprite).toHaveBeenCalledTimes(colored);
      palette.mockRestore(); sprite.mockRestore();
    });

    it('draw work is independent of off-screen map area and uses CSS rather than backing-store bounds', () => {
      const ctx = context(1280, 720, 2);
      const counts = [32, 64].map((size) => draw(ctx, Array(size * size).fill({ variant: 0 }),
        Array.from({ length: size }, () => Array(size).fill(1)), size, size, -200, -100, 4).length);
      expect(counts[0]).toBe(counts[1]);
      expect(counts[1]).toBeLessThanOrEqual(22 * 14);
    });

    it('keeps translucent replacement sprites on the exact ordered direct-draw path', () => {
      setCarpetSprites([Array.from({ length: 16 }, () => [['#11111180', '#eeeeee40']])]);
      const ctx = context(), tiles = [{ variant: 0 }, { variant: 0 }], map = [[1, 1]];
      expect(draw(ctx, tiles, map, 2, 1)).toEqual(reference(tiles, map, 2, 1, 0, 0, 1));
      expect(ctx.drawImage.mock.calls.every(call => call[0] instanceof HTMLCanvasElement)).toBe(false);
    });

    it('uses direct draws at fractional device-pixel scales to retain per-sprite sampling', () => {
      const ctx = context(160, 100, 1.25), tiles = [{ variant: 0 }, { variant: 0 }], map = [[1, 1]];
      expect(draw(ctx, tiles, map, 2, 1, 13, 7, 3)).toEqual(reference(tiles, map, 2, 1, 13, 7, 3)
        .filter(([, x, y]) => x <= 160 && y <= 100 && x + 48 >= 0 && y + 48 >= 0));
      expect(ctx.drawImage.mock.calls.every(call => !(call[0] instanceof HTMLCanvasElement))).toBe(true);
    });

    it('short-circuits absent/empty/all-null or fully masked layers and caches the empty result', () => {
      const ctx = context(), map = [[1, 1]];
      for (const tiles of [undefined, [], [null, null], [{ variant: 0 }, { variant: 1 }]]) {
        const floors = tiles?.[0] ? [[0, 8]] : map;
        expect(draw(ctx, tiles, floors, 2, 1)).toEqual([]);
        ctx.getTransform.mockClear();
        expect(draw(ctx, tiles, floors, 2, 1)).toEqual([]);
        expect(ctx.getTransform).not.toHaveBeenCalled();
      }
    });

    it('invalidates for replaced carpets/colors, replaced floor maps, dimensions and asset reload/recovery', () => {
      const ctx = context(), map = [[1, 1]], tiles = [{ variant: 0, color: main, accentColor: accent }, null];
      const first = structuredClone(draw(ctx, tiles, map, 2, 1));
      const changed = [{ variant: 0, color: { ...main, h: 120 }, accentColor: { ...accent, h: 240 } }, null];
      expect(draw(ctx, changed, map, 2, 1)).not.toEqual(first);
      expect(draw(ctx, tiles, [[0, 1]], 2, 1)).toEqual([]);
      expect(draw(ctx, tiles, map, 1, 2)).toEqual(reference(tiles, map, 1, 2, 0, 0, 1));
      setCarpetSprites([]);
      expect(draw(ctx, tiles, map, 2, 1)).toEqual([]);
      setCarpetSprites(sheets);
      expect(draw(ctx, tiles, map, 2, 1)).toEqual(first);
      const alternate = sheets.map(variant => variant.map(sprite => sprite.map(row => row.map(hex => hex ? '#111111' : ''))));
      setCarpetSprites(alternate);
      expect(draw(ctx, tiles, map, 2, 1)).not.toEqual(first);
    });
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
    const mainOnly = getCarpetSprite(0, 1, { ...main, h: 120 }, accent)!;
    const accentOnly = getCarpetSprite(0, 1, main, { ...accent, h: 240 })!;
    original.forEach((row, y) => row.forEach((hex, x) => {
      expect(mainOnly[y][x]).toBe(hex === '#941919' ? '#199419' : hex);
      expect(accentOnly[y][x]).toBe(hex === '#dba35a' ? '#5a5adb' : hex);
    }));
    const translucent = Array.from({ length: 16 }, () => [['#11111180', '#eeeeee40', '']]);
    setCarpetSprites([translucent]);
    expect(getCarpetSprite(0, 15)).toEqual([['#94191980', '#dba35a40', '']]);
    setCarpetSprites([]);
    expect(hasCarpetVariant(0)).toBe(false);
    expect(getCarpetSprite(0, 15)).toBeNull();
  });

  it('draws centered junctions above floors, orders overlapping palettes, and hides carpet on wall/void', () => {
    const ctx = { drawImage: vi.fn(), canvas: { width: 1280, height: 720 }, getTransform: () => ({ a: 1, d: 1 }) };
    const red = { variant: 0, color: main, accentColor: accent, order: 2 };
    const blue = { ...red, color: { ...main, h: 210 }, order: 1 };
    const tiles = [red, blue];
    renderCarpetLayer(ctx as unknown as CanvasRenderingContext2D, tiles, [[1, 1]], 2, 1, 10, 20, 2);
    const calls = recordedDraws(ctx.drawImage.mock.calls);
    expect(calls[0].slice(1)).toEqual([-6, 4]);
    const atShared = calls.filter((call) => call[1] === 26 && call[2] === 4);
    expect(atShared).toHaveLength(2);
    expect(atShared[0][0]).toEqual(getCarpetSprite(0, 4, blue.color, accent));
    expect(atShared[1][0]).toEqual(getCarpetSprite(0, 8, main, accent));
    ctx.drawImage.mockClear();
    renderCarpetLayer(ctx as unknown as CanvasRenderingContext2D, tiles, [[0, 8]], 2, 1, 0, 0, 1);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(tiles).toEqual([red, blue]);
  });
});
