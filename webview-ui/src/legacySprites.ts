import type { SpriteData } from './office/types.js';
import { Direction } from './office/types.js';
import type { CharacterSprites } from './office/sprites/defaultCharacters.js';

function isSprite(value: unknown): value is SpriteData {
  return Array.isArray(value) && value.length > 0
    && Array.from(value).every((row: unknown) => Array.isArray(row) && row.length > 0
      && row.length === value[0].length && Array.from(row).every((color: unknown) => typeof color === 'string'));
}

export function isRendererTiles(value: unknown): value is SpriteData[] {
  return Array.isArray(value) && value.length > 0 && Array.from(value).every(isSprite);
}

export function isRendererCharacters(value: unknown): value is CharacterSprites[] {
  return Array.isArray(value) && value.length > 0 && Array.from(value).every((character: unknown) => {
    if (typeof character !== 'object' || character === null) return false;
    return ['walk', 'typing', 'reading'].every((state) => {
      if (!(state in character)) return false;
      const frames: unknown = Reflect.get(character, state);
      return typeof frames === 'object' && frames !== null
        && Object.values(Direction).every((direction) => isRendererTiles(Reflect.get(frames, direction)));
    });
  });
}
