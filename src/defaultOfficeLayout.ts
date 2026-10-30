import type { FloorColor, LayoutData } from './types.js';
import { defaultFurniture } from './defaultFurniture.js';

const WALL = 0;
const FLOOR_1 = 1;
const FLOOR_7 = 7;
const VOID = 8;
const FLOOR_9 = 9;
const COLS = 21;
const ROWS = 13;

const TILE_COLORS: Record<number, FloorColor> = {
  [WALL]: { h: 214, s: 30, b: -100, c: -55, colorize: true },
  [FLOOR_1]: { h: 209, s: 39, b: -25, c: -80, colorize: true },
  [FLOOR_7]: { h: 25, s: 48, b: -43, c: -88, colorize: true },
  [VOID]: { h: 214, s: 30, b: -100, c: -55, colorize: true },
  [FLOOR_9]: { h: 209, s: 0, b: -16, c: -8, colorize: true },
};

function createTiles(): number[] {
  const tiles = Array<number>(COLS * ROWS).fill(VOID);

  for (let col = 0; col < 20; col++) {
    tiles[COLS + col] = WALL;
  }

  for (let row = 2; row <= 11; row++) {
    tiles[row * COLS] = WALL;
    tiles[row * COLS + 19] = WALL;

    for (let col = 1; col <= 9; col++) {
      tiles[row * COLS + col] = FLOOR_7;
    }

    const opensDivider = row >= 5 && row <= 8;
    tiles[row * COLS + 10] = opensDivider ? FLOOR_1 : WALL;

    for (let col = 11; col <= 18; col++) {
      tiles[row * COLS + col] = row >= 10 ? FLOOR_9 : FLOOR_1;
    }
  }

  return tiles;
}

export function createDefaultOfficeLayout(): LayoutData {
  const tiles = createTiles();
  const tileColors: Record<string, FloorColor> = {};

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const tile = tiles[row * COLS + col];
      tileColors[`${col},${row}`] = { ...TILE_COLORS[tile] };
    }
  }

  return {
    version: 2,
    cols: COLS,
    rows: ROWS,
    tiles,
    furniture: defaultFurniture(),
    pets: [],
    tileColors,
  };
}
