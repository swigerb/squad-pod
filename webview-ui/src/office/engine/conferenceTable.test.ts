import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import { defaultFurniture } from '../../../../src/defaultFurniture.js';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';
import type { Character, OfficeLayout, SpriteData } from '../types.js';
import { CharacterState, Direction } from '../types.js';
import { buildDynamicCatalog } from '../layout/furnitureCatalog.js';
import { deserializeLayout, layoutToFurnitureInstances, serializeLayout } from '../layout/layoutManager.js';
import { getSurfaceOwners } from '../layout/furnitureSurfaces.js';
import { commitFurniturePlan, getSurfaceRiders, planFurnitureMove, planFurnitureRotate } from '../editor/editorActions.js';
import { renderScene } from './renderer.js';
import * as assetLoader from '../sprites/assetLoader.js';
import * as spriteCache from '../sprites/spriteCache.js';
import * as characterSheet from '../sprites/characterSheetRenderer.js';

function asset(id: string, width: number, height: number, isDesk = false): ManifestFurniture {
  const folder = id.startsWith('PC_') ? 'PC' : id === 'DESK_FRONT' ? 'DESK' : id;
  const png = PNG.sync.read(readFileSync(resolve('public', 'assets', 'furniture', folder, `${id}.png`)));
  const sprite: SpriteData = Array.from({ length: png.height }, (_, y) =>
    Array.from({ length: png.width }, (_, x) => {
      const index = (y * png.width + x) * 4;
      return png.data[index + 3] ? `#${png.data.subarray(index, index + 4).toString('hex')}` : '';
    }));
  return {
    type: `pa_${id}`, label: id, width, height, sprite, isDesk,
    category: isDesk ? 'desks' : 'electronics', canPlaceOnSurfaces: !isDesk, canPlaceOnWalls: false,
    ...(id === 'PC_SIDE' ? { groupId: 'pa_PC', orientation: 'side', mirrorSide: true } : {}),
  };
}

function fixture(): OfficeLayout {
  buildDynamicCatalog([asset('TABLE_FRONT', 3, 4, true), asset('PC_SIDE', 1, 2)]);
  return {
    version: 2, cols: 20, rows: 16, tiles: Array(320).fill(1),
    furniture: defaultFurniture().filter((item) =>
      item.uid === 'conference-table' || item.uid.startsWith('computer-side-')),
    areas: [{ label: 'Meeting', color: '#123456' }],
    areaTiles: Array(320).fill(null), areaMappings: { fixture: ['Meeting'] },
  };
}

function drawOrder(layout: OfficeLayout, characters: Character[] = []): string[] {
  const order: string[] = [];
  const furniture = layoutToFurnitureInstances(layout.furniture);
  vi.spyOn(assetLoader, 'areTilesetAssetsReady').mockReturnValue(false);
  vi.spyOn(spriteCache, 'getCachedSprite').mockImplementation((sprite) => {
    return { sprite } as unknown as HTMLCanvasElement;
  });
  vi.spyOn(spriteCache, 'getOutlineSprite').mockImplementation((sprite) => sprite);
  vi.spyOn(characterSheet, 'drawCharacterFromSheet').mockImplementation(() => {
    order.push('character');
    return true;
  });
  const ctx = {
    drawImage: (canvas: { sprite: SpriteData }, x: number, y: number) => {
      const item = furniture.find((candidate) => candidate.sprite === canvas.sprite
        && x === 17 + candidate.col * 16 * 3 && y === 23 + candidate.row * 16 * 3)!;
      order.push(item.uid);
    },
  } as unknown as CanvasRenderingContext2D;
  renderScene(ctx, furniture, characters, 17, 23, 3, null, null);
  return order;
}

afterEach(() => { buildDynamicCatalog([]); vi.restoreAllMocks(); });

