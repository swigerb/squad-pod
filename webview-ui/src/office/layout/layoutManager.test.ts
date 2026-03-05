import { describe, it, expect } from 'vitest';
import {
  layoutToTileMap,
  layoutToSeats,
  layoutToFurnitureInstances,
  getBlockedTiles,
  getSeatTiles,
  createDefaultLayout
} from './layoutManager.js';
import { TileType, Direction } from '../types.js';
import type { OfficeLayout, PlacedFurniture } from '../types.js';

describe('layoutManager', () => {
  describe('layoutToTileMap', () => {
    it('converts layout to 2D tile array', () => {
      const layout: OfficeLayout = {
        cols: 3,
        rows: 2,
        tiles: [
          TileType.WALL, TileType.FLOOR_1, TileType.WALL,
          TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1
        ],
        furniture: []
      };

      const tileMap = layoutToTileMap(layout);

      expect(tileMap.length).toBe(2);
      expect(tileMap[0]).toEqual([TileType.WALL, TileType.FLOOR_1, TileType.WALL]);
      expect(tileMap[1]).toEqual([TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1]);
    });

    it('handles single row layout', () => {
      const layout: OfficeLayout = {
        cols: 4,
        rows: 1,
        tiles: [TileType.FLOOR_1, TileType.FLOOR_2, TileType.FLOOR_3, TileType.FLOOR_4],
        furniture: []
      };

      const tileMap = layoutToTileMap(layout);

      expect(tileMap.length).toBe(1);
      expect(tileMap[0].length).toBe(4);
    });
  });

  describe('layoutToSeats', () => {
    it('creates seats for desk+chair pairs', () => {
      const furniture: PlacedFurniture[] = [
        { uid: 'desk-1', type: 'desk', col: 2, row: 2, rotation: 0 },
        { uid: 'chair-1', type: 'chair', col: 2, row: 3, rotation: 0 }, // Chair south of desk
        { uid: 'desk-2', type: 'desk', col: 5, row: 5, rotation: 0 },
        { uid: 'chair-2', type: 'chair', col: 4, row: 5, rotation: 0 } // Chair west of desk
      ];

      const seats = layoutToSeats(furniture);

      expect(seats.length).toBe(2);

      const seat1 = seats.find(s => s.id === 'chair-1');
      expect(seat1).toBeDefined();
      expect(seat1?.col).toBe(2);
      expect(seat1?.row).toBe(3);
      expect(seat1?.direction).toBe(Direction.UP); // Chair facing desk to north

      const seat2 = seats.find(s => s.id === 'chair-2');
      expect(seat2).toBeDefined();
      expect(seat2?.col).toBe(4);
      expect(seat2?.row).toBe(5);
      expect(seat2?.direction).toBe(Direction.RIGHT); // Chair facing desk to east
    });

    it('does not create seat for chair without adjacent desk', () => {
      const furniture: PlacedFurniture[] = [
        { uid: 'desk-1', type: 'desk', col: 2, row: 2, rotation: 0 },
        { uid: 'chair-1', type: 'chair', col: 5, row: 5, rotation: 0 } // Far from desk
      ];

      const seats = layoutToSeats(furniture);

      expect(seats.length).toBe(0);
    });

    it('handles multiple desks with no chairs', () => {
      const furniture: PlacedFurniture[] = [
        { uid: 'desk-1', type: 'desk', col: 2, row: 2, rotation: 0 },
        { uid: 'desk-2', type: 'desk', col: 5, row: 5, rotation: 0 }
      ];

      const seats = layoutToSeats(furniture);

      expect(seats.length).toBe(0);
    });

    it('creates seat with correct direction for chair north of desk', () => {
      const furniture: PlacedFurniture[] = [
        { uid: 'desk-1', type: 'desk', col: 3, row: 4, rotation: 0 },
        { uid: 'chair-1', type: 'chair', col: 3, row: 3, rotation: 0 } // Chair north of desk
      ];

      const seats = layoutToSeats(furniture);

      expect(seats.length).toBe(1);
      expect(seats[0].direction).toBe(Direction.DOWN); // Facing south
    });

    it('creates seat with correct direction for chair east of desk', () => {
      const furniture: PlacedFurniture[] = [
        { uid: 'desk-1', type: 'desk', col: 3, row: 4, rotation: 0 },
        { uid: 'chair-1', type: 'chair', col: 4, row: 4, rotation: 0 } // Chair east of desk
      ];

      const seats = layoutToSeats(furniture);

      expect(seats.length).toBe(1);
      expect(seats[0].direction).toBe(Direction.LEFT); // Facing west
    });
  });

  describe('layoutToFurnitureInstances', () => {
    it('creates furniture instances with correct positions and sizes', () => {
      const furniture: PlacedFurniture[] = [
        { uid: 'desk-1', type: 'desk', col: 2, row: 3, rotation: 0 },
        { uid: 'chair-1', type: 'chair', col: 2, row: 4, rotation: 0 }
      ];

      const instances = layoutToFurnitureInstances(furniture);

      expect(instances.length).toBe(2);

      const desk = instances.find(i => i.uid === 'desk-1');
      expect(desk).toBeDefined();
      expect(desk?.type).toBe('desk');
      expect(desk?.col).toBe(2);
      expect(desk?.row).toBe(3);

      const chair = instances.find(i => i.uid === 'chair-1');
      expect(chair).toBeDefined();
      expect(chair?.type).toBe('chair');
      expect(chair?.col).toBe(2);
      expect(chair?.row).toBe(4);
    });

    it('handles empty furniture list', () => {
      const instances = layoutToFurnitureInstances([]);
      expect(instances.length).toBe(0);
    });
  });

  describe('getBlockedTiles', () => {
    it('returns desk and chair positions as blocked', () => {
      const furniture: PlacedFurniture[] = [
        { uid: 'desk-1', type: 'desk', col: 2, row: 2, rotation: 0 },
        { uid: 'chair-1', type: 'chair', col: 2, row: 3, rotation: 0 }
      ];

      const blocked = getBlockedTiles(furniture);

      expect(blocked.has('2,2')).toBe(true); // Desk
      expect(blocked.has('2,3')).toBe(true); // Chair
    });

    it('returns empty set for no furniture', () => {
      const blocked = getBlockedTiles([]);
      expect(blocked.size).toBe(0);
    });

    it('handles multi-tile furniture', () => {
      // Assuming some furniture takes 2x1 tiles
      const furniture: PlacedFurniture[] = [
        { uid: 'bookshelf-1', type: 'bookshelf', col: 3, row: 3, rotation: 0 }
      ];

      const blocked = getBlockedTiles(furniture);

      expect(blocked.size).toBeGreaterThan(0);
      expect(blocked.has('3,3')).toBe(true);
    });
  });

  describe('getSeatTiles', () => {
    it('returns seat tile positions', () => {
      const furniture: PlacedFurniture[] = [
        { uid: 'desk-1', type: 'desk', col: 2, row: 2, rotation: 0 },
        { uid: 'chair-1', type: 'chair', col: 2, row: 3, rotation: 0 }
      ];

      const seatTiles = getSeatTiles(furniture);

      expect(seatTiles.has('2,3')).toBe(true);
    });

    it('returns empty set when no seats exist', () => {
      const furniture: PlacedFurniture[] = [
        { uid: 'desk-1', type: 'desk', col: 2, row: 2, rotation: 0 }
      ];

      const seatTiles = getSeatTiles(furniture);

      expect(seatTiles.size).toBe(0);
    });
  });

  describe('createDefaultLayout', () => {
    it('creates valid layout with walls around edges', () => {
      const layout = createDefaultLayout();

      expect(layout.cols).toBeGreaterThan(0);
      expect(layout.rows).toBeGreaterThan(0);
      expect(layout.tiles.length).toBe(layout.cols * layout.rows);

      const tileMap = layoutToTileMap(layout);

      // Check corners are walls
      expect(tileMap[0][0]).toBe(TileType.WALL);
      expect(tileMap[0][layout.cols - 1]).toBe(TileType.WALL);
      expect(tileMap[layout.rows - 1][0]).toBe(TileType.WALL);
      expect(tileMap[layout.rows - 1][layout.cols - 1]).toBe(TileType.WALL);

      // Check center is floor
      const centerRow = Math.floor(layout.rows / 2);
      const centerCol = Math.floor(layout.cols / 2);
      expect(tileMap[centerRow][centerCol]).not.toBe(TileType.WALL);
    });

    it('creates layout with some furniture', () => {
      const layout = createDefaultLayout();

      expect(layout.furniture.length).toBeGreaterThan(0);
    });

    it('creates layout with tile colors', () => {
      const layout = createDefaultLayout();

      expect(layout.tileColors).toBeDefined();
      expect(Object.keys(layout.tileColors!).length).toBeGreaterThan(0);
    });
  });
});
