import { afterEach, describe, expect, it } from 'vitest';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';
import { clearColorizeCache } from '../colorize.js';
import type { FloorColor, OfficeLayout, PlacedFurniture, SpriteData } from '../types.js';
import { buildDynamicCatalog } from './furnitureCatalog.js';
import { layoutToFurnitureInstances, serializeLayout, deserializeLayout } from './layoutManager.js';

const sprite: SpriteData = [
  ['#804020', '#a08040', ''],
  ['#204080', '#abc12380', '#ffffff'],
];
const manifestFurniture = (baseSprite: SpriteData): ManifestFurniture => ({
  type: 'pa_COLOR_FIXTURE', label: 'Color fixture', width: 1, height: 1,
  sprite: baseSprite, isDesk: true, category: 'desks', canPlaceOnSurfaces: false, canPlaceOnWalls: false,
});
const color: FloorColor = { h: 120, s: 80, b: -5, c: 10 };
const rotate = (source: SpriteData, degrees: number): SpriteData => {
  if (degrees === 90) return source[0].map((_, x) => source.map((row) => row[x]).reverse());
  if (degrees === 180) return source.map((row) => [...row].reverse()).reverse();
  if (degrees === 270) return source[0].map((_, x) => source.map((row) => row[source[0].length - 1 - x]));
  return source;
};

afterEach(() => {
  buildDynamicCatalog([]);
  clearColorizeCache();
});

