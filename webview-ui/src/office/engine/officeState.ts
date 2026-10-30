import { CharacterState, Direction, TILE_SIZE } from '../types.js';
import type { OfficeLayout, Character, Seat, FurnitureInstance, Pet } from '../types.js';
import { createCharacter, isMidStep, routeToSeatPreservingStep } from './characters.js';
import {
  layoutToTileMap,
  layoutToSeats,
  getBlockedTiles,
  getFurnitureFootprint,
  layoutToFurnitureInstances,
} from '../layout/layoutManager.js';
import { getWalkableTiles } from './pathfinding.js';
import { findPath } from './pathfinding.js';
import { createPet, getPetSpriteData, togglePetHeart } from './petEntity.js';
import { getPetName, getPetSprites } from '../sprites/petSpriteData.js';
import { FURNITURE_ANIM_INTERVAL_SEC, PET_HIT_HALF_WIDTH, PET_HIT_HEIGHT } from '../../constants.js';
import { getAnimationFrames, getOnStateType } from '../layout/furnitureCatalog.js';
import { appearanceFromIndex, type AgentSnapshot } from './agentSync.js';
import { transientSubagents, type ObservedTaskSnapshot } from '../../../../src/observedTasks.js';

export class OfficeState {
  layout: OfficeLayout;
  tileMap: number[][];
  seats: Seat[];
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Set<string>;
  walkableTileList: Array<{ col: number; row: number }> = [];
  characters: Map<string, Character> = new Map();
  subagents = new Map<string, { character: Character; parentAgentId: string }>();
  private observedTasks: ObservedTaskSnapshot | null = null;
  pets: Pet[] = [];
  selectedAgentId: string | null = null;
  hoveredAgentId: string | null = null;
  hoveredTile: { col: number; row: number } | null = null;
  cameraFollowId: string | null = null;
  private furnitureAnimTimer = 0;
  private furnitureAnimFrame = 0;

  constructor(layout?: OfficeLayout) {
    this.layout = layout || { version: 1, cols: 0, rows: 0, tiles: [], furniture: [], pets: [] };
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    this.rebuildWalkableTileList();
    this.rebuildPetsFromLayout();
  }