describe('conference-table surface composition', () => {
  it('proves the baseline geometry and inward-facing source pixels, then draws every PC after its table', () => {
    const layout = fixture();
    const before = structuredClone(layout);
    const instances = layoutToFurnitureInstances(layout.furniture);
    expect(instances.map((item) => [item.uid, item.row * 16 + item.sprite.length])).toEqual([
      ['conference-table', 176], ['computer-side-1', 144], ['computer-side-2', 176],
      ['computer-side-3', 144], ['computer-side-4', 176],
    ]);
    expect(instances[1].sprite).toEqual(instances[3].sprite.map((row) => [...row].reverse()));
    expect(getSurfaceRiders(layout, 'conference-table').map((item) => item.uid)).toEqual([
      'computer-side-1', 'computer-side-2', 'computer-side-3', 'computer-side-4',
    ]);
    expect(drawOrder(layout)).toEqual([
      'conference-table', 'computer-side-1', 'computer-side-3', 'computer-side-2', 'computer-side-4',
    ]);
    expect(layout).toEqual(before);
  });

  it('preserves ordinary depth order for unattached PCs, other desks and characters in front/behind', () => {
    const layout = fixture();
    layout.furniture.push(
      { ...layout.furniture[0], uid: 'other-desk', col: 12, row: 8 },
      { ...layout.furniture[1], uid: 'unattached-pc', col: 0, row: 1 },
    );
    const character = {
      id: 'fixture', palette: 0, hueShift: 0, x: 80, y: 152, direction: Direction.DOWN,
      state: CharacterState.IDLE, frameIndex: 0,
    } as Character;
    const behind = drawOrder(layout, [character]);
    expect(behind).toEqual([
      'unattached-pc', 'character', 'conference-table', 'computer-side-1',
      'computer-side-3', 'computer-side-2', 'computer-side-4', 'other-desk',
    ]);
    vi.restoreAllMocks();
    character.y = 208;
    expect(drawOrder(layout, [character])).toEqual([
      'unattached-pc', 'conference-table', 'computer-side-1', 'computer-side-3',
      'computer-side-2', 'computer-side-4', 'other-desk', 'character',
    ]);
  });

  it('uses identical largest-overlap and layout-order ownership for rendering and grouped edits', () => {
    const layout = fixture();
    const table = layout.furniture[0];
    layout.furniture.unshift({ ...table, uid: 'partial-surface', col: 3 });
    const owners = () => getSurfaceOwners(layoutToFurnitureInstances(layout.furniture));
    // Left PCs overlap both surfaces equally; right PCs overlap only the original table.
    expect([...owners()]).toEqual([
      ['computer-side-1', 'partial-surface'], ['computer-side-2', 'partial-surface'],
      ['computer-side-3', 'conference-table'], ['computer-side-4', 'conference-table'],
    ]);
    layout.furniture.at(-1)!.col = 5;
    layout.furniture.at(-1)!.assetFootprint = { width: 2, height: 2 };
    expect(owners().get('computer-side-4')).toBe('conference-table');
    for (const surface of layout.furniture.slice(0, 2)) {
      expect(getSurfaceRiders(layout, surface.uid).map(item => item.uid)).toEqual(
        [...owners()].filter(([, owner]) => owner === surface.uid).map(([uid]) => uid),
      );
    }
    // Unattached computers retain their own depth; no nearest-desk/proximity fallback.
    layout.furniture[2].col = 0;
    expect(owners().has('computer-side-1')).toBe(false);
  });

  it('keeps the normal starter desks and their front-facing PCs in their existing composition order', () => {
    buildDynamicCatalog([asset('DESK_FRONT', 3, 2, true), asset('PC_FRONT_OFF', 1, 2)]);
    const layout: OfficeLayout = {
      version: 2, cols: 20, rows: 16, tiles: Array(320).fill(1),
      furniture: defaultFurniture().filter(item => ['desk-1', 'desk-2', 'computer-1', 'computer-2'].includes(item.uid)),
    };
    expect(drawOrder(layout)).toEqual(['desk-1', 'computer-2', 'desk-2', 'computer-1']);
    expect(getSurfaceRiders(layout, 'desk-1').map(item => item.uid)).toEqual(['computer-2']);
    expect(getSurfaceRiders(layout, 'desk-2').map(item => item.uid)).toEqual(['computer-1']);
  });

  it('keeps imported dual-role surfaces acyclic and renders each item once', () => {
    const layout = fixture();
    buildDynamicCatalog([{ ...asset('TABLE_FRONT', 3, 4, true), canPlaceOnSurfaces: true }]);
    layout.furniture = [
      layout.furniture[0], { ...layout.furniture[0], uid: 'second-surface', col: 5 },
    ];
    expect([...getSurfaceOwners(layoutToFurnitureInstances(layout.furniture))]).toEqual([
      ['conference-table', 'second-surface'],
    ]);
    expect(drawOrder(layout)).toEqual(['second-surface', 'conference-table']);
  });

  it('keeps composition, orientation and metadata through grouped move, four rotations and save/load', () => {
    const original = fixture();
    let layout = commitFurniturePlan(original, planFurnitureMove(original, 'conference-table', 8, 8))!.layout;
    const moved = structuredClone(layout);
    expect(layout.furniture.map(({ uid, col, row }) => [uid, col, row])).toEqual([
      ['conference-table', 8, 8], ['computer-side-1', 8, 8], ['computer-side-2', 8, 10],
      ['computer-side-3', 10, 8], ['computer-side-4', 10, 10],
    ]);
    for (let turn = 0; turn < 4; turn++) {
      const plan = planFurnitureRotate(layout, 'conference-table');
      expect(plan.error).toBeNull();
      layout = deserializeLayout(serializeLayout(commitFurniturePlan(layout, plan)!.layout));
      expect(getSurfaceRiders(layout, 'conference-table')).toHaveLength(4);
      const order = drawOrder(layout);
      expect(order[0]).toBe('conference-table');
      expect(new Set(order.slice(1))).toEqual(new Set(original.furniture.slice(1).map((item) => item.uid)));
      vi.restoreAllMocks();
    }
    expect(layout).toEqual(moved);
    expect(layout.areas).toEqual(original.areas);
    expect(layout.areaTiles).toEqual(original.areaTiles);
    expect(layout.areaMappings).toEqual(original.areaMappings);
  });
});
