import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from './editorState.js';
import { EditTool, TileType, FurnitureType } from '../types.js';
import { DEFAULT_FLOOR_COLOR, DEFAULT_WALL_COLOR } from '../../constants.js';

describe('EditorState', () => {
  let editorState: EditorState;

  beforeEach(() => {
    editorState = new EditorState();
  });

  describe('default state', () => {
    it('initializes with default tool', () => {
      expect(editorState.tool).toBe(EditTool.SELECT);
    });

    it('initializes with default tile type', () => {
      expect(editorState.tileType).toBe(TileType.FLOOR_1);
    });

    it('initializes with default furniture type', () => {
      expect(editorState.furnitureType).toBe(FurnitureType.DESK);
    });

    it('initializes with null selected furniture', () => {
      expect(editorState.selectedFurnitureUid).toBeNull();
    });

    it('initializes with default floor color', () => {
      expect(editorState.floorColor).toEqual(DEFAULT_FLOOR_COLOR);
    });

    it('initializes with default wall color', () => {
      expect(editorState.wallColor).toEqual(DEFAULT_WALL_COLOR);
    });

    it('initializes with empty undo/redo stacks', () => {
      expect(editorState.undoStack.length).toBe(0);
      expect(editorState.redoStack.length).toBe(0);
    });
  });

  describe('setTool', () => {
    it('changes the current tool', () => {
      editorState.setTool(EditTool.TILE_PAINT);
      expect(editorState.tool).toBe(EditTool.TILE_PAINT);

      editorState.setTool(EditTool.FURNITURE_PLACE);
      expect(editorState.tool).toBe(EditTool.FURNITURE_PLACE);
    });
  });

  describe('setTileType', () => {
    it('changes the current tile type', () => {
      editorState.setTileType(TileType.WALL);
      expect(editorState.tileType).toBe(TileType.WALL);

      editorState.setTileType(TileType.FLOOR_2);
      expect(editorState.tileType).toBe(TileType.FLOOR_2);
    });
  });

  describe('setFurnitureType', () => {
    it('changes the current furniture type', () => {
      editorState.setFurnitureType(FurnitureType.CHAIR);
      expect(editorState.furnitureType).toBe(FurnitureType.CHAIR);

      editorState.setFurnitureType(FurnitureType.BOOKSHELF);
      expect(editorState.furnitureType).toBe(FurnitureType.BOOKSHELF);
    });
  });

  describe('setFloorColor', () => {
    it('changes the floor color', () => {
      const newColor = { h: 180, s: 50, b: 20, c: 10 };
      editorState.setFloorColor(newColor);

      expect(editorState.floorColor).toEqual(newColor);
      expect(editorState.floorColor).not.toBe(newColor); // Should be a copy
    });
  });

  describe('setWallColor', () => {
    it('changes the wall color', () => {
      const newColor = { h: 240, s: 60, b: -10, c: 15 };
      editorState.setWallColor(newColor);

      expect(editorState.wallColor).toEqual(newColor);
      expect(editorState.wallColor).not.toBe(newColor); // Should be a copy
    });
  });

  describe('setSelectedFurnitureUid', () => {
    it('sets selected furniture UID', () => {
      editorState.setSelectedFurnitureUid('desk-1');
      expect(editorState.selectedFurnitureUid).toBe('desk-1');
    });

    it('clears selected furniture UID', () => {
      editorState.setSelectedFurnitureUid('desk-1');
      editorState.setSelectedFurnitureUid(null);
      expect(editorState.selectedFurnitureUid).toBeNull();
    });
  });

  describe('reset', () => {
    it('resets all properties to defaults', () => {
      editorState.setTool(EditTool.FURNITURE_PLACE);
      editorState.setTileType(TileType.WALL);
      editorState.setFurnitureType(FurnitureType.CHAIR);
      editorState.setSelectedFurnitureUid('desk-1');
      editorState.setFloorColor({ h: 100, s: 50, b: 20, c: 10 });
      editorState.setWallColor({ h: 200, s: 40, b: -5, c: 5 });
      editorState.undoStack.push({ layout: {} as any, timestamp: Date.now() });
      editorState.redoStack.push({ layout: {} as any, timestamp: Date.now() });

      editorState.reset();

      expect(editorState.tool).toBe(EditTool.SELECT);
      expect(editorState.tileType).toBe(TileType.FLOOR_1);
      expect(editorState.furnitureType).toBe(FurnitureType.DESK);
      expect(editorState.selectedFurnitureUid).toBeNull();
      expect(editorState.floorColor).toEqual(DEFAULT_FLOOR_COLOR);
      expect(editorState.wallColor).toEqual(DEFAULT_WALL_COLOR);
      expect(editorState.undoStack.length).toBe(0);
      expect(editorState.redoStack.length).toBe(0);
    });
  });

  describe('canUndo', () => {
    it('returns false when undo stack is empty', () => {
      expect(editorState.canUndo()).toBe(false);
    });

    it('returns true when undo stack has entries', () => {
      editorState.undoStack.push({ layout: {} as any, timestamp: Date.now() });
      expect(editorState.canUndo()).toBe(true);
    });
  });

  describe('canRedo', () => {
    it('returns false when redo stack is empty', () => {
      expect(editorState.canRedo()).toBe(false);
    });

    it('returns true when redo stack has entries', () => {
      editorState.redoStack.push({ layout: {} as any, timestamp: Date.now() });
      expect(editorState.canRedo()).toBe(true);
    });
  });
});