  rebuildFromLayout(layout: OfficeLayout, shift?: boolean) {
    const previousPets = new Map(this.pets.map((pet) => [pet.id, pet]));
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.furniture = layoutToFurnitureInstances(layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    this.rebuildWalkableTileList();
    this.rebuildPetsFromLayout(previousPets);

    if (shift) {
      for (const char of this.characters.values()) {
        const originalSeatId = char.seatId;
        if (originalSeatId && this.seats.some(s => s.id === originalSeatId)) {
          const seat = this.seats.find(s => s.id === originalSeatId)!;
          char.col = seat.col;
          char.row = seat.row;
          char.x = seat.col * 16 + 8;
          char.y = seat.row * 16 + 8;
          seat.occupant = char.id;
        } else {
          const walkableArr = Array.from(this.walkableTiles);
          const randomKey = walkableArr[Math.floor(Math.random() * walkableArr.length)];
          if (randomKey) {
            const [c, r] = randomKey.split(',').map(Number);
            char.col = c;
            char.row = r;
            char.x = c * 16 + 8;
            char.y = r * 16 + 8;
            char.seatId = null;
          }
        }
        char.path = [];
        char.moveProgress = 0;
      }
    }

    this.rebuildFurnitureInstances();
    this.reconcileSubagents();
  }

  setObservedTasks(snapshot: ObservedTaskSnapshot | null): void {
    this.observedTasks = snapshot;
    this.reconcileSubagents();
  }

  reconcileSubagents(): void {
    const wanted = transientSubagents(this.observedTasks, [...this.characters.keys()]);
    const ids = new Set(wanted.map(task => task.id));
    for (const id of this.subagents.keys()) {
      if (!ids.has(id)) this.subagents.delete(id);
    }
    for (const task of wanted) {
      const parent = this.characters.get(task.parentAgentId);
      if (!parent) continue;
      const existing = this.subagents.get(task.id);
      if (existing) {
        existing.parentAgentId = task.parentAgentId;
        existing.character.name = task.name;
      } else {
        const character = createCharacter(task.id, task.name, 'Ephemeral subagent',
          parent.palette, null, null, (parent.hueShift + 60) % 360);
        character.active = true;
        character.state = CharacterState.TYPE;
        this.subagents.set(task.id, { character, parentAgentId: task.parentAgentId });
      }
    }
    this.positionSubagents();
  }

  /** Transients occupy no seats and never enter saved agent/layout preferences. */
  positionSubagents(): void {
    const occupied = new Set([...this.characters.values()].map(char => `${char.col},${char.row}`));
    for (const [id, { character, parentAgentId }] of this.subagents) {
      const parent = this.characters.get(parentAgentId);
      if (!parent) continue;
      const current = `${character.col},${character.row}`;
      if (this.walkableTiles.has(current) && !occupied.has(current)
        && Math.abs(character.col - parent.col) + Math.abs(character.row - parent.row) <= 2) {
        occupied.add(current);
        continue;
      }
      const candidates = this.walkableTileList.filter(tile => !occupied.has(`${tile.col},${tile.row}`));
      candidates.sort((a, b) => (Math.abs(a.col - parent.col) + Math.abs(a.row - parent.row))
        - (Math.abs(b.col - parent.col) + Math.abs(b.row - parent.row)));
      const tile = candidates[0];
      if (!tile) {
        this.subagents.delete(id);
        continue;
      }
      character.col = tile.col;
      character.row = tile.row;
      character.x = tile.col * 16 + 8;
      character.y = tile.row * 16 + 8;
      occupied.add(`${tile.col},${tile.row}`);
    }
  }

  addAgent(
    id: string,
    name: string,
    role: string,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    preferredDirectoryId?: string,
    preferredDirectoryMappingIds?: string[],
  ) {
    if (this.characters.has(id)) return;

    let palette = preferredPalette;
    let hueShift = preferredHueShift ?? (preferredPalette !== undefined ? 0 : undefined);
    if (palette === undefined || hueShift === undefined) {
      const usedPalettes = new Map<number, number>();
      for (const char of this.characters.values()) {
        usedPalettes.set(char.palette, (usedPalettes.get(char.palette) || 0) + 1);
      }
      let bestPalette = 0;
      let minCount = Infinity;
      for (let p = 0; p < 6; p++) {
        const count = usedPalettes.get(p) || 0;
        if (count < minCount) {
          minCount = count;
          bestPalette = p;
        }
      }
      palette = bestPalette;
      hueShift = Math.floor((usedPalettes.get(bestPalette) || 0) * 60) % 360;
    }

    let seatId: string | null = null;

    if (preferredSeatId && this.seats.some(s => s.id === preferredSeatId)) {
      const seat = this.seats.find(s => s.id === preferredSeatId)!;
      if (!seat.occupant) {
        seatId = preferredSeatId;
        seat.occupant = id;
      }
    }

    if (!seatId) {
      const seat = this.findFreeSeat(preferredDirectoryId, preferredDirectoryMappingIds);
      if (seat) {
        seatId = seat.id;
        seat.occupant = id;
      }
    }

    const seatObj = seatId ? this.seats.find(s => s.id === seatId) ?? null : null;
    const character = createCharacter(id, name, role, palette!, seatId, seatObj, hueShift!, preferredDirectoryId);
    this.characters.set(id, character);
    this.reconcileSubagents();

    if (seatId) {
      this.sendToSeat(id);
    }

    this.rebuildFurnitureInstances();
  }

  private findFreeSeat(directoryId?: string, directoryMappingIds?: string[]): Seat | undefined {
    const freeSeats = this.seats.filter(seat => !seat.occupant);
    const directoryIds = [...new Set([
      ...(directoryMappingIds ?? []), ...(directoryId ? [directoryId] : []),
    ])];
    const areaLabels = new Set(directoryIds.flatMap(id => this.layout.areaMappings?.[id] ?? []));
    const areaSeat = freeSeats.find(seat => {
      const label = this.layout.areaTiles?.[seat.row * this.layout.cols + seat.col];
      return label !== undefined && label !== null && areaLabels.has(label);
    });
    return areaSeat ?? freeSeats.find(seat =>
      !this.layout.areaTiles?.[seat.row * this.layout.cols + seat.col]) ?? freeSeats[0];
  }

  /** Apply a complete standalone preference snapshot without interactive swap side effects. */
  applyAgentPreferences(snapshot: AgentSnapshot[]): void {
    const previousSeats = new Map([...this.characters].map(([id, char]) => [id, char.seatId]));
    for (const seat of this.seats) seat.occupant = null;
    for (const agent of snapshot) {
      const char = this.characters.get(agent.id);
      if (!char) continue;
      if (agent.paletteIndex !== undefined) {
        const appearance = appearanceFromIndex(agent.paletteIndex);
        char.palette = appearance.palette;
        char.hueShift = appearance.hueShift;
      }
      const seat = this.seats.find(candidate => candidate.id === agent.seatId && !candidate.occupant);
      char.seatId = seat?.id ?? null;
      if (seat) seat.occupant = agent.id;
    }
    // Reserve all explicit seats first, then keep automatic seating where possible.
    for (const agent of snapshot) {
      const char = this.characters.get(agent.id);
      if (!char) continue;
      if (!char.seatId) {
        const previous = this.seats.find(seat => seat.id === previousSeats.get(agent.id) && !seat.occupant);
        const seat = previous ?? this.findFreeSeat(char.directoryId, agent.directoryMappingIds);
        char.seatId = seat?.id ?? null;
        if (seat) seat.occupant = agent.id;
      }
      if (char.seatId !== previousSeats.get(agent.id)) {
        if (isMidStep(char)) {
          if (!char.seatId) char.path = [char.path[0]];
        } else {
          char.path = [];
          char.moveProgress = 0;
          char.state = CharacterState.IDLE;
        }
        this.sendToSeat(agent.id);
      }
    }
    this.rebuildFurnitureInstances();
  }

  setAgentDirectoryId(id: string, directoryId: string | null | undefined): void {
    const character = this.characters.get(id);
    if (character) character.directoryId = directoryId ?? undefined;
  }

  removeAgent(id: string) {
    const char = this.characters.get(id);
    if (!char) return;

    if (char.seatId) {
      const seat = this.seats.find(s => s.id === char.seatId);
      if (seat && seat.occupant === id) {
        seat.occupant = null;
      }
    }

    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.hoveredAgentId === id) this.hoveredAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;

    this.characters.delete(id);
    this.reconcileSubagents();
    this.rebuildFurnitureInstances();
  }

