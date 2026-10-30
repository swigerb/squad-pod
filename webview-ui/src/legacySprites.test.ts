import { describe, expect, it } from 'vitest';
import { isRendererCharacters, isRendererTiles } from './legacySprites.js';
import { Direction } from './office/types.js';

const sprite = [['#abcdef80', '']];
const frames = Object.fromEntries(Object.values(Direction).map((direction) => [direction, [sprite]]));
const character = { walk: frames, typing: frames, reading: frames };

describe('legacy renderer sprite guards', () => {
  it('accepts complete renderer frames and rejects host packed-pixel tiles and incomplete matrices', () => {
    expect(isRendererTiles([sprite])).toBe(true);
    const hostTile = { width: 2, height: 1, pixels: [0xabcdef80, 0] };
    for (const payload of [null, undefined, {}, [], [hostTile], [null], [[]], [[[]]],
      [[[1]]], [[['#fff'], []]], [[['#fff'], ['#fff', '']]], [sprite, null]]) {
      expect(isRendererTiles(payload)).toBe(false);
    }
  });

  it('requires every character state, direction and nonempty frame without accepting the host schema', () => {
    expect(isRendererCharacters([character])).toBe(true);
    const hostCharacter = { paletteIndex: 0, directions: { down: {
      idle: [{ width: 1, height: 1, pixels: [0xffffffff] }],
      walk: [{ width: 1, height: 1, pixels: [0xffffffff] }],
    } } };
    for (const payload of [null, undefined, {}, [], [hostCharacter], [sprite], [null],
      [{ ...character, reading: undefined }], [{ ...character, walk: {} }],
      [{ ...character, typing: { ...frames, [Direction.UP]: [] } }],
      [{ ...character, reading: { ...frames, [Direction.LEFT]: [[[]]] } }],
      [character, { ...character, walk: null }]]) {
      expect(isRendererCharacters(payload)).toBe(false);
    }
  });
});
