import { afterEach, describe, expect, it } from 'vitest';
import { FLOOR_PATTERNS, getFloorPatternIndex, createFloorAssets } from './floorTiles.js';
import { TileType } from './types.js';
import { isWalkable, findPath } from './engine/pathfinding.js';
import { applyTilePaint, applyFurniturePlace } from './editor/editorActions.js';
import { deserializeLayout, serializeLayout } from './layout/layoutManager.js';
import { isValidLayout } from '../../../src/layoutValidation.js';
import type { OfficeLayout } from './types.js';
import { OfficeState } from './engine/officeState.js';
import { colorizeTileSprite, TILE_RECOLOR_CACHE_LIMIT, getColorizedSprite, clearColorizeCache } from './colorize.js';

const expected = [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [9, 8], [10, 7]];

describe('persisted floor IDs and bundled source sheets', () => {
  const { getFloorSprite, setFloorSprites } = createFloorAssets();
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
      expect(getFloorSprite(getFloorPatternIndex(type))).toEqual(sprites[source]);
      expect(getFloorSprite(getFloorPatternIndex(type))).not.toBe(sprites[source]);
    }
  });

  describe('owned floor and wall sheets and recolor caches', () => {
    it.each([false, true])('isolates equal revisions, caller aliases, reload and clear (colorize=%s)', colorize => {
      const a = new OfficeState(), b = new OfficeState();
      const color = { h: 40, s: 30, b: -10, c: 10, colorize };
      const source = [[['#20406080', '']]];
      for (const office of [a, b]) {
        office.floorAssets.setFloorSprites(source);
        office.wallAssets.setWallSprites(Array(16).fill(source[0]));
        office.carpetAssets.setCarpetSprites([Array(16).fill(source[0])]);
      }
      source[0][0][0] = '#ffffff';
      a.floorAssets.getFloorSprite(0)[0][0] = '#80402040';
      a.wallAssets.getWallSprite([0], 1, 1, 0, 0).sprite[0][0] = '#80402040';
      expect(b.floorAssets.getFloorSprite(0)[0][0]).toBe('#20406080');
      expect(b.wallAssets.getWallSprite([0], 1, 1, 0, 0).sprite[0][0]).toBe('#20406080');
      const floorB = b.floorAssets.getColorizedFloorSprite(0, color);
      const wallB = b.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, color).sprite;
      const carpetB = b.carpetAssets.getCarpetSprite(0, 4);
      expect(floorB).toEqual(colorizeTileSprite([['#20406080', '']], color));
      expect(a.floorAssets.getColorizedFloorSprite(0, color)).not.toEqual(floorB);
      expect(a.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, color).sprite).not.toEqual(wallB);
      expect(a.floorAssets.revision).toBe(b.floorAssets.revision);
      expect(a.wallAssets.revision).toBe(b.wallAssets.revision);
      for (const sheets of [[[['#123456']]], []]) {
        a.floorAssets.setFloorSprites(sheets);
        a.wallAssets.setWallSprites(sheets.length ? Array(16).fill(sheets[0]) : []);
        expect(b.floorAssets.revision).toBe(1);
        expect(b.wallAssets.revision).toBe(1);
        expect(b.carpetAssets.revision).toBe(1);
        expect(b.floorAssets.getColorizedFloorSprite(0, color)).toBe(floorB);
        expect(b.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, color).sprite).toBe(wallB);
        expect(b.carpetAssets.getCarpetSprite(0, 4)).toBe(carpetB);
      }
      clearColorizeCache();
      expect(b.floorAssets.getColorizedFloorSprite(0, color)).toBe(floorB);
      expect(b.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, color).sprite).toBe(wallB);
    });

    it('owns default fallback arrays and retains missing-wall and neutral-color behavior', () => {
      const a = new OfficeState(), b = new OfficeState();
      const fallback = a.floorAssets.getFloorSprite(-1);
      fallback[0][0] = '#ffffff';
      expect(fallback[1][0]).toBe('#808080');
      expect(b.floorAssets.getFloorSprite(-1)[0][0]).toBe('#808080');
      expect(b.wallAssets.getWallSprite([0], 1, 1, 0, 0)).toEqual({ sprite: [[]], offsetY: 0 });
      expect(b.wallAssets.getWallInstances([0], 1, 1, { h: 0, s: 0, b: 0, c: 0 })).toEqual([]);
    });

    it.each([false, true])('evicts both owned caches at their bound without clearing peers or furniture (%s)', colorize => {
      const a = new OfficeState(), b = new OfficeState();
      const color = { h: 0, s: 30, b: 0, c: 0, colorize };
      for (const office of [a, b]) {
        office.floorAssets.setFloorSprites([[['#80402080']]]);
        office.wallAssets.setWallSprites(Array.from({ length: 16 }, () => [['#80402080']]));
      }
      const floor = a.floorAssets.getColorizedFloorSprite(0, color);
      const wall = a.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, color).sprite;
      const peer = b.floorAssets.getColorizedFloorSprite(0, color);
      const furniture = getColorizedSprite('owned-surface-furniture', [['#112233']], color);
      for (let i = 1; i < TILE_RECOLOR_CACHE_LIMIT; i++) {
        const next = { ...color, b: i / 100 };
        a.floorAssets.getColorizedFloorSprite(0, next);
        a.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, next);
      }
      expect(a.floorAssets.getColorizedFloorSprite(0, color)).toBe(floor);
      expect(a.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, color).sprite).toBe(wall);
      const extra = { ...color, b: 99 };
      a.floorAssets.getColorizedFloorSprite(0, extra);
      a.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, extra);
      expect(a.floorAssets.getColorizedFloorSprite(0, color)).not.toBe(floor);
      expect(a.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, color).sprite).not.toBe(wall);
      expect(b.floorAssets.getColorizedFloorSprite(0, color)).toBe(peer);
      a.floorAssets.setFloorSprites([]);
      a.wallAssets.setWallSprites([]);
      expect(getColorizedSprite('owned-surface-furniture', [], color)).toBe(furniture);
    });
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
