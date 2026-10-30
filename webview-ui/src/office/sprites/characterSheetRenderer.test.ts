import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { CharacterSheetData } from './assetLoader.js';
import { Direction } from '../types.js';
import { CharacterState } from '../types.js';
import { createCharacter } from '../engine/characters.js';
import { EMBEDDED_CHARACTERS } from './embeddedCharacters.js';

const pixelAgentsSheet: CharacterSheetData = {
  image: { source: 'pixel-agents' } as unknown as CanvasImageSource,
  layout: 'pixel-agents',
  frameWidth: 16,
  frameHeight: 32,
  framesPerRow: 7,
  rows: 3,
  scale: 1,
  baseWidth: 16,
  baseHeight: 32,
};

const legacySheet: CharacterSheetData = {
  image: { source: 'legacy' } as unknown as CanvasImageSource,
  layout: 'legacy',
  frameWidth: 32,
  frameHeight: 32,
  framesPerRow: 7,
  rows: 4,
  scale: 2,
  baseWidth: 16,
  baseHeight: 16,
};

describe('character sheet rendering', () => {
  let renderer: typeof import('./characterSheetRenderer.js');
  let drawImage: ReturnType<typeof vi.fn>;
  let translate: ReturnType<typeof vi.fn>;
  let scale: ReturnType<typeof vi.fn>;
  let ctx: CanvasRenderingContext2D;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      putImageData: vi.fn(),
    }) as unknown as CanvasRenderingContext2D);
    const assets = await import('./assetLoader.js');
    vi.spyOn(assets, 'getCharacterSheet').mockImplementation((key) =>
      key.startsWith('builtin:') ? pixelAgentsSheet : key.startsWith('external:') ? legacySheet : null,
    );
    renderer = await import('./characterSheetRenderer.js');
    drawImage = vi.fn();
    translate = vi.fn();
    scale = vi.fn();
    ctx = {
      imageSmoothingEnabled: true,
      filter: 'none',
      globalAlpha: 1,
      drawImage,
      translate,
      scale,
      save: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses six complete 112x96 source atlases with visible pixels in every authored cell', () => {
    for (let index = 0; index < 6; index++) {
      const file = join(process.cwd(), 'public', 'assets', 'characters', `char_${index}.png`);
      const png = PNG.sync.read(readFileSync(file));
      expect([png.width, png.height]).toEqual([112, 96]);
      const embedded = EMBEDDED_CHARACTERS.find((sheet) => sheet.id === `char_${index}`);
      expect(embedded).toMatchObject({ width: 112, height: 96, layout: 'pixel-agents' });
      expect(Buffer.from(embedded?.rgbaBase64 ?? '', 'base64')).toEqual(png.data);

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 7; col++) {
          let opaquePixels = 0;
          let minX = 16;
          let minY = 32;
          let maxX = -1;
          let maxY = -1;
          for (let y = row * 32; y < (row + 1) * 32; y++) {
            for (let x = col * 16; x < (col + 1) * 16; x++) {
              if (png.data[(y * png.width + x) * 4 + 3] === 0) continue;
              opaquePixels++;
              minX = Math.min(minX, x - col * 16);
              minY = Math.min(minY, y - row * 32);
              maxX = Math.max(maxX, x - col * 16);
              maxY = Math.max(maxY, y - row * 32);
            }
          }
          expect(opaquePixels, `char_${index} row ${row} frame ${col} must not be blank`).toBeGreaterThan(200);
          expect(minX).toBeGreaterThanOrEqual(0);
          expect(minY).toBeGreaterThanOrEqual(0);
          expect(maxX).toBeLessThan(16);
          expect(maxY).toBeLessThan(32);
        }
      }
    }
  });

  it.each([
    ['down', Direction.DOWN, 0],
    ['up', Direction.UP, 1],
    ['right', Direction.RIGHT, 2],
    ['left', Direction.LEFT, 2],
  ] as const)('maps every built-in pose and mirrors its left-facing row (%s)', (_name, direction, row) => {
    const sequences = [
      { animation: 'walk' as const, frames: [0, 1, 2, 1] },
      { animation: 'typing' as const, frames: [3, 4] },
      { animation: 'reading' as const, frames: [5, 6] },
    ];

    for (const palette of [0, 1, 2, 3, 4, 5]) {
      for (const { animation, frames } of sequences) {
        for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
          drawImage.mockClear();
          expect(renderer.drawCharacterFromSheet(
            ctx, palette, direction, frameIndex, 40, 50, 2, 0, animation,
          )).toBe(true);
          const expected = frames[frameIndex];
          expect(drawImage).toHaveBeenCalledWith(
            pixelAgentsSheet.image,
            expected * 16, row * 32, 16, 32,
            direction === Direction.LEFT ? 0 : 40,
            direction === Direction.LEFT ? 0 : 50,
            32, 64,
          );
          if (direction === Direction.LEFT) {
            expect(translate).toHaveBeenCalledWith(72, 50);
            expect(scale).toHaveBeenCalledWith(-1, 1);
          }
        }
      }
    }
  });

  it('anchors 16x32 built-ins at their feet while retaining legacy 16x16 external geometry', () => {
    expect(renderer.getCharacterSheetFrameSize(0)).toEqual({ width: 16, height: 32 });
    expect(renderer.getCharacterSheetAnchorOffset(0)).toEqual({ dx: -8, dy: -32 });
    expect(renderer.sheetAppearance(0)).toEqual({ sheetKey: 'builtin:0', hueDegrees: 0 });
    expect(renderer.sheetAppearance(5)).toEqual({ sheetKey: 'builtin:5', hueDegrees: 0 });
    expect(renderer.sheetAppearance(6)).toEqual({ sheetKey: 'builtin:0', hueDegrees: 45 });
    expect(renderer.getCharacterSheetFrameSize(48 * 0x1000000, 'walk')).toEqual({ width: 16, height: 16 });
    expect(renderer.getCharacterSheetAnchorOffset(48 * 0x1000000, 'walk')).toEqual({ dx: -8, dy: -8 });
    expect(renderer.getCharacterSheetFrameSize(48 * 0x1000000, 'reading')).toBeNull();
  });

  it('preserves the external 4-row direction and frame mapping', () => {
    const externalPalette = 48 * 0x1000000;
    for (const [direction, row] of [
      [Direction.UP, 0],
      [Direction.RIGHT, 1],
      [Direction.DOWN, 2],
      [Direction.LEFT, 3],
    ] as const) {
      drawImage.mockClear();
      expect(renderer.drawCharacterFromSheet(
        ctx, externalPalette, direction, 3, 10, 20, 2, 0, 'walk',
      )).toBe(true);
      expect(drawImage).toHaveBeenCalledWith(
        legacySheet.image, 96, row * 32, 32, 32, 10, 20, 32, 32,
      );
    }

    drawImage.mockClear();
    expect(renderer.drawCharacterFromSheet(
      ctx, externalPalette, Direction.DOWN, 0, 10, 20, 2, 0, 'reading',
    )).toBe(false);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('uses the same 16x32 feet bounds for seated rendering, selection outline, and furniture occlusion', async () => {
    const sceneRenderer = await import('../engine/renderer.js');
    const spriteCache = await import('./spriteCache.js');
    const furnitureCanvas = { source: 'furniture' } as unknown as HTMLCanvasElement;
    vi.spyOn(spriteCache, 'getCachedSprite').mockReturnValue(furnitureCanvas);
    vi.spyOn(spriteCache, 'getOutlineSprite').mockImplementation((sprite) => sprite);

    const character = createCharacter('fixture', 'Fixture', 'Dev', 0, null, null, 0);
    character.x = 40;
    character.y = 56;
    character.state = CharacterState.TYPE;
    character.direction = Direction.LEFT;
    character.frameIndex = 1;
    const furniture = {
      uid: 'front-desk',
      type: 'desk',
      col: 0,
      row: 4,
      width: 1,
      height: 1,
      sprite: Array.from({ length: 16 }, () => Array(16).fill('#654321')),
      rotation: 0,
    };

    sceneRenderer.renderScene(
      ctx, [furniture], [character], 10, 20, 2, 'fixture', null,
    );

    expect(translate).toHaveBeenCalledWith(106, 80);
    expect(drawImage).toHaveBeenCalledWith(
      pixelAgentsSheet.image, 64, 64, 16, 32, 0, 0, 32, 64,
    );
    expect(drawImage).toHaveBeenCalledTimes(6);
    expect(drawImage.mock.calls.slice(0, 5).every(([image]) => image === pixelAgentsSheet.image)).toBe(true);
    expect(drawImage.mock.calls[5]).toEqual([furnitureCanvas, 10, 148]);
  });
});
