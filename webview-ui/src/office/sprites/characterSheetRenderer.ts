/**
 * Character Sheet Renderer
 *
 * Renders animated characters from 4-row PNG sprite sheets
 * (employeeA–D).  Each sheet has the layout:
 *
 *   Row 0 — Walk Up   (away from camera)
 *   Row 1 — Walk Right (profile)
 *   Row 2 — Walk Down  (toward camera)
 *   Row 3 — Walk Left  (profile)
 *
 * Each row contains multiple animation frames laid out side-by-side.
 * Background is pre-removed during asset loading (see assetLoader.ts).
 */

import { getCharacterSheet } from './assetLoader.js';
import { Direction, TILE_SIZE } from '../types.js';

/** Map game Direction enum to sprite-sheet row index. */
const DIRECTION_TO_ROW: Record<Direction, number> = {
  [Direction.UP]: 0,
  [Direction.RIGHT]: 1,
  [Direction.DOWN]: 2,
  [Direction.LEFT]: 3,
};

/** Map palette index (0-1) to character sheet key (A-B). */
const PALETTE_TO_SHEET: string[] = ['A', 'B'];
const _loggedCharacterSheetIssues = new Set<string>();

function logCharacterSheetIssueOnce(key: string, ...args: unknown[]): void {
  if (_loggedCharacterSheetIssues.has(key)) return;
  _loggedCharacterSheetIssues.add(key);
  console.warn(...args);
}

function getSheetKeyForPalette(palette: number): string {
  return PALETTE_TO_SHEET[palette % PALETTE_TO_SHEET.length];
}

export function hasCharacterSheetForPalette(palette: number): boolean {
  const key = getSheetKeyForPalette(palette);
  const sheet = getCharacterSheet(key);
  return sheet !== null;
}

/**
 * Try to draw a character frame from a PNG sprite sheet.
 *
 * @returns `true` if the frame was drawn, `false` if the caller
 *          should fall back to inline sprite rendering.
 */
export function drawCharacterFromSheet(
  ctx: CanvasRenderingContext2D,
  palette: number,
  direction: Direction,
  frameIndex: number,
  destX: number,
  destY: number,
  zoom: number,
): boolean {
  const sheetKey = getSheetKeyForPalette(palette);
  const sheet = getCharacterSheet(sheetKey);
  if (!sheet) {
    logCharacterSheetIssueOnce(
      `missing-sheet:${sheetKey}`,
      '[SPRITE-DEBUG] drawCharacterFromSheet: NO sheet for palette',
      palette,
      '→ key',
      sheetKey,
      '(getCharacterSheet returned null)',
    );
    return false;
  }

  const row = DIRECTION_TO_ROW[direction] ?? DIRECTION_TO_ROW[Direction.DOWN];
  const col = frameIndex % sheet.framesPerRow;

  const srcX = col * sheet.frameWidth;
  const srcY = row * sheet.frameHeight;

  // Render at the base game resolution × zoom.
  // The sprite sheets are upscaled (e.g. 20×), so we scale back down
  // to the game's native pixel grid for crisp integer-scaled output.
  const destW = sheet.baseWidth * zoom;
  const destH = sheet.baseHeight * zoom;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sheet.image,
    srcX, srcY, sheet.frameWidth, sheet.frameHeight,
    destX, destY, destW, destH,
  );

  return true;
}

/**
 * Get the base-pixel dimensions of a character frame for positioning
 * calculations.  Returns null if the sheet isn't loaded.
 */
export function getCharacterSheetFrameSize(
  palette: number,
): { width: number; height: number } | null {
  const sheetKey = getSheetKeyForPalette(palette);
  const sheet = getCharacterSheet(sheetKey);
  if (!sheet) return null;
  return { width: sheet.baseWidth, height: sheet.baseHeight };
}

/**
 * Get the base-pixel positioning offsets for a character frame so it
 * aligns correctly with the tile grid (horizontally centred, feet at
 * tile bottom).
 */
export function getCharacterSheetOffset(
  palette: number,
): { dx: number; dy: number } | null {
  const size = getCharacterSheetFrameSize(palette);
  if (!size) return null;
  return {
    dx: TILE_SIZE / 2 - size.width / 2,
    dy: TILE_SIZE - size.height,
  };
}