describe('furniture color baking', () => {
  it('bakes valid colors into a manifest sprite while preserving exact colorless sprite identity', () => {
    buildDynamicCatalog([manifestFurniture(sprite)]);
    const plain = { uid: 'plain', type: 'pa_COLOR_FIXTURE', col: 0, row: 0, rotation: 0, assetFootprint: { width: 1, height: 1 } };
    const tinted = { ...plain, uid: 'tinted', color };
    const [plainInstance, tintedInstance] = layoutToFurnitureInstances([plain, tinted]);

    expect(plainInstance.sprite).toBe(sprite);
    expect(plainInstance).not.toHaveProperty('color');
    expect(tintedInstance.sprite).not.toBe(sprite);
    expect(tintedInstance.color).toEqual(color);
    expect(tintedInstance.sprite).not.toEqual(plainInstance.sprite);
    expect(layoutToFurnitureInstances([{ ...plain, color: { h: Infinity, s: 0, b: 0, c: 0 } } as PlacedFurniture])[0].sprite)
      .toBe(sprite);
  });

  it('uses distinct colorize and adjust modes and rotates only after tinting', () => {
    buildDynamicCatalog([manifestFurniture(sprite)]);
    const adjusted = layoutToFurnitureInstances([{
      uid: 'adjusted', type: 'pa_COLOR_FIXTURE', col: 0, row: 0, rotation: 0, assetFootprint: { width: 1, height: 1 },
      color: { ...color, colorize: false },
    }])[0];
    const colorizedColor = { ...color, colorize: true };
    const colorized = layoutToFurnitureInstances([{
      uid: 'colorized', type: 'pa_COLOR_FIXTURE', col: 0, row: 0, rotation: 0, assetFootprint: { width: 1, height: 1 }, color: colorizedColor,
    }])[0];
    expect(colorized.sprite).not.toEqual(adjusted.sprite);

    for (const rotation of [0, 90, 180, 270]) {
      clearColorizeCache();
      const instance = layoutToFurnitureInstances([{
        uid: `rotated-${rotation}`, type: 'pa_COLOR_FIXTURE', col: 0, row: 0, rotation, assetFootprint: { width: 1, height: 1 }, color: colorizedColor,
      }])[0];
      expect(instance.sprite).toEqual(rotate(colorized.sprite, rotation));
    }
  });

  it('keys cached colors by the resolved base sprite and preserves invalid source metadata', () => {
    const first = [['#ff0000']];
    const second = [['#0000ff']];
    const placement: PlacedFurniture = {
      uid: 'same-id', type: 'pa_COLOR_FIXTURE', col: 0, row: 0, rotation: 0, color,
      assetFootprint: { width: 1, height: 1 },
    };
    buildDynamicCatalog([manifestFurniture(first)]);
    const firstInstance = layoutToFurnitureInstances([placement])[0];
    buildDynamicCatalog([manifestFurniture(second)]);
    const secondInstance = layoutToFurnitureInstances([placement])[0];
    expect(firstInstance.sprite[0][0]).not.toBe(secondInstance.sprite[0][0]);

    const invalidColor = { h: 0, s: 'bad', b: 0, c: 0 };
    const layout = {
      version: 2, cols: 1, rows: 1, tiles: [1],
      furniture: [{ ...placement, color: invalidColor }],
    } as unknown as OfficeLayout;
    const before = serializeLayout(layout);
    const invalidInstance = layoutToFurnitureInstances(layout.furniture)[0];
    expect(invalidInstance.sprite).toBe(second);
    expect(invalidInstance).not.toHaveProperty('color');
    expect(serializeLayout(deserializeLayout(before))).toBe(before);
    expect((layout.furniture[0] as unknown as { color: unknown }).color).toEqual(invalidColor);
  });

  it('does not let invalid colors alias a colorless furniture instance', () => {
    buildDynamicCatalog([manifestFurniture(sprite)]);
    const invalid = { uid: 'invalid', type: 'pa_COLOR_FIXTURE', col: 0, row: 0, rotation: 0,
      assetFootprint: { width: 1, height: 1 },
      color: { h: 0, s: 0, b: 0, c: 0, colorize: 'yes' } };
    const instance = layoutToFurnitureInstances([invalid as unknown as PlacedFurniture])[0];
    expect(instance.sprite).toBe(sprite);
    expect(instance).not.toHaveProperty('color');
  });

  it('colorizes footprint-mismatch placeholders without passing shorthand pixels to the colorizer', () => {
    buildDynamicCatalog([manifestFurniture(sprite)]);
    const item: PlacedFurniture = {
      uid: 'placeholder', type: 'pa_COLOR_FIXTURE', col: 0, row: 0, rotation: 0,
      assetFootprint: { width: 2, height: 1 }, color: { h: 180, s: 80, b: 0, c: 0, colorize: true },
    };
    const [instance] = layoutToFurnitureInstances([item]);
    expect(instance.sprite).toHaveLength(16);
    expect(instance.sprite[0]).toHaveLength(32);
    expect(instance.sprite.flat().every((pixel) => /^#[\da-f]{6}$/i.test(pixel))).toBe(true);
  });

  it('rebuilds one furniture color variant at a time across a full hue sweep', () => {
    const deskSprite = Array.from({ length: 32 }, (_, row) =>
      Array.from({ length: 48 }, (_, col) => `#${((row * 7919 + col * 104729) & 0xffffff).toString(16).padStart(6, '0')}`));
    buildDynamicCatalog([{ ...manifestFurniture(deskSprite), width: 3, height: 2 }]);
    const item: PlacedFurniture = {
      uid: 'sweep-desk', type: 'pa_COLOR_FIXTURE', col: 0, row: 0, rotation: 0,
      assetFootprint: { width: 3, height: 2 }, color,
    };
    const variants = new Set<string>();
    let lastSprite: SpriteData | undefined;

    for (let hue = 0; hue < 360; hue++) {
      clearColorizeCache();
      const instance = layoutToFurnitureInstances([{ ...item, color: { ...color, h: hue, colorize: true } }])[0];
      variants.add(JSON.stringify(instance.sprite));
      lastSprite = instance.sprite;
    }

    expect(variants.size).toBe(360);
    expect(lastSprite).toHaveLength(32);
    expect(lastSprite?.[0]).toHaveLength(48);
  });
});
