import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharacter, getCharacterSprite, isReadingTool } from './characters.js';
import { renderScene } from './renderer.js';
import * as assetLoader from '../sprites/assetLoader.js';
import { setCharacterTemplates } from '../sprites/defaultCharacters.js';
import type { CharacterSprites } from '../sprites/defaultCharacters.js';
import { CharacterState, Direction } from '../types.js';
import type { SpriteData } from '../types.js';

const sprite = (color: string): SpriteData =>
  Array.from({ length: 24 }, () => Array(16).fill(color));

function frameSet(image: SpriteData): Record<Direction, SpriteData[]> {
  return {
    [Direction.DOWN]: [image],
    [Direction.LEFT]: [image],
    [Direction.RIGHT]: [image],
    [Direction.UP]: [image],
  };
}

const suppliedSprites: CharacterSprites = {
  walk: frameSet(sprite('#123456')),
  typing: frameSet(sprite('#d14343')),
  reading: frameSet(sprite('#1a8f52')),
};

const sheet = {
  image: {} as CanvasImageSource,
  frameWidth: 32,
  frameHeight: 32,
  framesPerRow: 7,
  rows: 4,
  scale: 2,
  baseWidth: 16,
  baseHeight: 16,
};

describe('reading animation rendering', () => {
  let filledColors: string[];
  let sheetDraws: unknown[][];
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    filledColors = [];
    sheetDraws = [];
    ctx = {
      fillStyle: '',
      fillRect() {
        filledColors.push(String(ctx.fillStyle));
      },
      drawImage(...args: unknown[]) {
        sheetDraws.push(args);
      },
    } as unknown as CanvasRenderingContext2D;
    setCharacterTemplates([suppliedSprites]);
    vi.spyOn(assetLoader, 'areTilesetAssetsReady').mockReturnValue(false);
    vi.spyOn(assetLoader, 'areCharacterAssetsReady').mockReturnValue(true);
  });

  afterEach(() => {
    setCharacterTemplates([]);
    vi.restoreAllMocks();
  });

  it('classifies only explicitly supported reading tool names', () => {
    for (const tool of ['view', 'grep', 'glob', 'web_fetch', 'web_search']) {
      expect(isReadingTool(tool)).toBe(true);
    }
    for (const tool of [undefined, 'Write', 'Task', 'Observed task: reading a file', 'currentTask']) {
      expect(isReadingTool(tool)).toBe(false);
    }
  });

  it('selects supplied reading frames in the inline fallback renderer', () => {
    vi.spyOn(assetLoader, 'getCharacterSheet').mockReturnValue(null);

    const typing = renderCharacter('Bash');
    const reading = renderCharacter('view');

    expect(typing.sheetDraws).toHaveLength(0);
    expect(reading.sheetDraws).toHaveLength(0);
    expect(typing.filledColors).toContain('#d14343');
    expect(reading.filledColors).toContain('#1a8f52');
    expect(reading.filledColors).not.toContain('#d14343');
    expect(reading.filledColors).not.toEqual(typing.filledColors);
  });

  it('uses inline reading frames rather than mislabeling bundled PNG walk frames', () => {
    vi.spyOn(assetLoader, 'getCharacterSheet').mockReturnValue(sheet);

    const typing = renderCharacter('Bash');
    const reading = renderCharacter('view');

    expect(typing.sheetDraws).toHaveLength(1);
    expect(typing.filledColors).toEqual([]);
    expect(reading.sheetDraws).toHaveLength(0);
    expect(reading.filledColors).toContain('#1a8f52');
    expect(reading.filledColors).not.toContain('#d14343');
  });

  it.each([undefined, 'Write', 'Observed task: inspect the repository'])(
    'keeps absent and non-reading metadata on the existing PNG path (%s)',
    (tool) => {
      vi.spyOn(assetLoader, 'getCharacterSheet').mockReturnValue(sheet);

      const rendered = renderCharacter(tool);

      expect(rendered.sheetDraws).toHaveLength(1);
      expect(rendered.filledColors).toEqual([]);
    },
  );

  it('uses supplied reading frames from getCharacterSprite without changing other states', () => {
    const character = createCharacter('fixture', 'Fixture', 'Test', 0, null, null, 0);
    character.state = CharacterState.TYPE;
    character.tool = 'view';
    expect(getCharacterSprite(character, suppliedSprites)).toBe(suppliedSprites.reading[Direction.DOWN][0]);

    character.tool = 'Bash';
    expect(getCharacterSprite(character, suppliedSprites)).toBe(suppliedSprites.typing[Direction.DOWN][0]);

    character.state = CharacterState.IDLE;
    character.tool = 'view';
    expect(getCharacterSprite(character, suppliedSprites)).toBe(suppliedSprites.walk[Direction.DOWN][0]);
  });

  function renderCharacter(tool: string | undefined) {
    filledColors = [];
    sheetDraws = [];
    const character = createCharacter('fixture', 'Fixture', 'Test', 0, null, null, 0);
    character.state = CharacterState.TYPE;
    character.active = true;
    character.tool = tool;
    renderScene(ctx, [], [character], 0, 0, 1, null, null);
    return { filledColors: [...filledColors], sheetDraws: [...sheetDraws] };
  }
});
