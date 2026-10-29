import { CharacterState } from '../types.js';
import type { OfficeLayout, Character, Seat, FurnitureInstance } from '../types.js';
import { createCharacter } from './characters.js';
import { layoutToTileMap, layoutToSeats, getBlockedTiles, layoutToFurnitureInstances } from '../layout/layoutManager.js';
import { getWalkableTiles } from './pathfinding.js';
import { findPath } from './pathfinding.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';

export class OfficeState {
  layout: OfficeLayout;
  tileMap: number[][];
  seats: Seat[];
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Set<string>;
  characters: Map<string, Character> = new Map();
  selectedAgentId: string | null = null;
  hoveredAgentId: string | null = null;
  hoveredTile: { col: number; row: number } | null = null;
  cameraFollowId: string | null = null;

  constructor(layout?: OfficeLayout) {
    this.layout = layout || { version: 1, cols: 0, rows: 0, tiles: [], furniture: [] };
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
  }

  rebuildFromLayout(layout: OfficeLayout, shift?: boolean) {
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.furniture = layoutToFurnitureInstances(layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);

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
  }

  addAgent(
    id: string,
    name: string,
    role: string,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string
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
      for (const seat of this.seats) {
        if (!seat.occupant) {
          seatId = seat.id;
          seat.occupant = id;
          break;
        }
      }
    }

    const seatObj = seatId ? this.seats.find(s => s.id === seatId) ?? null : null;
    const character = createCharacter(id, name, role, palette!, seatId, seatObj, hueShift!);
    this.characters.set(id, character);

    if (seatId) {
      this.sendToSeat(id);
    }

    this.rebuildFurnitureInstances();
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
    char.state = active ? CharacterState.TYPE : CharacterState.IDLE;
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
    this.walkToTile(agentId, seat.col, seat.row);
  }

  walkToTile(agentId: string, col: number, row: number): boolean {
    const char = this.characters.get(agentId);
    if (!char) return false;

    const path = findPath(char.col, char.row, col, row, this.tileMap, this.blockedTiles);
    if (!path || path.length === 0) return false;

    char.path = path;
    char.moveProgress = 0;
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
    this.rebuildFurnitureInstances();
  }

  rebuildFurnitureInstances() {
    const activeAgents = new Set<string>();
    for (const char of this.characters.values()) {
      if (char.active) activeAgents.add(char.id);
    }

    for (const furn of this.furniture) {
      const catalogEntry = getCatalogEntry(furn.type);
      if (catalogEntry?.dynamicState) {
        const nearbyActiveAgent = Array.from(this.characters.values()).some(c => {
          if (!c.active) return false;
          const dist = Math.hypot(c.col - furn.col, c.row - furn.row);
          return dist <= 3;
        });
        furn.state = nearbyActiveAgent ? 'on' : 'off';
      }
    }
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }
}
