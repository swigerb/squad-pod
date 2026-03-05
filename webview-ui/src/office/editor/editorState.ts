import { EditTool, TileType, FurnitureType, FloorColor, OfficeLayout } from '../types.js';
import { DEFAULT_FLOOR_COLOR, DEFAULT_WALL_COLOR } from '../../constants.js';

export interface UndoEntry {
  layout: OfficeLayout;
  timestamp: number;
}

export class EditorState {
  tool: EditTool = EditTool.SELECT;
  tileType: TileType = TileType.FLOOR_1;
  furnitureType: string = FurnitureType.DESK;
  selectedFurnitureUid: string | null = null;
  floorColor: FloorColor = { ...DEFAULT_FLOOR_COLOR };
  wallColor: FloorColor = { ...DEFAULT_WALL_COLOR };
  undoStack: UndoEntry[] = [];
  redoStack: UndoEntry[] = [];

  constructor() {}

  setTool(tool: EditTool): void { this.tool = tool; }
  setTileType(type: TileType): void { this.tileType = type; }
  setFurnitureType(type: string): void { this.furnitureType = type; }
  setFloorColor(color: FloorColor): void { this.floorColor = { ...color }; }
  setWallColor(color: FloorColor): void { this.wallColor = { ...color }; }
  setSelectedFurnitureUid(uid: string | null): void { this.selectedFurnitureUid = uid; }

  reset(): void {
    this.tool = EditTool.SELECT;
    this.tileType = TileType.FLOOR_1;
    this.furnitureType = FurnitureType.DESK;
    this.selectedFurnitureUid = null;
    this.floorColor = { ...DEFAULT_FLOOR_COLOR };
    this.wallColor = { ...DEFAULT_WALL_COLOR };
    this.undoStack = [];
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
