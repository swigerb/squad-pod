import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';
import type { OfficeLayout, PlacedFurniture } from '../types.js';
import { OfficeState } from '../engine/officeState.js';
import { getColorizedSprite } from '../colorize.js';
import { layoutToFurnitureInstances } from './layoutManager.js';
import {
  buildDynamicCatalog,
  getAnimationFrames,
  getCatalogEntry,
  getOnStateType,
  getToggledType,
} from './furnitureCatalog.js';

const sprite = (color: string) => Array.from({ length: 16 }, () => Array<string>(16).fill(color));
const asset = (type: string, extra: Partial<ManifestFurniture> = {}): ManifestFurniture => ({
  type,
  label: type,
  groupId: 'pa_pc',
  groupType: 'state',
  orientation: 'front',
  width: 1,
  height: 1,
  sprite: sprite('#804020'),
  isDesk: false,
  category: 'electronics',
  canPlaceOnSurfaces: true,
  canPlaceOnWalls: false,
  ...extra,
});
const pcAssets = [
  asset('pa_pc_front_off', { state: 'off' }),
  asset('pa_pc_front_on_0', { groupType: 'animation', state: 'on', frame: 0, sprite: sprite('#ff0000') }),
  asset('pa_pc_front_on_1', { groupType: 'animation', state: 'on', frame: 1, sprite: sprite('#00ff00') }),
  asset('pa_pc_front_on_2', { groupType: 'animation', state: 'on', frame: 2, sprite: sprite('#0000ff') }),
  asset('pa_pc_side_off', { orientation: 'side', state: 'off', mirrorSide: true }),
  asset('pa_pc_side_on', { orientation: 'side', state: 'on', mirrorSide: true, sprite: sprite('#ffffff') }),
  asset('pa_pc_back_off', { orientation: 'back', state: 'off' }),
];

const placed = (type: string, extra: Partial<PlacedFurniture> = {}): PlacedFurniture => ({
  uid: 'pc',
  type,
  col: 4,
  row: 3,
  rotation: 0,
  assetFootprint: { width: 1, height: 1 },
  ...extra,
});

function officeForDirection(
  dCol: number,
  dRow: number,
  depth = 1,
  side = 0,
  active = true,
  pcDCol = dCol,
  pcDRow = dRow,
): { office: OfficeState; layout: OfficeLayout } {
  const seatCol = 4;
  const seatRow = 4;
  const sideCol = dRow === 0 ? 0 : side;
  const sideRow = dCol === 0 ? 0 : side;
  const layout: OfficeLayout = {
    version: 2,
    cols: 9,
    rows: 9,
    tiles: Array(81).fill(1),
    furniture: [
      { uid: 'desk', type: 'desk', col: seatCol + dCol, row: seatRow + dRow, rotation: 0 },
      { uid: 'seat', type: 'chair', col: seatCol, row: seatRow, rotation: 0 },
      placed('pa_pc_front_off', {
        col: seatCol + pcDCol * depth + sideCol,
        row: seatRow + pcDRow * depth + sideRow,
      }),
    ],
  };
  const office = new OfficeState(layout);
  office.addAgent('fixture-agent', 'Fixture Agent', 'Test', undefined, undefined, 'seat');
  if (active) office.setAgentActive('fixture-agent', true);
  return { office, layout };
}

afterEach(() => buildDynamicCatalog([]));

