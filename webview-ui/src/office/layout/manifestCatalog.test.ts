import { afterEach, describe, expect, it } from 'vitest';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';
import { buildDynamicCatalog, getAssetProblem, getCatalogEntry } from './furnitureCatalog.js';
import { applyFurniturePlace, planFurnitureMove, planFurnitureRotate } from '../editor/editorActions.js';
import { getFurnitureFootprint, layoutToFurnitureInstances, layoutToSeats, createDefaultLayout } from './layoutManager.js';
import { OfficeState } from '../engine/officeState.js';
import { getColorizedFloorSprite, setFloorSprites } from '../floorTiles.js';
import { getColorizedWallSprite, setWallSprites } from '../wallTiles.js';
import type { OfficeLayout } from '../types.js';

const desk: ManifestFurniture = {
  type: 'pa_DESK_FRONT', label: 'Desk fixture', width: 3, height: 2,
  sprite: Array.from({ length: 32 }, () => Array<string>(48).fill('#abc12380')),
  isDesk: true, category: 'desks', canPlaceOnSurfaces: false, canPlaceOnWalls: false,
};
const empty = (): OfficeLayout => ({ version: 2, cols: 12, rows: 11, tiles: Array(132).fill(1), furniture: [] });

describe('manifest catalog and non-destructive reload', () => {
  afterEach(() => { buildDynamicCatalog([]); setFloorSprites([]); setWallSprites([]); });

  it('keeps the old 2x1 desk and unknown IDs unchanged while new desks have validated 3x2 geometry', () => {
    buildDynamicCatalog([desk]);
    const layout = empty();
    layout.furniture = [
      { uid: 'old', type: 'desk', col: 2, row: 2, rotation: 0 },
      { uid: 'neighbor', type: 'old_unknown_id', col: 4, row: 2, rotation: 90 },
    ];
    const before = JSON.stringify(layout);
    const office = new OfficeState(layout);
    office.refreshAssets();
    expect(JSON.stringify(office.getLayout())).toBe(before);
    expect(getCatalogEntry('desk')).toMatchObject({ width: 2, height: 1 });
    expect(getFurnitureFootprint(layout.furniture[0])).toEqual({ width: 2, height: 1 });
    expect(getFurnitureFootprint(layout.furniture[1])).toBeUndefined();
    expect(office.furniture.map((f) => f.uid)).toEqual(['old', 'neighbor']);
    expect(getAssetProblem(layout.furniture[1])).toContain('Unavailable');
    expect(applyFurniturePlace(layout, desk.type, 7, 4)).toBe(layout);
  });

  it('rejects new overlaps/off-grid placements and records exact dimensions on successful placement/copy/rotate', () => {
    buildDynamicCatalog([desk]);
    let layout = applyFurniturePlace(empty(), desk.type, 2, 2);
    expect(layout.furniture[0].assetFootprint).toEqual({ width: 3, height: 2 });
    expect(applyFurniturePlace(layout, desk.type, 4, 3)).toBe(layout);
    expect(applyFurniturePlace(layout, desk.type, 10, 2)).toBe(layout);
    expect(planFurnitureMove(layout, layout.furniture[0].uid, 10, 2).error).toContain('grid');
    const rotated = planFurnitureRotate(layout, layout.furniture[0].uid);
    expect(rotated.error).toBeNull();
    expect(getFurnitureFootprint(rotated.items[0])).toEqual({ width: 2, height: 3 });
    layout = applyFurniturePlace(layout, desk.type, 6, 2);
    expect(layout.furniture).toHaveLength(2);
  });

  it('retains saved footprints across removal, changed dimensions and reload in a fresh office instance', () => {
    buildDynamicCatalog([desk]);
    const layout = applyFurniturePlace(empty(), desk.type, 2, 2);
    const before = JSON.stringify(layout);
    const office = new OfficeState(layout);
    office.addAgent('test-agent-1', 'Test Agent', 'Test role', 0);
    const character = office.characters.get('test-agent-1')!;
    const position = [character.col, character.row, character.x, character.y];
    buildDynamicCatalog([{ ...desk, width: 5, sprite: Array.from({ length: 32 }, () => Array<string>(80).fill('#ffffff')) }]);
    office.refreshAssets();
    expect(office.furniture[0]).toMatchObject({ width: 3, height: 2 });
    expect(office.furniture[0].sprite[0]).toHaveLength(48);
    expect(getAssetProblem(layout.furniture[0])).toContain('Changed footprint');
    expect([character.col, character.row, character.x, character.y]).toEqual(position);
    expect(JSON.stringify(office.getLayout())).toBe(before);
    buildDynamicCatalog([]);
    office.refreshAssets();
    expect(office.furniture[0]).toMatchObject({ width: 3, height: 2 });
    expect(getAssetProblem(layout.furniture[0])).toContain('Unavailable');
    buildDynamicCatalog([desk]);
    const restored = new OfficeState(JSON.parse(before));
    expect(restored.furniture[0].sprite).toBe(desk.sprite);
    expect(getAssetProblem(restored.layout.furniture[0])).toBeNull();
  });

  it('does not adopt dimensions for previously unknown dynamic IDs without an explicit footprint', () => {
    buildDynamicCatalog([desk]);
    const item = { uid: 'unknown', type: desk.type, col: 2, row: 2, rotation: 0 };
    expect(getFurnitureFootprint(item)).toBeUndefined();
    expect(layoutToFurnitureInstances([item])[0]).toMatchObject({ width: 1, height: 1 });
    expect(getAssetProblem(item)).toContain('Unconfirmed');
  });

  it('uses the verified starter only for fresh offices and retains seat assignments across catalog refresh', () => {
    const chair = { ...desk, type: 'pa_CUSHIONED_CHAIR_FRONT', width: 1, height: 1, isDesk: false, category: 'chairs' };
    buildDynamicCatalog([desk, chair]);
    const layout = createDefaultLayout();
    expect(layoutToSeats(layout.furniture)).toHaveLength(6);
    expect(layout.furniture.every((f) => f.col >= 0 && f.row >= 0
      && f.col + f.assetFootprint!.width <= layout.cols
      && f.row + f.assetFootprint!.height <= layout.rows)).toBe(true);
    const office = new OfficeState(layout);
    office.addAgent('test-agent-1', 'Test Agent', 'Test role', 0, 0, 'chair-left-1');
    const before = JSON.stringify(office.getLayout());
    const assignments = office.getSeatAssignments();
    buildDynamicCatalog([]);
    office.refreshAssets();
    expect(office.seats).toHaveLength(6);
    expect(office.seats.find((seat) => seat.id === 'chair-left-1')?.occupant).toBe('test-agent-1');
    expect(office.getSeatAssignments()).toEqual(assignments);
    expect(JSON.stringify(office.getLayout())).toBe(before);
    expect(new OfficeState(JSON.parse(before)).seats).toHaveLength(6);
  });

  it('invalidates colorized floor/wall caches and preserves alpha on refreshed sprites', () => {
    const color = { h: 0, s: 0, b: 0, c: 0 };
    setFloorSprites([[['#abcdef80']]]);
    const old = getColorizedFloorSprite(0, color);
    expect(old[0][0]).toHaveLength(9);
    expect(old[0][0].slice(-2)).toBe('80');
    setFloorSprites([[['#12345640']]]);
    const next = getColorizedFloorSprite(0, color);
    expect(next).not.toBe(old);
    expect(next[0][0].slice(-2)).toBe('40');
    setWallSprites(Array.from({ length: 16 }, () => [['#abcdef80']]));
    const wall = getColorizedWallSprite([0], 1, 1, 0, 0, { ...color, colorize: true });
    expect(wall.sprite[0][0].slice(-2)).toBe('80');
    setWallSprites(Array.from({ length: 16 }, () => [['#12345640']]));
    expect(getColorizedWallSprite([0], 1, 1, 0, 0, color).sprite).not.toBe(wall.sprite);
  });
});
