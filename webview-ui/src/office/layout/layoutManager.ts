import {
  OfficeLayout,
  FurnitureInstance,
  Seat,
  PlacedFurniture,
  Direction,
  TileType,
  SpriteData
} from '../types.js';
import { DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_FLOOR_COLOR } from '../../constants.js';
import { getCatalogEntry } from './furnitureCatalog.js';

export function createDefaultLayout(): OfficeLayout {
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

  const furniture: PlacedFurniture[] = [
    { uid: 'desk-1', type: 'desk', col: 4, row: 3, rotation: 0 },
    { uid: 'chair-1', type: 'chair', col: 4, row: 4, rotation: 0 },
    { uid: 'desk-2', type: 'desk', col: 10, row: 3, rotation: 0 },
    { uid: 'chair-2', type: 'chair', col: 10, row: 4, rotation: 0 },
    { uid: 'desk-3', type: 'desk', col: 4, row: 7, rotation: 0 },
    { uid: 'chair-3', type: 'chair', col: 4, row: 8, rotation: 0 },
    { uid: 'desk-4', type: 'desk', col: 10, row: 7, rotation: 0 },
    { uid: 'chair-4', type: 'chair', col: 10, row: 8, rotation: 0 }
  ];

  const tileColors = new Map<string, typeof DEFAULT_FLOOR_COLOR>();
  for (let row = 0; row < DEFAULT_ROWS; row++) {
    for (let col = 0; col < DEFAULT_COLS; col++) {
      tileColors.set(`${col},${row}`, { ...DEFAULT_FLOOR_COLOR });
    }
  }

  return {
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    tiles,
    furniture,
    tileColors: Object.fromEntries(tileColors)
  };
}

export function layoutToTileMap(layout: OfficeLayout): number[][] {
  const tileMap: number[][] = [];
  for (let row = 0; row < layout.rows; row++) {
    const rowData: number[] = [];
    for (let col = 0; col < layout.cols; col++) {
      const index = row * layout.cols + col;
      rowData.push(layout.tiles[index]);
    }
    tileMap.push(rowData);
  }
  return tileMap;
}

export function layoutToFurnitureInstances(furniture: PlacedFurniture[]): FurnitureInstance[] {
  const instances: FurnitureInstance[] = [];
  for (const furn of furniture) {
    const entry = getCatalogEntry(furn.type);
    if (!entry) continue;

    let sprite = entry.sprite;
    let width = entry.width;
    let height = entry.height;

    if (furn.rotation === 90 || furn.rotation === 270) {
      [width, height] = [height, width];
      sprite = rotateSprite(sprite, furn.rotation);
    } else if (furn.rotation === 180) {
      sprite = rotateSprite(sprite, furn.rotation);
    }

    instances.push({
      uid: furn.uid,
      type: furn.type,
      col: furn.col,
      row: furn.row,
      width,
      height,
      sprite,
      rotation: furn.rotation
    });
  }
  return instances;
}

function rotateSprite(sprite: SpriteData, rotation: number): SpriteData {
  if (rotation === 0) return sprite;
  
  if (rotation === 90) {
    const height = sprite.length;
    const width = sprite[0].length;
    const rotated: SpriteData = [];
    for (let x = 0; x < width; x++) {
      const row: string[] = [];
      for (let y = height - 1; y >= 0; y--) {
        row.push(sprite[y][x]);
      }
      rotated.push(row);
    }
    return rotated;
  }
  
  if (rotation === 180) {
    return sprite.map(row => [...row].reverse()).reverse();
  }
  
  if (rotation === 270) {
    const height = sprite.length;
    const width = sprite[0].length;
    const rotated: SpriteData = [];
    for (let x = width - 1; x >= 0; x--) {
      const row: string[] = [];
      for (let y = 0; y < height; y++) {
        row.push(sprite[y][x]);
      }
      rotated.push(row);
    }
    return rotated;
  }
  
  return sprite;
}

export function layoutToSeats(furniture: PlacedFurniture[]): Seat[] {
  const seats: Seat[] = [];
  const chairMap = new Map<string, PlacedFurniture>();
  const deskMap = new Map<string, PlacedFurniture>();

  for (const furn of furniture) {
    if (furn.type === 'chair') {
      chairMap.set(`${furn.col},${furn.row}`, furn);
    } else if (furn.type === 'desk') {
      deskMap.set(`${furn.col},${furn.row}`, furn);
    }
  }

  for (const chair of chairMap.values()) {
    const directions = [
      { dir: Direction.UP, dc: 0, dr: -1 },
      { dir: Direction.DOWN, dc: 0, dr: 1 },
      { dir: Direction.LEFT, dc: -1, dr: 0 },
      { dir: Direction.RIGHT, dc: 1, dr: 0 }
    ];

    for (const d of directions) {
      const deskCol = chair.col + d.dc;
      const deskRow = chair.row + d.dr;
      const key = `${deskCol},${deskRow}`;
      if (deskMap.has(key)) {
        seats.push({
          id: chair.uid,
          col: chair.col,
          row: chair.row,
          direction: d.dir
        });
        break;
      }
    }
  }

  return seats;
}

export function getBlockedTiles(furniture: PlacedFurniture[]): Set<string> {
  const blocked = new Set<string>();
  const instances = layoutToFurnitureInstances(furniture);

  for (const furn of instances) {
    for (let r = 0; r < furn.height; r++) {
      for (let c = 0; c < furn.width; c++) {
        blocked.add(`${furn.col + c},${furn.row + r}`);
      }
    }
  }

  return blocked;
}

export function getSeatTiles(furniture: PlacedFurniture[]): Set<string> {
  const seats = layoutToSeats(furniture);
  const seatTiles = new Set<string>();
  for (const seat of seats) {
    seatTiles.add(`${seat.col},${seat.row}`);
  }
  return seatTiles;
}

export function serializeLayout(layout: OfficeLayout): string {
  return JSON.stringify(layout);
}

export function deserializeLayout(json: string): OfficeLayout {
  const layout = JSON.parse(json) as OfficeLayout;
  
  if (!layout.cols || !layout.rows || !layout.tiles || !Array.isArray(layout.furniture)) {
    throw new Error('Invalid layout format');
  }
  
  if (layout.tiles.length !== layout.cols * layout.rows) {
    throw new Error('Tile array length does not match dimensions');
  }
  
  return layout;
}
