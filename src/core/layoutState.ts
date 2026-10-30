import { defaultFurniture } from '../defaultFurniture.js';
import type { LayoutData } from '../types.js';

/**
 * Ensure a layout has tileColors populated. Layouts from older versions,
 * external tools, or the layout editor may omit tileColors entirely.
 */
export function ensureTileColors(layout: LayoutData): void {
  if (layout.tileColors && Object.keys(layout.tileColors).length > 0) { return; }

  const floorColor = { h: 35, s: 40, b: 15, c: 0 };
  const wallColor = { h: 20, s: 30, b: -25, c: 0 };
  const colors: Record<string, { h: number; s: number; b: number; c: number }> = {};

  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      const index = r * layout.cols + c;
      const tile = layout.tiles[index];
      colors[`${c},${r}`] = tile === 0 ? { ...wallColor } : { ...floorColor };
    }
  }

  layout.tileColors = colors;
}

/**
 * Create a minimal empty layout when no layout source is available.
 * The format matches the webview's OfficeLayout type.
 */
export function createMinimalLayout(): LayoutData {
  const cols = 20;
  const rows = 15;
  const tiles: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        tiles.push(0);
      } else {
        tiles.push(1);
      }
    }
  }

  const floorColor = { h: 35, s: 40, b: 15, c: 0 };
  const wallColor = { h: 20, s: 30, b: -25, c: 0 };
  const tileColors: Record<string, { h: number; s: number; b: number; c: number }> = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isWall = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      tileColors[`${c},${r}`] = isWall ? { ...wallColor } : { ...floorColor };
    }
  }

  return {
    version: 2,
    cols,
    rows,
    tiles,
    furniture: defaultFurniture(),
    tileColors,
  };
}
