import { useEffect, useRef, useState, useCallback } from 'react';
import type { OfficeState } from '../engine/officeState.js';
import type { EditorState } from '../editor/editorState.js';
import { EditTool, TileType } from '../types.js';
import { startGameLoop } from '../engine/gameLoop.js';
import { renderFrame } from '../engine/renderer.js';
import { updateCharacter } from '../engine/characters.js';
import { TILE_SIZE, CHARACTER_HIT_HALF_WIDTH, CHARACTER_HIT_HEIGHT, PAN_MARGIN_FRACTION, ZOOM_SCROLL_THRESHOLD } from '../../constants.js';

interface OfficeCanvasProps {
  officeState: OfficeState;
  onClick?: (col: number, row: number) => void;
  isEditMode: boolean;
  editorState: EditorState;
  onEditorTileAction?: (col: number, row: number) => void;
  onEditorEraseAction?: (col: number, row: number) => void;
  onEditorSelectionChange?: (uid: string | null) => void;
  onDeleteSelected?: () => void;
  onRotateSelected?: () => void;
  onDragMove?: (uid: string, newCol: number, newRow: number) => void;
  editorTick: number;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  panRef: React.RefObject<{ x: number; y: number }>;
  onDeskClick?: (agentId: string, screenX: number, screenY: number) => void;
}

