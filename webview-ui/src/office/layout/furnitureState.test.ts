import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';
import { Direction } from '../types.js';
import type { OfficeLayout, PlacedFurniture } from '../types.js';
import { OfficeState } from '../engine/officeState.js';
import { getColorizedSprite } from '../colorize.js';
import { createDefaultLayout, layoutToFurnitureInstances } from './layoutManager.js';
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
const sizedAsset = (
  type: string,
  width: number,
  height: number,
  extra: Partial<ManifestFurniture> = {},
): ManifestFurniture => ({
  ...asset(type, extra),
  width,
  height,
  sprite: Array.from({ length: height * 16 }, () => Array(width * 16).fill('#804020')),
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

  it('rejects mismatched state and animation footprints without affecting valid pairs', () => {
    buildDynamicCatalog([
      asset('pa_pair_off', { groupId: 'pa_pair', state: 'off' }),
      sizedAsset('pa_pair_on', 2, 1, { groupId: 'pa_pair', state: 'on' }),
      asset('pa_frames_off', { groupId: 'pa_frames', state: 'off' }),
      asset('pa_frames_on_0', { groupId: 'pa_frames', groupType: 'animation', state: 'on', frame: 0 }),
      sizedAsset('pa_frames_on_1', 2, 1, { groupId: 'pa_frames', groupType: 'animation', state: 'on', frame: 1 }),
      asset('pa_valid_off', { groupId: 'pa_valid', state: 'off' }),
      asset('pa_valid_on', { groupId: 'pa_valid', state: 'on' }),
    ]);

    expect(getToggledType('pa_pair_off')).toBeNull();
    expect(getToggledType('pa_pair_on')).toBeNull();
    expect(getToggledType('pa_frames_off')).toBeNull();
    expect(getToggledType('pa_frames_on_0')).toBeNull();
    expect(getAnimationFrames('pa_frames_on_0')).toBeUndefined();
    expect(getToggledType('pa_valid_off')).toBe('pa_valid_on');
    expect(getToggledType('pa_valid_on')).toBe('pa_valid_off');
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

  it('routes to all blocked seats in the native default office fixture', () => {
    const office = new OfficeState(createDefaultLayout());
    const starts = new Map([
      ['chair-left-1', { col: 2, row: 9 }],
      ['chair-left-2', { col: 2, row: 7 }],
      ['chair-right-1', { col: 8, row: 7 }],
      ['chair-right-2', { col: 8, row: 9 }],
      ['bench-1', { col: 3, row: 6 }],
      ['bench-2', { col: 7, row: 6 }],
    ]);

    expect(office.seats).toHaveLength(starts.size);
    for (const seat of office.seats) {
      const start = starts.get(seat.id);
      expect(start, `native seat ${seat.id} has a reachable-floor fixture`).toBeDefined();
      office.addAgent(seat.id, seat.id, 'Test', undefined, undefined, seat.id);
      const character = office.characters.get(seat.id)!;
      character.col = start!.col;
      character.row = start!.row;
      character.x = start!.col * 16 + 8;
      character.y = start!.row * 16 + 8;

      office.setAgentActive(seat.id, true);

      expect(office.blockedTiles.has(`${seat.col},${seat.row}`)).toBe(true);
      expect(office.walkableTiles.has(`${seat.col},${seat.row}`)).toBe(false);
      expect(character.state).toBe('walk');
      expect(character.path.at(-1)).toEqual({ col: seat.col, row: seat.row });
      expect(character.path.slice(0, -1).some((step) => office.blockedTiles.has(`${step.col},${step.row}`)))
        .toBe(false);
    }
  });

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

  it.each([
    ['the right edge', 5, []],
    ['beside existing furniture', 8, [{ uid: 'neighbor', type: 'bookshelf', col: 5, row: 2, rotation: 0 }]],
  ] as const)('keeps mismatched state variants off at %s', (_description, cols, neighbors) => {
    buildDynamicCatalog([
      asset('pa_mismatch_off', { groupId: 'pa_mismatch', state: 'off' }),
      sizedAsset('pa_mismatch_on', 2, 1, { groupId: 'pa_mismatch', state: 'on' }),
    ]);
    const layout: OfficeLayout = {
      version: 2,
      cols,
      rows: 5,
      tiles: Array(cols * 5).fill(1),
      furniture: [
        { uid: 'desk', type: 'desk', col: 2, row: 2, rotation: 0 },
        { uid: 'seat', type: 'chair', col: 1, row: 2, rotation: 0 },
        placed('pa_mismatch_off', { uid: 'mismatch', col: 4, row: 2 }),
        ...neighbors,
      ],
    };
    const original = structuredClone(layout);
    const office = new OfficeState(layout);
    office.addAgent('fixture-agent', 'Fixture Agent', 'Test', undefined, undefined, 'seat');
    office.setAgentActive('fixture-agent', true);

    expect(getToggledType('pa_mismatch_off')).toBeNull();
    expect(office.furniture.find((item) => item.uid === 'mismatch')?.type).toBe('pa_mismatch_off');
    expect(office.getLayout()).toBe(layout);
    expect(layout).toEqual(original);
  });

  it('swaps occupied seats and routes both agents to their assigned chair tiles', () => {
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
    office.addAgent('second-agent', 'Second Agent', 'Test', undefined, undefined, 'seat-b');
    expect(office.furniture.find((item) => item.uid === 'pc-a')?.type).toBe('pa_pc_front_on_0');
    expect(office.furniture.find((item) => item.uid === 'pc-b')?.type).toBe('pa_pc_front_off');

    office.reassignSeat('fixture-agent', 'seat-b');
    expect(office.furniture.find((item) => item.uid === 'pc-a')?.type).toBe('pa_pc_front_off');
    expect(office.furniture.find((item) => item.uid === 'pc-b')?.type).toBe('pa_pc_front_on_0');
    expect(office.characters.get('fixture-agent')?.seatId).toBe('seat-b');
    expect(office.characters.get('second-agent')?.seatId).toBe('seat-a');
    expect(office.seats.find((seat) => seat.id === 'seat-a')?.occupant).toBe('second-agent');
    expect(office.seats.find((seat) => seat.id === 'seat-b')?.occupant).toBe('fixture-agent');
    expect(office.characters.get('fixture-agent')?.path.at(-1)).toEqual({ col: 7, row: 3 });
    expect(office.characters.get('second-agent')?.path.at(-1)).toEqual({ col: 2, row: 3 });
    expect(office.getLayout()).toBe(layout);
    expect(layout).toEqual(original);
  });

  it('routes rotated role-based desks and seats while keeping their furniture footprints blocked', () => {
    const layout: OfficeLayout = {
      version: 2,
      cols: 8,
      rows: 8,
      tiles: Array(64).fill(1),
      furniture: [
        {
          uid: 'role-desk',
          type: 'custom-desk',
          col: 2,
          row: 3,
          rotation: 90,
          assetRole: 'desk',
          assetFootprint: { width: 1, height: 2 },
        },
        {
          uid: 'role-seat',
          type: 'custom-seat',
          col: 3,
          row: 4,
          rotation: 90,
          assetRole: 'seat',
          assetFootprint: { width: 2, height: 1 },
        },
      ],
    };
    const office = new OfficeState(layout);
    office.addAgent('role-agent', 'Role Agent', 'Test');
    const character = office.characters.get('role-agent')!;
    character.col = 2;
    character.row = 4;
    character.x = 40;
    character.y = 72;

    expect(office.seats).toMatchObject([{ id: 'role-seat', col: 3, row: 4 }]);
    expect(office.seats[0].direction).toBe(Direction.UP);
    expect(office.blockedTiles.has('3,3')).toBe(true);
    expect(office.blockedTiles.has('3,4')).toBe(true);
    expect(office.blockedTiles.has('3,5')).toBe(true);
    expect(office.walkableTiles.has('3,4')).toBe(false);

    office.setAgentActive('role-agent', true);

    expect(character.state).toBe('walk');
    expect(character.path).toEqual([{ col: 3, row: 4 }]);
    expect(office.blockedTiles.has('3,4')).toBe(true);
    expect(office.blockedTiles.has('3,5')).toBe(true);
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
