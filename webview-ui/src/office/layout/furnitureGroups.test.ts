import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';
import type { OfficeLayout, PlacedFurniture } from '../types.js';
import { clearColorizeCache, getColorizedSprite } from '../colorize.js';
import { applyFurniturePlace, commitFurniturePlan, planFurnitureRotate } from '../editor/editorActions.js';
import { buildDynamicCatalog, getAssetProblem, getCatalogEntry, getRotatedType, isRotatable } from './furnitureCatalog.js';
import { deserializeLayout, getFurnitureFootprint, layoutToFurnitureInstances, layoutToSeats, serializeLayout } from './layoutManager.js';

const sprite = [['#804020', '#a08040', ''], ['#204080', '#abc12380', '#ffffff']];
function asset(orientation: ManifestFurniture['orientation'], extra: Partial<ManifestFurniture> = {}): ManifestFurniture {
  return {
    type: `pa_${orientation}`, label: 'Fixture - Front - Off', groupId: 'pa_FIXTURE',
    groupType: 'rotation', orientation, width: 1, height: 1, sprite, isDesk: false,
    category: 'chairs', canPlaceOnSurfaces: false, canPlaceOnWalls: false, ...extra,
  };
}
const placement = (type = 'pa_front'): PlacedFurniture => ({
  uid: 'stable-seat', type, col: 2, row: 2, rotation: 0, assetFootprint: { width: 1, height: 1 }, assetRole: 'seat',
});
const layout = (items = [placement()]): OfficeLayout => ({
  version: 2, cols: 8, rows: 8, tiles: Array(64).fill(1), furniture: items,
});
afterEach(() => { buildDynamicCatalog([]); clearColorizeCache(); vi.restoreAllMocks(); });

