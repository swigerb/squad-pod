import {
  PET_BUBBLE_DURATION_SEC,
  PET_FOLLOW_CHANCE,
  PET_FOLLOW_DURATION_MAX_SEC,
  PET_FOLLOW_DURATION_MIN_SEC,
  PET_FOLLOW_RADIUS_TILES,
  PET_FOLLOW_RECALC_INTERVAL_SEC,
  PET_IDLE_FRAME_DURATION_SEC,
  PET_IDLE_SEQUENCE,
  PET_WALK_FRAME_DURATION_SEC,
  PET_WALK_SEQUENCE,
  PET_WALK_SPEED_PX_PER_SEC,
  PET_WANDER_PAUSE_MAX_SEC,
  PET_WANDER_PAUSE_MIN_SEC,
} from '../../constants.js';
import { findPath, isWalkable } from './pathfinding.js';
import type { PetSpriteFrames } from '../sprites/petSpriteData.js';
import type { Character, Pet, SpriteData } from '../types.js';
import { Direction, PetState, TILE_SIZE } from '../types.js';

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function tileCenter(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
}

function directionBetween(fromCol: number, fromRow: number, toCol: number, toRow: number): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

function manhattanDistance(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2);
}

function findNearbyCharacter(pet: Pet, characters: Map<string, Character>): Character | null {
  let closest: Character | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const character of characters.values()) {
    const distance = manhattanDistance(pet.tileCol, pet.tileRow, character.col, character.row);
    if (distance <= PET_FOLLOW_RADIUS_TILES && distance < closestDistance) {
      closest = character;
      closestDistance = distance;
    }
  }
  return closest;
}

function findAdjacentTile(
  character: Character,
  tileMap: number[][],
  blockedTiles: Set<string>,
): { col: number; row: number } | null {
  const candidates = [
    { col: character.col, row: character.row - 1 },
    { col: character.col, row: character.row + 1 },
    { col: character.col - 1, row: character.row },
    { col: character.col + 1, row: character.row },
  ];
  return candidates.find((tile) => isWalkable(tile.col, tile.row, tileMap, blockedTiles)) ?? null;
}

function updateAnimation(pet: Pet, dt: number, duration: number): void {
  pet.frameTimer += dt;
  if (pet.frameTimer >= duration) {
    pet.frameTimer -= duration;
    pet.frame = (pet.frame + 1) % 4;
  }
}

