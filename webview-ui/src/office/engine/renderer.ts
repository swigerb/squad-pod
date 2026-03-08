import {
  Character,
  CharacterState,
  Direction,
  FurnitureInstance,
  Seat,
  SpriteData,
  TileType,
  TILE_SIZE,
  FloorColor
} from '../types.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  SELECTED_OUTLINE_ALPHA,
  HOVERED_OUTLINE_ALPHA,
  GHOST_PREVIEW_SPRITE_ALPHA,
  GHOST_PREVIEW_TINT_ALPHA,
  SELECTION_DASH_PATTERN,
  BUBBLE_VERTICAL_OFFSET_PX,
  BUBBLE_SITTING_OFFSET_PX,
  SEAT_OWN_COLOR,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  GRID_LINE_COLOR,
  VOID_TILE_OUTLINE_COLOR,
  VOID_TILE_DASH_PATTERN,
  GHOST_BORDER_VALID_COLOR,
  GHOST_BORDER_INVALID_COLOR,
  SELECTION_HIGHLIGHT_COLOR,
  DELETE_BUTTON_BG
} from '../../constants.js';
import { getCachedSprite, getOutlineSprite } from '../sprites/spriteCache.js';
import { getCharacterSprites, BUBBLE_PERMISSION_SPRITE, BUBBLE_WAITING_SPRITE } from '../sprites/defaultCharacters.js';
import { getColorizedFloorSprite } from '../floorTiles.js';
import { wallColorToHex } from '../wallTiles.js';
import { areAssetsReady, areCharacterAssetsReady, areTilesetAssetsReady, getAssetLoadSnapshot } from '../sprites/assetLoader.js';
import { drawTilesetFurniture, drawTilesetTile, drawMetadataItemScaled } from '../sprites/tilesetRenderer.js';
import { drawCharacterFromSheet, getCharacterSheetOffset, hasCharacterSheetForPalette } from '../sprites/characterSheetRenderer.js';

interface Drawable {
  sprite: SpriteData;
  x: number;
  y: number;
  z: number;
  type: 'furniture' | 'character';
  outlineSprite?: SpriteData;
  outlineAlpha?: number;
  /** Furniture type for PNG tileset lookup. */
  furnitureType?: string;
  /** Furniture footprint in pixels at current zoom (for tileset rendering). */
  furnitureDestW?: number;
  furnitureDestH?: number;
  /** Character reference for PNG sprite sheet rendering. */
  character?: Character;
}

// Track first-time diagnostic logging per render path (avoid 60fps spam)
let _loggedPngReady = false;
let _loggedPngFallback = false;
let _loggedTilesetWaiting = false;
let _loggedCharPng = false;
let _loggedCharFallback = false;
let _loggedCharWaiting = false;
let _loggedFirstRender = false;