  setAgentActive(id: string, active: boolean) {
    const char = this.characters.get(id);
    if (!char) return;
    if (active && char.bubbleState.type === 'waiting') {
      char.bubbleState = { type: 'none' };
    }
    if (char.active === active) return;
    char.active = active;
    if (!active) {
      // A walking character finishes its route so the rendered position stays continuous.
      if (char.state !== CharacterState.WALK || char.path.length === 0) {
        char.state = CharacterState.IDLE;
      }
    } else if (!char.seatId) {
      if (isMidStep(char)) {
        char.path = [char.path[0]];
      } else {
        char.state = CharacterState.TYPE;
      }
    } else {
      const seat = this.seats.find((candidate) => candidate.id === char.seatId);
      if (!seat) {
        if (isMidStep(char)) {
          char.path = [char.path[0]];
        } else {
          char.state = CharacterState.IDLE;
          char.path = [];
          char.moveProgress = 0;
          char.x = char.col * TILE_SIZE + TILE_SIZE / 2;
          char.y = char.row * TILE_SIZE + TILE_SIZE / 2;
        }
      } else if (char.state !== CharacterState.WALK) {
        if (char.col === seat.col && char.row === seat.row && char.path.length === 0 && char.moveProgress === 0) {
          char.state = CharacterState.TYPE;
          char.direction = seat.direction;
          char.frameIndex = 0;
          char.frameTimer = 0;
        } else {
          char.state = CharacterState.IDLE;
          this.sendToSeat(id);
        }
      }
    }
    this.rebuildFurnitureInstances();
  }

  setAgentTool(id: string, tool: string | null) {
    const char = this.characters.get(id);
    if (!char) return;
    char.tool = tool ?? undefined;
  }

  showPermissionBubble(id: string) {
    const char = this.characters.get(id);
    if (!char) return;
    char.bubbleState = { type: 'permission' };
  }

