import type { OfficeLayout, Character, CharacterState, TileType, Seat, FurnitureInstance } from '../types.js';
import { createCharacter } from './characters.js';
import { layoutToTileMap, layoutToSeats, getBlockedTiles, layoutToFurnitureInstances } from '../layout/layoutManager.js';
import { getWalkableTiles } from './pathfinding.js';
import { findPath } from './pathfinding.js';

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileType[][];
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Array<{ col: number; row: number }>;
  characters: Map<string, Character> = new Map();
  selectedAgentId: string | null = null;
  hoveredAgentId: string | null = null;
  hoveredTile: { col: number; row: number } | null = null;
  cameraFollowId: string | null = null;

  constructor(layout?: OfficeLayout) {
    this.layout = layout || { version: 1, cols: 0, rows: 0, tiles: [], furniture: [] };
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout);
    this.blockedTiles = getBlockedTiles(this.layout);
    this.furniture = layoutToFurnitureInstances(this.layout);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
  }

  rebuildFromLayout(layout: OfficeLayout, shift?: boolean) {
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout);
    this.blockedTiles = getBlockedTiles(layout);
    this.furniture = layoutToFurnitureInstances(layout);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);

    if (shift) {
      for (const char of this.characters.values()) {
        const originalSeatId = char.seatId;
        if (originalSeatId && this.seats.has(originalSeatId)) {
          const seat = this.seats.get(originalSeatId)!;
          char.tileCol = seat.col;
          char.tileRow = seat.row;
          char.x = seat.col * 16 + 8;
          char.y = seat.row * 16 + 8;
          seat.occupant = char.id;
        } else {
          const randomWalkable = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
          if (randomWalkable) {
            char.tileCol = randomWalkable.col;
            char.tileRow = randomWalkable.row;
            char.x = randomWalkable.col * 16 + 8;
            char.y = randomWalkable.row * 16 + 8;
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
    preferredSeatId?: string,
    skipSpawnEffect?: boolean
  ) {
    if (this.characters.has(id)) return;

    let palette = preferredPalette;
    let hueShift = preferredHueShift;
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
    let col = 0;
    let row = 0;

    if (preferredSeatId && this.seats.has(preferredSeatId)) {
      const seat = this.seats.get(preferredSeatId)!;
      if (!seat.occupant) {
        seatId = preferredSeatId;
        seat.occupant = id;
        col = seat.col;
        row = seat.row;
      }
    }

    if (!seatId) {
      for (const [sid, seat] of this.seats) {
        if (!seat.occupant) {
          seatId = sid;
          seat.occupant = id;
          col = seat.col;
          row = seat.row;
          break;
        }
      }
    }

    if (!seatId && this.walkableTiles.length > 0) {
      const randomWalkable = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
      col = randomWalkable.col;
      row = randomWalkable.row;
    }

    const character = createCharacter(id, name, role, col, row, palette, hueShift);
    character.seatId = seatId;
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
      const seat = this.seats.get(char.seatId);
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
    char.isActive = active;
    char.state = active ? 'typing' : 'idle';
    this.rebuildFurnitureInstances();
  }

  setAgentTool(id: string, tool: string | null) {
    const char = this.characters.get(id);
    if (!char) return;
    char.currentTool = tool;
  }

  showPermissionBubble(id: string) {
    const char = this.characters.get(id);
    if (!char) return;
    char.bubbleType = 'permission';
    char.bubbleTimer = 0;
  }

  clearPermissionBubble(id: string) {
    const char = this.characters.get(id);
    if (!char) return;
    if (char.bubbleType === 'permission') {
      char.bubbleType = null;
      char.bubbleTimer = 0;
    }
  }

  showWaitingBubble(id: string) {
    const char = this.characters.get(id);
    if (!char) return;
    char.bubbleType = 'waiting';
    char.bubbleTimer = 0;
  }

  getSeatAtTile(col: number, row: number): string | null {
    for (const [sid, seat] of this.seats) {
      if (seat.col === col && seat.row === row) {
        return sid;
      }
    }
    return null;
  }

  reassignSeat(agentId: string, seatId: string) {
    const char = this.characters.get(agentId);
    if (!char) return;

    if (char.seatId) {
      const oldSeat = this.seats.get(char.seatId);
      if (oldSeat && oldSeat.occupant === agentId) {
        oldSeat.occupant = null;
      }
    }

    const newSeat = this.seats.get(seatId);
    if (!newSeat) return;

    if (newSeat.occupant && newSeat.occupant !== agentId) {
      const otherChar = this.characters.get(newSeat.occupant);
      if (otherChar) {
        otherChar.seatId = null;
      }
    }

    newSeat.occupant = agentId;
    char.seatId = seatId;
    this.sendToSeat(agentId);
  }

  sendToSeat(agentId: string) {
    const char = this.characters.get(agentId);
    if (!char || !char.seatId) return;
    const seat = this.seats.get(char.seatId);
    if (!seat) return;
    this.walkToTile(agentId, seat.col, seat.row);
  }

  walkToTile(agentId: string, col: number, row: number): boolean {
    const char = this.characters.get(agentId);
    if (!char) return false;

    const path = findPath(char.tileCol, char.tileRow, col, row, this.tileMap, this.blockedTiles);
    if (!path || path.length === 0) return false;

    char.path = path;
    char.moveProgress = 0;
    char.state = 'walking';
    return true;
  }

  rebuildFurnitureInstances() {
    const activeAgents = new Set<string>();
    for (const char of this.characters.values()) {
      if (char.isActive) activeAgents.add(char.id);
    }

    for (const furn of this.furniture) {
      if (furn.type.dynamicState) {
        const nearbyActiveAgent = Array.from(this.characters.values()).some(c => {
          if (!c.isActive) return false;
          const dist = Math.hypot(c.tileCol - furn.col, c.tileRow - furn.row);
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
