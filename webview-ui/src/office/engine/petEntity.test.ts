import { afterEach, describe, expect, it, vi } from 'vitest';
import { PET_IDLE_SEQUENCE, PET_WALK_SEQUENCE } from '../../constants.js';
import { createCharacter } from './characters.js';
import { createPet, getPetSpriteData, togglePetHeart, updatePet } from './petEntity.js';
import { resetPetTemplates, setPetTemplates, getPetSprites } from '../sprites/petSpriteData.js';
import { Direction, PetState, TileType } from '../types.js';

function makeSheet(): string[][] {
  return Array.from({ length: 96 }, (_, y) =>
    Array.from({ length: 96 }, (_, x) => `#${(y * 96 + x).toString(16).padStart(6, '0')}`));
}

describe('animated pet behavior', () => {
  afterEach(() => {
    resetPetTemplates();
    vi.restoreAllMocks();
  });

  it('uses the pinned sheet frame sequences and directional sprites', () => {
    setPetTemplates([{ id: 'claudio', name: 'Claudio', sprite: makeSheet() }]);
    const sprites = getPetSprites(0)!;
    const pet = createPet('pet-id', 0, 'Claudio', 1, 1);
    expect(getPetSpriteData(pet, sprites)).toBe(sprites.idleDown[PET_IDLE_SEQUENCE[0]]);
    pet.dir = Direction.LEFT;
    expect(getPetSpriteData(pet, sprites)).toBe(sprites.idleLeft[PET_IDLE_SEQUENCE[0]]);
    pet.state = PetState.WALK;
    pet.dir = Direction.RIGHT;
    pet.frame = 1;
    expect(getPetSpriteData(pet, sprites)).toBe(sprites.walkRight[PET_WALK_SEQUENCE[1]]);
  });

  it('advances walking animation and tile-centered movement on the game tick', () => {
    const pet = createPet('walk-test', 0, 'Claudio', 1, 1);
    pet.state = PetState.WALK;
    pet.path = [{ col: 2, row: 1 }];
    const oldX = pet.x;
    const floor = Array.from({ length: 4 }, () => Array<number>(4).fill(TileType.FLOOR_1));
    updatePet(pet, 0.15, [], new Map(), floor, new Set());
    expect(pet.frame).toBe(1);
    expect(pet.dir).toBe(Direction.RIGHT);
    expect(pet.x).toBeGreaterThan(oldX);
    expect(pet.tileCol).toBe(1);
    updatePet(pet, 0.36, [], new Map(), floor, new Set());
    expect(pet.tileCol).toBe(2);
    expect(pet.path).toEqual([]);
    expect(pet.state).toBe(PetState.IDLE);
  });

  it('follows a nearby agent, stops beside them, and does not change agent lifecycle state', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pet = createPet('follow-test', 0, 'Claudio', 1, 1);
    pet.wanderTimer = 0;
    const agent = createCharacter('homer', 'Homer', 'Lead', 0, null, null, 0);
    agent.col = 2;
    agent.row = 1;
    const originalState = agent.state;
    const characters = new Map([[agent.id, agent]]);
    const floor = Array.from({ length: 4 }, () => Array<number>(4).fill(TileType.FLOOR_1));
    const walkable = Array.from({ length: 4 }, (_, row) =>
      Array.from({ length: 4 }, (_, col) => ({ col, row }))).flat();
    updatePet(pet, 0.01, walkable, characters, floor, new Set());
    expect(pet.state).toBe(PetState.FOLLOW);
    expect(pet.followTargetId).toBe('homer');
    updatePet(pet, 0.01, walkable, characters, floor, new Set());
    expect(pet.state).toBe(PetState.IDLE);
    expect(agent.state).toBe(originalState);
  });

  it('toggles a timed heart response without creating agent or telemetry events', () => {
    const pet = createPet('heart-test', 0, 'Claudio', 1, 1);
    togglePetHeart(pet);
    expect(pet.bubbleType).toBe('heart');
    const duration = pet.bubbleTimer;
    updatePet(pet, 0.25, [], new Map(), [[TileType.FLOOR_1]], new Set());
    expect(pet.bubbleTimer).toBeCloseTo(duration - 0.25);
    togglePetHeart(pet);
    expect(pet.bubbleType).toBeNull();
    expect(pet.bubbleTimer).toBe(0);
    expect(pet.state).toBe(PetState.IDLE);
  });
});