  clearPermissionBubble(id: string) {
    const char = this.characters.get(id);
    if (!char) return;
    if (char.bubbleState.type === 'permission') {
      char.bubbleState = { type: 'none' };
    }
  }

  showWaitingBubble(id: string) {
    const char = this.characters.get(id);
    if (!char) return;
    char.bubbleState = { type: 'waiting' };
  }

  getSeatAtTile(col: number, row: number): string | null {
    for (const seat of this.seats) {
      if (seat.col === col && seat.row === row) {
        return seat.id;
      }
    }
    return null;
  }

  /** Move an agent to a seat; a displaced occupant swaps into the vacated seat. */
  reassignSeat(agentId: string, seatId: string): boolean {
    const char = this.characters.get(agentId);
    if (!char) return false;

    const newSeat = this.seats.find(s => s.id === seatId);
    if (!newSeat) return false;
    if (char.seatId === seatId) return false;

    const oldSeat = char.seatId ? this.seats.find(s => s.id === char.seatId) ?? null : null;
    if (oldSeat && oldSeat.occupant === agentId) {
      oldSeat.occupant = null;
    }

    if (newSeat.occupant && newSeat.occupant !== agentId) {
      const otherId = newSeat.occupant;
      const otherChar = this.characters.get(otherId);
      if (otherChar) {
        if (oldSeat) {
          oldSeat.occupant = otherId;
          otherChar.seatId = oldSeat.id;
          this.sendToSeat(otherId);
        } else {
          otherChar.seatId = null;
        }
      }
    }

    newSeat.occupant = agentId;
    char.seatId = seatId;
    this.sendToSeat(agentId);
    this.rebuildFurnitureInstances();
    return true;
  }

