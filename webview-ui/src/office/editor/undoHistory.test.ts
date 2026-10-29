import { describe, expect, it } from 'vitest';
import { UndoHistory } from './undoHistory.js';
import { applyTilePaint, applyErase } from './editorActions.js';
import { TileType } from '../types.js';
import type { OfficeLayout } from '../types.js';

const color = { h: 0, s: 0, b: 0, c: 0 };

function blank(): OfficeLayout {
  return { version: 1, cols: 4, rows: 2, tiles: new Array(8).fill(TileType.FLOOR_1), furniture: [] } as OfficeLayout;
}

function paintStroke(history: UndoHistory, start: OfficeLayout, cols: number[]): OfficeLayout {
  history.beginGesture(start);
  let layout = start;
  for (const col of cols) layout = applyTilePaint(layout, col, 0, TileType.WALL, color);
  history.endGesture(layout);
  return layout;
}

describe('UndoHistory', () => {
  it('records one undo entry per drag stroke', () => {
    const history = new UndoHistory();
    const base = blank();
    const afterFirst = paintStroke(history, base, [0, 1, 2]);
    const afterSecond = paintStroke(history, afterFirst, [3]);

    const undoOnce = history.undo(afterSecond)!;
    expect(undoOnce).toEqual(afterFirst);
    const undoTwice = history.undo(undoOnce)!;
    expect(undoTwice).toEqual(base);
    expect(history.canUndo).toBe(false);
  });

  it('ignores gestures that change nothing', () => {
    const history = new UndoHistory();
    const base = blank();
    history.beginGesture(base);
    expect(history.endGesture(base)).toBe(false);
    expect(history.canUndo).toBe(false);
  });

  it('redoes a stroke and clears redo after a new edit', () => {
    const history = new UndoHistory();
    const base = blank();
    const painted = paintStroke(history, base, [0, 1]);
    const undone = history.undo(painted)!;
    expect(history.redo(undone)).toEqual(painted);

    history.undo(painted);
    paintStroke(history, base, [2]);
    expect(history.canRedo).toBe(false);
  });

  it('commits an open gesture before undoing', () => {
    const history = new UndoHistory();
    const base = blank();
    history.beginGesture(base);
    const erased = applyErase(base, 1, 1);
    expect(history.undo(erased)).toEqual(base);
  });

  it('isolates snapshots from later mutation', () => {
    const history = new UndoHistory();
    const base = blank();
    history.record(base);
    base.tiles[0] = TileType.WALL;
    expect(history.undo(base)!.tiles[0]).toBe(TileType.FLOOR_1);
  });

  it('caps the history size', () => {
    const history = new UndoHistory(2);
    let layout = blank();
    for (let col = 0; col < 4; col++) layout = paintStroke(history, layout, [col]);
    expect(history.undo(layout)).not.toBeNull();
    expect(history.undo(layout)).not.toBeNull();
    expect(history.undo(layout)).toBeNull();
  });
});
