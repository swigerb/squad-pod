export const TILE_SIZE = 16;

export const TileType = {
  WALL: 0,
  FLOOR_1: 1,
  FLOOR_2: 2,
  FLOOR_3: 3,
  FLOOR_4: 4,
  FLOOR_5: 5,
  FLOOR_6: 6,
  FLOOR_7: 7,
  VOID: 8,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export interface FloorColor {
  h: number; // Hue 0-360
  s: number; // Saturation 0-100
  b: number; // Brightness -100 to 100
  c: number; // Contrast -100 to 100
  colorize?: boolean;
}

export const CharacterState = {
  IDLE: 'idle',
  WALK: 'walk',
  TYPE: 'type',
} as const;
export type CharacterState = (typeof CharacterState)[keyof typeof CharacterState];

export const Direction = {
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export type SpriteData = string[][]; // [row][col] of hex colors, '' for transparent

export interface Seat {
  id: string;
  col: number;
  row: number;
  direction: Direction;
  occupant?: string | null;
}

export interface FurnitureInstance {
  uid: string;
  type: string;
  col: number;
  row: number;
  width: number;
  height: number;
  sprite: SpriteData;
  rotation: number;
  state?: string;
}

export interface ToolActivity {
  toolId: string;
  status: string;
  done: boolean;
  permissionWait?: boolean;
}

export const FurnitureType = {
  DESK: 'desk',
  BOOKSHELF: 'bookshelf',
  PLANT: 'plant',
  COOLER: 'cooler',
  WHITEBOARD: 'whiteboard',
  CHAIR: 'chair',
  PC: 'pc',
  LAMP: 'lamp',
} as const;
export type FurnitureType = (typeof FurnitureType)[keyof typeof FurnitureType];

export const EditTool = {
  TILE_PAINT: 'tile_paint',
  WALL_PAINT: 'wall_paint',
  FURNITURE_PLACE: 'furniture_place',
  FURNITURE_PICK: 'furniture_pick',
  SELECT: 'select',
  EYEDROPPER: 'eyedropper',
  ERASE: 'erase',
} as const;
export type EditTool = (typeof EditTool)[keyof typeof EditTool];

export interface FurnitureCatalogEntry {
  type: string;
  label: string;
  name?: string;
  width: number;
  height: number;
  sprite: SpriteData;
  isDesk: boolean;
  category?: string;
  orientation?: string;
  dynamicState?: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  canPlaceOnWalls?: boolean;
}

export interface PlacedFurniture {
  uid: string;
  type: string;
  col: number;
  row: number;
  rotation: number;
  color?: FloorColor;
  state?: string;
}

export interface OfficeLayout {
  version?: number;
  cols: number;
  rows: number;
  tiles: number[];
  furniture: PlacedFurniture[];
  tileColors?: Record<string, FloorColor>;
}

// KEY SQUAD CHANGE: Character uses string ID (slug) and has name/role
export interface Character {
  id: string; // slug like "homer-simpson" (was number in pixel-agents)
  name: string; // display name like "Homer Simpson"
  role: string; // role like "Lead" or "Frontend Dev"
  state: CharacterState;
  direction: Direction;
  x: number;
  y: number;
  col: number;
  row: number;
  path: Array<{ col: number; row: number }>;
  moveProgress: number;
  tool: string | undefined;
  palette: number;
  hueShift: number;
  frameIndex: number;
  frameTimer: number;
  wanderTimer: number;
  wanderCount: number;
  wanderLimit: number;
  active: boolean;
  seatId: string | null;
  bubbleState: { type: string; fadeTimer?: number };
  seatTimer: number;
}

export type TelemetryCategory = 'status' | 'session' | 'log' | 'orchestration';

export interface TelemetryEvent {
  id: string;
  timestamp: number;
  category: TelemetryCategory;
  agentId: string | null;
  agentName: string | null;
  summary: string;
  detail: string | null;
}

// Squad team member from roster
export interface SquadTeamMember {
  name: string;
  role: string;
  slug: string;
  emoji?: string;
}