describe('state and animation catalog', () => {
  it('pairs state variants per group and orientation without allowing an incomplete sibling to affect a valid pair', () => {
    buildDynamicCatalog([
      asset('pa_partial_on', { groupId: 'pa_mixed', state: 'on' }),
      asset('pa_valid_off', { groupId: 'pa_mixed', orientation: 'side', state: 'off' }),
      asset('pa_valid_on', { groupId: 'pa_mixed', orientation: 'side', state: 'on' }),
    ]);

    expect(getToggledType('pa_partial_on')).toBeNull();
    expect(getToggledType('pa_valid_off')).toBe('pa_valid_on');
    expect(getToggledType('pa_valid_on')).toBe('pa_valid_off');
    expect(getOnStateType('pa_valid_off')).toBe('pa_valid_on');
  });

  it('orders frames, picks duplicate indexes by type, and ignores missing or invalid indexes', () => {
    buildDynamicCatalog([
      asset('pa_anim_off', { groupId: 'pa_anim', state: 'off' }),
      asset('pa_anim_z0', { groupId: 'pa_anim', groupType: 'animation', state: 'on', frame: 0 }),
      asset('pa_anim_a0', { groupId: 'pa_anim', groupType: 'animation', state: 'on', frame: 0 }),
      asset('pa_anim_2', { groupId: 'pa_anim', groupType: 'animation', state: 'on', frame: 2 }),
      asset('pa_anim_1', { groupId: 'pa_anim', groupType: 'animation', state: 'on', frame: 1 }),
      asset('pa_anim_missing', { groupId: 'pa_anim', groupType: 'animation', state: 'on' }),
      asset('pa_anim_invalid', { groupId: 'pa_anim', groupType: 'animation', state: 'on', frame: -1 }),
    ]);

    expect(getAnimationFrames('pa_anim_a0')).toEqual(['pa_anim_a0', 'pa_anim_1', 'pa_anim_2']);
    expect(getAnimationFrames('pa_anim_z0')).toBeUndefined();
    expect(getAnimationFrames('pa_anim_missing')).toBeUndefined();
    expect(getAnimationFrames('pa_anim_invalid')).toBeUndefined();
    expect(getToggledType('pa_anim_1')).toBe('pa_anim_off');
  });

  it('keeps mirrored, tinted on-frame sprites distinct from their base and other frame/color variants', () => {
    buildDynamicCatalog(pcAssets);
    const color = { h: 120, s: 80, b: -5, c: 10 };
    const mirrored = getCatalogEntry('pa_pc_side_on:left')!;
    expect(mirrored.sprite).toEqual(pcAssets[5].sprite.map((row) => [...row].reverse()));

    const instances = layoutToFurnitureInstances([
      placed('pa_pc_front_on_0', { color }),
      placed('pa_pc_front_on_1', { color }),
      placed('pa_pc_front_on_0', { color: { ...color, h: 220 } }),
      placed('pa_pc_side_on:left', { color }),
    ]);
    expect(instances[0].sprite).not.toEqual(pcAssets[1].sprite);
    expect(instances[0].sprite).not.toEqual(instances[1].sprite);
    expect(instances[0].sprite).not.toEqual(instances[2].sprite);
    expect(instances[3].sprite).toEqual(getColorizedSprite('furniture-state-left-expected', mirrored.sprite, color));
    expect(pcAssets[1].sprite).toEqual(sprite('#ff0000'));
  });
});

