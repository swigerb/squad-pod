import { EditTool, TileType, FurnitureType, FloorColor, OfficeLayout } from '../types.js';
import { DEFAULT_FLOOR_COLOR, DEFAULT_WALL_COLOR, UNDO_STACK_MAX_SIZE } from '../../constants.js';

export interface UndoEntry {
  layout: OfficeLayout;
  timestamp: number;
}

export class EditorState {
  activeTool: EditTool = EditTool.SELECT;
  selectedTileType: TileType = TileType.FLOOR_1;
  selectedFurnitureType: string = FurnitureType.DESK;
  selectedFurnitureUid: string | null = null;
  floorColor: FloorColor = { ...DEFAULT_FLOOR_COLOR };
  wallColor: FloorColor = { ...DEFAULT_WALL_COLOR };
  undoStack: UndoEntry[] = [];
  redoStack: UndoEntry[] = [];

  constructor() {}

  reset(): void {
    this.activeTool = EditTool.SELECT;
    this.selectedTileType = TileType.FLOOR_1;
    this.selectedFurnitureType = FurnitureType.DESK;
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
