import { TileType } from '../types.js';

export function isWalkable(
  col: number,
  row: number,
  tileMap: number[][],
  blockedTiles: Set<string>
): boolean {
  if (row < 0 || row >= tileMap.length || col < 0 || col >= tileMap[row].length) {
    return false;
  }
  const tile = tileMap[row][col];
  if (tile === TileType.WALL || tile === TileType.VOID) {
    return false;
  }
  if (blockedTiles.has(`${col},${row}`)) {
    return false;
  }
  return true;
}

function isFloorTile(col: number, row: number, tileMap: number[][]): boolean {
  if (row < 0 || row >= tileMap.length || col < 0 || col >= tileMap[row].length) {
    return false;
  }
  const tile = tileMap[row][col];
  return tile !== TileType.WALL && tile !== TileType.VOID;
}

export function getWalkableTiles(tileMap: number[][], blockedTiles: Set<string>): Set<string> {
  const walkable = new Set<string>();
  for (let row = 0; row < tileMap.length; row++) {
    for (let col = 0; col < tileMap[row].length; col++) {
      if (isWalkable(col, row, tileMap, blockedTiles)) {
        walkable.add(`${col},${row}`);
      }
    }
  }
  return walkable;
}

function findPathInternal(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: number[][],
  blockedTiles: Set<string>,
  allowBlockedGoal: boolean
): Array<{ col: number; row: number }> {
  if (startCol === endCol && startRow === endRow) {
    return [];
  }
  if (!isWalkable(endCol, endRow, tileMap, blockedTiles)
    && !(allowBlockedGoal && isFloorTile(endCol, endRow, tileMap))) {
    return [];
  }

  const queue: Array<{ col: number; row: number; path: Array<{ col: number; row: number }> }> = [];
  const visited = new Set<string>();

  queue.push({ col: startCol, row: startRow, path: [] });
  visited.add(`${startCol},${startRow}`);

  const directions = [
    { dc: 0, dr: -1 },
    { dc: -1, dr: 0 },
    { dc: 1, dr: 0 },
    { dc: 0, dr: 1 }
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const dir of directions) {
      const nextCol = current.col + dir.dc;
      const nextRow = current.row + dir.dr;
      const key = `${nextCol},${nextRow}`;

      if (visited.has(key)) continue;
      const isGoal = nextCol === endCol && nextRow === endRow;
      if (!isWalkable(nextCol, nextRow, tileMap, blockedTiles)
        && !(allowBlockedGoal && isGoal && isFloorTile(nextCol, nextRow, tileMap))) continue;

      const newPath = [...current.path, { col: nextCol, row: nextRow }];

      if (isGoal) {
        return newPath;
      }

      queue.push({ col: nextCol, row: nextRow, path: newPath });
      visited.add(key);
    }
  }

  return [];
}

export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: number[][],
  blockedTiles: Set<string>
): Array<{ col: number; row: number }> {
  return findPathInternal(startCol, startRow, endCol, endRow, tileMap, blockedTiles, false);
}

/** Allows a route to end on its assigned chair tile without relaxing other collision checks. */
export function findPathToSeat(
  startCol: number,
  startRow: number,
  seatCol: number,
  seatRow: number,
  tileMap: number[][],
  blockedTiles: Set<string>
): Array<{ col: number; row: number }> {
  return findPathInternal(startCol, startRow, seatCol, seatRow, tileMap, blockedTiles, true);
}
