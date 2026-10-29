import { describe, expect, it } from 'vitest';
import { getOutlineSprite } from './spriteCache.js';
import type { SpriteData } from '../types.js';

describe('getOutlineSprite', () => {
  it('places all four neighbors of a single opaque pixel inside the padding', () => {
    expect(getOutlineSprite([['#123456']])).toEqual([
      ['', '#ffffff', ''],
      ['#ffffff', '', '#ffffff'],
      ['', '#ffffff', ''],
    ]);
  });

  it.each([
    ['top', 1, 0, 2, 0],
    ['left', 0, 1, 0, 2],
    ['right', 2, 1, 4, 2],
    ['bottom', 1, 2, 2, 4],
  ] as const)('outlines an opaque pixel touching the %s boundary', (_edge, x, y, outlineX, outlineY) => {
    const sprite: SpriteData = Array.from({ length: 3 }, () => ['', '', '']);
    sprite[y][x] = '#123456';
    const outline = getOutlineSprite(sprite);

    expect(outline).toHaveLength(5);
    expect(outline.every(row => row.length === 5)).toBe(true);
    expect(outline[outlineY][outlineX]).toBe('#ffffff');
    expect(outline.flat().filter(color => color === '#ffffff')).toHaveLength(4);
  });

  it('outlines transparent holes without painting over opaque sprite pixels', () => {
    const sprite = [
      ['#123456', '#123456', '#123456'],
      ['#123456', '', '#123456'],
      ['#123456', '#123456', '#123456'],
    ];
    const before = structuredClone(sprite);
    const outline = getOutlineSprite(sprite);

    expect(outline[2][2]).toBe('#ffffff');
    expect(outline[1][1]).toBe('');
    expect(outline[0][0]).toBe('');
    expect(sprite).toEqual(before);
    expect(getOutlineSprite(sprite)).toBe(outline);
  });

  it('keeps a fully transparent sprite transparent', () => {
    expect(getOutlineSprite([['', '']])).toEqual([
      ['', '', '', ''],
      ['', '', '', ''],
      ['', '', '', ''],
    ]);
  });
});
