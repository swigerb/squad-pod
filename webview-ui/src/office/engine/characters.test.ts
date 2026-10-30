import { describe, it, expect } from 'vitest';
import { createCharacter, updateCharacter } from './characters.js';
import {
  WALK_FRAME_DURATION_SEC,
  TYPE_FRAME_DURATION_SEC,
  WANDER_PAUSE_MIN_SEC,
  WANDER_PAUSE_MAX_SEC
} from '../../constants.js';
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
      const walkableTiles = new Set(['2,1']);
      const seats: Seat[] = [];
      const blockedTiles = new Set<string>();

      updateCharacter(character, 0.02, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.state).toBe(CharacterState.WALK);
      expect(character.path.length).toBeGreaterThan(0);
      expect(character.path).toEqual([{ col: 2, row: 1 }]);
    });

    it.each([
      { scenario: 'the current cell is selected', candidates: ['1,1'] },
      { scenario: 'there are no candidates', candidates: [] }
    ])('idle character resets wander timer when $scenario', ({ candidates }) => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.wanderTimer = 0.01;

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      const walkableTiles = new Set(candidates);
      const seats: Seat[] = [];
      const blockedTiles = new Set<string>();

      updateCharacter(character, 0.02, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.state).toBe(CharacterState.IDLE);
      expect(character.path).toEqual([]);
      expect(character.wanderTimer).toBeGreaterThan(0);
      expect(character.wanderTimer).toBeGreaterThanOrEqual(WANDER_PAUSE_MIN_SEC);
      expect(character.wanderTimer).toBeLessThan(WANDER_PAUSE_MAX_SEC);
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

    it('does not start seated work until it reaches its blocked chair tile', () => {
      const seat: Seat = { id: 'chair-1', col: 5, row: 5, direction: Direction.LEFT };
      const character = createCharacter('id', 'Name', 'Role', 0, 'chair-1', seat, 0);
      character.col = 1;
      character.row = 1;
      character.x = 24;
      character.y = 24;
      character.active = true;
      const tileMap = Array.from({ length: 8 }, () => Array(8).fill(TileType.FLOOR_1));
      const blockedTiles = new Set(['5,5', '2,2']);

      updateCharacter(character, 0, new Set(), [seat], tileMap, blockedTiles);

      expect(character.state).toBe(CharacterState.WALK);
      expect(character.path.at(-1)).toEqual({ col: seat.col, row: seat.row });
      expect(character.path.slice(0, -1).some((step) => blockedTiles.has(`${step.col},${step.row}`))).toBe(false);

      for (let frame = 0; frame < 100 && character.state === CharacterState.WALK; frame++) {
        updateCharacter(character, 0.1, new Set(), [seat], tileMap, blockedTiles);
        if (character.state === CharacterState.WALK) {
          expect(character.path.at(-1)).toEqual({ col: seat.col, row: seat.row });
        }
      }

      expect(character.state).toBe(CharacterState.TYPE);
      expect(character.col).toBe(seat.col);
      expect(character.row).toBe(seat.row);
      expect(character.direction).toBe(Direction.LEFT);
    });

    it('retargets an in-flight wander step to the assigned seat on activation', () => {
      const seat: Seat = { id: 'chair-1', col: 5, row: 5, direction: Direction.UP };
      const character = createCharacter('id', 'Name', 'Role', 0, 'chair-1', seat, 0);
      character.state = CharacterState.WALK;
      character.path = [{ col: 2, row: 1 }, { col: 3, row: 1 }];
      character.moveProgress = 0.5;
      character.active = true;
      const tileMap = Array.from({ length: 8 }, () => Array(8).fill(TileType.FLOOR_1));
      const blockedTiles = new Set(['5,5']);

      updateCharacter(character, 0, new Set(), [seat], tileMap, blockedTiles);

      expect(character.state).toBe(CharacterState.WALK);
      expect(character.path[0]).toEqual({ col: 2, row: 1 });
      expect(character.path.at(-1)).toEqual({ col: 5, row: 5 });
      expect(character.moveProgress).toBe(0.5);

      for (let frame = 0; frame < 100 && character.state === CharacterState.WALK; frame++) {
        updateCharacter(character, 0.1, new Set(), [seat], tileMap, blockedTiles);
      }

      expect(character.state).toBe(CharacterState.TYPE);
      expect(character.col).toBe(seat.col);
      expect(character.row).toBe(seat.row);
    });

    it('returns an idle agent to its blocked seat when its wander limit is reached', () => {
      const seat: Seat = { id: 'chair-1', col: 5, row: 5, direction: Direction.DOWN };
      const character = createCharacter('id', 'Name', 'Role', 0, 'chair-1', seat, 0);
      character.state = CharacterState.WALK;
      character.path = [{ col: 2, row: 1 }];
      character.col = 1;
      character.row = 1;
      character.wanderCount = 1;
      character.wanderLimit = 1;
      const tileMap = Array.from({ length: 8 }, () => Array(8).fill(TileType.FLOOR_1));
      const blockedTiles = new Set(['5,5']);

      updateCharacter(character, 1, new Set(), [seat], tileMap, blockedTiles);

      expect(character.state).toBe(CharacterState.WALK);
      expect(character.path.at(-1)).toEqual({ col: 5, row: 5 });

      for (let frame = 0; frame < 100 && character.state === CharacterState.WALK; frame++) {
        updateCharacter(character, 0.1, new Set(), [seat], tileMap, blockedTiles);
      }

      expect(character.state).toBe(CharacterState.TYPE);
      expect(character.col).toBe(seat.col);
      expect(character.row).toBe(seat.row);
    });

    it('does not work at an unreachable or missing assigned seat', () => {
      const seat: Seat = { id: 'chair-1', col: 4, row: 4, direction: Direction.UP };
      const character = createCharacter('id', 'Name', 'Role', 0, 'chair-1', seat, 0);
      character.col = 1;
      character.row = 1;
      character.active = true;
      character.state = CharacterState.IDLE;
      const tileMap = Array.from({ length: 6 }, () => Array(6).fill(TileType.FLOOR_1));
      tileMap[3] = Array(6).fill(TileType.WALL);
      const blockedTiles = new Set(['4,4']);

      updateCharacter(character, 0.1, new Set(), [seat], tileMap, blockedTiles);
      expect(character.state).toBe(CharacterState.IDLE);
      expect(character.path).toEqual([]);

      character.seatId = 'missing-seat';
      updateCharacter(character, 0.1, new Set(), [], tileMap, blockedTiles);
      expect(character.state).toBe(CharacterState.IDLE);
      expect(character.path).toEqual([]);
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

    it('preserves animation timer remainder across updates', () => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.state = CharacterState.WALK;
      character.path = [{ col: 10, row: 1 }];

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      const walkableTiles = new Set<string>();
      const seats: Seat[] = [];
      const blockedTiles = new Set<string>();

      updateCharacter(character, WALK_FRAME_DURATION_SEC * 0.75, walkableTiles, seats, tileMap, blockedTiles);
      updateCharacter(character, WALK_FRAME_DURATION_SEC * 0.75, walkableTiles, seats, tileMap, blockedTiles);

      expect(character.frameIndex).toBe(1);
      expect(character.frameTimer).toBeCloseTo(WALK_FRAME_DURATION_SEC * 0.5);

      updateCharacter(character, WALK_FRAME_DURATION_SEC * 0.5, walkableTiles, seats, tileMap, blockedTiles);
      expect(character.frameIndex).toBe(2);
      expect(character.frameTimer).toBeCloseTo(0);

      const typing = createCharacter('typing', 'Name', 'Role', 0, null, null, 0);
      typing.state = CharacterState.TYPE;
      typing.active = true;
      updateCharacter(typing, TYPE_FRAME_DURATION_SEC * 0.75, walkableTiles, seats, tileMap, blockedTiles);
      updateCharacter(typing, TYPE_FRAME_DURATION_SEC * 0.75, walkableTiles, seats, tileMap, blockedTiles);

      expect(typing.frameIndex).toBe(1);
      expect(typing.frameTimer).toBeCloseTo(TYPE_FRAME_DURATION_SEC * 0.5);
    });

    it('preserves movement remainder across multiple tiles in one update', () => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.state = CharacterState.WALK;
      character.path = [{ col: 2, row: 1 }, { col: 3, row: 1 }, { col: 3, row: 2 }];

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      updateCharacter(character, 0.5, new Set(), [], tileMap, new Set());

      expect(character.col).toBe(2);
      expect(character.row).toBe(1);
      expect(character.path).toEqual([{ col: 3, row: 1 }, { col: 3, row: 2 }]);
      expect(character.moveProgress).toBeCloseTo(0.5);
      expect(character.x).toBe(40);
      expect(character.y).toBe(24);
      expect(character.state).toBe(CharacterState.WALK);
    });

    it('faces the first movement direction before the first tile is complete', () => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.state = CharacterState.WALK;
      character.path = [{ col: 2, row: 1 }];
      character.direction = Direction.DOWN;

      updateCharacter(character, 0.01, new Set(), [], [], new Set());

      expect(character.direction).toBe(Direction.RIGHT);
      expect(character.moveProgress).toBeCloseTo(0.03);
    });

    it('turns to face the next path segment immediately at a corner', () => {
      const character = createCharacter('id', 'Name', 'Role', 0, null, null, 0);
      character.state = CharacterState.WALK;
      character.path = [{ col: 2, row: 1 }, { col: 2, row: 2 }];
      character.moveProgress = 0.99;
      character.direction = Direction.RIGHT;

      updateCharacter(character, 0.01, new Set(), [], [], new Set());

      expect(character.col).toBe(2);
      expect(character.row).toBe(1);
      expect(character.direction).toBe(Direction.DOWN);
      expect(character.moveProgress).toBeCloseTo(0.02);
    });

    it('preserves an in-flight tile while rerouting to an active character seat', () => {
      const seat: Seat = { id: 'chair-1', col: 4, row: 1, direction: Direction.UP };
      const character = createCharacter('id', 'Name', 'Role', 0, 'chair-1', seat, 0);
      character.state = CharacterState.WALK;
      character.active = true;
      character.path = [{ col: 2, row: 1 }, { col: 3, row: 1 }];
      character.moveProgress = 0.5;

      const tileMap = Array(10).fill(0).map(() => Array(10).fill(TileType.FLOOR_1));
      updateCharacter(character, 0, new Set(), [seat], tileMap, new Set());

      expect(character.path).toEqual([{ col: 2, row: 1 }, { col: 3, row: 1 }, { col: 4, row: 1 }]);
      expect(character.moveProgress).toBe(0.5);
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
