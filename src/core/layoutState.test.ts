import { describe, expect, it } from 'vitest';
import type { LayoutData } from '../types.js';
import { createMinimalLayout, ensureTileColors } from './layoutState.js';

describe('host-neutral layout state', () => {
  it('creates the same renderable 20x15 fallback layout', () => {
    const layout = createMinimalLayout();

    expect(layout).toMatchObject({
      version: 2,
      cols: 20,
      rows: 15,
      furniture: expect.arrayContaining([
        expect.objectContaining({ uid: 'desk-1', col: 4, row: 3 }),
        expect.objectContaining({ uid: 'chair-1', col: 5, row: 5 }),
      ]),
    });
    expect(layout.tiles).toHaveLength(300);
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const isWall = row === 0 || row === layout.rows - 1 || col === 0 || col === layout.cols - 1;
        const index = row * layout.cols + col;
        expect(layout.tiles[index]).toBe(isWall ? 0 : 1);
        expect(layout.tileColors?.[`${col},${row}`]).toEqual(
          isWall ? { h: 20, s: 30, b: -25, c: 0 } : { h: 35, s: 40, b: 15, c: 0 },
        );
      }
    }
  });

  it('fills only missing or empty tile colors using each tile value', () => {
    const layout: LayoutData = {
      version: 2,
      cols: 2,
      rows: 1,
      tiles: [0, 1],
      furniture: [],
    };

    ensureTileColors(layout);
    expect(layout.tileColors).toEqual({
      '0,0': { h: 20, s: 30, b: -25, c: 0 },
      '1,0': { h: 35, s: 40, b: 15, c: 0 },
    });
  });

  it('preserves any existing non-empty tile color map', () => {
    const colors = { '0,0': { h: 100, s: 80, b: 20, c: 0 } };
    const layout: LayoutData = {
      version: 2,
      cols: 1,
      rows: 1,
      tiles: [0],
      furniture: [],
      tileColors: colors,
    };

    ensureTileColors(layout);
    expect(layout.tileColors).toBe(colors);
  });
});