export function renderTileGrid(
  ctx: CanvasRenderingContext2D,
  tileMap: number[][],
  offsetX: number,
  offsetY: number,
  zoom: number,
  tileColors: Map<string, FloorColor>,
  cols: number
): void {
  const rows = tileMap.length;
  const tilesetReady = areTilesetAssetsReady();

  if (!_loggedFirstRender) {
    _loggedFirstRender = true;
    console.log('[renderer] First tile render snapshot', getAssetLoadSnapshot());
  }

   if (tilesetReady && !_loggedPngReady) {
     _loggedPngReady = true;
     console.log('[renderer] ✅ Tileset PNG path ready — using metadata tiles', getAssetLoadSnapshot());
   } else if (!tilesetReady && !_loggedTilesetWaiting) {
     _loggedTilesetWaiting = true;
     console.log('[renderer] ⏳ Tileset PNG path not ready yet — using fallback tiles', getAssetLoadSnapshot());
   }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = tileMap[row][col];
      if (tile === TileType.VOID) continue;

      const x = offsetX + col * TILE_SIZE * zoom;
      const y = offsetY + row * TILE_SIZE * zoom;

      // Prefer tileset PNG tiles when loaded
      if (tilesetReady && drawTilesetTile(ctx, tile, x, y, zoom)) {
        continue;
      }

      // One-time diagnostic if PNG path is ready but drawTilesetTile returned false
      if (tilesetReady && !_loggedPngFallback) {
        _loggedPngFallback = true;
        console.warn('[renderer] ⚠️ Tileset PNG path is ready but drawTilesetTile returned false for tile type', tile, getAssetLoadSnapshot());
      }

      // Fall back to colored rendering
      if (tile === TileType.WALL) {
        const colorKey = `${col},${row}`;
        const color = tileColors.get(colorKey);
        if (color) {
          const hex = wallColorToHex(color);
          ctx.fillStyle = hex;
          ctx.fillRect(x, y, TILE_SIZE * zoom, TILE_SIZE * zoom);
        }
      } else {
        const colorKey = `${col},${row}`;
        const color = tileColors.get(colorKey);
        if (color) {
          const sprite = getColorizedFloorSprite(tile, color);
          if (sprite) {
            const canvas = getCachedSprite(sprite, zoom);
            ctx.drawImage(canvas, x, y);
          }
        }
      }
    }
  }
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  furniture: FurnitureInstance[],
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  selectedAgentId: string | null,
  hoveredAgentId: string | null
): void {
  const drawables: Drawable[] = [];
  const tilesetReady = areTilesetAssetsReady();
  const anyAssetsReady = areAssetsReady();
  const characterAssetsReady = areCharacterAssetsReady();

  for (const furn of furniture) {
    const sprite = furn.sprite;
    const x = offsetX + furn.col * TILE_SIZE * zoom;
    const y = offsetY + furn.row * TILE_SIZE * zoom;
    const bottomY = y + sprite.length * zoom;
    drawables.push({
      sprite, x, y, z: bottomY, type: 'furniture',
      furnitureType: furn.type,
      furnitureDestW: sprite[0].length * zoom,
      furnitureDestH: sprite.length * zoom,
    });
  }

  for (const ch of characters) {
    const sprites = getCharacterSprites(ch.palette, ch.hueShift);
    const sprite = getCharacterSprite(ch, sprites);

    let baseX = ch.col * TILE_SIZE;
    let baseY = ch.row * TILE_SIZE;

    if (ch.state === CharacterState.WALK && ch.path.length > 0) {
      const next = ch.path[0];
      const fromX = ch.col * TILE_SIZE;
      const fromY = ch.row * TILE_SIZE;
      const toX = next.col * TILE_SIZE;
      const toY = next.row * TILE_SIZE;
      baseX = fromX + (toX - fromX) * ch.moveProgress;
      baseY = fromY + (toY - fromY) * ch.moveProgress;
    }

    // Determine sprite dimensions — prefer PNG sheet size when available
    let spriteWidth: number;
    let spriteHeight: number;
    let drawX: number;
    let drawY: number;

    const sheetOffset = hasCharacterSheetForPalette(ch.palette) ? getCharacterSheetOffset(ch.palette) : null;
    if (sheetOffset) {
      spriteWidth = TILE_SIZE - sheetOffset.dx * 2; // symmetric around tile center
      spriteHeight = TILE_SIZE - sheetOffset.dy;
      drawX = offsetX + (baseX + sheetOffset.dx) * zoom;
      drawY = offsetY + (baseY + sheetOffset.dy) * zoom;
    } else {
      spriteWidth = sprite[0].length;
      spriteHeight = sprite.length;
      drawX = offsetX + (baseX + TILE_SIZE / 2 - spriteWidth / 2) * zoom;
      drawY = offsetY + (baseY + TILE_SIZE - spriteHeight) * zoom;
    }

    if (ch.state === CharacterState.TYPE) {
      drawY += CHARACTER_SITTING_OFFSET_PX * zoom;
    }

    const bottomY = drawY + spriteHeight * zoom;
    const z = bottomY + CHARACTER_Z_SORT_OFFSET;

    const outlineSprite = getOutlineSprite(sprite);
    let outlineAlpha = 0;
    if (ch.id === selectedAgentId) {
      outlineAlpha = SELECTED_OUTLINE_ALPHA;
    } else if (ch.id === hoveredAgentId) {
      outlineAlpha = HOVERED_OUTLINE_ALPHA;
    }

    drawables.push({
      sprite, x: drawX, y: drawY, z, type: 'character',
      outlineSprite, outlineAlpha,
      character: ch,
    });
  }

  drawables.sort((a, b) => a.z - b.z);

  for (const drawable of drawables) {
    if (drawable.outlineSprite && drawable.outlineAlpha && drawable.outlineAlpha > 0) {
      const outlineCanvas = getCachedSprite(drawable.outlineSprite, zoom);
      const outlineX = drawable.x - zoom;
      const outlineY = drawable.y - zoom;
      ctx.save();
      ctx.globalAlpha = drawable.outlineAlpha;
      ctx.drawImage(outlineCanvas, outlineX, outlineY);
      ctx.restore();
    }

    if (drawable.type === 'character') {
      const ch = drawable.character;
      // Try PNG sprite sheet first, fall back to inline
      const pngDrawn = Boolean(ch) && drawCharacterFromSheet(
        ctx, ch.palette, ch.direction, ch.frameIndex,
        drawable.x, drawable.y, zoom,
      );
      if (pngDrawn && !_loggedCharPng) {
        _loggedCharPng = true;
        console.error('[SPRITE-DEBUG] ✅ Character drawn from PNG sprite sheet (palette', ch?.palette, ')', getAssetLoadSnapshot());
      }
      if (!pngDrawn) {
        if (!characterAssetsReady && !_loggedCharWaiting) {
          _loggedCharWaiting = true;
          console.error('[SPRITE-DEBUG] ⏳ Character PNG sheets not ready — using inline sprites. characterAssetsReady=false', getAssetLoadSnapshot());
        } else if (characterAssetsReady && !_loggedCharFallback) {
          _loggedCharFallback = true;
          console.error('[SPRITE-DEBUG] ⚠️ Character PNG draw FAILED for palette', ch?.palette, '— using inline sprite. hasSheet:', ch ? hasCharacterSheetForPalette(ch.palette) : 'N/A', getAssetLoadSnapshot());
        }
        drawSpriteDirect(ctx, drawable.sprite, drawable.x, drawable.y, zoom);
      }
    } else {
      // Try PNG tileset first, fall back to inline cached sprite
      const tilesetDrawn = Boolean(tilesetReady && drawable.furnitureType) && drawTilesetFurniture(
        ctx, drawable.furnitureType,
        drawable.x, drawable.y,
        drawable.furnitureDestW!, drawable.furnitureDestH!,
      );
      if (!tilesetDrawn) {
        // Try tileset metadata rendering (for items placed from metadata catalog)
        const metadataDrawn = Boolean(tilesetReady && drawable.furnitureType) && drawMetadataItemScaled(
          ctx, drawable.furnitureType,
          drawable.x, drawable.y,
          drawable.furnitureDestW!, drawable.furnitureDestH!,
        );
        if (!metadataDrawn) {
          const canvas = getCachedSprite(drawable.sprite, zoom);
          ctx.drawImage(canvas, drawable.x, drawable.y);
        }
      }
    }
  }
}

