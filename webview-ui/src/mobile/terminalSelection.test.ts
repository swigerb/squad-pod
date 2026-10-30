import { describe, expect, it } from 'vitest';
import { dragSelectionHandle, extendSelection, orderedRange, selectionLength, wordRangeAt } from './terminalSelection.js';
describe('absolute terminal buffer selection', () => {
  const anchor = { start: { row: 100, col: 3 }, end: { row: 100, col: 6 } };
  it('selects only the nonblank word, with row boundaries and blank cells respected', () => {
    const row = '   word  x';
    const blank = (cell: { row: number; col: number }) => row[cell.col] === ' ';
    expect(wordRangeAt({ row: 100, col: 4 }, 10, blank)).toEqual(anchor);
    expect(wordRangeAt({ row: 100, col: 0 }, 10, blank)).toBeNull();
    expect(wordRangeAt({ row: 100, col: 9 }, 10, blank)).toEqual({
      start: { row: 100, col: 9 }, end: { row: 100, col: 9 },
    });
    expect(wordRangeAt({ row: 0, col: 1 }, 3, () => false)).toEqual({
      start: { row: 0, col: 0 }, end: { row: 0, col: 2 },
    });
  });
  it('extends backwards from the whole anchor word and measures inclusive multi-row cells', () => {
    const range = extendSelection(anchor, { row: 99, col: 8 });
    expect(range).toEqual({ start: { row: 99, col: 8 }, end: anchor.end });
    expect(selectionLength(range, 10)).toBe(9);
    expect(extendSelection(anchor, { row: 101, col: 1 })).toEqual({
      start: anchor.start, end: { row: 101, col: 1 },
    });
    expect(orderedRange(anchor.end, anchor.start)).toEqual(anchor);
  });
  it('clamps crossing handles at one cell instead of swapping ends', () => {
    const start = dragSelectionHandle(anchor, 'start', { row: 101, col: 0 });
    const end = dragSelectionHandle(anchor, 'end', { row: 99, col: 9 });
    expect(start).toEqual({ start: anchor.end, end: anchor.end });
    expect(end).toEqual({ start: anchor.start, end: anchor.start });
    expect(selectionLength(start, 80)).toBe(1);
    expect(dragSelectionHandle(anchor, 'end', { row: 101, col: 0 }).start).toEqual(anchor.start);
  });
});
