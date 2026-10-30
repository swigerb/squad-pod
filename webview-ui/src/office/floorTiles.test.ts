import { afterEach, describe, expect, it } from 'vitest';
import { FLOOR_PATTERNS, getFloorPatternIndex, getFloorSprite, setFloorSprites } from './floorTiles.js';
import { TileType } from './types.js';
import { isWalkable, findPath } from './engine/pathfinding.js';
import { applyTilePaint, applyFurniturePlace } from './editor/editorActions.js';
import { deserializeLayout, serializeLayout } from './layout/layoutManager.js';
import { isValidLayout } from '../../../src/layoutValidation.js';
import type { OfficeLayout } from './types.js';

const expected = [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [9, 8], [10, 7]];

describe('persisted floor IDs and bundled source sheets', () => {
  afterEach(() => setFloorSprites([]));

  it('exposes every sheet exactly once without reinterpreting legacy IDs', () => {
    expect(FLOOR_PATTERNS.map(({ type, patternIndex }) => [type, patternIndex])).toEqual(expected);
    expect(FLOOR_PATTERNS.map(({ patternIndex }) => patternIndex).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(TileType.VOID).toBe(8);
    expect(getFloorPatternIndex(TileType.VOID)).toBe(-1);
    expect(getFloorPatternIndex(TileType.WALL)).toBe(-1);
    const sprites = Array.from({ length: 9 }, (_, i) => [[`#${i}${i}${i}${i}${i}${i}`]]);
    setFloorSprites(sprites);
    for (const [type, source] of expected) {
      expect(getFloorPatternIndex(type)).toBe(source);
      expect(getFloorSprite(getFloorPatternIndex(type))).toBe(sprites[source]);
    }
  });

  it.each(expected)('keeps floor %i walkable and serializable (sheet %i)', (type) => {
    const layout: OfficeLayout = {
      version: 2, cols: 3, rows: 1, tiles: [type, type, 8], furniture: [],
      areas: [{ label: 'Test Area', color: '#123456' }],
      areaTiles: ['Test Area', null, null], areaMappings: { 'test-directory': ['Test Area'] },
      carpetTiles: [{ variant: 0 }, null, null],
    };
    const before = JSON.stringify(layout);
    expect(isValidLayout(layout)).toBe(true);
    expect(deserializeLayout(serializeLayout(layout))).toEqual(layout);
    expect(isWalkable(0, 0, [layout.tiles], new Set())).toBe(true);
    expect(isWalkable(2, 0, [layout.tiles], new Set())).toBe(false);
    expect(findPath(0, 0, 1, 0, [layout.tiles], new Set())).toEqual([{ col: 1, row: 0 }]);
    expect(findPath(0, 0, 2, 0, [layout.tiles], new Set())).toEqual([]);
    expect(applyFurniturePlace(layout, 'chair', 1, 0).furniture).toHaveLength(1);
    expect(applyFurniturePlace(layout, 'chair', 2, 0)).toBe(layout);
    const painted = applyTilePaint(layout, 0, 0, TileType.FLOOR_10, { h: 0, s: 0, b: 0, c: 0 });
    expect(painted.tiles).toEqual([10, type, 8]);
    expect(painted.carpetTiles).toEqual(layout.carpetTiles);
    expect(painted.areaTiles).toEqual(layout.areaTiles);
    expect(painted.areaMappings).toEqual(layout.areaMappings);
    expect(JSON.stringify(layout)).toBe(before);
  });
});
