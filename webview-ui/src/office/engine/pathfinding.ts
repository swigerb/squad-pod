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

export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: number[][],
  blockedTiles: Set<string>
): Array<{ col: number; row: number }> {
  if (startCol === endCol && startRow === endRow) {
    return [];
  }
  if (!isWalkable(endCol, endRow, tileMap, blockedTiles)) {
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
      if (!isWalkable(nextCol, nextRow, tileMap, blockedTiles)) continue;

      const newPath = [...current.path, { col: nextCol, row: nextRow }];

      if (nextCol === endCol && nextRow === endRow) {
        return newPath;
      }

      queue.push({ col: nextCol, row: nextRow, path: newPath });
      visited.add(key);
    }
  }

  return [];
}
