import { describe, it, expect } from 'vitest';
import { isValidCarpetLayer, isValidCarpetTile } from './carpetValidation.js';
import { parseLayoutJson } from './layoutPersistence.js';

const color = { h: 360, s: 100, b: -100, c: 100, colorize: true };

describe('optional carpet layout contract', () => {
  it('migrates old layouts and retains carpet colors/order and unknown metadata', () => {
    const old = { version: 2, cols: 2, rows: 1, tiles: [1, 0], furniture: [], custom: { keep: true } };
    expect(parseLayoutJson(JSON.stringify(old))).toEqual({ ...old, pets: [] });
    expect(parseLayoutJson(JSON.stringify(old))).not.toHaveProperty('carpetTiles');
    const layout = { ...old, carpetTiles: [{ variant: 2, color, accentColor: { ...color, b: 100 }, order: 4 }, null] };
    expect(parseLayoutJson(JSON.stringify(layout))).toEqual({ ...layout, pets: [] });
    expect(isValidCarpetTile({ variant: 0 })).toBe(true);
    expect(isValidCarpetTile({ variant: 1 })).toBe(true);
  });

  it.each([
    null, {}, [], [null], [null, null, null], [{ variant: -1 }, null],
    [{ variant: 3 }, null], [{ variant: 1.5 }, null], [false, null],
    [{ variant: 0, color: null }, null], [{ variant: 0, color: {} }, null],
    [{ variant: 0, color: { ...color, h: 361 } }, null],
    [{ variant: 0, color: { ...color, s: -1 } }, null],
    [{ variant: 0, accentColor: { ...color, b: 101 } }, null],
    [{ variant: 0, color: { ...color, c: -101 } }, null],
    [{ variant: 0, color: { ...color, colorize: 'true' } }, null],
    [{ variant: 0, order: -1 }, null], [{ variant: 0, order: 0.1 }, null],
  ])('rejects malformed carpet data rather than stripping or resetting it: %j', (carpetTiles) => {
    expect(isValidCarpetLayer(carpetTiles, 2)).toBe(false);
    expect(parseLayoutJson(JSON.stringify({ version: 2, cols: 2, rows: 1, tiles: [1, 1], furniture: [], carpetTiles }))).toBeNull();
  });

  it('rejects non-finite color/order values before JSON serialization', () => {
    for (const n of [NaN, Infinity, -Infinity]) {
      expect(isValidCarpetTile({ variant: 0, color: { ...color, h: n } })).toBe(false);
      expect(isValidCarpetTile({ variant: 0, order: n })).toBe(false);
    }
  });
});
