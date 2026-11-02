import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditorKeyboard } from './useEditorKeyboard.js';
import { EditorState } from '../office/editor/editorState.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('useEditorKeyboard', () => {
  let host: HTMLDivElement | undefined;
  let root: ReturnType<typeof createRoot> | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('handles Ctrl+Shift+Z redo while keeping Ctrl+Z undo and Ctrl+Y redo', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    function Harness() {
      const boundary = useRef(host!);
      useEditorKeyboard(true, new EditorState(), vi.fn(), vi.fn(), undo, redo, vi.fn(), vi.fn(), boundary);
      return null;
    }

    host = document.createElement('div');
    host.tabIndex = 0;
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Harness />));
    host.focus();

    act(() => host!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true,
    })));
    act(() => host!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true,
    })));
    act(() => host!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true,
    })));

    expect(redo).toHaveBeenCalledTimes(2);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
