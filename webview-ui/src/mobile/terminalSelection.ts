// Adapted from Pixel Agents v1.5.0 (b1bafd0), terminal/selectionMath.ts.
// Absolute buffer cells, inclusive ends: viewport scrolling never changes identity.
export interface Cell { row: number; col: number }
export interface CellRange { start: Cell; end: Cell }
export function cellBefore(a: Cell, b: Cell): boolean {
  return a.row < b.row || (a.row === b.row && a.col < b.col);
}
export function orderedRange(a: Cell, b: Cell): CellRange {
  return cellBefore(b, a) ? { start: b, end: a } : { start: a, end: b };
}
export function wordRangeAt(cell: Cell, cols: number, isBlank: (cell: Cell) => boolean): CellRange | null {
  if (isBlank(cell)) return null;
  let start = cell.col;
  let end = cell.col;
  while (start > 0 && !isBlank({ row: cell.row, col: start - 1 })) start--;
  while (end < cols - 1 && !isBlank({ row: cell.row, col: end + 1 })) end++;
  return { start: { row: cell.row, col: start }, end: { row: cell.row, col: end } };
}
export function extendSelection(anchor: CellRange, to: Cell): CellRange {
  return cellBefore(to, anchor.start) ? orderedRange(to, anchor.end) : orderedRange(anchor.start, to);
}
export function dragSelectionHandle(range: CellRange, end: 'start' | 'end', to: Cell): CellRange {
  if (end === 'start') return { ...range, start: cellBefore(range.end, to) ? range.end : to };
  return { ...range, end: cellBefore(to, range.start) ? range.start : to };
}
export function selectionLength(range: CellRange, cols: number): number {
  return (range.end.row - range.start.row) * cols + range.end.col - range.start.col + 1;
}
