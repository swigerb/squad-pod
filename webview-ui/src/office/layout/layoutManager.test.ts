import { afterEach, describe, it, expect } from 'vitest';
import {
  layoutToTileMap,
  layoutToSeats,
  layoutToFurnitureInstances,
  getBlockedTiles,
  getSeatTiles,
  createDefaultLayout,
  serializeLayout,
  deserializeLayout,
} from './layoutManager.js';
import { TileType, Direction } from '../types.js';
import type { OfficeLayout, PlacedFurniture } from '../types.js';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';
import { buildDynamicCatalog } from './furnitureCatalog.js';

function chairAsset(type: string, width: number, height: number, backgroundTiles: number): ManifestFurniture {
  return {
    type, label: type, width, height,
    sprite: Array.from({ length: height * 16 }, () => Array<string>(width * 16).fill('#ffffff')),
    isDesk: false, category: 'chairs', canPlaceOnSurfaces: false, canPlaceOnWalls: false, backgroundTiles,
  };
}

afterEach(() => { buildDynamicCatalog([]); });

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
    it.each([
      { rotation: 0, col: 2, row: 3, deskCol: 3, deskRow: 3, direction: Direction.RIGHT },
      { rotation: 90, col: 2, row: 2, deskCol: 0, deskRow: 2, direction: Direction.LEFT },
      { rotation: 180, col: 2, row: 2, deskCol: 2, deskRow: 1, direction: Direction.UP },
      { rotation: 270, col: 3, row: 2, deskCol: 4, deskRow: 2, direction: Direction.RIGHT },
    ])('maps a background row through a $rotation-degree chair turn', ({ rotation, col, row, deskCol, deskRow, direction }) => {
      buildDynamicCatalog([chairAsset('pa_tall-chair', 1, 2, 1)]);
      const furniture: PlacedFurniture[] = [
        {
          uid: 'stable-chair', type: 'pa_tall-chair', col: 2, row: 2, rotation,
          assetFootprint: { width: 1, height: 2 },
        },
        { uid: 'desk-1', type: 'desk', col: deskCol, row: deskRow, rotation: 0, assetRole: 'desk' },
      ];

      expect(layoutToSeats(furniture)).toEqual([
        { id: 'stable-chair', col, row, direction },
      ]);
      expect(getSeatTiles(furniture)).toEqual(new Set([`${col},${row}`]));
    });

    it('keeps a one-tile bench at its origin when backgroundTiles is zero', () => {
      buildDynamicCatalog([chairAsset('pa_bench', 1, 1, 0)]);
      const furniture: PlacedFurniture[] = [
        {
          uid: 'bench-1', type: 'pa_bench', col: 2, row: 2, rotation: 0,
          assetFootprint: { width: 1, height: 1 },
        },
        { uid: 'desk-1', type: 'desk', col: 2, row: 1, rotation: 0, assetRole: 'desk' },
      ];

      expect(layoutToSeats(furniture)).toEqual([
        { id: 'bench-1', col: 2, row: 2, direction: Direction.UP },
      ]);
    });

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
    it('creates the source-faithful office layout with intact walls, floors and void', () => {
      const layout = createDefaultLayout();

      expect(layout.cols).toBe(21);
      expect(layout.rows).toBe(13);
      expect(layout.tiles.length).toBe(layout.cols * layout.rows);

      const tileMap = layoutToTileMap(layout);

      expect(tileMap[0].every((tile) => tile === TileType.VOID)).toBe(true);
      expect(tileMap[1].slice(0, 20).every((tile) => tile === TileType.WALL)).toBe(true);
      expect(tileMap[1][20]).toBe(TileType.VOID);
      expect(tileMap[2][10]).toBe(TileType.WALL);
      expect(tileMap[5][10]).toBe(TileType.FLOOR_1);
      expect(tileMap[10][10]).toBe(TileType.WALL);
      expect(tileMap[10][18]).toBe(TileType.FLOOR_9);
      expect(tileMap[12].every((tile) => tile === TileType.VOID)).toBe(true);
      expect(layout.tiles.filter((tile) => tile === TileType.FLOOR_7)).not.toHaveLength(0);
    });

    it('creates the reference furniture with explicit footprints and four conference seats', () => {
      const layout = createDefaultLayout();

      expect(layout.furniture).toHaveLength(36);
      expect(new Set(layout.furniture.map((item) => item.uid)).size).toBe(36);
      expect(layout.furniture.every((item) => item.assetFootprint
        && item.col >= 0 && item.row >= 0
        && item.col + item.assetFootprint.width <= layout.cols
        && item.row + item.assetFootprint.height <= layout.rows)).toBe(true);
      expect(layoutToSeats(layout.furniture).map((seat) => seat.id)).toEqual([
        'chair-left-1', 'chair-left-2', 'chair-right-1', 'chair-right-2',
        'bench-1', 'bench-2',
      ]);
      expect(layout.tileColors).toHaveProperty('0,0');
    });

    describe('pet layout compatibility', () => {
      it('round-trips persisted pet identities and leaves petless legacy imports unchanged', () => {
        const withPets: OfficeLayout = {
          version: 2, cols: 2, rows: 2, tiles: Array(4).fill(TileType.FLOOR_1), furniture: [],
          pets: [{ id: 'companion-1', petType: 1 }],
        };
        expect(deserializeLayout(serializeLayout(withPets))).toEqual(withPets);
        const legacy = { version: 2, cols: 2, rows: 2, tiles: Array(4).fill(TileType.FLOOR_1), furniture: [] };
        expect(deserializeLayout(JSON.stringify(legacy))).toEqual(legacy);
      });

      it('rejects invalid pet records before an import can replace the current layout', () => {
        const valid: OfficeLayout = {
          version: 2, cols: 2, rows: 2, tiles: Array(4).fill(TileType.FLOOR_1), furniture: [],
          pets: [{ id: 'companion-1', petType: 0 }],
        };
        for (const pets of [
          [{ id: '', petType: 0 }],
          [{ id: 'duplicate', petType: 0 }, { id: 'duplicate', petType: 1 }],
          [{ id: 'bad-type', petType: -1 }],
          [{ id: 'bad-type', petType: Number.NaN }],
        ]) {
          expect(() => deserializeLayout(JSON.stringify({ ...valid, pets }))).toThrow('Invalid layout format');
        }
      });
    });
  });
});
