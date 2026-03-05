import { useState, useRef, useCallback } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';
import type { EditorState } from '../office/editor/editorState.js';
import type { EditTool, TileType, FloorColor, OfficeLayout } from '../office/types.js';
import { applyTilePaint, applyErase, applyFurniturePlace } from '../office/editor/editorActions.js';
import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MIN, ZOOM_MAX, UNDO_STACK_MAX_SIZE } from '../constants.js';
import { vscode } from '../vscodeApi.js';

export function useEditorActions(getOfficeState: () => OfficeState, editorState: EditorState) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [editorTick, setEditorTick] = useState(0);
  const [zoom, setZoom] = useState(Math.floor(ZOOM_DEFAULT_DPR_FACTOR * (window.devicePixelRatio || 1)));
  const panRef = useRef({ x: 0, y: 0 });
  const undoStack = useRef<OfficeLayout[]>([]);
  const redoStack = useRef<OfficeLayout[]>([]);
  const lastSavedLayoutRef = useRef<OfficeLayout | null>(null);

  const pushUndo = useCallback(() => {
    const currentLayout = getOfficeState().getLayout();
    undoStack.current.push(JSON.parse(JSON.stringify(currentLayout)));
    if (undoStack.current.length > UNDO_STACK_MAX_SIZE) {
      undoStack.current.shift();
    }
    redoStack.current = [];
  }, [getOfficeState]);

  const isDirty = useCallback(() => {
    if (!lastSavedLayoutRef.current) return false;
    const current = getOfficeState().getLayout();
    return JSON.stringify(current) !== JSON.stringify(lastSavedLayoutRef.current);
  }, [getOfficeState]);

  const handleToggleEditMode = useCallback(() => {
    if (isEditMode && isDirty()) {
      const confirm = window.confirm('You have unsaved changes. Exit without saving?');
      if (!confirm) return;
    }
    setIsEditMode((prev) => !prev);
    if (!isEditMode) {
      pushUndo();
    }
  }, [isEditMode, isDirty, pushUndo]);

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
      if (editorState.tool === 'tile') {
        pushUndo();
        const currentLayout = officeState.getLayout();
        const newLayout = applyTilePaint(
          currentLayout,
          col,
          row,
          editorState.tileType,
          editorState.tileType === 1 ? editorState.floorColor : editorState.wallColor
        );
        officeState.rebuildFromLayout(newLayout);
      } else if (editorState.tool === 'furniture') {
        pushUndo();
        const currentLayout = officeState.getLayout();
        const newLayout = applyFurniturePlace(
          currentLayout,
          editorState.furnitureType,
          col,
          row,
          0
        );
        officeState.rebuildFromLayout(newLayout);
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
    pushUndo();
    const officeState = getOfficeState();
    const layout = officeState.getLayout();
    const furniture = layout.furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
    if (furniture) {
      furniture.rotation = ((furniture.rotation || 0) + 90) % 360;
      officeState.rebuildFromLayout(layout);
      setEditorTick((t) => t + 1);
    }
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
    if (undoStack.current.length === 0) return;
    const officeState = getOfficeState();
    redoStack.current.push(JSON.parse(JSON.stringify(officeState.getLayout())));
    const prevLayout = undoStack.current.pop()!;
    officeState.rebuildFromLayout(prevLayout);
    setEditorTick((t) => t + 1);
  }, [getOfficeState]);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const officeState = getOfficeState();
    undoStack.current.push(JSON.parse(JSON.stringify(officeState.getLayout())));
    const nextLayout = redoStack.current.pop()!;
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
    officeState.rebuildFromLayout(lastSavedLayoutRef.current);
    undoStack.current = [];
    redoStack.current = [];
    setEditorTick((t) => t + 1);
  }, [getOfficeState]);

  const handleDragMove = useCallback(
    (uid: string, newCol: number, newRow: number) => {
      const officeState = getOfficeState();
      const layout = officeState.getLayout();
      const furniture = layout.furniture.find((f) => f.uid === uid);
      if (furniture) {
        furniture.col = newCol;
        furniture.row = newRow;
        officeState.rebuildFromLayout(layout);
        setEditorTick((t) => t + 1);
      }
    },
    [getOfficeState]
  );

  const handleZoomChange = useCallback((newZoom: number) => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(newZoom)));
    setZoom(clamped);
  }, []);

  const handleOpenClaude = useCallback(() => {
    vscode.postMessage({ type: 'openClaude' });
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
    handleZoomChange,
    handleOpenClaude,
    handleSelectedFurnitureColorChange,
    setLastSavedLayout,
  };
}
