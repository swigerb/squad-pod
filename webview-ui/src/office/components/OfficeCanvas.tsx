import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import type { OfficeState } from '../engine/officeState.js';
import type { EditorState } from '../editor/editorState.js';
import { EditTool, TileType } from '../types.js';
import { planFurnitureMove } from '../editor/editorActions.js';
import type { FurnitureTransformPlan } from '../editor/editorActions.js';
import { getFurnitureFootprint } from '../layout/layoutManager.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import { startGameLoop } from '../engine/gameLoop.js';
import { renderFrame } from '../engine/renderer.js';
import { clampPanOffset, zoomPanAroundAnchor } from '../engine/viewport.js';
import { updateCharacter } from '../engine/characters.js';
import { vscode } from '../../vscodeApi.js';
import { TILE_SIZE, CHARACTER_HIT_HALF_WIDTH, CHARACTER_HIT_HEIGHT, PAN_MARGIN_FRACTION, ZOOM_SCROLL_THRESHOLD } from '../../constants.js';

interface OfficeCanvasProps {
  officeState: OfficeState;
  isDebugMode?: boolean;
  onClick?: (col: number, row: number) => void;
  isEditMode: boolean;
  editorState: EditorState;
  onEditorTileAction?: (col: number, row: number) => void;
  onEditorEraseAction?: (col: number, row: number) => void;
  onEditorSelectionChange?: (uid: string | null) => void;
  onDeleteSelected?: () => void;
  onRotateSelected?: () => void;
  onDragMove?: (uid: string, newCol: number, newRow: number, duplicate: boolean) => void;
  onExpandGrid?: (direction: 'left' | 'right' | 'up' | 'down') => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  editorTick: number;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  panRef: React.RefObject<{ x: number; y: number }>;
  onDeskClick?: (agentId: string, screenX: number, screenY: number) => void;
}

