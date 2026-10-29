import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfficeLayout, PlacedFurniture } from '../types.js';
import { TileType } from '../types.js';
import { commitFurniturePlan, getSurfaceRiders, planFurnitureMove, planFurnitureRotate } from './editorActions.js';
import * as catalog from '../layout/furnitureCatalog.js';

function layout(): OfficeLayout {
  return {
    version: 2, cols: 12, rows: 10, tiles: Array(120).fill(TileType.FLOOR_1),
    tileColors: { '0,0': { h: 12, s: 30, b: 0, c: 0 } },
    furniture: [
      { uid: 'desk', type: 'desk', col: 2, row: 2, rotation: 0, color: { h: 40, s: 50, b: 5, c: 10 } },
      { uid: 'pc', type: 'pc', col: 3, row: 2, rotation: 0, state: 'on' },
      { uid: 'other', type: 'chair', col: 8, row: 7, rotation: 0 },
    ],
  };
}

describe('atomic furniture transforms', () => {
  afterEach(() => vi.restoreAllMocks());

  it('moves a desk and its surface riders by the same delta without mutating input', () => {
    const source = layout();
    const before = structuredClone(source);
    const plan = planFurnitureMove(source, 'desk', 4, 5);
    expect(plan.error).toBeNull();
    expect(plan.items.map((f) => [f.uid, f.col, f.row])).toEqual([['desk', 4, 5], ['pc', 5, 5]]);
    const result = commitFurniturePlan(source, plan)!;
    expect(source).toEqual(before);
    expect(result.layout.furniture[2]).toBe(source.furniture[2]);
    expect(result.layout.tileColors).toEqual(source.tileColors);
    expect(result.layout.version).toBe(2);
    expect(result.layout.furniture[0].color).toEqual(source.furniture[0].color);
  });

  it('copies complete groups with unique IDs even if the ID generator collides', () => {
    const source = layout();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000');
    let result = commitFurniturePlan(source, planFurnitureMove(source, 'desk', 5, 2, true), true)!;
    result = commitFurniturePlan(result.layout, planFurnitureMove(result.layout, 'desk', 5, 5, true), true)!;
    expect(new Set(result.layout.furniture.map((f) => f.uid)).size).toBe(7);
    expect(result.layout.furniture.slice(0, 3)).toEqual(source.furniture);
    expect(result.layout.furniture.slice(3).map((f) => [f.type, f.col, f.row])).toEqual([
      ['desk', 5, 2], ['pc', 6, 2], ['desk', 5, 5], ['pc', 6, 5],
    ]);
    expect(result.selectedUid).toBe(result.layout.furniture[5].uid);
    expect(result.layout.furniture[3].color).toEqual(source.furniture[0].color);
    expect(result.layout.furniture[3].color).not.toBe(source.furniture[0].color);
    expect(result.layout.furniture[4]).not.toHaveProperty('color');
    expect(result.layout.furniture[4].state).toBe('on');
    expect(getSurfaceRiders(result.layout, result.selectedUid).map((f) => f.uid)).toEqual([result.layout.furniture[6].uid]);
  });

  it('moves a PC independently without carrying its desk', () => {
    const source = layout();
    const result = commitFurniturePlan(source, planFurnitureMove(source, 'pc', 2, 2))!;
    expect(result.layout.furniture[0]).toBe(source.furniture[0]);
    expect(result.layout.furniture[1]).toMatchObject({ uid: 'pc', col: 2, row: 2 });
  });

  it('carries lamps too, with stable ownership when a rider overlaps multiple desks', () => {
    const source = layout();
    source.furniture.push(
      { uid: 'lamp', type: 'lamp', col: 2, row: 2, rotation: 0 },
      { uid: 'second-desk', type: 'desk', col: 2, row: 2, rotation: 0 },
    );
    expect(getSurfaceRiders(source, 'desk').map((f) => f.uid)).toEqual(['pc', 'lamp']);
    expect(getSurfaceRiders(source, 'second-desk')).toEqual([]);
  });

  it('allows moves onto vacated group tiles but refuses copies overlapping originals', () => {
    const source = layout();
    expect(planFurnitureMove(source, 'desk', 3, 2).error).toBeNull();
    const plan = planFurnitureMove(source, 'desk', 3, 2, true);
    expect(plan.error).toMatch(/overlaps/);
    expect(commitFurniturePlan(source, plan, true)).toBeNull();
  });

  it.each([false, true])('rejects a whole %s-copy group when only its rider hits furniture', (duplicate) => {
    const source = layout();
    const original = catalog.getCatalogEntry;
    vi.spyOn(catalog, 'getCatalogEntry').mockImplementation((type) =>
      type === 'pc' ? { ...original(type)!, width: 2 } : original(type));
    source.furniture[2].col = 7;
    source.furniture[2].row = 4;
    const before = structuredClone(source);
    const plan = planFurnitureMove(source, 'desk', 5, 4, duplicate);
    expect(plan.error).toMatch(/overlaps/);
    expect(commitFurniturePlan(source, plan, duplicate)).toBeNull();
    expect(source).toEqual(before);
    expect(planFurnitureMove(source, 'desk', 10, 4, duplicate).error).toMatch(/inside the grid/);
  });

  it.each([
    [-1, 2], [11, 2], [2, -1], [2, 10], [2.5, 2],
  ])('rejects off-grid or non-integral destinations (%s, %s)', (col, row) => {
    const source = layout();
    const plan = planFurnitureMove(source, 'desk', col, row);
    expect(plan.error).toMatch(/inside the grid/);
    expect(commitFurniturePlan(source, plan)).toBeNull();
  });

  it.each([TileType.WALL, TileType.VOID])('rejects destinations on tile %s', (tile) => {
    const source = layout();
    source.tiles[5 * source.cols + 5] = tile;
    expect(planFurnitureMove(source, 'desk', 4, 5).error).toMatch(/floor/);
  });

  it('never hides an unrelated PC collision behind a desk surface', () => {
    const source = layout();
    source.furniture.push({ uid: 'pc-2', type: 'pc', col: 2, row: 2, rotation: 0 });
    expect(planFurnitureMove(source, 'pc', 2, 2).error).toMatch(/overlaps/);
    expect(planFurnitureMove(source, 'desk', 8, 7).error).toMatch(/overlaps/);
  });

  it('rotates the desk footprint and PC position/orientation coherently, restoring after four turns', () => {
    const source = layout();
    let next = commitFurniturePlan(source, planFurnitureRotate(source, 'desk'))!.layout;
    expect(next.furniture.slice(0, 2)).toMatchObject([
      { uid: 'desk', col: 2, row: 2, rotation: 90 },
      { uid: 'pc', col: 2, row: 3, rotation: 90 },
    ]);
    for (let i = 0; i < 3; i++) next = commitFurniturePlan(next, planFurnitureRotate(next, 'desk'))!.layout;
    expect(next).toEqual(source);
  });

  it('rejects rotations atomically for collisions and grid edges', () => {
    const source = layout();
    source.furniture[2] = { uid: 'obstacle', type: 'chair', col: 2, row: 3, rotation: 0 };
    const before = structuredClone(source);
    const plan = planFurnitureRotate(source, 'desk');
    expect(plan.error).toMatch(/overlaps/);
    expect(commitFurniturePlan(source, plan)).toBeNull();
    expect(source).toEqual(before);
    source.furniture[0].row = 9;
    source.furniture[1].row = 9;
    expect(planFurnitureRotate(source, 'desk').error).toMatch(/inside the grid/);
  });

  it('rejects a rotation when the desk fits but a protruding surface rider does not', () => {
    const source = layout();
    const original = catalog.getCatalogEntry;
    vi.spyOn(catalog, 'getCatalogEntry').mockImplementation((type) =>
      type === 'pc' ? { ...original(type)!, width: 2 } : original(type));
    source.furniture[2] = { uid: 'obstacle', type: 'chair', col: 2, row: 4, rotation: 0 };
    const plan = planFurnitureRotate(source, 'desk');
    expect(plan.error).toMatch(/overlaps/);
    expect(commitFurniturePlan(source, plan)).toBeNull();
    source.furniture.pop();
    expect(planFurnitureRotate(source, 'desk').error).toBeNull();
  });

  it('reports missing items and unknown collision dimensions without changing saved furniture', () => {
    const source = layout();
    expect(planFurnitureMove(source, 'missing', 4, 4).error).toMatch(/no longer exists/);
    const unknown: PlacedFurniture = { uid: 'unknown', type: 'unknown', col: 9, row: 9, rotation: 0 };
    source.furniture.push(unknown);
    expect(planFurnitureMove(source, 'desk', 4, 4).error).toMatch(/unknown furniture/);
    expect(planFurnitureRotate(source, 'unknown').error).toMatch(/unknown dimensions/);
  });
});