/**
 * Draw a sprite directly onto `ctx` pixel-by-pixel.
 * This avoids the offscreen-canvas indirection of getCachedSprite,
 * guaranteeing visible output if the sprite data has colors.
 */
function drawSpriteDirect(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteData,
  x: number,
  y: number,
  zoom: number
): void {
  const height = sprite.length;
  const width = sprite[0]?.length ?? 0;
  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const color = sprite[sy][sx];
      if (color && color !== '') {
        ctx.fillStyle = color;
        ctx.fillRect(x + sx * zoom, y + sy * zoom, zoom, zoom);
      }
    }
  }
}

function getCharacterSprite(
  ch: Character,
  sprites: { walk: Record<Direction, SpriteData[]>; typing: Record<Direction, SpriteData[]>; reading: Record<Direction, SpriteData[]> }
): SpriteData {
  if (ch.state === CharacterState.TYPE) {
    const frames = sprites.typing[ch.direction] || sprites.typing[Direction.DOWN];
    return frames[ch.frameIndex % frames.length];
  } else if (ch.state === CharacterState.WALK) {
    const frames = sprites.walk[ch.direction] || sprites.walk[Direction.DOWN];
    return frames[ch.frameIndex % frames.length];
  } else {
    const frames = sprites.walk[ch.direction] || sprites.walk[Direction.DOWN];
    return frames[0];
  }
}