export function OfficeCanvas({
  officeState,
  isDebugMode = false,
  onClick,
  isEditMode,
  editorState,
  onEditorTileAction,
  onEditorEraseAction,
  onEditorSelectionChange,
  onDragMove,
  onExpandGrid,
  onGestureStart,
  onGestureEnd,
  zoom,
  onZoomChange,
  panRef,
  onDeskClick,
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const panOriginRef = useRef<{ x: number; y: number } | null>(null);
  const spaceKeyRef = useRef(false);
  const draggedFurnitureRef = useRef<{ uid: string; offsetCol: number; offsetRow: number } | null>(null);
  const dragPreviewRef = useRef<FurnitureTransformPlan | null>(null);
  // Tile last touched by an in-progress paint/erase stroke.
  const strokeRef = useRef<{ col: number; row: number } | null>(null);
  const gestureOpenRef = useRef(false);
  const hasCenteredRef = useRef(false);
  const frameCountRef = useRef(0);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number): { col: number; row: number } => {
      const worldX = (screenX - panRef.current!.x) / zoom;
      const worldY = (screenY - panRef.current!.y) / zoom;
      return {
        col: Math.floor(worldX / TILE_SIZE),
        row: Math.floor(worldY / TILE_SIZE),
      };
    },
    [zoom, panRef]
  );

  const clampPan = useCallback(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const map = {
      width: officeState.layout.cols * TILE_SIZE * zoom,
      height: officeState.layout.rows * TILE_SIZE * zoom,
    };
    Object.assign(panRef.current!, clampPanOffset(panRef.current!, rect, map, PAN_MARGIN_FRACTION));
  }, [officeState.layout.cols, officeState.layout.rows, zoom, panRef]);

  // Zoom from any source (buttons, wheel) keeps the world point under the
  // anchor fixed, then re-clamps against the new map size. Runs before the
  // next frame so the office is never drawn with a stale offset.
  const prevZoomRef = useRef(zoom);
  const zoomAnchorRef = useRef<{ zoom: number; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const oldZoom = prevZoomRef.current;
    prevZoomRef.current = zoom;
    const pending = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const container = containerRef.current;
    if (oldZoom === zoom || !container || !hasCenteredRef.current) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const anchor = pending && pending.zoom === zoom ? pending : { x: rect.width / 2, y: rect.height / 2 };
    Object.assign(panRef.current!, zoomPanAroundAnchor(panRef.current!, oldZoom, zoom, anchor));
    clampPan();
  }, [zoom, panRef, clampPan]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initial sizing — may be 0 if webview hasn't laid out yet; that's OK,
    // the render callback re-checks every frame.
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    const cleanup = startGameLoop(canvas, {
      update: (deltaTime: number) => {
        for (const char of officeState.characters.values()) {
          updateCharacter(char, deltaTime, officeState.walkableTiles, officeState.seats, officeState.tileMap, officeState.blockedTiles);
        }
      },
      render: () => {
        frameCountRef.current++;

        // Inline resize: check container dimensions every frame and resize
        // canvas if needed.  This replaces the ResizeObserver which could
        // clear the backing store AFTER rAF draw but BEFORE browser paint,
        // producing an always-blank canvas.
        const r = container.getBoundingClientRect();
        const targetW = Math.round(r.width * dpr);
        const targetH = Math.round(r.height * dpr);
        if (targetW > 0 && targetH > 0 && (canvas.width !== targetW || canvas.height !== targetH)) {
          canvas.width = targetW;
          canvas.height = targetH;
          canvas.style.width = `${r.width}px`;
          canvas.style.height = `${r.height}px`;
          clampPan();
        }

        // Skip drawing if canvas has no area
        const cw = canvas.width / dpr;
        const ch = canvas.height / dpr;
        if (cw <= 0 || ch <= 0) return;

        // One-time auto-center when layout first loads
        if (!hasCenteredRef.current && officeState.layout.cols > 0) {
          const mapW = officeState.layout.cols * TILE_SIZE * zoom;
          const mapH = officeState.layout.rows * TILE_SIZE * zoom;
          panRef.current!.x = (cw - mapW) / 2;
          panRef.current!.y = (ch - mapH) / 2;
          hasCenteredRef.current = true;
        }

        // DPR scaling — must come AFTER any canvas.width change (which
        // resets the context transform to identity).
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;

        const tileColorsMap = officeState.layout.tileColors ? new Map(Object.entries(officeState.layout.tileColors)) : undefined;
        const chars = Array.from(officeState.characters.values());
        renderFrame(
          ctx,
          cw,
          ch,
          officeState.tileMap,
          officeState.furniture,
          chars,
          zoom,
          panRef.current!.x,
          panRef.current!.y,
          null,
          isEditMode ? { showGrid: true, showGhostBorder: true, ghostHoverCol: officeState.hoveredTile?.col ?? null, ghostHoverRow: officeState.hoveredTile?.row ?? null } : undefined,
          tileColorsMap,
          officeState.layout.cols,
          officeState.layout.rows,
          officeState.selectedAgentId,
          officeState.hoveredAgentId,
          officeState.hoveredTile,
          officeState.seats,
          isDebugMode
        );
        const preview = dragPreviewRef.current;
        if (isEditMode && preview) {
          ctx.save();
          ctx.strokeStyle = preview.error ? '#ff6060' : '#60dd90';
          ctx.fillStyle = preview.error ? '#ff606033' : '#60dd9033';
          ctx.lineWidth = 2;
          for (const item of preview.items) {
            const size = getFurnitureFootprint(item);
            if (!size) continue;
            const x = item.col * TILE_SIZE * zoom + panRef.current!.x;
            const y = item.row * TILE_SIZE * zoom + panRef.current!.y;
            const w = size.width * TILE_SIZE * zoom;
            const h = size.height * TILE_SIZE * zoom;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
          }
          ctx.restore();
        }
      },
    });

    return () => { cleanup(); };
  }, [officeState, isEditMode, isDebugMode, editorState, zoom, panRef, clampPan]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && spaceKeyRef.current)) {
        e.preventDefault();
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY };
        panOriginRef.current = { ...panRef.current! };
        return;
      }

      if (e.button !== 0) return;

      const rect = canvasRef.current!.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { col, row } = screenToWorld(screenX, screenY);

      if (isEditMode) {
        // Ghost border click → expand grid
        const { cols: lCols, rows: lRows } = officeState.layout;
        if (onExpandGrid && (col < 0 || col >= lCols || row < 0 || row >= lRows)) {
          if (col < 0) onExpandGrid('left');
          else if (col >= lCols) onExpandGrid('right');
          else if (row < 0) onExpandGrid('up');
          else if (row >= lRows) onExpandGrid('down');
          return;
        }

        if (editorState.tool === 'select') {
          let selectedUid: string | null = null;
          // Surface objects are drawn above desks and must win hit testing too.
          const hitOrder = [...officeState.furniture].reverse().sort((a, b) =>
            Number(!!getCatalogEntry(b.type)?.canPlaceOnSurfaces) - Number(!!getCatalogEntry(a.type)?.canPlaceOnSurfaces));
          for (const furn of hitOrder) {
            const furnWidth = furn.width;
            const furnHeight = furn.height;
            if (col >= furn.col && col < furn.col + furnWidth && row >= furn.row && row < furn.row + furnHeight) {
              selectedUid = furn.uid;
              draggedFurnitureRef.current = { uid: furn.uid, offsetCol: col - furn.col, offsetRow: row - furn.row };
              gestureOpenRef.current = true;
              onGestureStart?.();
              break;
            }
          }
          onEditorSelectionChange?.(selectedUid);
        } else if (editorState.tool === 'erase') {
          gestureOpenRef.current = true;
          onGestureStart?.();
          strokeRef.current = { col, row };
          onEditorEraseAction?.(col, row);
        } else if (editorState.tool === 'eyedropper') {
          const tile = officeState.tileMap[row]?.[col];
          if (tile !== undefined) {
            editorState.setTileType(tile as TileType);
            editorState.setTool(EditTool.TILE_PAINT);
          }
        } else {
          if (editorState.tool === EditTool.TILE_PAINT || editorState.tool === EditTool.WALL_PAINT) {
            gestureOpenRef.current = true;
            onGestureStart?.();
            strokeRef.current = { col, row };
          }
          onEditorTileAction?.(col, row);
        }
      } else {
        let clickedAgentId: string | null = null;
        for (const [id, char] of officeState.characters) {
          const charScreenX = char.x * zoom + panRef.current!.x;
          const charScreenY = char.y * zoom + panRef.current!.y;
          const hitLeft = charScreenX - CHARACTER_HIT_HALF_WIDTH * zoom;
          const hitRight = charScreenX + CHARACTER_HIT_HALF_WIDTH * zoom;
          const hitTop = charScreenY - CHARACTER_HIT_HEIGHT * zoom;
          const hitBottom = charScreenY;
          if (screenX >= hitLeft && screenX <= hitRight && screenY >= hitTop && screenY <= hitBottom) {
            clickedAgentId = id;
            break;
          }
        }
        
        if (clickedAgentId) {
          onDeskClick?.(clickedAgentId, e.clientX, e.clientY);
        }
        
        if (!clickedAgentId) {
          let seatId = officeState.getSeatAtTile(col, row);
          
          if (!seatId) {
            const adjacentOffsets = [
              [-1, 0], [1, 0], [0, -1], [0, 1],
              [-1, -1], [1, -1], [-1, 1], [1, 1],
            ];
            for (const [dc, dr] of adjacentOffsets) {
              seatId = officeState.getSeatAtTile(col + dc, row + dr);
              if (seatId) break;
            }
          }
          
          const selected = officeState.selectedAgentId;
          const seat = seatId ? officeState.seats.find(s => s.id === seatId) : undefined;
          if (seat && selected && seat.occupant !== selected) {
            // A selected agent plus a click on another seat moves the agent there.
            if (officeState.reassignSeat(selected, seat.id)) {
              vscode.postMessage({ type: 'saveAgentSeats', seats: officeState.getSeatAssignments() });
            }
            officeState.selectedAgentId = null;
            onClick?.(col, row);
            return;
          }
          if (seat?.occupant) {
            clickedAgentId = seat.occupant;
            onDeskClick?.(seat.occupant, e.clientX, e.clientY);
          }
        }
        
        if (clickedAgentId) {
          officeState.selectedAgentId = officeState.selectedAgentId === clickedAgentId ? null : clickedAgentId;
        } else {
          officeState.selectedAgentId = null;
        }
        onClick?.(col, row);
      }
    },
    [
      screenToWorld,
      isEditMode,
      editorState,
      officeState,
      onClick,
      onEditorTileAction,
      onEditorEraseAction,
      onEditorSelectionChange,
      onExpandGrid,
      onGestureStart,
      zoom,
      panRef,
      onDeskClick,
    ]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning && panStartRef.current && panOriginRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        panRef.current!.x = panOriginRef.current.x + dx;
        panRef.current!.y = panOriginRef.current.y + dy;
        clampPan();
        return;
      }

      if (draggedFurnitureRef.current && isEditMode && editorState.tool === 'select') {
        const rect = canvasRef.current!.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const { col, row } = screenToWorld(screenX, screenY);
        const newCol = col - draggedFurnitureRef.current.offsetCol;
        const newRow = row - draggedFurnitureRef.current.offsetRow;
        dragPreviewRef.current = planFurnitureMove(officeState.layout, draggedFurnitureRef.current.uid, newCol, newRow, e.altKey);
        return;
      }

      const rect = canvasRef.current!.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { col, row } = screenToWorld(screenX, screenY);
      officeState.hoveredTile = { col, row };

      const stroke = strokeRef.current;
      if (stroke && isEditMode && (stroke.col !== col || stroke.row !== row)) {
        const inGrid = col >= 0 && row >= 0 && col < officeState.layout.cols && row < officeState.layout.rows;
        if (inGrid) {
          strokeRef.current = { col, row };
          if (editorState.tool === EditTool.ERASE) onEditorEraseAction?.(col, row);
          else if (editorState.tool === EditTool.TILE_PAINT || editorState.tool === EditTool.WALL_PAINT) {
            onEditorTileAction?.(col, row);
          }
        }
      }

      let hoveredId: string | null = null;
      for (const [id, char] of officeState.characters) {
        const charScreenX = char.x * zoom + panRef.current!.x;
        const charScreenY = char.y * zoom + panRef.current!.y;
        const hitLeft = charScreenX - CHARACTER_HIT_HALF_WIDTH * zoom;
        const hitRight = charScreenX + CHARACTER_HIT_HALF_WIDTH * zoom;
        const hitTop = charScreenY - CHARACTER_HIT_HEIGHT * zoom;
        const hitBottom = charScreenY;
        if (screenX >= hitLeft && screenX <= hitRight && screenY >= hitTop && screenY <= hitBottom) {
          hoveredId = id;
          break;
        }
      }
      officeState.hoveredAgentId = hoveredId;
    },
    [isPanning, isEditMode, editorState.tool, screenToWorld, officeState, zoom, panRef, clampPan, onEditorEraseAction, onEditorTileAction]
  );

  const finishGesture = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
    panOriginRef.current = null;
    draggedFurnitureRef.current = null;
    dragPreviewRef.current = null;
    strokeRef.current = null;
    if (gestureOpenRef.current) {
      gestureOpenRef.current = false;
      onGestureEnd?.();
    }
  }, [onGestureEnd]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const drag = draggedFurnitureRef.current;
    if (drag && isEditMode && editorState.tool === EditTool.SELECT) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const { col, row } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      // Commit only the final destination; passing through valid tiles must not
      // leave a partial move behind when the drop itself is invalid.
      onDragMove?.(drag.uid, col - drag.offsetCol, row - drag.offsetRow, e.altKey);
    }
    finishGesture();
  }, [isEditMode, editorState, screenToWorld, onDragMove, finishGesture]);

  useEffect(() => {
    window.addEventListener('blur', finishGesture);
    return () => window.removeEventListener('blur', finishGesture);
  }, [finishGesture]);

  useEffect(() => {
    if (!isEditMode) finishGesture();
  }, [isEditMode, finishGesture]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const newZoom = Math.max(1, Math.min(10, Math.floor(zoom + delta)));
        if (newZoom !== zoom) {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) zoomAnchorRef.current = { zoom: newZoom, x: e.clientX - rect.left, y: e.clientY - rect.top };
          onZoomChange?.(newZoom);
        }
      } else {
        if (Math.abs(e.deltaX) > ZOOM_SCROLL_THRESHOLD || Math.abs(e.deltaY) > ZOOM_SCROLL_THRESHOLD) {
          panRef.current!.x -= e.deltaX;
          panRef.current!.y -= e.deltaY;
          clampPan();
        }
      }
    },
    [zoom, onZoomChange, panRef, clampPan]
  );

  useEffect(() => {
    const updateCopyPreview = (duplicate: boolean) => {
      const drag = draggedFurnitureRef.current;
      const target = dragPreviewRef.current?.items[0];
      if (drag && target) {
        dragPreviewRef.current = planFurnitureMove(officeState.layout, drag.uid, target.col, target.row, duplicate);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') updateCopyPreview(true);
      if (e.code === 'Space') {
        e.preventDefault();
        spaceKeyRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') updateCopyPreview(false);
      if (e.code === 'Space') {
        spaceKeyRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [officeState]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, cursor: isPanning ? 'grabbing' : 'default' }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={finishGesture}
        onWheel={handleWheel}
        style={{ display: 'block' }}
      />
      {isEditMode && editorState.tool === EditTool.SELECT && (
        <div style={{ position: 'absolute', right: 12, bottom: 60, color: '#ccc', background: '#252526', padding: 6, pointerEvents: 'none' }}>
          Drag to move. Hold Alt on release to copy. Desks carry PCs and lamps.
        </div>
      )}
      {isEditMode && editorState.transformError && (
        <div role="alert" style={{ position: 'absolute', right: 12, bottom: 100, color: '#ff9090', background: '#252526', padding: 8, pointerEvents: 'none' }}>
          {editorState.transformError}
        </div>
      )}
    </div>
  );
}
