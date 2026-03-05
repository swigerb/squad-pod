import {
  Character,
  CharacterState,
  Direction,
  Seat,
  SpriteData,
  TILE_SIZE
} from '../types.js';
import {
  WALK_SPEED_PX_PER_SEC,
  WALK_FRAME_DURATION_SEC,
  TYPE_FRAME_DURATION_SEC,
  WANDER_PAUSE_MIN_SEC,
  WANDER_PAUSE_MAX_SEC,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_MOVES_BEFORE_REST_MAX,
  SEAT_REST_MIN_SEC,
  SEAT_REST_MAX_SEC
} from '../../constants.js';
import { findPath } from './pathfinding.js';

export function isReadingTool(tool: string | undefined): boolean {
  if (!tool) return false;
  const reading = ['view', 'grep', 'glob', 'web_fetch', 'web_search'];
  return reading.includes(tool);
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}

function directionBetween(fromCol: number, fromRow: number, toCol: number, toRow: number): Direction {
  const dx = toCol - fromCol;
  const dy = toRow - fromRow;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? Direction.RIGHT : Direction.LEFT;
  }
  return dy > 0 ? Direction.DOWN : Direction.UP;
}

export function createCharacter(
  id: string,
  name: string,
  role: string,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift: number
): Character {
  const startCol = seat ? seat.col : 1;
  const startRow = seat ? seat.row : 1;
  return {
    id,
    name,
    role,
    col: startCol,
    row: startRow,
    x: startCol * TILE_SIZE + TILE_SIZE / 2,
    y: startRow * TILE_SIZE + TILE_SIZE / 2,
    direction: Direction.DOWN,
    state: CharacterState.IDLE,
    frameIndex: 0,
    frameTimer: 0,
    path: [],
    moveProgress: 0,
    wanderTimer: randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC),
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    seatTimer: randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC),
    seatId,
    palette,
    hueShift,
    active: false,
    tool: undefined,
    bubbleState: { type: 'none' }
  };
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Set<string>,
  seats: Seat[],
  tileMap: number[][],
  blockedTiles: Set<string>
): void {
  const mySeat = ch.seatId ? seats.find(s => s.id === ch.seatId) : null;

  switch (ch.state) {
    case CharacterState.TYPE: {
      ch.frameTimer += dt;
      const frameDur = isReadingTool(ch.tool) ? TYPE_FRAME_DURATION_SEC : TYPE_FRAME_DURATION_SEC;
      if (ch.frameTimer >= frameDur) {
        ch.frameTimer = 0;
        ch.frameIndex = (ch.frameIndex + 1) % 2;
      }

      if (!ch.active) {
        ch.seatTimer -= dt;
        if (ch.seatTimer <= 0) {
          ch.state = CharacterState.IDLE;
          ch.frameIndex = 0;
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
      }
      break;
    }

    case CharacterState.IDLE: {
      if (ch.active && mySeat) {
        const atSeat = ch.col === mySeat.col && ch.row === mySeat.row;
        if (!atSeat) {
          const path = findPath(ch.col, ch.row, mySeat.col, mySeat.row, tileMap, blockedTiles);
          if (path.length > 0) {
            ch.path = path;
            ch.state = CharacterState.WALK;
            ch.moveProgress = 0;
            ch.frameIndex = 0;
            ch.frameTimer = 0;
          }
        } else {
          ch.state = CharacterState.TYPE;
          ch.direction = mySeat.direction;
          ch.frameIndex = 0;
          ch.frameTimer = 0;
        }
      } else {
        ch.wanderTimer -= dt;
        if (ch.wanderTimer <= 0) {
          const allWalkable = Array.from(walkableTiles).map(key => {
            const [c, r] = key.split(',').map(Number);
            return { col: c, row: r };
          });
          if (allWalkable.length > 0) {
            const target = allWalkable[randomInt(0, allWalkable.length - 1)];
            const path = findPath(ch.col, ch.row, target.col, target.row, tileMap, blockedTiles);
            if (path.length > 0) {
              ch.path = path;
              ch.state = CharacterState.WALK;
              ch.moveProgress = 0;
              ch.frameIndex = 0;
              ch.frameTimer = 0;
              ch.wanderCount++;
            } else {
              ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
            }
          } else {
            ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
          }
        }
      }
      break;
    }

    case CharacterState.WALK: {
      ch.frameTimer += dt;
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer = 0;
        ch.frameIndex = (ch.frameIndex + 1) % 4;
      }

      const distPerSec = WALK_SPEED_PX_PER_SEC / TILE_SIZE;
      ch.moveProgress += dt * distPerSec;

      if (ch.moveProgress >= 1.0) {
        ch.moveProgress = 0;
        if (ch.path.length > 0) {
          const next = ch.path.shift()!;
          ch.direction = directionBetween(ch.col, ch.row, next.col, next.row);
          ch.col = next.col;
          ch.row = next.row;
          ch.x = ch.col * TILE_SIZE + TILE_SIZE / 2;
          ch.y = ch.row * TILE_SIZE + TILE_SIZE / 2;
        }
      }

      if (ch.path.length === 0 && ch.moveProgress === 0) {
        ch.state = CharacterState.IDLE;
        ch.frameIndex = 0;

        if (ch.active && mySeat && ch.col === mySeat.col && ch.row === mySeat.row) {
          ch.state = CharacterState.TYPE;
          ch.direction = mySeat.direction;
          ch.frameIndex = 0;
          ch.frameTimer = 0;
        } else if (!ch.active) {
          if (ch.wanderCount >= ch.wanderLimit && mySeat) {
            const atSeat = ch.col === mySeat.col && ch.row === mySeat.row;
            if (atSeat) {
              ch.state = CharacterState.TYPE;
              ch.direction = mySeat.direction;
              ch.frameIndex = 0;
              ch.frameTimer = 0;
              ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
              ch.wanderCount = 0;
              ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
            } else {
              const path = findPath(ch.col, ch.row, mySeat.col, mySeat.row, tileMap, blockedTiles);
              if (path.length > 0) {
                ch.path = path;
                ch.state = CharacterState.WALK;
                ch.moveProgress = 0;
              } else {
                ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
              }
            }
          } else {
            ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
          }
        } else {
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
      }

      if (ch.active && mySeat && ch.state === CharacterState.WALK) {
        const destCol = ch.path.length > 0 ? ch.path[ch.path.length - 1].col : ch.col;
        const destRow = ch.path.length > 0 ? ch.path[ch.path.length - 1].row : ch.row;
        if (destCol !== mySeat.col || destRow !== mySeat.row) {
          const newPath = findPath(ch.col, ch.row, mySeat.col, mySeat.row, tileMap, blockedTiles);
          if (newPath.length > 0) {
            ch.path = newPath;
            ch.moveProgress = 0;
          }
        }
      }
      break;
    }
  }
}

export function getCharacterSprite(
  ch: Character,
  sprites: { walk: Record<Direction, SpriteData[]>; typing: Record<Direction, SpriteData[]>; reading: Record<Direction, SpriteData[]> }
): SpriteData {
  if (ch.state === CharacterState.TYPE) {
    const spriteSet = isReadingTool(ch.tool) ? sprites.reading : sprites.typing;
    const frames = spriteSet[ch.direction] || spriteSet[Direction.DOWN];
    return frames[ch.frameIndex % frames.length];
  } else if (ch.state === CharacterState.WALK) {
    const frames = sprites.walk[ch.direction] || sprites.walk[Direction.DOWN];
    return frames[ch.frameIndex % frames.length];
  } else {
    const frames = sprites.walk[ch.direction] || sprites.walk[Direction.DOWN];
    return frames[0];
  }
}
