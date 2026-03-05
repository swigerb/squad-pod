import { describe, it, expect, beforeEach } from 'vitest';
import { OfficeState } from './officeState.js';
import { TileType, CharacterState } from '../types.js';
import type { OfficeLayout } from '../types.js';

describe('OfficeState', () => {
  let officeState: OfficeState;

  beforeEach(() => {
    const layout: OfficeLayout = {
      version: 1,
      cols: 5,
      rows: 5,
      tiles: [
        TileType.WALL, TileType.WALL, TileType.WALL, TileType.WALL, TileType.WALL,
        TileType.WALL, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.WALL,
        TileType.WALL, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.WALL,
        TileType.WALL, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.WALL,
        TileType.WALL, TileType.WALL, TileType.WALL, TileType.WALL, TileType.WALL
      ],
      furniture: [
        { uid: 'desk-1', type: 'desk', col: 2, row: 1, rotation: 0 },
        { uid: 'chair-1', type: 'chair', col: 2, row: 2, rotation: 0 }
      ]
    };
    officeState = new OfficeState(layout);
  });

  describe('constructor', () => {
    it('creates empty state with default layout', () => {
      const emptyState = new OfficeState();

      expect(emptyState.characters.size).toBe(0);
      expect(emptyState.layout.cols).toBe(0);
      expect(emptyState.layout.rows).toBe(0);
    });

    it('creates state with provided layout', () => {
      expect(officeState.layout.cols).toBe(5);
      expect(officeState.layout.rows).toBe(5);
      expect(officeState.tileMap.length).toBe(5);
      expect(officeState.tileMap[0].length).toBe(5);
    });
  });

  describe('addAgent', () => {
    it('adds an agent and assigns seat', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      expect(officeState.characters.size).toBe(1);
      expect(officeState.characters.has('homer-simpson')).toBe(true);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.id).toBe('homer-simpson');
      expect(character.name).toBe('Homer Simpson');
      expect(character.role).toBe('Lead');
      expect(character.seatId).toBe('chair-1');

      const seat = officeState.seats.find(s => s.id === 'chair-1');
      expect(seat?.occupant).toBe('homer-simpson');
    });

    it('does not create duplicate when adding same ID twice', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      expect(officeState.characters.size).toBe(1);
    });

    it('assigns preferred seat if available', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead', 0, 0, 'chair-1');

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.seatId).toBe('chair-1');
    });

    it('assigns palette and hue shift', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead', 2, 120);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.palette).toBe(2);
      expect(character.hueShift).toBe(120);
    });

    it('auto-assigns palette when not provided', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.palette).toBeGreaterThanOrEqual(0);
      expect(character.palette).toBeLessThan(6);
      expect(character.hueShift).toBeGreaterThanOrEqual(0);
    });
  });

  describe('removeAgent', () => {
    it('removes agent and frees seat', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      officeState.removeAgent('homer-simpson');

      expect(officeState.characters.has('homer-simpson')).toBe(false);

      const seat = officeState.seats.find(s => s.id === 'chair-1');
      expect(seat?.occupant).toBeNull();
    });

    it('clears selected agent if removed', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      officeState.selectedAgentId = 'homer-simpson';
      officeState.removeAgent('homer-simpson');

      expect(officeState.selectedAgentId).toBeNull();
    });

    it('does nothing when agent does not exist', () => {
      officeState.removeAgent('nonexistent');
      expect(officeState.characters.size).toBe(0);
    });
  });

  describe('reassignSeat', () => {
    it('reassigns agent to different seat', () => {
      const layout: OfficeLayout = {
        version: 1,
        cols: 5,
        rows: 5,
        tiles: Array(25).fill(TileType.FLOOR_1),
        furniture: [
          { uid: 'desk-1', type: 'desk', col: 1, row: 1, rotation: 0 },
          { uid: 'chair-1', type: 'chair', col: 1, row: 2, rotation: 0 },
          { uid: 'desk-2', type: 'desk', col: 3, row: 1, rotation: 0 },
          { uid: 'chair-2', type: 'chair', col: 3, row: 2, rotation: 0 }
        ]
      };
      officeState = new OfficeState(layout);

      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      const oldSeatId = officeState.characters.get('homer-simpson')!.seatId;
      expect(oldSeatId).toBe('chair-1');

      officeState.reassignSeat('homer-simpson', 'chair-2');

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.seatId).toBe('chair-2');

      const oldSeat = officeState.seats.find(s => s.id === 'chair-1');
      expect(oldSeat?.occupant).toBeNull();

      const newSeat = officeState.seats.find(s => s.id === 'chair-2');
      expect(newSeat?.occupant).toBe('homer-simpson');
    });
  });

  describe('getSeatAtTile', () => {
    it('returns seat ID for occupied tile', () => {
      const seatId = officeState.getSeatAtTile(2, 2);
      expect(seatId).toBe('chair-1');
    });

    it('returns null for empty tile', () => {
      const seatId = officeState.getSeatAtTile(1, 1);
      expect(seatId).toBeNull();
    });
  });

  describe('rebuildFromLayout', () => {
    it('rebuilds with new layout and retains character seats', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      const newLayout: OfficeLayout = {
        version: 1,
        cols: 5,
        rows: 5,
        tiles: Array(25).fill(TileType.FLOOR_1),
        furniture: [
          { uid: 'desk-1', type: 'desk', col: 2, row: 1, rotation: 0 },
          { uid: 'chair-1', type: 'chair', col: 2, row: 2, rotation: 0 }
        ]
      };

      officeState.rebuildFromLayout(newLayout, true);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.seatId).toBe('chair-1');
      expect(character.col).toBe(2);
      expect(character.row).toBe(2);
    });

    it('places character randomly if seat no longer exists', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      const newLayout: OfficeLayout = {
        version: 1,
        cols: 5,
        rows: 5,
        tiles: Array(25).fill(TileType.FLOOR_1),
        furniture: []
      };

      officeState.rebuildFromLayout(newLayout, true);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.seatId).toBeNull();
      expect(character.col).toBeGreaterThanOrEqual(0);
      expect(character.row).toBeGreaterThanOrEqual(0);
    });
  });

  describe('setAgentActive', () => {
    it('sets agent active and changes state to TYPE', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      const character = officeState.characters.get('homer-simpson')!;
      character.state = CharacterState.IDLE;

      officeState.setAgentActive('homer-simpson', true);

      expect(character.active).toBe(true);
      expect(character.state).toBe(CharacterState.TYPE);
    });

    it('sets agent inactive and changes state to IDLE', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      officeState.setAgentActive('homer-simpson', true);

      officeState.setAgentActive('homer-simpson', false);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.active).toBe(false);
      expect(character.state).toBe(CharacterState.IDLE);
    });

    it('does nothing when agent does not exist', () => {
      officeState.setAgentActive('nonexistent', true);
      expect(officeState.characters.size).toBe(0);
    });
  });
});