export function renderSeatIndicators(
  ctx: CanvasRenderingContext2D,
  seats: Seat[],
  characters: Character[],
  selectedAgentId: string | null,
  _hoveredTile: { col: number; row: number } | null,
  offsetX: number,
  offsetY: number,
  zoom: number
): void {
  for (const seat of seats) {
    const ch = characters.find(c => c.seatId === seat.id);
    let color = SEAT_AVAILABLE_COLOR;
    if (ch) {
      color = ch.id === selectedAgentId ? SEAT_OWN_COLOR : SEAT_BUSY_COLOR;
    }

    const x = offsetX + seat.col * TILE_SIZE * zoom;
    const y = offsetY + seat.row * TILE_SIZE * zoom;

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(x, y, TILE_SIZE * zoom, TILE_SIZE * zoom);
    ctx.globalAlpha = 1.0;
  }
}

export function renderGridOverlay(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  rows: number,
  tileMap: number[][]
): void {
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1;

  for (let col = 0; col <= cols; col++) {
    const x = Math.floor(offsetX + col * TILE_SIZE * zoom) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, offsetY);
    ctx.lineTo(x, offsetY + rows * TILE_SIZE * zoom);
    ctx.stroke();
  }

  for (let row = 0; row <= rows; row++) {
    const y = Math.floor(offsetY + row * TILE_SIZE * zoom) + 0.5;
    ctx.beginPath();
    ctx.moveTo(offsetX, y);
    ctx.lineTo(offsetX + cols * TILE_SIZE * zoom, y);
    ctx.stroke();
  }

  ctx.strokeStyle = VOID_TILE_OUTLINE_COLOR;
  ctx.setLineDash(VOID_TILE_DASH_PATTERN);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (tileMap[row][col] === TileType.VOID) {
        const x = offsetX + col * TILE_SIZE * zoom;
        const y = offsetY + row * TILE_SIZE * zoom;
        ctx.strokeRect(x, y, TILE_SIZE * zoom, TILE_SIZE * zoom);
      }
    }
  }
  ctx.setLineDash([]);
}

export function renderGhostBorder(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  rows: number,
  ghostHoverCol: number | null,
  ghostHoverRow: number | null
): void {
  const borderTiles: Array<{ col: number; row: number; color: string }> = [];

  for (let col = -1; col <= cols; col++) {
    borderTiles.push({ col, row: -1, color: GHOST_BORDER_VALID_COLOR });
    borderTiles.push({ col, row: rows, color: GHOST_BORDER_VALID_COLOR });
  }
  for (let row = 0; row < rows; row++) {
    borderTiles.push({ col: -1, row, color: GHOST_BORDER_VALID_COLOR });
    borderTiles.push({ col: cols, row, color: GHOST_BORDER_VALID_COLOR });
  }

  for (const tile of borderTiles) {
    const x = offsetX + tile.col * TILE_SIZE * zoom;
    const y = offsetY + tile.row * TILE_SIZE * zoom;
    const isHovered = ghostHoverCol === tile.col && ghostHoverRow === tile.row;
    ctx.fillStyle = isHovered ? GHOST_BORDER_INVALID_COLOR : tile.color;
    ctx.globalAlpha = isHovered ? 0.3 : 0.1;
    ctx.fillRect(x, y, TILE_SIZE * zoom, TILE_SIZE * zoom);
    ctx.globalAlpha = 1.0;
  }
}

