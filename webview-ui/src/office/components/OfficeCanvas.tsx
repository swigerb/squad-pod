import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import type { OfficeState } from '../engine/officeState.js';
import type { EditorState } from '../editor/editorState.js';
import { EditTool } from '../types.js';
import type { Character } from '../types.js';
import { planFurnitureMove } from '../editor/editorActions.js';
import type { FurnitureTransformPlan } from '../editor/editorActions.js';
import { getFurnitureFootprint } from '../layout/layoutManager.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import { startGameLoop } from '../engine/gameLoop.js';
import { renderFrame } from '../engine/renderer.js';
import { clampPanOffset, zoomPanAroundAnchor } from '../engine/viewport.js';
import { officePanStep, pinchZoom, type OfficePanAnchor, type Point } from '../../mobile/touchDecisions.js';
import {
  updateCharacter,
} from '../engine/characters.js';
import { getCharacterScreenBounds } from '../engine/characterGeometry.js';
import { updatePet } from '../engine/petEntity.js';
import { useHostClient } from '../../HostClientContext.js';
import {
  TILE_SIZE,
  PAN_MARGIN_FRACTION,
  ZOOM_SCROLL_THRESHOLD,
} from '../../constants.js';

interface OfficeCanvasProps {
  readOnly?: boolean;
  officeState: OfficeState;
  isDebugMode?: boolean;
  onClick?: (col: number, row: number) => void;
  isEditMode: boolean;
  editorState: EditorState;
  onEditorTileAction?: (col: number, row: number) => void;
  onEditorEraseAction?: (col: number, row: number) => void;
  onEditorEyedropper?: (col: number, row: number, sampleArea?: boolean) => void;
  onEditorFurnitureColorPick?: (col: number, row: number) => void;
  furnitureColorPickTarget?: 'selected' | 'palette' | null;
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
  showAreas?: boolean;
  panRef: React.RefObject<{ x: number; y: number }>;
  onDeskClick?: (agentId: string, screenX: number, screenY: number) => void;
  touchGestures?: boolean;
  onManualPan?: () => void;
}

export function getCharacterHitBounds(
  character: Character,
  zoom: number,
  pan: { x: number; y: number },
): { left: number; right: number; top: number; bottom: number } {
  return getCharacterScreenBounds(character, zoom, pan);
}

