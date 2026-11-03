import { useEffect, type RefObject } from 'react';
import type { EditorState } from '../office/editor/editorState.js';
import { acceptsOfficeKey } from '../officeInput.js';

export function useEditorKeyboard(
  isEditMode: boolean,
  editorState: EditorState,
  onDelete: () => void,
  onRotate: () => void,
  onUndo: () => void,
  onRedo: () => void,
  onDeselect: () => void,
  onExitEditMode: () => void,
  boundary: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const root = boundary.current;
    if (!isEditMode || !root) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!acceptsOfficeKey(root, e)) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && editorState.selectedFurnitureUid) {
        e.preventDefault();
        onDelete();
      } else if (e.key === 'r' && editorState.selectedFurnitureUid) {
        e.preventDefault();
        onRotate();
      } else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        onRedo();
      } else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onUndo();
      } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onRedo();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (editorState.selectedFurnitureUid) {
          onDeselect();
        } else {
          onExitEditMode();
        }
      }
    };

    root.addEventListener('keydown', handleKeyDown);
    return () => root.removeEventListener('keydown', handleKeyDown);
  }, [isEditMode, editorState.selectedFurnitureUid, onDelete, onRotate, onUndo, onRedo, onDeselect, onExitEditMode, boundary]);
}
