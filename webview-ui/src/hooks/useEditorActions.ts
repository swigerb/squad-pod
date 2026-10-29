import { useState, useRef, useCallback } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';
import type { EditorState } from '../office/editor/editorState.js';
import { EditTool, TileType } from '../office/types.js';
import type { FloorColor, OfficeLayout } from '../office/types.js';
import { applyTilePaint, applyErase, applyFurniturePlace, planFurnitureMove, planFurnitureRotate, commitFurniturePlan } from '../office/editor/editorActions.js';
import { UndoHistory } from '../office/editor/undoHistory.js';
import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MIN, ZOOM_MAX, MAX_COLS, MAX_ROWS } from '../constants.js';
import { vscode } from '../vscodeApi.js';

export function useEditorActions(getOfficeState: () => OfficeState, editorState: EditorState) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [editorTick, setEditorTick] = useState(0);
  const [zoom, setZoom] = useState(Math.floor(ZOOM_DEFAULT_DPR_FACTOR * (window.devicePixelRatio || 1)));
  const panRef = useRef({ x: 0, y: 0 });
  const historyRef = useRef(new UndoHistory());
  const lastSavedLayoutRef = useRef<OfficeLayout | null>(null);

  // Inside a gesture the starting layout is already captured, so edits don't add entries.
  const pushUndo = useCallback(() => {
    if (historyRef.current.inGesture) return;
    historyRef.current.record(getOfficeState().getLayout());
  }, [getOfficeState]);

  const handleGestureStart = useCallback(() => {
    historyRef.current.beginGesture(getOfficeState().getLayout());
  }, [getOfficeState]);

  const handleGestureEnd = useCallback(() => {
    if (historyRef.current.endGesture(getOfficeState().getLayout())) {
      setEditorTick((t) => t + 1);
    }
  }, [getOfficeState]);

  const isDirty = useCallback(() => {
    if (!lastSavedLayoutRef.current) return false;
    const current = getOfficeState().getLayout();
    return JSON.stringify(current) !== JSON.stringify(lastSavedLayoutRef.current);
  }, [getOfficeState]);

  const handleToggleEditMode = useCallback(() => {
    historyRef.current.endGesture(getOfficeState().getLayout());
    setIsEditMode((prev) => !prev);
  }, [getOfficeState]);

  const handleToolChange = useCallback((tool: EditTool) => {
    editorState.setTool(tool);
    setEditorTick((t) => t + 1);
  }, [editorState]);

  const handleTileTypeChange = useCallback((type: TileType) => {
    editorState.setTileType(type);
    setEditorTick((t) => t + 1);
  }, [editorState]);

  const handleFloorColorChange = useCallback((color: FloorColor) => {
    editorState.setFloorColor(color);
    setEditorTick((t) => t + 1);
  }, [editorState]);

  const handleWallColorChange = useCallback((color: FloorColor) => {
    editorState.setWallColor(color);
    setEditorTick((t) => t + 1);
  }, [editorState]);

  const handleFurnitureTypeChange = useCallback((type: string) => {
    editorState.setFurnitureType(type);
    setEditorTick((t) => t + 1);
  }, [editorState]);

  const handleEditorTileAction = useCallback(
    (col: number, row: number) => {
      const officeState = getOfficeState();
      if (editorState.tool === EditTool.TILE_PAINT) {
        pushUndo();
        const currentLayout = officeState.getLayout();
        const newLayout = applyTilePaint(
          currentLayout,
          col,
          row,
          editorState.tileType,
          editorState.floorColor
        );
        officeState.rebuildFromLayout(newLayout);
      } else if (editorState.tool === EditTool.WALL_PAINT) {
        pushUndo();
        const currentLayout = officeState.getLayout();
        const newLayout = applyTilePaint(
          currentLayout,
          col,
          row,
          TileType.WALL,
          editorState.wallColor
        );
        officeState.rebuildFromLayout(newLayout);
      } else if (editorState.tool === EditTool.FURNITURE_PLACE) {
        const currentLayout = officeState.getLayout();
        const newLayout = applyFurniturePlace(
          currentLayout,
          editorState.furnitureType,
          col,
          row,
          0
        );
        editorState.transformError = newLayout === currentLayout
          ? 'Cannot place furniture: check grid bounds, collisions and unavailable assets.' : null;
        if (newLayout !== currentLayout) {
          pushUndo();
          officeState.rebuildFromLayout(newLayout);
        }
      }
      setEditorTick((t) => t + 1);
    },
    [getOfficeState, editorState, pushUndo]
  );

  const handleEditorEraseAction = useCallback(
    (col: number, row: number) => {
      const officeState = getOfficeState();
      pushUndo();
      const currentLayout = officeState.getLayout();
      const newLayout = applyErase(currentLayout, col, row);
      officeState.rebuildFromLayout(newLayout);
      setEditorTick((t) => t + 1);
    },
    [getOfficeState, pushUndo]
  );

  const handleEditorSelectionChange = useCallback((uid: string | null) => {
    editorState.setSelectedFurnitureUid(uid);
    editorState.transformError = null;
    setEditorTick((t) => t + 1);
  }, [editorState]);

  const handleDeleteSelected = useCallback(() => {
    if (!editorState.selectedFurnitureUid) return;
    pushUndo();
    const officeState = getOfficeState();
    const layout = officeState.getLayout();
    layout.furniture = layout.furniture.filter((f) => f.uid !== editorState.selectedFurnitureUid);
    officeState.rebuildFromLayout(layout);
    editorState.setSelectedFurnitureUid(null);
    setEditorTick((t) => t + 1);
  }, [editorState, getOfficeState, pushUndo]);

  const handleRotateSelected = useCallback(() => {
    if (!editorState.selectedFurnitureUid) return;
    const officeState = getOfficeState();
    const layout = officeState.getLayout();
    const plan = planFurnitureRotate(layout, editorState.selectedFurnitureUid);
    editorState.transformError = plan.error;
    const result = commitFurniturePlan(layout, plan);
    if (result) {
      pushUndo();
      officeState.rebuildFromLayout(result.layout);
    }
    setEditorTick((t) => t + 1);
  }, [editorState, getOfficeState, pushUndo]);

  const handleToggleState = useCallback(() => {
    if (!editorState.selectedFurnitureUid) return;
    pushUndo();
    const officeState = getOfficeState();
    const layout = officeState.getLayout();
    const furniture = layout.furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
    if (furniture && furniture.state) {
      furniture.state = furniture.state === 'on' ? 'off' : 'on';
      officeState.rebuildFromLayout(layout);
      setEditorTick((t) => t + 1);
    }
  }, [editorState, getOfficeState, pushUndo]);

  const handleUndo = useCallback(() => {
    const officeState = getOfficeState();
    const prevLayout = historyRef.current.undo(officeState.getLayout());
    if (!prevLayout) return;
    officeState.rebuildFromLayout(prevLayout);
    setEditorTick((t) => t + 1);
  }, [getOfficeState]);

  const handleRedo = useCallback(() => {
    const officeState = getOfficeState();
    const nextLayout = historyRef.current.redo(officeState.getLayout());
    if (!nextLayout) return;
    officeState.rebuildFromLayout(nextLayout);
    setEditorTick((t) => t + 1);
  }, [getOfficeState]);

  const handleSave = useCallback(() => {
    const layout = getOfficeState().getLayout();
    vscode.postMessage({ type: 'saveLayout', layout });
    lastSavedLayoutRef.current = JSON.parse(JSON.stringify(layout));
    setEditorTick((t) => t + 1);
  }, [getOfficeState]);

  const handleReset = useCallback(() => {
    if (!lastSavedLayoutRef.current) return;
    const officeState = getOfficeState();
    officeState.rebuildFromLayout(JSON.parse(JSON.stringify(lastSavedLayoutRef.current)));
    historyRef.current.clear();
    setEditorTick((t) => t + 1);
  }, [getOfficeState]);

  const handleDragMove = useCallback(
    (uid: string, newCol: number, newRow: number, duplicate = false) => {
      const officeState = getOfficeState();
      const layout = officeState.getLayout();
      const furniture = layout.furniture.find((f) => f.uid === uid);
      if (!furniture || (furniture.col === newCol && furniture.row === newRow)) return;
      const plan = planFurnitureMove(layout, uid, newCol, newRow, duplicate);
      editorState.transformError = plan.error;
      const result = commitFurniturePlan(layout, plan, duplicate);
      if (result) {
        pushUndo();
        officeState.rebuildFromLayout(result.layout);
        editorState.setSelectedFurnitureUid(result.selectedUid);
      }
      setEditorTick((t) => t + 1);
    },
    [getOfficeState, editorState, pushUndo]
  );

  const handleExpandGrid = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      const officeState = getOfficeState();
      const layout = JSON.parse(JSON.stringify(officeState.getLayout())) as OfficeLayout;
      const { cols, rows } = layout;

      if (direction === 'left' || direction === 'right') {
        if (cols >= MAX_COLS) return;
      } else {
        if (rows >= MAX_ROWS) return;
      }

      pushUndo();
      const newCols = (direction === 'left' || direction === 'right') ? cols + 1 : cols;
      const newRows = (direction === 'up' || direction === 'down') ? rows + 1 : rows;

      const oldTiles = layout.tiles;
      const newTiles: number[] = new Array(newCols * newRows).fill(8); // VOID

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const destR = direction === 'up' ? r + 1 : r;
          const destC = direction === 'left' ? c + 1 : c;
          newTiles[destR * newCols + destC] = oldTiles[r * cols + c];
        }
      }

      layout.cols = newCols;
      layout.rows = newRows;
      layout.tiles = newTiles;

      // Shift furniture positions for left/up expansion
      if (direction === 'left') {
        for (const f of layout.furniture) f.col += 1;
      } else if (direction === 'up') {
        for (const f of layout.furniture) f.row += 1;
      }

      // Shift tile color keys for left/up expansion
      if (layout.tileColors && (direction === 'left' || direction === 'up')) {
        const newColors: Record<string, FloorColor> = {};
        for (const [key, val] of Object.entries(layout.tileColors)) {
          const [c, r] = key.split(',').map(Number);
          const nc = direction === 'left' ? c + 1 : c;
          const nr = direction === 'up' ? r + 1 : r;
          newColors[`${nc},${nr}`] = val;
        }
        layout.tileColors = newColors;
      }

      officeState.rebuildFromLayout(layout, direction === 'left' || direction === 'up');
      setEditorTick((t) => t + 1);
    },
    [getOfficeState, pushUndo]
  );

  const handleZoomChange = useCallback((newZoom: number) => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(newZoom)));
    setZoom(clamped);
  }, []);

  const handleSelectedFurnitureColorChange = useCallback(
    (color: FloorColor) => {
      if (!editorState.selectedFurnitureUid) return;
      pushUndo();
      const officeState = getOfficeState();
      const layout = officeState.getLayout();
      const furniture = layout.furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
      if (furniture) {
        furniture.color = color;
        officeState.rebuildFromLayout(layout);
        setEditorTick((t) => t + 1);
      }
    },
    [editorState, getOfficeState, pushUndo]
  );

  const setLastSavedLayout = useCallback((layout: OfficeLayout) => {
    lastSavedLayoutRef.current = JSON.parse(JSON.stringify(layout));
  }, []);

  return {
    isEditMode,
    isDirty: isDirty(),
    editorTick,
    zoom,
    panRef,
    canUndo: historyRef.current.canUndo,
    canRedo: historyRef.current.canRedo,
    handleGestureStart,
    handleGestureEnd,
    handleToggleEditMode,
    handleToolChange,
    handleTileTypeChange,
    handleFloorColorChange,
    handleWallColorChange,
    handleFurnitureTypeChange,
    handleEditorTileAction,
    handleEditorEraseAction,
    handleEditorSelectionChange,
    handleDeleteSelected,
    handleRotateSelected,
    handleToggleState,
    handleUndo,
    handleRedo,
    handleSave,
    handleReset,
    handleDragMove,
    handleExpandGrid,
    handleZoomChange,
    handleSelectedFurnitureColorChange,
    setLastSavedLayout,
  };
}