export function OfficeCanvas({
  readOnly = false,
  officeState,
  isDebugMode = false,
  onClick,
  isEditMode,
  editorState,
  onEditorTileAction,
  onEditorEraseAction,
  onEditorEyedropper,
  onEditorFurnitureColorPick,
  furnitureColorPickTarget = null,
  onEditorSelectionChange,
  onDragMove,
  onExpandGrid,
  onGestureStart,
  onGestureEnd,
  zoom,
  onZoomChange,
  showAreas = false,
  panRef,
  onDeskClick,
  touchGestures = false,
  onManualPan,
}: OfficeCanvasProps) {
  const client = useHostClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const panOriginRef = useRef<{ x: number; y: number } | null>(null);
  const spaceKeyRef = useRef(false);
  const draggedFurnitureRef = useRef<{ uid: string; offsetCol: number; offsetRow: number } | null>(null);
  const dragPreviewRef = useRef<FurnitureTransformPlan | null>(null);
  // Tile last touched by an in-progress paint/erase stroke.
  const strokeRef = useRef<{ col: number; row: number; erase: boolean } | null>(null);
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
  const touchOptions = useRef({ zoom, onZoomChange, panRef, clampPan, onManualPan });
  touchOptions.current = { zoom, onZoomChange, panRef, clampPan, onManualPan };

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
        officeState.updateFurnitureAnimation(deltaTime);
        for (const char of officeState.characters.values()) {
          updateCharacter(char, deltaTime, officeState.walkableTiles, officeState.seats, officeState.tileMap, officeState.blockedTiles);
        }
        for (const pet of officeState.pets) {
          updatePet(pet, deltaTime, officeState.walkableTileList, officeState.characters, officeState.tileMap, officeState.blockedTiles);
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
          isDebugMode,
          officeState.layout.carpetTiles,
          officeState.pets,
          officeState.layout.areas,
          officeState.layout.areaTiles,
          showAreas || (isEditMode && editorState.tool === EditTool.AREA_PAINT),
          editorState.selectedAreaLabel,
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
  }, [officeState, isEditMode, isDebugMode, editorState, zoom, panRef, clampPan, showAreas]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && spaceKeyRef.current)) {
        e.preventDefault();
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY };
        panOriginRef.current = { ...panRef.current! };
        return;
      }

      const carpetErase = e.button === 2 && isEditMode && editorState.tool === EditTool.CARPET_PAINT;
      const areaErase = e.button === 2 && isEditMode && editorState.tool === EditTool.AREA_PAINT;
      if (e.button !== 0 && !carpetErase && !areaErase) return;

      const rect = canvasRef.current!.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { col, row } = screenToWorld(screenX, screenY);

      if (isEditMode) {
        if (furnitureColorPickTarget !== null) {
          onEditorFurnitureColorPick?.(col, row);
          return;
        }

        // Ghost border click → expand grid
        const { cols: lCols, rows: lRows } = officeState.layout;
        if (onExpandGrid && !carpetErase && !areaErase && (col < 0 || col >= lCols || row < 0 || row >= lRows)) {
          if (col < 0) onExpandGrid('left');
          else if (col >= lCols) onExpandGrid('right');
          else if (row < 0) onExpandGrid('up');
          else if (row >= lRows) onExpandGrid('down');
          return;
        }

        if (carpetErase || areaErase) {
          gestureOpenRef.current = true;
          onGestureStart?.();
          strokeRef.current = { col, row, erase: true };
          onEditorEraseAction?.(col, row);
        } else if (editorState.tool === 'select') {
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
          strokeRef.current = { col, row, erase: true };
          onEditorEraseAction?.(col, row);
        } else if (editorState.tool === 'eyedropper') {
          onEditorEyedropper?.(col, row, e.shiftKey);
        } else {
          if (editorState.tool === EditTool.TILE_PAINT || editorState.tool === EditTool.WALL_PAINT
            || editorState.tool === EditTool.CARPET_PAINT || editorState.tool === EditTool.AREA_PAINT) {
            gestureOpenRef.current = true;
            onGestureStart?.();
            strokeRef.current = { col, row, erase: false };
          }
          onEditorTileAction?.(col, row);
        }
      } else {
        const worldX = (screenX - panRef.current!.x) / zoom;
        const worldY = (screenY - panRef.current!.y) / zoom;
        let clickedAgentId: string | null = null;
        for (const [id, char] of officeState.characters) {
          const bounds = getCharacterHitBounds(char, zoom, panRef.current!);
          if (screenX >= bounds.left && screenX <= bounds.right
            && screenY >= bounds.top && screenY <= bounds.bottom) {
            clickedAgentId = id;
            break;
          }
        }
        
        if (clickedAgentId) {
          onDeskClick?.(clickedAgentId, e.clientX, e.clientY);
        }

        if (!clickedAgentId) {
          const pet = officeState.getPetAt(worldX, worldY);
          if (pet) {
            officeState.togglePetBubble(pet.id);
            officeState.selectedAgentId = null;
            return;
          }
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
          if (!readOnly && seat && selected && seat.occupant !== selected) {
            // A selected agent plus a click on another seat moves the agent there.
            if (officeState.reassignSeat(selected, seat.id)) {
              client.send({ type: 'saveAgentSeats', seats: officeState.getSeatAssignments() });
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
          officeState.selectedAgentId = clickedAgentId;
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
      onEditorEyedropper,
      onEditorFurnitureColorPick,
      furnitureColorPickTarget,
      onEditorSelectionChange,
      onExpandGrid,
      onGestureStart,
      zoom,
      panRef,
      onDeskClick,
      readOnly,
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
          strokeRef.current = { col, row, erase: stroke.erase };
          if (stroke.erase) onEditorEraseAction?.(col, row);
          else if (editorState.tool === EditTool.TILE_PAINT || editorState.tool === EditTool.WALL_PAINT
            || editorState.tool === EditTool.CARPET_PAINT || editorState.tool === EditTool.AREA_PAINT) {
            onEditorTileAction?.(col, row);
          }
        }
      }

      let hoveredId: string | null = null;
      for (const [id, char] of officeState.characters) {
        const bounds = getCharacterHitBounds(char, zoom, panRef.current!);
        if (screenX >= bounds.left && screenX <= bounds.right
          && screenY >= bounds.top && screenY <= bounds.bottom) {
          hoveredId = id;
          break;
        }
      }
      officeState.hoveredAgentId = hoveredId;
      const worldX = (screenX - panRef.current!.x) / zoom;
      const worldY = (screenY - panRef.current!.y) / zoom;
      const hoveredPet = !isEditMode && !hoveredId ? officeState.getPetAt(worldX, worldY) : null;
      if (canvasRef.current) canvasRef.current.style.cursor = hoveredId || hoveredPet ? 'pointer' : 'default';
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
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) {
        return;
      }
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !touchGestures) return;
    type TouchMode = 'idle' | 'pending' | 'pan' | 'pinch';
    let mode: TouchMode = 'idle';
    let anchor: OfficePanAnchor | null = null;
    let pinchStartDistance = 0;
    let pinchStartZoom = 1;
    let pinchLastMidpoint: Point | null = null;
    const point = (touch: Touch): Point => ({ x: touch.clientX, y: touch.clientY });
    const midpoint = (a: Touch, b: Touch): Point => ({
      x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2,
    });
    const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const reset = () => { mode = 'idle'; anchor = null; };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        mode = 'pending';
        anchor = { point: point(event.touches[0]), pan: { ...touchOptions.current.panRef.current! }, panned: false };
      } else if (event.touches.length === 2) {
        event.preventDefault();
        mode = 'pinch';
        anchor = { point: midpoint(event.touches[0], event.touches[1]),
          pan: { ...touchOptions.current.panRef.current! }, panned: false };
        pinchLastMidpoint = anchor.point;
        pinchStartDistance = distance(event.touches[0], event.touches[1]);
        pinchStartZoom = touchOptions.current.zoom;
      } else if (event.touches.length > 2) reset();
    };
    const onMove = (event: TouchEvent) => {
      const current = touchOptions.current;
      if (!anchor || mode === 'idle') return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (mode === 'pinch' && event.touches.length >= 2) {
        event.preventDefault();
        const mid = midpoint(event.touches[0], event.touches[1]);
        const step = officePanStep(anchor, mid, dpr);
        anchor = step.anchor;
        if (step.breakFollow) current.onManualPan?.();
        if (pinchLastMidpoint) {
          current.panRef.current!.x += (mid.x - pinchLastMidpoint.x) * dpr;
          current.panRef.current!.y += (mid.y - pinchLastMidpoint.y) * dpr;
        }
        pinchLastMidpoint = mid;
        const nextZoom = pinchZoom(pinchStartDistance, distance(event.touches[0], event.touches[1]), pinchStartZoom);
        if (nextZoom !== current.zoom) {
          zoomAnchorRef.current = { zoom: nextZoom, x: mid.x - rect.left, y: mid.y - rect.top };
          current.onZoomChange?.(nextZoom);
        } else current.clampPan();
        return;
      }
      if (event.touches.length !== 1) return;
      const finger = point(event.touches[0]);
      if (mode === 'pending') {
        const dx = finger.x - anchor.point.x;
        const dy = finger.y - anchor.point.y;
        if (Math.hypot(dx, dy) <= 10) return;
        mode = 'pan';
      }
      if (mode === 'pan') {
        event.preventDefault();
        const step = officePanStep(anchor, finger, dpr);
        anchor = step.anchor;
        if (step.breakFollow) current.onManualPan?.();
        current.panRef.current!.x = step.pan.x;
        current.panRef.current!.y = step.pan.y;
        current.clampPan();
      }
    };
    const onEnd = (event: TouchEvent) => {
      if (event.touches.length === 1 && mode === 'pinch') {
        mode = 'pan';
        anchor = { point: point(event.touches[0]), pan: { ...touchOptions.current.panRef.current! }, panned: false };
        pinchLastMidpoint = null;
      } else if (!event.touches.length) reset();
    };
    const onCancel = () => reset();
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });
    canvas.addEventListener('touchcancel', onCancel);
    return () => {
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
      canvas.removeEventListener('touchcancel', onCancel);
    };
  }, [touchGestures]);

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
        onMouseLeave={() => {
          if (canvasRef.current) canvasRef.current.style.cursor = 'default';
          finishGesture();
        }}
        onContextMenu={(e) => {
          if (isEditMode && (editorState.tool === EditTool.CARPET_PAINT || editorState.tool === EditTool.AREA_PAINT)) e.preventDefault();
        }}
        onWheel={handleWheel}
        style={{ display: 'block', touchAction: touchGestures ? 'none' : undefined }}
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
