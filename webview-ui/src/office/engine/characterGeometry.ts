import { CHARACTER_HIT_HALF_WIDTH, CHARACTER_HIT_HEIGHT, CHARACTER_SITTING_OFFSET_PX } from '../../constants.js';
import { getCharacterAnimation, getCharacterSprite, getCharacterWorldPosition } from './characters.js';
import { getCharacterSprites } from '../sprites/defaultCharacters.js';
import { getCharacterSheetFrameSize, getCharacterSheetLayout } from '../sprites/characterSheetRenderer.js';
import { CharacterState, TILE_SIZE } from '../types.js';
import type { Character } from '../types.js';

export interface CharacterScreenBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Match hit testing and overlays to the exact rendered frame and anchor. */
export function getCharacterScreenBounds(
  character: Character,
  zoom: number,
  pan: { x: number; y: number },
): CharacterScreenBounds {
  const animation = getCharacterAnimation(character);
  const frameSize = getCharacterSheetFrameSize(character.palette, animation);
  const fallback = frameSize ? null : getCharacterSprite(
    character,
    getCharacterSprites(character.palette, character.hueShift),
  );
  const width = frameSize?.width ?? fallback?.[0]?.length ?? CHARACTER_HIT_HALF_WIDTH * 2;
  const height = frameSize?.height ?? fallback?.length ?? CHARACTER_HIT_HEIGHT;
  const position = getCharacterWorldPosition(character);
  const layout = getCharacterSheetLayout(character.palette);
  const sittingOffset = character.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
  const anchorY = position.y + sittingOffset + (layout === 'pixel-agents' ? 0 : TILE_SIZE / 2);

  return {
    left: (position.x - width / 2) * zoom + pan.x,
    right: (position.x + width / 2) * zoom + pan.x,
    top: (anchorY - height) * zoom + pan.y,
    bottom: anchorY * zoom + pan.y,
  };
}
