/**
 * Character Sheet Renderer
 *
 * Renders the six built-in Pixel Agents pose atlases and legacy 4-row
 * external walk sheets. Built-in sheets use this layout:
 *
 *   Row 0 — Down, Row 1 — Up, Row 2 — Right (Left is flipped Right)
 *   Cols 0–2 — walk, 3–4 — typing, 5–6 — reading
 *
 * Legacy external sheets remain 7 frames × 4 direction rows at 32×32 per cell.
 */

import { getCharacterSheet } from './assetLoader.js';
import type { CharacterSheetData } from './assetLoader.js';
import { Direction, TILE_SIZE } from '../types.js';
import { EXTERNAL_CHARACTER_BASE, PALETTE_COUNT } from '../engine/agentSync.js';

export type CharacterAnimation = 'idle' | 'walk' | 'typing' | 'reading';

const LEGACY_DIRECTION_TO_ROW: Record<Direction, number> = {
  [Direction.UP]: 0,
  [Direction.RIGHT]: 1,
  [Direction.DOWN]: 2,
  [Direction.LEFT]: 3,
};

const BUILTIN_DIRECTION_TO_ROW: Record<Direction, number> = {
  [Direction.DOWN]: 0,
  [Direction.UP]: 1,
  [Direction.RIGHT]: 2,
  [Direction.LEFT]: 2,
};
const _loggedCharacterSheetIssues = new Set<string>();

function logCharacterSheetIssueOnce(key: string, ...args: unknown[]): void {
  if (_loggedCharacterSheetIssues.has(key)) return;
  _loggedCharacterSheetIssues.add(key);
  console.warn(...args);
}

/**
 * Resolve a stable built-in sheet for each persisted palette. Higher palette
 * cycles keep the existing hue-shift behavior; external IDs retain their own
 * sheet key and legacy frame contract.
 */
export function sheetAppearance(palette: number, hueShift = 0): { sheetKey: string; hueDegrees: number } {
  let p = Math.max(0, Math.floor(palette) || 0);
  if (Number.isSafeInteger(p) && p >= EXTERNAL_CHARACTER_BASE) {
    const key = `external:${p - p % 48}`;
    if (getCharacterSheet(key)) { return { sheetKey: key, hueDegrees: (p % 48 * 45) % 360 }; }
    hueShift = (Math.floor(p / PALETTE_COUNT) * 45) % 360;
    p %= PALETTE_COUNT;
  }
  const variant = Math.floor(p / PALETTE_COUNT);
  return {
    sheetKey: `builtin:${p % PALETTE_COUNT}`,
    hueDegrees: (((variant * 45 + hueShift) % 360) + 360) % 360,
  };
}

function getSheetForPalette(palette: number): CharacterSheetData | null {
  return getCharacterSheet(sheetAppearance(palette).sheetKey);
}

export function hasCharacterSheetForPalette(palette: number): boolean {
  return getSheetForPalette(palette) !== null;
}

export function getCharacterSheetLayout(palette: number): CharacterSheetData['layout'] | null {
  return getSheetForPalette(palette)?.layout ?? null;
}

function frameSource(
  sheet: CharacterSheetData,
  direction: Direction,
  animation: CharacterAnimation,
  frameIndex: number,
): { row: number; col: number; flip: boolean } | null {
  if (sheet.layout === 'pixel-agents') {
    const row = BUILTIN_DIRECTION_TO_ROW[direction] ?? BUILTIN_DIRECTION_TO_ROW[Direction.DOWN];
    if (animation === 'reading') return { row, col: 5 + frameIndex % 2, flip: direction === Direction.LEFT };
    if (animation === 'typing') return { row, col: 3 + frameIndex % 2, flip: direction === Direction.LEFT };
    if (animation === 'walk') {
      const walkFrames = [0, 1, 2, 1];
      return { row, col: walkFrames[frameIndex % walkFrames.length], flip: direction === Direction.LEFT };
    }
    return { row, col: 0, flip: direction === Direction.LEFT };
  }

  if (animation === 'reading') return null;
  const row = LEGACY_DIRECTION_TO_ROW[direction] ?? LEGACY_DIRECTION_TO_ROW[Direction.DOWN];
  return { row, col: frameIndex % sheet.framesPerRow, flip: false };
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
  hueShift = 0,
  animation: CharacterAnimation = 'walk',
  outlineAlpha = 0,
): boolean {
  const { sheetKey, hueDegrees } = sheetAppearance(palette, hueShift);
  const sheet = getCharacterSheet(sheetKey);
  if (!sheet) {
    logCharacterSheetIssueOnce(
      `missing-sheet:${sheetKey}`,
      '[characterSheetRenderer] No sheet for palette',
      palette,
      '→ key',
      sheetKey,
    );
    return false;
  }

  const frame = frameSource(sheet, direction, animation, frameIndex);
  if (!frame) return false;

  const srcX = frame.col * sheet.frameWidth;
  const srcY = frame.row * sheet.frameHeight;

  const destW = sheet.baseWidth * zoom;
  const destH = sheet.baseHeight * zoom;
  const drawFrame = (x: number, y: number): void => {
    if (frame.flip) {
      ctx.save();
      ctx.translate(x + destW, y);
      ctx.scale(-1, 1);
      ctx.drawImage(sheet.image, srcX, srcY, sheet.frameWidth, sheet.frameHeight, 0, 0, destW, destH);
      ctx.restore();
    } else {
      ctx.drawImage(sheet.image, srcX, srcY, sheet.frameWidth, sheet.frameHeight, x, y, destW, destH);
    }
  };

  ctx.imageSmoothingEnabled = false;
  if (outlineAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = outlineAlpha;
    ctx.filter = 'brightness(0) invert(1)';
    drawFrame(destX - zoom, destY);
    drawFrame(destX + zoom, destY);
    drawFrame(destX, destY - zoom);
    drawFrame(destX, destY + zoom);
    ctx.restore();
  }
  if (hueDegrees !== 0) {
    ctx.save();
    ctx.filter = `hue-rotate(${hueDegrees}deg)`;
  }
  drawFrame(destX, destY);
  if (hueDegrees !== 0) {
    ctx.restore();
  }

  return true;
}

/**
 * Get the base-pixel dimensions of a character frame for positioning
 * calculations.  Returns null if the sheet isn't loaded.
 */
export function getCharacterSheetFrameSize(
  palette: number,
  animation?: CharacterAnimation,
): { width: number; height: number } | null {
  const sheet = getSheetForPalette(palette);
  if (!sheet) return null;
  if (animation === 'reading' && sheet.layout !== 'pixel-agents') return null;
  return { width: sheet.baseWidth, height: sheet.baseHeight };
}

/** Position offset from the tile-center anchor; built-ins match Pixel Agents' foot anchor. */
export function getCharacterSheetAnchorOffset(
  palette: number,
  animation?: CharacterAnimation,
): { dx: number; dy: number } | null {
  const size = getCharacterSheetFrameSize(palette, animation);
  if (!size) return null;
  const layout = getCharacterSheetLayout(palette);
  return {
    dx: -size.width / 2,
    dy: layout === 'pixel-agents' ? -size.height : TILE_SIZE / 2 - size.height,
  };
}

/**
 * Get the legacy tile-origin offsets for consumers that anchor at tile top-left.
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
