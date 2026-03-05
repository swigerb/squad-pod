import { describe, it, expect } from 'vitest';
import { createCharacter, updateCharacter } from './characters.js';
import { CharacterState, Direction, TileType } from '../types.js';
import type { Seat } from '../types.js';

describe('characters', () => {
  describe('createCharacter', () => {
    it('creates character with correct properties', () => {
      const character = createCharacter(
        'homer-simpson',
        'Homer Simpson',
        'Lead',
        2,
        null,
        null,
        120
      );

      expect(character.id).toBe('homer-simpson');
      expect(character.name).toBe('Homer Simpson');
      expect(character.role).toBe('Lead');
      expect(character.palette).toBe(2);
      expect(character.hueShift).toBe(120);
      expect(character.state).toBe(CharacterState.IDLE);
      expect(character.direction).toBe(Direction.DOWN);
      expect(character.path).toEqual([]);
      expect(character.active).toBe(false);
    });

    it('creates character at default position when no seat', () => {
      const character = createCharacter(
        'homer-simpson',
        'Homer Simpson',
        'Lead',
        0,
        null,
        null,
        0
      );

      expect(character.col).toBe(1);
      expect(character.row).toBe(1);
      expect(character.x).toBe(24); // 1 * 16 + 8
      expect(character.y).toBe(24);
    });

    it('creates character at seat position when provided', () => {
      const seat: Seat = {
        id: 'chair-1',
        col: 5,
        row: 3,
        direction: Direction.UP
      };

      const character = createCharacter(
        'homer-simpson',
        'Homer Simpson',
        'Lead',
        0,
        'chair-1',
        seat,
        0
      );

      expect(character.col).toBe(5);
      expect(character.row).toBe(3);
      expect(character.x).toBe(88); // 5 * 16 + 8
      expect(character.y).toBe(56); // 3 * 16 + 8
      expect(character.seatId).toBe('chair-1');
    });

    it('initializes timers with random values', () => {
      const char1 = createCharacter('id1', 'Name', 'Role', 0, null, null, 0);
      const char2 = createCharacter('id2', 'Name', 'Role', 0, null, null, 0);

      // Both should have timers set
      expect(char1.wanderTimer).toBeGreaterThan(0);
      expect(char1.wanderLimit).toBeGreaterThan(0);
      expect(char2.wanderTimer).toBeGreaterThan(0);
      expect(char2.wanderLimit).toBeGreaterThan(0);
    });
  });

  describe('updateCharacter', () => {
    it('idle character starts walking after wander timer expires', () => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.state = CharacterState.IDLE;
      character.wanderTimer = 0.01; // Very short timer

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      const walkableTiles = new Set<string>();
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          walkableTiles.add(`${c},${r}`);
        }
      }
      const seats: Seat[] = [];
      const blockedTiles = new Set<string>();

      updateCharacter(character, 0.02, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.state).toBe(CharacterState.WALK);
      expect(character.path.length).toBeGreaterThan(0);
    });

    it('walking character completes path and returns to idle', () => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.state = CharacterState.WALK;
      character.path = [{ col: 2, row: 1 }];
      character.col = 1;
      character.row = 1;
      character.moveProgress = 0;

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      const walkableTiles = new Set<string>();
      const seats: Seat[] = [];
      const blockedTiles = new Set<string>();

      // Advance time to complete one tile move
      updateCharacter(character, 1.0, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.col).toBe(2);
      expect(character.row).toBe(1);
      expect(character.path.length).toBe(0);
      expect(character.state).toBe(CharacterState.IDLE);
    });

    it('active character at seat enters TYPE state', () => {
      const seat: Seat = {
        id: 'chair-1',
        col: 2,
        row: 2,
        direction: Direction.UP
      };

      const character = createCharacter('id', 'Name', 'Role', 0, 'chair-1', seat, 0);
      character.state = CharacterState.IDLE;
      character.active = true;
      character.col = 2;
      character.row = 2;

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      const walkableTiles = new Set<string>();
      const seats: Seat[] = [seat];
      const blockedTiles = new Set<string>();

      updateCharacter(character, 0.1, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.state).toBe(CharacterState.TYPE);
      expect(character.direction).toBe(Direction.UP);
    });

    it('active character not at seat starts walking to seat', () => {
      const seat: Seat = {
        id: 'chair-1',
        col: 5,
        row: 5,
        direction: Direction.UP
      };

      const character = createCharacter('id', 'Name', 'Role', 0, 'chair-1', seat, 0);
      character.state = CharacterState.IDLE;
      character.active = true;
      character.col = 1;
      character.row = 1;

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      const walkableTiles = new Set<string>();
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          walkableTiles.add(`${c},${r}`);
        }
      }
      const seats: Seat[] = [seat];
      const blockedTiles = new Set<string>();

      updateCharacter(character, 0.1, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.state).toBe(CharacterState.WALK);
      expect(character.path.length).toBeGreaterThan(0);
      expect(character.path[character.path.length - 1]).toEqual({ col: 5, row: 5 });
    });

    it('TYPE state advances frame animation', () => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.state = CharacterState.TYPE;
      character.active = true;
      character.frameIndex = 0;
      character.frameTimer = 0;

      const tileMap: number[][] = [];
      const walkableTiles = new Set<string>();
      const seats: Seat[] = [];
      const blockedTiles = new Set<string>();

      // Advance time to trigger frame change (TYPE_FRAME_DURATION_SEC is typically ~0.2)
      updateCharacter(character, 0.3, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.frameIndex).toBe(1);
    });

    it('WALK state advances frame animation', () => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.state = CharacterState.WALK;
      character.path = [{ col: 2, row: 1 }, { col: 3, row: 1 }];
      character.col = 1;
      character.row = 1;
      character.frameIndex = 0;
      character.frameTimer = 0;

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      const walkableTiles = new Set<string>();
      const seats: Seat[] = [];
      const blockedTiles = new Set<string>();

      // Advance time to trigger frame change (WALK_FRAME_DURATION_SEC is typically ~0.15)
      updateCharacter(character, 0.2, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.frameIndex).toBeGreaterThan(0);
    });

    it('character direction updates based on movement', () => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.state = CharacterState.WALK;
      character.path = [{ col: 3, row: 1 }]; // Moving right
      character.col = 2;
      character.row = 1;
      character.moveProgress = 0;
      character.direction = Direction.DOWN;

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      const walkableTiles = new Set<string>();
      const seats: Seat[] = [];
      const blockedTiles = new Set<string>();

      updateCharacter(character, 1.0, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.direction).toBe(Direction.RIGHT);
    });
  });
});