function movePetAlongPath(pet: Pet, dt: number): void {
  if (!pet.path.length) return;
  const nextTile = pet.path[0];
  pet.dir = directionBetween(pet.tileCol, pet.tileRow, nextTile.col, nextTile.row);
  pet.moveProgress += (PET_WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;
  const from = tileCenter(pet.tileCol, pet.tileRow);
  const to = tileCenter(nextTile.col, nextTile.row);
  const progress = Math.min(pet.moveProgress, 1);
  pet.x = from.x + (to.x - from.x) * progress;
  pet.y = from.y + (to.y - from.y) * progress;
  if (pet.moveProgress >= 1) {
    pet.tileCol = nextTile.col;
    pet.tileRow = nextTile.row;
    pet.x = to.x;
    pet.y = to.y;
    pet.path.shift();
    pet.moveProgress = 0;
  }
}

function settle(pet: Pet): void {
  pet.state = PetState.IDLE;
  pet.followTargetId = null;
  pet.path = [];
  pet.moveProgress = 0;
  pet.frame = 0;
  pet.frameTimer = 0;
  pet.wanderTimer = randomRange(PET_WANDER_PAUSE_MIN_SEC, PET_WANDER_PAUSE_MAX_SEC);
}

export function createPet(id: string, petType: number, name: string, col: number, row: number): Pet {
  const center = tileCenter(col, row);
  return {
    id,
    petType,
    name,
    state: PetState.IDLE,
    dir: Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    frame: 0,
    frameTimer: 0,
    wanderTimer: randomRange(PET_WANDER_PAUSE_MIN_SEC, PET_WANDER_PAUSE_MAX_SEC),
    followTargetId: null,
    followRecalcTimer: 0,
    followDuration: 0,
    followDurationLimit: 0,
    bubbleType: null,
    bubbleTimer: 0,
  };
}

export function updatePet(
  pet: Pet,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  characters: Map<string, Character>,
  tileMap: number[][],
  blockedTiles: Set<string>,
): void {
  if (pet.bubbleTimer > 0) {
    pet.bubbleTimer = Math.max(0, pet.bubbleTimer - dt);
    if (pet.bubbleTimer === 0) pet.bubbleType = null;
  }

  switch (pet.state) {
    case PetState.IDLE: {
      updateAnimation(pet, dt, PET_IDLE_FRAME_DURATION_SEC);
      pet.wanderTimer -= dt;
      if (pet.wanderTimer > 0) break;
      if (Math.random() < PET_FOLLOW_CHANCE) {
        const target = findNearbyCharacter(pet, characters);
        if (target) {
          pet.state = PetState.FOLLOW;
          pet.followTargetId = target.id;
          pet.followDuration = 0;
          pet.followRecalcTimer = 0;
          pet.followDurationLimit = randomRange(PET_FOLLOW_DURATION_MIN_SEC, PET_FOLLOW_DURATION_MAX_SEC);
          pet.frame = 0;
          pet.frameTimer = 0;
          break;
        }
      }
      const candidates = walkableTiles.filter(
        (tile) => tile.col !== pet.tileCol || tile.row !== pet.tileRow,
      );
      if (candidates.length) {
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        const path = findPath(pet.tileCol, pet.tileRow, target.col, target.row, tileMap, blockedTiles);
        if (path.length) {
          pet.state = PetState.WALK;
          pet.path = path;
          pet.moveProgress = 0;
          pet.frame = 0;
          pet.frameTimer = 0;
        }
      }
      pet.wanderTimer = randomRange(PET_WANDER_PAUSE_MIN_SEC, PET_WANDER_PAUSE_MAX_SEC);
      break;
    }
    case PetState.WALK:
      updateAnimation(pet, dt, PET_WALK_FRAME_DURATION_SEC);
      movePetAlongPath(pet, dt);
      if (!pet.path.length && pet.moveProgress === 0) settle(pet);
      break;
    case PetState.FOLLOW: {
      pet.followDuration += dt;
      const target = pet.followTargetId === null ? undefined : characters.get(pet.followTargetId);
      if (!target || pet.followDuration >= pet.followDurationLimit
        || manhattanDistance(pet.tileCol, pet.tileRow, target.col, target.row) <= 1) {
        if (target && manhattanDistance(pet.tileCol, pet.tileRow, target.col, target.row) === 1) {
          pet.dir = directionBetween(pet.tileCol, pet.tileRow, target.col, target.row);
        }
        settle(pet);
        break;
      }
      pet.followRecalcTimer -= dt;
      if (pet.followRecalcTimer <= 0) {
        const adjacent = findAdjacentTile(target, tileMap, blockedTiles);
        if (adjacent) {
          const path = findPath(pet.tileCol, pet.tileRow, adjacent.col, adjacent.row, tileMap, blockedTiles);
          if (path.length) {
            pet.path = path;
            pet.moveProgress = 0;
          }
        }
        pet.followRecalcTimer = PET_FOLLOW_RECALC_INTERVAL_SEC;
      }
      updateAnimation(pet, dt, PET_WALK_FRAME_DURATION_SEC);
      movePetAlongPath(pet, dt);
      break;
    }
  }
}

export function togglePetHeart(pet: Pet): void {
  if (pet.bubbleType === 'heart') {
    pet.bubbleType = null;
    pet.bubbleTimer = 0;
  } else {
    pet.bubbleType = 'heart';
    pet.bubbleTimer = PET_BUBBLE_DURATION_SEC;
  }
}

export function getPetSpriteData(pet: Pet, sprites: PetSpriteFrames | null): SpriteData | null {
  if (!sprites) return null;
  if (pet.state === PetState.IDLE) {
    const frame = PET_IDLE_SEQUENCE[pet.frame % PET_IDLE_SEQUENCE.length];
    switch (pet.dir) {
      case Direction.DOWN: return sprites.idleDown[frame];
      case Direction.UP: return sprites.idleUp[frame];
      case Direction.RIGHT: return sprites.idleRight[frame];
      case Direction.LEFT: return sprites.idleLeft[frame];
    }
  }
  const frame = PET_WALK_SEQUENCE[pet.frame % PET_WALK_SEQUENCE.length];
  switch (pet.dir) {
    case Direction.DOWN: return sprites.walkDown[frame];
    case Direction.UP: return sprites.walkUp[frame];
    case Direction.RIGHT: return sprites.walkRight[frame];
    case Direction.LEFT: return sprites.walkLeft[frame];
  }
}
