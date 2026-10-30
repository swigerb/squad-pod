import { describe, expect, it } from 'vitest';
import type { LayoutData } from '../types.js';
import { createMinimalLayout, ensureTileColors } from './layoutState.js';

describe('host-neutral layout state', () => {
  it('creates the same source-faithful office used by the webview', () => {
    const layout = createMinimalLayout();

    expect(layout).toMatchObject({
      version: 2,
      cols: 21,
      rows: 13,
      furniture: expect.arrayContaining([
        expect.objectContaining({ uid: 'conference-table', type: 'pa_TABLE_FRONT', col: 4, row: 7 }),
        expect.objectContaining({ uid: 'desk-1', type: 'pa_DESK_FRONT', col: 2, row: 3 }),
      ]),
    });
    expect(layout.tiles).toHaveLength(273);
    expect(layout.tiles).toEqual(createMinimalLayout().tiles);
    expect(layout.tileColors).toEqual(createMinimalLayout().tileColors);
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
