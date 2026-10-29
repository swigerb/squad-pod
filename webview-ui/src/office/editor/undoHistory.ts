import type { OfficeLayout } from '../types.js';
import { UNDO_STACK_MAX_SIZE } from '../../constants.js';

function snapshot(layout: OfficeLayout): string {
  return JSON.stringify(layout);
}

/**
 * Layout undo/redo history. A gesture (e.g. one paint drag) records at most one
 * undo entry, and gestures that change nothing record none.
 */
export class UndoHistory {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private gestureStart: string | null = null;

  constructor(private readonly maxSize: number = UNDO_STACK_MAX_SIZE) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get inGesture(): boolean {
    return this.gestureStart !== null;
  }

  /** Record the current layout as an undo point for a single discrete action. */
  record(layout: OfficeLayout): void {
    this.pushUndo(snapshot(layout));
  }

  beginGesture(layout: OfficeLayout): void {
    if (this.gestureStart === null) this.gestureStart = snapshot(layout);
  }

  endGesture(layout: OfficeLayout): boolean {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (start === null || start === snapshot(layout)) return false;
    this.pushUndo(start);
    return true;
  }

  undo(current: OfficeLayout): OfficeLayout | null {
    this.endGesture(current);
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(snapshot(current));
    return JSON.parse(prev) as OfficeLayout;
  }

  redo(current: OfficeLayout): OfficeLayout | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(snapshot(current));
    return JSON.parse(next) as OfficeLayout;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.gestureStart = null;
  }

  private pushUndo(entry: string): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
  }
}
