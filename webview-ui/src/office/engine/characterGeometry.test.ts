import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharacter } from './characters.js';
import { EXTERNAL_CHARACTER_BASE } from './agentSync.js';
import { CharacterState } from '../types.js';
import type { CharacterSheetData } from '../sprites/assetLoader.js';

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

describe('shared character screen geometry', () => {
  let getCharacterScreenBounds: typeof import('./characterGeometry.js').getCharacterScreenBounds;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      putImageData: vi.fn(),
    }) as unknown as CanvasRenderingContext2D);
    const assets = await import('../sprites/assetLoader.js');
    vi.spyOn(assets, 'getCharacterSheet').mockImplementation((key) =>
      key.startsWith('builtin:') ? pixelAgentsSheet : key.startsWith('external:') ? legacySheet : null,
    );
    ({ getCharacterScreenBounds } = await import('./characterGeometry.js'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps interpolated 16x32 walking hits aligned with the feet anchor at zoom', () => {
    const character = createCharacter('fixture', 'Fixture', 'Dev', 0, null, null, 0);
    character.state = CharacterState.WALK;
    character.col = 2;
    character.row = 3;
    character.x = 40;
    character.y = 56;
    character.path = [{ col: 3, row: 3 }];
    character.moveProgress = 0.25;

    expect(getCharacterScreenBounds(character, 2, { x: 10, y: 20 })).toEqual({
      left: 82,
      right: 114,
      top: 68,
      bottom: 132,
    });
  });

  it('extends the seated hit box to include the 6px sitting offset', () => {
    const character = createCharacter('fixture', 'Fixture', 'Dev', 0, null, null, 0);
    character.state = CharacterState.TYPE;
    character.x = 40;
    character.y = 56;

    expect(getCharacterScreenBounds(character, 2, { x: 10, y: 20 })).toEqual({
      left: 74,
      right: 106,
      top: 80,
      bottom: 144,
    });
  });

  it('uses legacy tile-bottom geometry and inline reading fallback for external sheets', () => {
    const externalPalette = EXTERNAL_CHARACTER_BASE;
    const character = createCharacter('fixture', 'Fixture', 'Dev', externalPalette, null, null, 0);
    character.x = 40;
    character.y = 56;
    expect(getCharacterScreenBounds(character, 2, { x: 10, y: 20 })).toEqual({
      left: 74,
      right: 106,
      top: 116,
      bottom: 148,
    });

    character.state = CharacterState.TYPE;
    character.tool = 'view';
    expect(getCharacterScreenBounds(character, 2, { x: 10, y: 20 })).toEqual({
      left: 74,
      right: 106,
      top: 112,
      bottom: 160,
    });
  });
});
