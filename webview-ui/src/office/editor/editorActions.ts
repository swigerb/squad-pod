import { OfficeLayout, TileType, FloorColor, PlacedFurniture } from '../types.js';
import { EditorState, UndoEntry } from './editorState.js';
import { UNDO_STACK_MAX_SIZE } from '../../constants.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import { getFurnitureFootprint } from '../layout/layoutManager.js';

function overlapArea(a: PlacedFurniture, b: PlacedFurniture): number {
  const af = getFurnitureFootprint(a);
  const bf = getFurnitureFootprint(b);
  if (!af || !bf) return 0;
  return Math.max(0, Math.min(a.col + af.width, b.col + bf.width) - Math.max(a.col, b.col))
    * Math.max(0, Math.min(a.row + af.height, b.row + bf.height) - Math.max(a.row, b.row));
}

// Ownership is geometric, so existing saved offices need no group-ID migration.
// A rider straddling desks belongs to the largest overlap, then layout order.
export function getSurfaceRiders(layout: OfficeLayout, uid: string): PlacedFurniture[] {
  const desks = layout.furniture.filter((f) => getCatalogEntry(f.type)?.isDesk);
  if (!desks.some((f) => f.uid === uid)) return [];
  return layout.furniture.filter((item) => {
    if (!getCatalogEntry(item.type)?.canPlaceOnSurfaces) return false;
    let owner: string | null = null;
    let area = 0;
    for (const desk of desks) {
      const overlap = overlapArea(item, desk);
      if (overlap > area) {
        area = overlap;
        owner = desk.uid;
      }
    }
    return owner === uid;
  });
}

export interface FurnitureTransformPlan {
  items: PlacedFurniture[];
  error: string | null;
}

function groupPlacementError(layout: OfficeLayout, items: PlacedFurniture[], duplicate: boolean): string | null {
  const excluded = new Set(duplicate ? [] : items.map((f) => f.uid));
  const obstacles = layout.furniture.filter((f) => !excluded.has(f.uid));
  for (const item of items) {
    const footprint = getFurnitureFootprint(item);
    if (!footprint) return `Cannot transform furniture with unknown dimensions: ${item.type}.`;
    const { width, height } = footprint;
    if (!Number.isInteger(item.col) || !Number.isInteger(item.row)
      || item.col < 0 || item.row < 0 || item.col + width > layout.cols || item.row + height > layout.rows) {
      return 'Furniture group must stay entirely inside the grid.';
    }
    for (let r = item.row; r < item.row + height; r++) {
      for (let c = item.col; c < item.col + width; c++) {
        const tile = layout.tiles[r * layout.cols + c];
        if ((tile === TileType.WALL && !getCatalogEntry(item.type)?.canPlaceOnWalls) || tile === TileType.VOID || tile === undefined) {
          return 'Furniture group must stay on floor tiles.';
        }
      }
    }
    for (const obstacle of [...obstacles, ...items.filter((f) => f.uid !== item.uid)]) {
      if (!getFurnitureFootprint(obstacle)) {
        return `Cannot check collisions with unknown furniture: ${obstacle.type}.`;
      }
      if (!overlapArea(item, obstacle)) continue;
      const entry = getCatalogEntry(item.type);
      const other = getCatalogEntry(obstacle.type);
      const internal = items.includes(obstacle);
      if ((entry?.canPlaceOnSurfaces && other?.isDesk)
        || (internal && entry?.isDesk && other?.canPlaceOnSurfaces)) continue;
      return 'Furniture group overlaps other furniture.';
    }
  }
  return null;
}

export function planFurnitureMove(
  layout: OfficeLayout, uid: string, col: number, row: number, duplicate = false,
): FurnitureTransformPlan {
  const item = layout.furniture.find((f) => f.uid === uid);
  if (!item) return { items: [], error: 'The selected furniture no longer exists.' };
  const items = [item, ...getSurfaceRiders(layout, uid)].map((f) => ({
    ...f, col: f.col + col - item.col, row: f.row + row - item.row,
  }));
  return { items, error: groupPlacementError(layout, items, duplicate) };
}

export function planFurnitureRotate(layout: OfficeLayout, uid: string): FurnitureTransformPlan {
  const item = layout.furniture.find((f) => f.uid === uid);
  const footprint = item && getFurnitureFootprint(item);
  if (!item || !footprint) return { items: [], error: 'Cannot rotate furniture with unknown dimensions.' };
  const items = [
    { ...item, rotation: ((item.rotation || 0) + 90) % 360 },
    ...getSurfaceRiders(layout, uid).map((rider) => {
      const size = getFurnitureFootprint(rider)!;
      return {
        ...rider,
        col: item.col + footprint.height - (rider.row - item.row) - size.height,
        row: item.row + rider.col - item.col,
        rotation: ((rider.rotation || 0) + 90) % 360,
      };
    }),
  ];
  return { items, error: groupPlacementError(layout, items, false) };
}

export function commitFurniturePlan(
  layout: OfficeLayout, plan: FurnitureTransformPlan, duplicate = false,
): { layout: OfficeLayout; selectedUid: string } | null {
  if (plan.error || !plan.items.length) return null;
  if (duplicate) {
    const taken = new Set(layout.furniture.map((f) => f.uid));
    const copies = plan.items.map((f) => {
      const base = `f-${crypto.randomUUID()}`;
      let uid = base;
      let suffix = 0;
      while (taken.has(uid)) uid = `${base}-${++suffix}`;
      taken.add(uid);
      return { ...f, uid, ...(f.color ? { color: { ...f.color } } : {}) };
    });
    return { layout: { ...layout, furniture: [...layout.furniture, ...copies] }, selectedUid: copies[0].uid };
  }
  const updates = new Map(plan.items.map((f) => [f.uid, f]));
  return {
    layout: { ...layout, furniture: layout.furniture.map((f) => updates.get(f.uid) ?? f) },
    selectedUid: plan.items[0].uid,
  };
}

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
  const entry = getCatalogEntry(type);
  if (entry && /^(pa_|local_)/.test(type)) {
    furniture.assetFootprint = { width: entry.width, height: entry.height };
    if (entry.isDesk) furniture.assetRole = 'desk';
    else if (entry.category === 'chairs' && entry.width === 1 && entry.height === 1) furniture.assetRole = 'seat';
  }
  if (groupPlacementError(layout, [furniture], true)) return layout;
  
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
  return commitFurniturePlan(layout, planFurnitureRotate(layout, uid))?.layout ?? layout;
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
