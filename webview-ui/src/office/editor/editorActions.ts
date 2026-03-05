import { OfficeLayout, TileType, FloorColor, PlacedFurniture } from '../types.js';
import { EditorState, UndoEntry } from './editorState.js';
import { UNDO_STACK_MAX_SIZE } from '../../constants.js';

export function applyTilePaint(
  layout: OfficeLayout,
  col: number,
  row: number,
  tileType: TileType,
  color: FloorColor
): OfficeLayout {
  const newLayout = cloneLayout(layout);
  const index = row * layout.cols + col;
  
  if (index >= 0 && index < newLayout.tiles.length) {
    newLayout.tiles[index] = tileType;
    if (!newLayout.tileColors) newLayout.tileColors = {};
    newLayout.tileColors[`${col},${row}`] = { ...color };
  }
  
  return newLayout;
}

export function applyErase(
  layout: OfficeLayout,
  col: number,
  row: number
): OfficeLayout {
  const newLayout = cloneLayout(layout);
  const index = row * layout.cols + col;
  
  if (index >= 0 && index < newLayout.tiles.length) {
    newLayout.tiles[index] = TileType.VOID;
    if (newLayout.tileColors) {
      delete newLayout.tileColors[`${col},${row}`];
    }
  }
  
  return newLayout;
}

export function applyFurniturePlace(
  layout: OfficeLayout,
  type: string,
  col: number,
  row: number,
  rotation: number = 0
): OfficeLayout {
  const newLayout = cloneLayout(layout);
  const uid = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const furniture: PlacedFurniture = {
    uid,
    type,
    col,
    row,
    rotation
  };
  
  newLayout.furniture.push(furniture);
  return newLayout;
}

export function applyFurnitureDelete(
  layout: OfficeLayout,
  uid: string
): OfficeLayout {
  const newLayout = cloneLayout(layout);
  newLayout.furniture = newLayout.furniture.filter(f => f.uid !== uid);
  return newLayout;
}

export function applyFurnitureRotate(
  layout: OfficeLayout,
  uid: string
): OfficeLayout {
  const newLayout = cloneLayout(layout);
  const furniture = newLayout.furniture.find(f => f.uid === uid);
  
  if (furniture) {
    furniture.rotation = (furniture.rotation + 90) % 360;
  }
  
  return newLayout;
}

export function applyEyedropper(
  layout: OfficeLayout,
  col: number,
  row: number
): { tileType: TileType; color: FloorColor } | null {
  const index = row * layout.cols + col;
  
  if (index >= 0 && index < layout.tiles.length) {
    const tileType = layout.tiles[index] as TileType;
    const color = layout.tileColors?.[`${col},${row}`];
    
    if (color) {
      return { tileType, color };
    }
  }
  
  return null;
}

export function pushUndo(state: EditorState, layout: OfficeLayout): void {
  const entry: UndoEntry = {
    layout: cloneLayout(layout),
    timestamp: Date.now()
  };
  
  state.undoStack.push(entry);
  
  if (state.undoStack.length > UNDO_STACK_MAX_SIZE) {
    state.undoStack.shift();
  }
  
  state.redoStack = [];
}

export function performUndo(state: EditorState, currentLayout: OfficeLayout): OfficeLayout | null {
  if (state.undoStack.length === 0) return null;
  
  const currentEntry: UndoEntry = {
    layout: cloneLayout(currentLayout),
    timestamp: Date.now()
  };
  state.redoStack.push(currentEntry);
  
  const entry = state.undoStack.pop()!;
  return entry.layout;
}

export function performRedo(state: EditorState, currentLayout: OfficeLayout): OfficeLayout | null {
  if (state.redoStack.length === 0) return null;
  
  const currentEntry: UndoEntry = {
    layout: cloneLayout(currentLayout),
    timestamp: Date.now()
  };
  state.undoStack.push(currentEntry);
  
  const entry = state.redoStack.pop()!;
  return entry.layout;
}

function cloneLayout(layout: OfficeLayout): OfficeLayout {
  return {
    version: layout.version,
    cols: layout.cols,
    rows: layout.rows,
    tiles: [...layout.tiles],
    furniture: layout.furniture.map(f => ({ ...f })),
    tileColors: layout.tileColors ? { ...layout.tileColors } : undefined
  };
}