describe('rotation groups and mirrors', () => {
  it.each(['2-way', '3-way-mirror', '4-way'] as const)('builds ordered %s cycles with one palette entry and every leaf addressable', (scheme) => {
    const assets = [
      asset('back', { rotationScheme: scheme }), asset('front'),
      asset('side', { mirrorSide: scheme !== '4-way' }),
      ...(scheme === '4-way' ? [asset('left')] : []),
      asset('front', { type: 'pa_on', state: 'on' }),
    ];
    const palette = buildDynamicCatalog(assets);
    const expected = scheme === '2-way' ? ['pa_front', 'pa_side']
      : ['pa_front', 'pa_side', 'pa_back', scheme === '4-way' ? 'pa_left' : 'pa_side:left'];
    let type = 'pa_front';
    const cycle = expected.map(() => { const current = type; type = getRotatedType(type)!; return current; });
    expect(cycle).toEqual(expected);
    expect(type).toBe('pa_front');
    expect(getRotatedType('pa_front', 'ccw')).toBe(expected.at(-1));
    expect(palette.map((item) => [item.type, item.label])).toEqual([['pa_front', 'Fixture']]);
    for (const entry of assets) expect(getCatalogEntry(entry.type)).toBeDefined();
    expect(isRotatable('pa_on')).toBe(false);
    expect(getRotatedType('pa_on')).toBeNull();
  });

  it('keeps underspecified groups and unrelated items unchanged and clears stale group membership', () => {
    const entry = asset('front');
    expect(buildDynamicCatalog([entry])).toEqual([entry]);
    expect(isRotatable(entry.type)).toBe(false);
    const pair = [entry, asset('right')];
    buildDynamicCatalog(pair);
    expect(isRotatable(entry.type)).toBe(true);
    const single = asset('side', { groupId: undefined, mirrorSide: true });
    expect(buildDynamicCatalog([single])).toEqual([single]);
    expect(getRotatedType(entry.type)).toBeNull();
    expect(getCatalogEntry(entry.type)).toBeUndefined();
  });

  it('uses a deterministic representative when a partial group has no front', () => {
    expect(buildDynamicCatalog([asset('left'), asset('back')]).map((item) => item.type)).toEqual(['pa_back']);
    expect(getRotatedType('pa_back')).toBe('pa_left');
  });

  it('mirrors exact source pixels and retains distinct cache entries for every variant and color', () => {
    buildDynamicCatalog([asset('front'), asset('side', { mirrorSide: true })]);
    const source = structuredClone(sprite);
    const right = placement('pa_side');
    const left = placement('pa_side:left');
    const color = { h: 120, s: 80, b: -5, c: 10 };
    const [plainRight, plainLeft, tintedRight, tintedLeft, otherColor] = layoutToFurnitureInstances([
      right, left, { ...right, color }, { ...left, color }, { ...left, color: { ...color, h: 220 } },
    ]);
    expect(plainRight.sprite).toEqual(source);
    expect(plainLeft.sprite).toEqual(source.map((row) => [...row].reverse()));
    expect(tintedLeft.sprite).toEqual(tintedRight.sprite.map((row) => [...row].reverse()));
    expect(tintedLeft.sprite).not.toEqual(tintedRight.sprite);
    expect(otherColor.sprite).not.toEqual(tintedLeft.sprite);
    expect(tintedRight.sprite).toEqual(getColorizedSprite('independent-expected', source, color));
    expect(getFurnitureFootprint(left)).toEqual({ width: 1, height: 1 });
    expect(sprite).toEqual(source);
  });

  it('switches variant and re-derives footprint/roles without changing identity, color or input', () => {
    buildDynamicCatalog([asset('front'), asset('side', { width: 2, height: 1, isDesk: true })]);
    const source = layout([{ ...placement(), color: { h: 10, s: 20, b: 0, c: 0 } }]);
    const before = structuredClone(source);
    const result = commitFurniturePlan(source, planFurnitureRotate(source, 'stable-seat'))!;
    expect(result.layout.furniture[0]).toEqual({
      ...source.furniture[0], type: 'pa_side', rotation: 0, assetFootprint: { width: 2, height: 1 }, assetRole: 'desk',
    });
    expect(source).toEqual(before);
    expect(deserializeLayout(serializeLayout(result.layout))).toEqual(result.layout);
    expect(applyFurniturePlace(layout([]), 'pa_front', 0, 0, 90).furniture[0].rotation).toBe(0);
  });

  it('rejects variant collisions, bounds, void/wall tiles and changed-footprint assets atomically', () => {
    buildDynamicCatalog([asset('front'), asset('side', { width: 2, height: 1 })]);
    const source = layout([placement(), { uid: 'blocker', type: 'chair', col: 3, row: 2, rotation: 0 }]);
    expect(planFurnitureRotate(source, 'stable-seat').error).toMatch(/overlaps/);
    source.furniture.pop();
    source.furniture[0].col = 7;
    expect(planFurnitureRotate(source, 'stable-seat').error).toMatch(/inside the grid/);
    source.furniture[0].col = 2;
    for (const tile of [0, 8]) {
      source.tiles[2 * 8 + 3] = tile;
      const plan = planFurnitureRotate(source, 'stable-seat');
      expect(plan.error).toMatch(/floor/);
      expect(commitFurniturePlan(source, plan)).toBeNull();
    }
    source.furniture[0].assetFootprint = { width: 2, height: 1 };
    expect(planFurnitureRotate(source, 'stable-seat').error).toBe(getAssetProblem(source.furniture[0]));
  });

  it('validates riders against replacement desk surfaces, rather than silently dropping them', () => {
    buildDynamicCatalog([
      asset('front', { isDesk: true, width: 2, category: 'desks' }),
      asset('side', { isDesk: true, height: 2, category: 'desks' }),
      asset(undefined, { type: 'pa_pc', groupId: undefined, canPlaceOnSurfaces: true }),
    ]);
    const source = layout([
      { ...placement(), assetFootprint: { width: 2, height: 1 }, assetRole: 'desk' },
      { ...placement('pa_pc'), uid: 'rider', col: 3, assetRole: undefined },
    ]);
    expect(planFurnitureRotate(source, 'stable-seat').error).toMatch(/riders/);
    source.furniture[1].col = 2;
    const plan = planFurnitureRotate(source, 'stable-seat');
    expect(plan.error).toBeNull();
    expect(plan.items[1]).toEqual(source.furniture[1]);
    expect(commitFurniturePlan(source, plan)?.layout.furniture).toHaveLength(2);
  });

  it('preserves geometric rotation for ungrouped manifest assets and legacy placeholders', () => {
    buildDynamicCatalog([asset('front', { groupId: undefined, width: 2 })]);
    const source = layout([{ ...placement(), assetFootprint: { width: 2, height: 1 } }]);
    const plan = planFurnitureRotate(source, 'stable-seat');
    expect(plan.items[0]).toMatchObject({ type: 'pa_front', rotation: 90 });
    expect(getFurnitureFootprint(plan.items[0])).toEqual({ width: 1, height: 2 });
    const legacy = layout([{ uid: 'desk', type: 'desk', col: 0, row: 0, rotation: 0 }]);
    expect(planFurnitureRotate(legacy, 'desk').items[0]).toMatchObject({ type: 'desk', rotation: 90 });
  });

  it('keeps saved chair uid, desk-adjacent facing and seat assignment keys across variant rotations', () => {
    buildDynamicCatalog([asset('front'), asset('side', { mirrorSide: true }), asset('back')]);
    let current = layout([placement(), { uid: 'desk', type: 'desk', col: 2, row: 1, rotation: 0 }]);
    const before = layoutToSeats(current.furniture);
    expect(before).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      current = commitFurniturePlan(current, planFurnitureRotate(current, 'stable-seat'))!.layout;
      expect(layoutToSeats(current.furniture)).toEqual(before);
    }
    expect(current.furniture[0]).toEqual(placement());
  });
});
