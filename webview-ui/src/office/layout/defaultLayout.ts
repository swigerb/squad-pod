import { OfficeLayout, TileType } from '../types.js';
import { DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_FLOOR_COLOR } from '../../constants.js';

const tiles: number[] = [];
for (let row = 0; row < DEFAULT_ROWS; row++) {
  for (let col = 0; col < DEFAULT_COLS; col++) {
    if (row === 0 || row === DEFAULT_ROWS - 1 || col === 0 || col === DEFAULT_COLS - 1) {
      tiles.push(TileType.WALL);
    } else {
      tiles.push(TileType.FLOOR_1);
    }
  }
}

const tileColors: Record<string, typeof DEFAULT_FLOOR_COLOR> = {};
for (let row = 0; row < DEFAULT_ROWS; row++) {
  for (let col = 0; col < DEFAULT_COLS; col++) {
    tileColors[`${col},${row}`] = { ...DEFAULT_FLOOR_COLOR };
  }
}

export const DEFAULT_LAYOUT: OfficeLayout = {
  cols: DEFAULT_COLS,
  rows: DEFAULT_ROWS,
  tiles,
  furniture: [
    { uid: 'desk-1', type: 'desk', col: 4, row: 3, rotation: 0 },
    { uid: 'chair-1', type: 'chair', col: 4, row: 4, rotation: 0 },
    { uid: 'desk-2', type: 'desk', col: 10, row: 3, rotation: 0 },
    { uid: 'chair-2', type: 'chair', col: 10, row: 4, rotation: 0 },
    { uid: 'desk-3', type: 'desk', col: 4, row: 7, rotation: 0 },
    { uid: 'chair-3', type: 'chair', col: 4, row: 8, rotation: 0 },
    { uid: 'desk-4', type: 'desk', col: 10, row: 7, rotation: 0 },
    { uid: 'chair-4', type: 'chair', col: 10, row: 8, rotation: 0 }
  ],
  tileColors
};