export function renderGhostPreview(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteData,
  col: number,
  row: number,
  valid: boolean,
  offsetX: number,
  offsetY: number,
  zoom: number
): void {
  const x = offsetX + col * TILE_SIZE * zoom;
  const y = offsetY + row * TILE_SIZE * zoom;

  ctx.globalAlpha = GHOST_PREVIEW_SPRITE_ALPHA;
  const canvas = getCachedSprite(sprite, zoom);
  ctx.drawImage(canvas, x, y);
  ctx.globalAlpha = 1.0;

  const tintColor = valid ? GHOST_BORDER_VALID_COLOR : GHOST_BORDER_INVALID_COLOR;
  ctx.fillStyle = tintColor;
  ctx.globalAlpha = GHOST_PREVIEW_TINT_ALPHA;
  const w = sprite[0].length * zoom;
  const h = sprite.length * zoom;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1.0;
}

export function renderSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  h: number,
  offsetX: number,
  offsetY: number,
  zoom: number
): void {
  const x = offsetX + col * TILE_SIZE * zoom;
  const y = offsetY + row * TILE_SIZE * zoom;
  const width = w * TILE_SIZE * zoom;
  const height = h * TILE_SIZE * zoom;

  ctx.strokeStyle = SELECTION_HIGHLIGHT_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash(SELECTION_DASH_PATTERN);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
}

export function renderDeleteButton(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  _h: number,
  offsetX: number,
  offsetY: number,
  zoom: number
): void {
  const x = offsetX + (col + w) * TILE_SIZE * zoom - 12 * zoom;
  const y = offsetY + row * TILE_SIZE * zoom;
  const size = 12 * zoom;

  ctx.fillStyle = DELETE_BUTTON_BG;
  ctx.fillRect(x, y, size, size);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  const pad = 3 * zoom;
  ctx.beginPath();
  ctx.moveTo(x + pad, y + pad);
  ctx.lineTo(x + size - pad, y + size - pad);
  ctx.moveTo(x + size - pad, y + pad);
  ctx.lineTo(x + pad, y + size - pad);
  ctx.stroke();
}