describe('seat-facing auto-on and animation', () => {
  beforeEach(() => buildDynamicCatalog(pcAssets));

  it.each([
    ['up', 0, -1],
    ['down', 0, 1],
    ['left', -1, 0],
    ['right', 1, 0],
  ] as const)('turns on only for the facing geometry (%s)', (_label, dCol, dRow) => {
    const { office, layout } = officeForDirection(dCol, dRow);
    const original = structuredClone(layout);
    expect(office.furniture.find((item) => item.uid === 'pc')?.type).toBe('pa_pc_front_on_0');
    expect(office.getLayout()).toBe(layout);
    expect(layout).toEqual(original);

    const opposite = officeForDirection(-dCol, -dRow, 1, 0, true, dCol, dRow);
    expect(opposite.office.furniture.find((item) => item.uid === 'pc')?.type).toBe('pa_pc_front_off');
  });

  it('applies three forward tiles and two side depths, but not the next tile', () => {
    expect(officeForDirection(0, -1, 3).office.furniture.find((item) => item.uid === 'pc')?.type)
      .toBe('pa_pc_front_on_0');
    expect(officeForDirection(0, -1, 4).office.furniture.find((item) => item.uid === 'pc')?.type)
      .toBe('pa_pc_front_off');
    expect(officeForDirection(0, -1, 2, -1).office.furniture.find((item) => item.uid === 'pc')?.type)
      .toBe('pa_pc_front_on_0');
    expect(officeForDirection(0, -1, 3, 1).office.furniture.find((item) => item.uid === 'pc')?.type)
      .toBe('pa_pc_front_off');
  });

  it('keeps idle and unseated agents from auto-switching furniture on', () => {
    const idle = officeForDirection(0, -1, 1, 0, false).office;
    expect(idle.furniture.find((item) => item.uid === 'pc')?.type).toBe('pa_pc_front_off');

    const layout: OfficeLayout = {
      version: 2, cols: 5, rows: 5, tiles: Array(25).fill(1),
      furniture: [placed('pa_pc_front_off')],
    };
    const unseated = new OfficeState(layout);
    unseated.addAgent('unseated', 'Unseated', 'Test');
    unseated.setAgentActive('unseated', true);
    expect(unseated.furniture.find((item) => item.uid === 'pc')?.type).toBe('pa_pc_front_off');
  });

  it('reassigns occupied seats, updates only on the next active seat, and keeps layout snapshots untouched', () => {
    const layout: OfficeLayout = {
      version: 2, cols: 10, rows: 8, tiles: Array(80).fill(1),
      furniture: [
        { uid: 'desk-a', type: 'desk', col: 2, row: 2, rotation: 0 },
        { uid: 'seat-a', type: 'chair', col: 2, row: 3, rotation: 0 },
        { ...placed('pa_pc_front_off'), uid: 'pc-a', col: 2, row: 2 },
        { uid: 'desk-b', type: 'desk', col: 7, row: 2, rotation: 0 },
        { uid: 'seat-b', type: 'chair', col: 7, row: 3, rotation: 0 },
        { ...placed('pa_pc_front_off'), uid: 'pc-b', col: 7, row: 2 },
      ],
    };
    const original = structuredClone(layout);
    const office = new OfficeState(layout);
    office.addAgent('fixture-agent', 'Fixture Agent', 'Test', undefined, undefined, 'seat-a');
    office.setAgentActive('fixture-agent', true);
    expect(office.furniture.find((item) => item.uid === 'pc-a')?.type).toBe('pa_pc_front_on_0');
    expect(office.furniture.find((item) => item.uid === 'pc-b')?.type).toBe('pa_pc_front_off');

    office.reassignSeat('fixture-agent', 'seat-b');
    expect(office.furniture.find((item) => item.uid === 'pc-a')?.type).toBe('pa_pc_front_off');
    expect(office.furniture.find((item) => item.uid === 'pc-b')?.type).toBe('pa_pc_front_on_0');
    expect(office.getLayout()).toBe(layout);
    expect(layout).toEqual(original);
  });

  it('updates independent workstations for multiple active agents', () => {
    const office = new OfficeState({
      version: 2, cols: 10, rows: 8, tiles: Array(80).fill(1),
      furniture: [
        { uid: 'desk-a', type: 'desk', col: 2, row: 2, rotation: 0 },
        { uid: 'seat-a', type: 'chair', col: 2, row: 3, rotation: 0 },
        { ...placed('pa_pc_front_off'), uid: 'pc-a', col: 2, row: 2 },
        { uid: 'desk-b', type: 'desk', col: 7, row: 2, rotation: 0 },
        { uid: 'seat-b', type: 'chair', col: 7, row: 3, rotation: 0 },
        { ...placed('pa_pc_front_off'), uid: 'pc-b', col: 7, row: 2 },
      ],
    });
    office.addAgent('agent-a', 'Agent A', 'Test', undefined, undefined, 'seat-a');
    office.addAgent('agent-b', 'Agent B', 'Test', undefined, undefined, 'seat-b');
    office.setAgentActive('agent-a', true);
    expect(office.furniture.find((item) => item.uid === 'pc-a')?.type).toBe('pa_pc_front_on_0');
    expect(office.furniture.find((item) => item.uid === 'pc-b')?.type).toBe('pa_pc_front_off');
    office.setAgentActive('agent-b', true);
    expect(office.furniture.find((item) => item.uid === 'pc-a')?.type).toBe('pa_pc_front_on_0');
    expect(office.furniture.find((item) => item.uid === 'pc-b')?.type).toBe('pa_pc_front_on_0');
    office.setAgentActive('agent-a', false);
    expect(office.furniture.find((item) => item.uid === 'pc-a')?.type).toBe('pa_pc_front_off');
    expect(office.furniture.find((item) => item.uid === 'pc-b')?.type).toBe('pa_pc_front_on_0');
  });

  it('advances animated furniture only at the 0.2 second boundary without writing frames to the layout', () => {
    const { office, layout } = officeForDirection(0, -1);
    const original = structuredClone(layout);
    const initial = office.furniture;
    office.updateFurnitureAnimation(0.05);
    expect(office.furniture).toBe(initial);
    expect(office.furniture[2].type).toBe('pa_pc_front_on_0');

    office.updateFurnitureAnimation(0.15);
    expect(office.furniture).not.toBe(initial);
    expect(office.furniture[2].type).toBe('pa_pc_front_on_1');
    office.updateFurnitureAnimation(0.2);
    expect(office.furniture[2].type).toBe('pa_pc_front_on_2');
    office.updateFurnitureAnimation(0.2);
    expect(office.furniture[2].type).toBe('pa_pc_front_on_0');
    expect(office.getLayout()).toBe(layout);
    expect(layout).toEqual(original);
  });
});