  /** Current seat assignment for every agent that has one. */
  getSeatAssignments(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [id, char] of this.characters) {
      if (char.seatId) result[id] = char.seatId;
    }
    return result;
  }

  sendToSeat(agentId: string) {
    const char = this.characters.get(agentId);
    if (!char || !char.seatId) return;
    const seat = this.seats.find(s => s.id === char.seatId);
    if (!seat) return;
    if (routeToSeatPreservingStep(char, seat.col, seat.row, this.tileMap, this.blockedTiles)) return;
    if (isMidStep(char)) {
      // No route: finish the in-flight step rather than snapping back; never work off-seat.
      if (char.active) char.path = [char.path[0]];
      return;
    }
    if (char.active && (char.col !== seat.col || char.row !== seat.row)) {
      char.state = CharacterState.IDLE;
      char.path = [];
      char.moveProgress = 0;
      char.x = char.col * TILE_SIZE + TILE_SIZE / 2;
      char.y = char.row * TILE_SIZE + TILE_SIZE / 2;
    }
  }

  walkToTile(agentId: string, col: number, row: number): boolean {
    const char = this.characters.get(agentId);
    if (!char) return false;

    const inFlightStep = isMidStep(char) ? char.path[0] : undefined;
    if (inFlightStep && inFlightStep.col === col && inFlightStep.row === row) {
      char.path = [inFlightStep];
      return true;
    }
    const from = inFlightStep ?? { col: char.col, row: char.row };
    const path = findPath(from.col, from.row, col, row, this.tileMap, this.blockedTiles);
    if (!path || path.length === 0) return false;

    if (inFlightStep) {
      char.path = [inFlightStep, ...path];
    } else {
      char.path = path;
      char.moveProgress = 0;
    }
    char.state = CharacterState.WALK;
    return true;
  }

  refreshAssets(): void {
    const occupied = new Map(this.seats.map((seat) => [seat.id, seat.occupant]));
    this.seats = layoutToSeats(this.layout.furniture);
    for (const seat of this.seats) {
      seat.occupant = occupied.get(seat.id)
        ?? [...this.characters.values()].find((character) => character.seatId === seat.id)?.id;
    }
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    this.rebuildWalkableTileList();
    this.rebuildPetsFromLayout();
    this.rebuildFurnitureInstances();
  }

  private rebuildWalkableTileList(): void {
    this.walkableTileList = Array.from(this.walkableTiles, (key) => {
      const separator = key.indexOf(',');
      return { col: Number(key.slice(0, separator)), row: Number(key.slice(separator + 1)) };
    });
  }

  rebuildPetsFromLayout(previousPets = new Map(this.pets.map((pet) => [pet.id, pet]))): void {
    this.pets = (this.layout.pets ?? []).flatMap((placed) => {
      const existing = previousPets.get(placed.id);
      if (existing && existing.petType === placed.petType) {
        const currentTile = `${existing.tileCol},${existing.tileRow}`;
        const pathIsWalkable = existing.path.every((tile) => this.walkableTiles.has(`${tile.col},${tile.row}`));
        if (this.walkableTiles.has(currentTile) && pathIsWalkable) {
          existing.name = getPetName(placed.petType);
          return [existing];
        }
      }
      if (!this.walkableTileList.length) return [];
      const tile = this.walkableTileList[Math.floor(Math.random() * this.walkableTileList.length)];
      if (!tile) return [];
      return [createPet(placed.id, placed.petType, getPetName(placed.petType), tile.col, tile.row)];
    });
  }

  getActivePetTypes(): number[] {
    return [...new Set((this.layout.pets ?? []).map((pet) => pet.petType))];
  }

  getPetAt(x: number, y: number): Pet | null {
    for (let index = this.pets.length - 1; index >= 0; index--) {
      const pet = this.pets[index];
      if (!getPetSpriteData(pet, getPetSprites(pet.petType))) continue;
      if (x >= pet.x - PET_HIT_HALF_WIDTH && x <= pet.x + PET_HIT_HALF_WIDTH
        && y >= pet.y - PET_HIT_HEIGHT && y <= pet.y) {
        return pet;
      }
    }
    return null;
  }

  togglePetBubble(id: string): void {
    const pet = this.pets.find((candidate) => candidate.id === id);
    if (pet) togglePetHeart(pet);
  }

  updateFurnitureAnimation(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.furnitureAnimTimer += dt;
    const frame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    if (frame === this.furnitureAnimFrame) return;
    this.furnitureAnimFrame = frame;
    if (this.furniture.some((item) => (getAnimationFrames(item.type)?.length ?? 0) > 1)) {
      this.rebuildFurnitureInstances();
    }
  }

  rebuildFurnitureInstances(): void {
    const autoOnTiles = new Set<string>();
    for (const character of this.characters.values()) {
      if (!character.active || !character.seatId) continue;
      const seat = this.seats.find((candidate) => candidate.id === character.seatId);
      if (!seat) continue;

      const dCol = seat.direction === Direction.RIGHT ? 1 : seat.direction === Direction.LEFT ? -1 : 0;
      const dRow = seat.direction === Direction.DOWN ? 1 : seat.direction === Direction.UP ? -1 : 0;
      for (let depth = 1; depth <= 3; depth++) {
        autoOnTiles.add(`${seat.col + dCol * depth},${seat.row + dRow * depth}`);
      }
      for (let depth = 1; depth <= 2; depth++) {
        const col = seat.col + dCol * depth;
        const row = seat.row + dRow * depth;
        if (dCol !== 0) {
          autoOnTiles.add(`${col},${row - 1}`);
          autoOnTiles.add(`${col},${row + 1}`);
        } else {
          autoOnTiles.add(`${col - 1},${row}`);
          autoOnTiles.add(`${col + 1},${row}`);
        }
      }
    }

    const visibleFurniture = this.layout.furniture.map((item) => {
      const footprint = getFurnitureFootprint(item);
      const overlapsAutoOnTile = footprint !== undefined && Array.from(
        { length: footprint.height },
        (_, row) => Array.from(
          { length: footprint.width },
          (_, col) => autoOnTiles.has(`${item.col + col},${item.row + row}`),
        ),
      ).some((row) => row.some(Boolean));
      const type = overlapsAutoOnTile ? getOnStateType(item.type) : item.type;
      const frames = getAnimationFrames(type);
      if (frames && frames.length > 1) {
        return { ...item, type: frames[this.furnitureAnimFrame % frames.length] };
      }
      return type === item.type ? item : { ...item, type };
    });
    this.furniture = layoutToFurnitureInstances(visibleFurniture);
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }
}
