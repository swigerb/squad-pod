import { describe, it, expect } from 'vitest';
import { findPath, getWalkableTiles } from './pathfinding.js';
import { TileType } from '../types.js';

describe('pathfinding', () => {
  describe('findPath', () => {
    it('finds basic path in simple 5x5 grid', () => {
      const tileMap = [
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1]
      ];
      const blockedTiles = new Set<string>();

      const path = findPath(1, 1, 3, 3, tileMap, blockedTiles);

      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual({ col: 3, row: 3 });

      for (let i = 1; i < path.length; i++) {
        const prev = i === 0 ? { col: 1, row: 1 } : path[i - 1];
        const curr = path[i];
        const dx = Math.abs(curr.col - prev.col);
        const dy = Math.abs(curr.row - prev.row);
        expect(dx + dy).toBe(1); // Each step is adjacent
      }
    });

    it('finds path around blocked tiles', () => {
      const tileMap = [
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1]
      ];
      const blockedTiles = new Set<string>(['2,1', '2,2', '2,3']);

      const path = findPath(1, 2, 3, 2, tileMap, blockedTiles);

      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual({ col: 3, row: 2 });

      for (const step of path) {
        expect(blockedTiles.has(`${step.col},${step.row}`)).toBe(false);
      }
    });

    it('returns empty array when no path exists', () => {
      const tileMap = [
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.WALL, TileType.WALL, TileType.WALL],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1]
      ];
      const blockedTiles = new Set<string>();

      const path = findPath(1, 0, 1, 2, tileMap, blockedTiles);

      expect(path).toEqual([]);
    });

    it('returns empty array when start equals end', () => {
      const tileMap = [
        [TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1]
      ];
      const blockedTiles = new Set<string>();

      const path = findPath(1, 1, 1, 1, tileMap, blockedTiles);

      expect(path).toEqual([]);
    });

    it('finds single-step path for adjacent tiles', () => {
      const tileMap = [
        [TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1]
      ];
      const blockedTiles = new Set<string>();

      const path = findPath(0, 0, 1, 0, tileMap, blockedTiles);

      expect(path.length).toBe(1);
      expect(path[0]).toEqual({ col: 1, row: 0 });
    });

    it('returns empty array when destination is blocked', () => {
      const tileMap = [
        [TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1]
      ];
      const blockedTiles = new Set<string>(['1,1']);

      const path = findPath(0, 0, 1, 1, tileMap, blockedTiles);

      expect(path).toEqual([]);
    });

    it('returns empty array when destination is wall', () => {
      const tileMap = [
        [TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.WALL]
      ];
      const blockedTiles = new Set<string>();

      const path = findPath(0, 0, 1, 1, tileMap, blockedTiles);

      expect(path).toEqual([]);
    });
  });

  describe('getWalkableTiles', () => {
    it('returns only floor tiles not in blocked set', () => {
      const tileMap = [
        [TileType.WALL, TileType.FLOOR_1, TileType.FLOOR_1],
        [TileType.FLOOR_1, TileType.FLOOR_1, TileType.WALL],
        [TileType.VOID, TileType.FLOOR_1, TileType.FLOOR_1]
      ];
      const blockedTiles = new Set<string>(['1,1']);

      const walkable = getWalkableTiles(tileMap, blockedTiles);

      expect(walkable.has('1,0')).toBe(true);
      expect(walkable.has('2,0')).toBe(true);
      expect(walkable.has('0,1')).toBe(true);
      expect(walkable.has('1,2')).toBe(true);
      expect(walkable.has('2,2')).toBe(true);

      expect(walkable.has('0,0')).toBe(false); // Wall
      expect(walkable.has('2,1')).toBe(false); // Wall
      expect(walkable.has('0,2')).toBe(false); // Void
      expect(walkable.has('1,1')).toBe(false); // Blocked
    });

    it('returns empty set when all tiles are walls', () => {
      const tileMap = [
        [TileType.WALL, TileType.WALL],
        [TileType.WALL, TileType.WALL]
      ];
      const blockedTiles = new Set<string>();

      const walkable = getWalkableTiles(tileMap, blockedTiles);

      expect(walkable.size).toBe(0);
    });

    it('returns all tiles when none are blocked or walls', () => {
      const tileMap = [
        [TileType.FLOOR_1, TileType.FLOOR_2],
        [TileType.FLOOR_3, TileType.FLOOR_4]
      ];
      const blockedTiles = new Set<string>();

      const walkable = getWalkableTiles(tileMap, blockedTiles);

      expect(walkable.size).toBe(4);
      expect(walkable.has('0,0')).toBe(true);
      expect(walkable.has('1,0')).toBe(true);
      expect(walkable.has('0,1')).toBe(true);
      expect(walkable.has('1,1')).toBe(true);
    });
  });
});
