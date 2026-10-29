import { describe, it, expect, beforeEach } from 'vitest';
import { OfficeState } from './officeState.js';
import { appearanceFromIndex, reconcileAgents } from './agentSync.js';
import { TileType } from '../types.js';
import { sheetAppearance } from '../sprites/characterSheetRenderer.js';
import type { OfficeLayout } from '../types.js';

function twoSeatLayout(): OfficeLayout {
  return {
    version: 1,
    cols: 5,
    rows: 5,
    tiles: Array(25).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'desk-1', type: 'desk', col: 1, row: 1, rotation: 0 },
      { uid: 'chair-1', type: 'chair', col: 1, row: 2, rotation: 0 },
      { uid: 'desk-2', type: 'desk', col: 3, row: 1, rotation: 0 },
      { uid: 'chair-2', type: 'chair', col: 3, row: 2, rotation: 0 },
    ],
  };
}

describe('appearanceFromIndex', () => {
  it('maps the first six indices to distinct palettes without hue shift', () => {
    const palettes = [0, 1, 2, 3, 4, 5].map((i) => appearanceFromIndex(i));
    expect(new Set(palettes.map((p) => p.palette)).size).toBe(6);
    expect(palettes.every((p) => p.hueShift === 0)).toBe(true);
  });

  it('adds a hue rotation once palettes wrap', () => {
    expect(appearanceFromIndex(6)).toEqual({ palette: 0, hueShift: 45 });
    expect(appearanceFromIndex(13)).toEqual({ palette: 1, hueShift: 90 });
  });

  it('treats invalid indices as zero', () => {
    expect(appearanceFromIndex(undefined)).toEqual({ palette: 0, hueShift: 0 });
    expect(appearanceFromIndex(-3)).toEqual({ palette: 0, hueShift: 0 });
  });
});

describe('reconcileAgents', () => {
  let office: OfficeState;

  beforeEach(() => {
    office = new OfficeState(twoSeatLayout());
  });

  it('adds agents with their stored appearance and seat', () => {
    reconcileAgents(office, [
      { id: 'homer', name: 'Homer', role: 'Lead', paletteIndex: 7, seatId: 'chair-2', status: 'idle' },
    ]);
    const homer = office.characters.get('homer')!;
    expect(homer.palette).toBe(1);
    expect(homer.hueShift).toBe(45);
    expect(homer.seatId).toBe('chair-2');
  });

  it('is idempotent when the same snapshot is delivered twice', () => {
    const snapshot = [
      { id: 'homer', name: 'Homer', role: 'Lead', paletteIndex: 0 },
      { id: 'marge', name: 'Marge', role: 'Dev', paletteIndex: 1 },
    ];
    reconcileAgents(office, snapshot);
    const second = reconcileAgents(office, snapshot);
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([]);
    expect(office.characters.size).toBe(2);
  });

  it('removes agents missing from the snapshot', () => {
    reconcileAgents(office, [
      { id: 'homer', name: 'Homer', role: 'Lead', paletteIndex: 0 },
      { id: 'marge', name: 'Marge', role: 'Dev', paletteIndex: 1 },
    ]);
    const result = reconcileAgents(office, [{ id: 'marge', name: 'Marge', role: 'Dev', paletteIndex: 1 }]);
    expect(result.removed).toEqual(['homer']);
    expect(office.characters.has('homer')).toBe(false);
  });

  it('applies active and waiting status from the snapshot', () => {
    reconcileAgents(office, [
      { id: 'homer', name: 'Homer', role: 'Lead', paletteIndex: 0, status: 'active' },
      { id: 'marge', name: 'Marge', role: 'Dev', paletteIndex: 1, status: 'waiting' },
    ]);
    expect(office.characters.get('homer')!.active).toBe(true);
    expect(office.characters.get('marge')!.bubbleState.type).toBe('waiting');

    reconcileAgents(office, [
      { id: 'homer', name: 'Homer', role: 'Lead', paletteIndex: 0, status: 'active' },
      { id: 'marge', name: 'Marge', role: 'Dev', paletteIndex: 1, status: 'active' },
    ]);
    expect(office.characters.get('marge')!.bubbleState.type).toBe('none');
  });

  it('renders the same appearance regardless of delivery order', () => {
    const other = new OfficeState(twoSeatLayout());
    const a = { id: 'homer', name: 'Homer', role: 'Lead', paletteIndex: 3 };
    const b = { id: 'marge', name: 'Marge', role: 'Dev', paletteIndex: 9 };
    reconcileAgents(office, [a, b]);
    reconcileAgents(other, [b, a]);
    for (const id of ['homer', 'marge']) {
      expect(other.characters.get(id)!.palette).toBe(office.characters.get(id)!.palette);
      expect(other.characters.get(id)!.hueShift).toBe(office.characters.get(id)!.hueShift);
    }
  });
});

describe('OfficeState.reassignSeat swap', () => {
  it('swaps a displaced occupant into the vacated seat', () => {
    const office = new OfficeState(twoSeatLayout());
    office.addAgent('homer', 'Homer', 'Lead', 0, 0, 'chair-1');
    office.addAgent('marge', 'Marge', 'Dev', 1, 0, 'chair-2');

    expect(office.reassignSeat('homer', 'chair-2')).toBe(true);
    expect(office.getSeatAssignments()).toEqual({ homer: 'chair-2', marge: 'chair-1' });
    expect(office.seats.find((s) => s.id === 'chair-1')?.occupant).toBe('marge');
  });

  it('ignores unknown seats and no-op moves', () => {
    const office = new OfficeState(twoSeatLayout());
    office.addAgent('homer', 'Homer', 'Lead', 0, 0, 'chair-1');
    expect(office.reassignSeat('homer', 'nope')).toBe(false);
    expect(office.reassignSeat('homer', 'chair-1')).toBe(false);
    expect(office.getSeatAssignments()).toEqual({ homer: 'chair-1' });
  });
});

describe('sheetAppearance', () => {
  it('keeps six palettes visually distinct with two PNG sheets', () => {
    const looks = [0, 1, 2, 3, 4, 5].map((p) => {
      const a = sheetAppearance(p, 0);
      return `${a.sheetKey}:${a.hueDegrees}`;
    });
    expect(new Set(looks).size).toBe(6);
    expect(sheetAppearance(0, 0)).toEqual({ sheetKey: 'A', hueDegrees: 0 });
  });

  it('distinguishes wrapped appearance indices by hue', () => {
    const first = appearanceFromIndex(0);
    const wrapped = appearanceFromIndex(6);
    const a = sheetAppearance(first.palette, first.hueShift);
    const b = sheetAppearance(wrapped.palette, wrapped.hueShift);
    expect(a.sheetKey).toBe(b.sheetKey);
    expect(a.hueDegrees).not.toBe(b.hueDegrees);
  });
});
