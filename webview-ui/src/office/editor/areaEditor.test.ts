import { describe, expect, it } from 'vitest';
import { TileType } from '../types.js';
import type { OfficeLayout } from '../types.js';
import {
  addArea,
  applyAreaErase,
  applyAreaPaint,
  changeAreaColor,
  pickArea,
  removeArea,
  renameArea,
  setAreaMapping,
} from './areaEditor.js';

function makeLayout(): OfficeLayout {
  return {
    version: 2,
    cols: 3,
    rows: 2,
    tiles: [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.WALL, TileType.VOID],
    furniture: [],
    customMetadata: { preserved: true },
  } as OfficeLayout;
}

describe('named Area layout transactions', () => {
  it('keeps missing Area fields missing until an explicit edit', () => {
    const legacy = makeLayout();
    const original = structuredClone(legacy);
    expect(legacy.areas).toBeUndefined();
    expect(legacy.areaTiles).toBeUndefined();
    expect(legacy.areaMappings).toBeUndefined();
    expect(addArea(legacy, 'Team Floor', '#50C878')).toMatchObject({
      areas: [{ label: 'Team Floor', color: '#50c878' }],
      customMetadata: { preserved: true },
    });
    expect(legacy).toEqual(original);
  });

  it('paints, rejects wall and void tiles, picks and erases floor membership', () => {
    const withArea = addArea(makeLayout(), 'Engineering', '#50c878');
    const painted = applyAreaPaint(withArea, 0, 0, 'Engineering');
    expect(painted.areaTiles).toEqual(['Engineering', null, null, null, null, null]);
    expect(applyAreaPaint(painted, 1, 1, 'Engineering')).toBe(painted);
    expect(applyAreaPaint(painted, 2, 1, 'Engineering')).toBe(painted);
    expect(pickArea(painted, 0, 0)).toEqual({ label: 'Engineering', color: '#50c878' });
    expect(pickArea(painted, 1, 0)).toBeNull();
    const erased = applyAreaErase(painted, 0, 0);
    expect(erased).not.toHaveProperty('areaTiles');
    expect(applyAreaErase(erased, 0, 0)).toBe(erased);
  });

  it('renames and recolors all associated painted tiles and mappings atomically', () => {
    let layout = addArea(makeLayout(), 'Engineering', '#50c878');
    layout = addArea(layout, 'Support', '#f0a000');
    layout = applyAreaPaint(layout, 0, 0, 'Engineering');
    layout = setAreaMapping(layout, 'workspace:file:///synthetic', 'Engineering', true);
    layout = setAreaMapping(layout, 'missing-directory-id', 'Support', true);
    const renamed = renameArea(layout, 'Engineering', 'Platform');
    expect(renamed.areas).toEqual([
      { label: 'Platform', color: '#50c878' },
      { label: 'Support', color: '#f0a000' },
    ]);
    expect(renamed.areaTiles?.[0]).toBe('Platform');
    expect(renamed.areaMappings).toEqual({
      'workspace:file:///synthetic': ['Platform'],
      'missing-directory-id': ['Support'],
    });
    expect(changeAreaColor(renamed, 'Platform', '#123ABC').areas?.[0].color).toBe('#123abc');
  });

  it('removes only the selected definition, its tile membership and its directory mappings', () => {
    let layout = addArea(makeLayout(), 'Engineering', '#50c878');
    layout = addArea(layout, 'Support', '#f0a000');
    layout = applyAreaPaint(layout, 0, 0, 'Engineering');
    layout = applyAreaPaint(layout, 1, 0, 'Support');
    layout = setAreaMapping(layout, 'saved-stable-id', 'Engineering', true);
    layout = setAreaMapping(layout, 'saved-stable-id', 'Support', true);
    const removed = removeArea(layout, 'Engineering');
    expect(removed.areas).toEqual([{ label: 'Support', color: '#f0a000' }]);
    expect(removed.areaTiles).toEqual([null, 'Support', null, null, null, null]);
    expect(removed.areaMappings).toEqual({ 'saved-stable-id': ['Support'] });
    expect(removeArea(removed, 'Support')).not.toHaveProperty('areas');
  });

  it('validates names, colors, directory keys and duplicate labels without mutating input', () => {
    const layout = addArea(makeLayout(), 'Engineering', '#50c878');
    const original = structuredClone(layout);
    expect(() => addArea(layout, ' engineering ', '#123456')).toThrow('already exists');
    expect(() => addArea(layout, '  ', '#123456')).toThrow('Area name');
    expect(() => addArea(layout, 'Support', 'red')).toThrow('six-digit hex');
    expect(() => setAreaMapping(layout, '', 'Engineering', true)).toThrow('stable directory ID');
    expect(layout).toEqual(original);
  });
});
