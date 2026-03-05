import { useEffect, useRef, useState, useCallback } from 'react';
import type { OfficeState } from '../engine/officeState.js';
import type { EditorState } from '../editor/editorState.js';
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
}

export function OfficeCanvas({
  officeState,
  onClick,
  isEditMode,
  editorState,
  onEditorTileAction,
  onEditorEraseAction,
  onEditorSelectionChange,
  onDeleteSelected,
  onRotateSelected,
  onDragMove,
  editorTick,
  zoom,
  onZoomChange,
  panRef,
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const panOriginRef = useRef<{ x: number; y: number } | null>(null);
  const spaceKeyRef = useRef(false);
  const draggedFurnitureRef = useRef<{ uid: string; offsetCol: number; offsetRow: number } | null>(null);

  const worldToScreen = useCallback(
    (col: number, row: number): { x: number; y: number } => {
      const worldX = col * TILE_SIZE;
      const worldY = row * TILE_SIZE;
      return {
        x: worldX * zoom + panRef.current!.x,
        y: worldY * zoom + panRef.current!.y,
      };
    },
    [zoom, panRef]
  );

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
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const resizeObserver = new ResizeObserver(() => {
      const newRect = container.getBoundingClientRect();
      canvas.width = newRect.width * dpr;
      canvas.height = newRect.height * dpr;
      canvas.style.width = `${newRect.width}px`;
      canvas.style.height = `${newRect.height}px`;
      clampPan();
    });
    resizeObserver.observe(container);

    const cleanup = startGameLoop(canvas, {
      onUpdate: (deltaTime: number) => {
        for (const char of officeState.characters.values()) {
          updateCharacter(char, deltaTime, officeState.tileMap, officeState.blockedTiles);
          if (char.bubbleTimer !== undefined) {
            char.bubbleTimer += deltaTime;
          }
        }
      },
      onRender: () => {
        renderFrame(
          ctx,
          officeState,
          isEditMode,
          editorState,
          zoom,
          panRef.current!.x,
          panRef.current!.y,
          canvas.width / dpr,
          canvas.height / dpr,
          dpr
        );
      },
    });

    return () => {
      cleanup();
      resizeObserver.disconnect();
    };
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
            const furnWidth = furn.type.width;
            const furnHeight = furn.type.height;
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
          if (tile) {
            editorState.setTileType(tile);
            editorState.setTool('tile');
          }
        } else {
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