export function OfficeCanvas({
  officeState,
  onClick,
  isEditMode,
  editorState,
  onEditorTileAction,
  onEditorEraseAction,
  onEditorSelectionChange,
  onDragMove,
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
    const mapWidth = officeState.layout.cols * TILE_SIZE * zoom;
    const mapHeight = officeState.layout.rows * TILE_SIZE * zoom;
    const minVisibleWidth = mapWidth * PAN_MARGIN_FRACTION;
    const minVisibleHeight = mapHeight * PAN_MARGIN_FRACTION;

    panRef.current!.x = Math.max(panRef.current!.x, rect.width - mapWidth - minVisibleWidth);
    panRef.current!.x = Math.min(panRef.current!.x, minVisibleWidth);
    panRef.current!.y = Math.max(panRef.current!.y, rect.height - mapHeight - minVisibleHeight);
    panRef.current!.y = Math.min(panRef.current!.y, minVisibleHeight);
  }, [officeState.layout.cols, officeState.layout.rows, zoom, panRef]);

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
          isEditMode ? { showGrid: true, showGhostBorder: false, ghostHoverCol: null, ghostHoverRow: null } : undefined,
          tileColorsMap,
          officeState.layout.cols,
          officeState.layout.rows,
          officeState.selectedAgentId,
          officeState.hoveredAgentId,
          officeState.hoveredTile,
          officeState.seats
        );

        // DIAGNOSTIC: Draw bright markers at character positions
        // This bypasses all sprite/drawable logic — purely position-based
        if (chars.length > 0) {
          const px = panRef.current!.x;
          const py = panRef.current!.y;
          for (const c of chars) {
            // Characters use col/row for tile position
            const sx = px + c.col * 16 * zoom;
            const sy = py + c.row * 16 * zoom;
            // Large bright magenta circle
            ctx.save();
            ctx.fillStyle = '#FF00FF';
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.arc(sx + 8 * zoom, sy + 8 * zoom, 6 * zoom, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
        // Also draw a green indicator showing character count + debug info
        ctx.save();
        ctx.fillStyle = chars.length > 0 ? '#00FF00' : '#FF0000';
        ctx.font = '14px monospace';
        ctx.fillText(`chars: ${chars.length}  zoom: ${zoom}  dpr: ${dpr}  furn: ${officeState.furniture.length}  seats: ${officeState.seats.length}`, 10, 20);
        if (chars.length > 0) {
          const c0 = chars[0];
          ctx.fillText(`[0] id=${c0.id} col=${c0.col} row=${c0.row} pal=${c0.palette}`, 10, 36);
        }
        ctx.restore();
      },
    });

    return () => { cleanup(); };
  }, [officeState, isEditMode, editorState, zoom, panRef, clampPan]);

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
        if (editorState.tool === 'select') {
          let selectedUid: string | null = null;
          for (const furn of officeState.furniture) {
            const furnWidth = furn.width;
            const furnHeight = furn.height;
            if (col >= furn.col && col < furn.col + furnWidth && row >= furn.row && row < furn.row + furnHeight) {
              selectedUid = furn.uid;
              draggedFurnitureRef.current = { uid: furn.uid, offsetCol: col - furn.col, offsetRow: row - furn.row };
              break;
            }
          }
          onEditorSelectionChange?.(selectedUid);
        } else if (editorState.tool === 'erase') {
          onEditorEraseAction?.(col, row);
        } else if (editorState.tool === 'eyedropper') {
          const tile = officeState.tileMap[row]?.[col];
          if (tile !== undefined) {
            editorState.setTileType(tile as TileType);
            editorState.setTool(EditTool.TILE_PAINT);
          }
        } else {
          onEditorTileAction?.(col, row);
        }
      } else {
        console.log(`[click] screen=(${screenX.toFixed(0)},${screenY.toFixed(0)}) tile=(${col},${row}) chars=${officeState.characters.size} seats=${officeState.seats.length}`);
        let clickedAgentId: string | null = null;
        for (const [id, char] of officeState.characters) {
          const charScreenX = char.x * zoom + panRef.current!.x;
          const charScreenY = char.y * zoom + panRef.current!.y;
          const hitLeft = charScreenX - CHARACTER_HIT_HALF_WIDTH * zoom;
          const hitRight = charScreenX + CHARACTER_HIT_HALF_WIDTH * zoom;
          const hitTop = charScreenY - CHARACTER_HIT_HEIGHT * zoom;
          const hitBottom = charScreenY;
          console.log(`[click] char "${char.name}" hitBox: [${hitLeft.toFixed(0)},${hitTop.toFixed(0)}]-[${hitRight.toFixed(0)},${hitBottom.toFixed(0)}] charPos=(${char.x},${char.y}) col=${char.col} row=${char.row}`);
          if (screenX >= hitLeft && screenX <= hitRight && screenY >= hitTop && screenY <= hitBottom) {
            clickedAgentId = id;
            console.log(`[click] HIT character: ${id}`);
            break;
          }
        }
        
        // If character was clicked directly, also trigger card (not just desk clicks)
        if (clickedAgentId) {
          onDeskClick?.(clickedAgentId, e.clientX, e.clientY);
        }
        
        // If no character sprite was clicked, check for desk/seat clicks
        if (!clickedAgentId) {
          let seatId = officeState.getSeatAtTile(col, row);
          console.log(`[click] getSeatAtTile(${col},${row}) => ${seatId}`);
          
          // If no seat at exact tile, check adjacent tiles
          if (!seatId) {
            const adjacentOffsets = [
              [-1, 0], [1, 0], [0, -1], [0, 1],
              [-1, -1], [1, -1], [-1, 1], [1, 1],
            ];
            for (const [dc, dr] of adjacentOffsets) {
              seatId = officeState.getSeatAtTile(col + dc, row + dr);
              if (seatId) {
                console.log(`[click] found seat at adjacent (${col + dc},${row + dr}): ${seatId}`);
                break;
              }
            }
          }
          
          // If a seat was found, check if it's occupied
          if (seatId) {
            const seat = officeState.seats.find(s => s.id === seatId);
            console.log(`[click] seat occupant: ${seat?.occupant}`);
            if (seat?.occupant) {
              clickedAgentId = seat.occupant;
              onDeskClick?.(seat.occupant, e.clientX, e.clientY);
            }
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
        onDragMove?.(draggedFurnitureRef.current.uid, newCol, newRow);
        return;
      }

      const rect = canvasRef.current!.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { col, row } = screenToWorld(screenX, screenY);
      officeState.hoveredTile = { col, row };

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
    [isPanning, isEditMode, editorState.tool, screenToWorld, officeState, zoom, panRef, clampPan, onDragMove]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
    panOriginRef.current = null;
    draggedFurnitureRef.current = null;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const newZoom = Math.max(1, Math.min(10, Math.floor(zoom + delta)));
        if (newZoom !== zoom) {
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        spaceKeyRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
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
  }, []);

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
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{ display: 'block' }}
      />
    </div>
  );
}
