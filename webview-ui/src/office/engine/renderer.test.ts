import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderFrame } from './renderer.js';
import { TileType, type CarpetTile, type FloorColor, type SpriteData } from '../types.js';
import * as assetLoader from '../sprites/assetLoader.js';
import * as spriteCache from '../sprites/spriteCache.js';
import * as tilesetRenderer from '../sprites/tilesetRenderer.js';
import { setFloorSprites } from '../floorTiles.js';
import { setWallSprites } from '../wallTiles.js';
import { setCarpetSprites } from '../sprites/carpetTiles.js';

describe('tile colors are optional rendering overrides', () => {
  const wall: FloorColor = { h: 240, s: 100, b: 0, c: 0 };
  const floor: FloorColor = { h: 120, s: 100, b: 0, c: 0, colorize: true };
  const complete = new Map([['0,0', wall], ['1,0', floor]]);
  const map = [[TileType.WALL, TileType.FLOOR_1, TileType.VOID]];
  let pixels: Array<{ x: number; y: number; color: string }>;
  let sprites: WeakMap<HTMLCanvasElement, SpriteData>;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    pixels = [];
    sprites = new WeakMap();
    setFloorSprites([]);
    setWallSprites([]);
    vi.spyOn(assetLoader, 'areTilesetAssetsReady').mockReturnValue(false);
    vi.spyOn(spriteCache, 'getCachedSprite').mockImplementation((sprite) => {
      const canvas = document.createElement('canvas');
      sprites.set(canvas, sprite);
      return canvas;
    });
    ctx = {
      clearRect: vi.fn(),
      fillStyle: '',
      fillRect(x: number, y: number) {
        pixels.push({ x, y, color: String(ctx.fillStyle) });
      },
      drawImage(canvas: HTMLCanvasElement, x: number, y: number) {
        const sprite = sprites.get(canvas)!;
        expect(sprite).toHaveLength(16);
        expect(sprite.every((row) => row.length === 16 && row.every((p) => p === sprite[0][0]))).toBe(true);
        pixels.push({ x, y, color: sprite[0][0] });
      },
    } as unknown as CanvasRenderingContext2D;
  });

  afterEach(() => {
    setFloorSprites([]);
    setWallSprites([]);
    setCarpetSprites([]);
    vi.restoreAllMocks();
  });

  it.each([
    ['missing', undefined],
    ['empty', new Map<string, FloorColor>()],
    ['partial', new Map([['1,0', floor]])],
    ['complete', complete],
  ] as const)('draws every non-void tile with %s colors without mutating its inputs', (name, colors) => {
    const before = JSON.stringify([map, colors && [...colors]]);
    renderFrame(ctx, 48, 16, map, [], [], 1, 0, 0, null, undefined, colors);
    expect(pixels).toEqual([
      { x: 0, y: 0, color: name === 'complete' ? '#0000ff' : '#53392d' },
      { x: 16, y: 0, color: name === 'complete' || name === 'partial' ? '#01ff01' : '#caac83' },
    ]);
    expect(JSON.stringify([map, colors && [...colors]])).toBe(before);
  });

  it('uses the PNG tileset path even without any tile colors', () => {
    vi.mocked(assetLoader.areTilesetAssetsReady).mockReturnValue(true);
    const draw = vi.spyOn(tilesetRenderer, 'drawTilesetTile').mockReturnValue(true);
    renderFrame(ctx, 48, 16, map, [], [], 1, 0, 0);
    expect(draw.mock.calls.map((call) => call.slice(1))).toEqual([
      [TileType.WALL, 0, 0, 1], [TileType.FLOOR_1, 16, 0, 1],
    ]);
    expect(pixels).toEqual([]);
  });

  it('uses the wall sprite fallback without any tile colors', () => {
    setWallSprites(Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => Array(16).fill('#808080'))));
    renderFrame(ctx, 48, 16, map, [], [], 1, 0, 0);
    expect(pixels).toHaveLength(2);
    expect(spriteCache.getCachedSprite).toHaveBeenCalledTimes(2);
  });

  it('draws carpet above a colorless floor without changing layout or carpet data', () => {
    setCarpetSprites([Array.from({ length: 16 }, () =>
      Array.from({ length: 16 }, () => Array(16).fill('#111111')))]);
    const carpetTiles: Array<CarpetTile | null> = [null, { variant: 0 }, null];
    const layout = { cols: 3, rows: 1, tiles: map.flat(), furniture: [], carpetTiles };
    const before = JSON.stringify(layout);
    const draw = vi.fn();
    ctx.drawImage = draw;
    renderFrame(ctx, 48, 16, map, [], [], 1, 0, 0, null, undefined, undefined,
      3, 1, null, null, null, [], false, carpetTiles);
    // First the floor, then the four junctions around its carpet cell.
    expect(draw.mock.calls.map((call) => call.slice(1))).toEqual([
      [16, 0], [8, -8], [24, -8], [8, 8], [24, 8],
    ]);
    for (const [canvas] of draw.mock.calls.slice(1)) {
      expect(sprites.get(canvas)?.flat()).toContain('#941919');
    }
    expect(JSON.stringify(layout)).toBe(before);
    expect(layout).not.toHaveProperty('tileColors');
  });
});

describe('asset diagnostic banner follows Debug View', () => {
  it.each([undefined, false, true])('draws the chars/tileset strip only when enabled (%s)', (debug) => {
    const canvas = document.createElement('canvas');
    const ctx = {
      canvas, clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      setTransform: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    };
    renderFrame(ctx as unknown as CanvasRenderingContext2D,
      800, 600, [], [], [], 1, 0, 0, null, undefined, undefined,
      0, 0, null, null, null, [], debug);
    if (debug) {
      expect(ctx.fillText).toHaveBeenCalledWith(expect.stringMatching(/^chars:.*tileset:/), expect.any(Number), expect.any(Number));
      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    } else {
      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
    }
  });
});