export function renderBubbles(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number
): void {
  for (const ch of characters) {
    if (ch.bubbleState.type === 'none') continue;

    let sprite: SpriteData | null = null;
    if (ch.bubbleState.type === 'permission') {
      sprite = BUBBLE_PERMISSION_SPRITE;
    } else if (ch.bubbleState.type === 'waiting') {
      sprite = BUBBLE_WAITING_SPRITE;
    }

    if (!sprite) continue;

    let baseX = ch.col * TILE_SIZE + TILE_SIZE / 2;
    let baseY = ch.row * TILE_SIZE;

    if (ch.state === CharacterState.WALK && ch.path.length > 0) {
      const next = ch.path[0];
      const fromX = ch.col * TILE_SIZE + TILE_SIZE / 2;
      const fromY = ch.row * TILE_SIZE;
      const toX = next.col * TILE_SIZE + TILE_SIZE / 2;
      const toY = next.row * TILE_SIZE;
      baseX = fromX + (toX - fromX) * ch.moveProgress;
      baseY = fromY + (toY - fromY) * ch.moveProgress;
    }

    let yOffset = BUBBLE_VERTICAL_OFFSET_PX;
    if (ch.state === CharacterState.TYPE) {
      yOffset = BUBBLE_SITTING_OFFSET_PX;
    }

    const x = offsetX + (baseX - sprite[0].length / 2) * zoom;
    const y = offsetY + (baseY - yOffset) * zoom;

    const alpha = ch.bubbleState.fadeTimer !== undefined
      ? Math.max(0, ch.bubbleState.fadeTimer)
      : 1.0;

    ctx.globalAlpha = alpha;
    const canvas = getCachedSprite(sprite, zoom);
    ctx.drawImage(canvas, x, y);
    ctx.globalAlpha = 1.0;
  }
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  tileMap: number[][],
  furniture: FurnitureInstance[],
  characters: Character[],
  zoom: number,
  panX: number,
  panY: number,
  selection?: { uid: string; col: number; row: number; w: number; h: number } | null,
  editor?: {
    showGrid: boolean;
    showGhostBorder: boolean;
    ghostHoverCol: number | null;
    ghostHoverRow: number | null;
    ghostPreview?: { sprite: SpriteData; col: number; row: number; valid: boolean };
  },
  tileColors?: Map<string, FloorColor>,
  layoutCols?: number,
  layoutRows?: number,
  selectedAgentId?: string | null,
  hoveredAgentId?: string | null,
  hoveredTile?: { col: number; row: number } | null,
  seats?: Seat[]
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const cols = layoutCols ?? tileMap[0]?.length ?? 0;
  const rows = layoutRows ?? tileMap.length ?? 0;

  // panX/panY are screen-space offsets — same coordinate system as AgentLabels.
  const offsetX = panX;
  const offsetY = panY;

  if (tileColors) {
    renderTileGrid(ctx, tileMap, offsetX, offsetY, zoom, tileColors, cols);
  }

  if (seats) {
    renderSeatIndicators(ctx, seats, characters, selectedAgentId ?? null, hoveredTile ?? null, offsetX, offsetY, zoom);
  }

  renderScene(ctx, furniture, characters, offsetX, offsetY, zoom, selectedAgentId ?? null, hoveredAgentId ?? null);

  if (editor?.showGrid) {
    renderGridOverlay(ctx, offsetX, offsetY, zoom, cols, rows, tileMap);
  }

  if (editor?.showGhostBorder) {
    renderGhostBorder(ctx, offsetX, offsetY, zoom, cols, rows, editor.ghostHoverCol, editor.ghostHoverRow);
  }

  if (editor?.ghostPreview) {
    const gp = editor.ghostPreview;
    renderGhostPreview(ctx, gp.sprite, gp.col, gp.row, gp.valid, offsetX, offsetY, zoom);
  }

  if (selection) {
    renderSelectionHighlight(ctx, selection.col, selection.row, selection.w, selection.h, offsetX, offsetY, zoom);
    renderDeleteButton(ctx, selection.col, selection.row, selection.w, selection.h, offsetX, offsetY, zoom);
  }

  renderBubbles(ctx, characters, offsetX, offsetY, zoom);

  // Visible asset diagnostic — renders on canvas so Brian can see without DevTools
  // Reset transform to identity to draw in raw pixel space (independent of DPR/zoom)
  const snapshot = getAssetLoadSnapshot();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dpr = window.devicePixelRatio || 1;
  ctx.font = `${Math.round(11 * dpr)}px monospace`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, Math.round(500 * dpr), Math.round(32 * dpr));
  ctx.fillStyle = snapshot.characterReady ? '#0f0' : '#f44';
  ctx.fillText(
    `chars:${snapshot.characterSheetsLoaded.join(',')||'NONE'} tileset:${snapshot.tilesetReady?'OK':'NO'} meta:${snapshot.tilesetMetadataStatus} v:diag`,
    Math.round(4 * dpr), Math.round(4 * dpr)
  );
  ctx.fillStyle = '#ff0';
  ctx.fillText(
    `expected:[${snapshot.characterSheetsExpected}] failed:[${snapshot.characterSheetsFailed}]`,
    Math.round(4 * dpr), Math.round(16 * dpr)
  );
  ctx.restore();
}
