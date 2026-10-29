import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfficeCanvas } from './OfficeCanvas.js';
import { OfficeState } from '../engine/officeState.js';
import { EditorState } from '../editor/editorState.js';
import { useEditorActions } from '../../hooks/useEditorActions.js';
import { useEditorKeyboard } from '../../hooks/useEditorKeyboard.js';
import { TileType } from '../types.js';
import { vscode } from '../../vscodeApi.js';
import * as gameLoop from '../engine/gameLoop.js';
import * as renderer from '../engine/renderer.js';
import { ZoomControls } from '../../components/ZoomControls.js';
import { TILE_SIZE } from '../../constants.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('passes live Debug View changes into every rendered frame', () => {
  const ctx = { setTransform: vi.fn(), imageSmoothingEnabled: false };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
  });
  vi.spyOn(gameLoop, 'startGameLoop').mockImplementation((_canvas, callbacks) => {
    callbacks.render(ctx as unknown as CanvasRenderingContext2D);
    return () => {};
  });
  const frame = vi.spyOn(renderer, 'renderFrame').mockImplementation(() => {});
  const host = document.createElement('div');
  const root = createRoot(host);
  const office = new OfficeState();
  const editor = new EditorState();
  const pan = { current: { x: 0, y: 0 } };
  try {
    for (const enabled of [false, true, false]) {
      act(() => root.render(<OfficeCanvas officeState={office} editorState={editor} isEditMode={false}
        isDebugMode={enabled} editorTick={0} zoom={1} panRef={pan} />));
      expect(frame.mock.lastCall?.at(-1)).toBe(enabled);
    }
  } finally {
    act(() => root.unmount());
    vi.restoreAllMocks();
  }
});

describe('real canvas gestures with editor actions and keyboard history', () => {
  let host: HTMLDivElement;
  let root: Root;
  let canvas: HTMLCanvasElement;
  let office: OfficeState;
  let editorState: EditorState;
  let actions: ReturnType<typeof useEditorActions>;

  beforeEach(() => {
    // Rendering is not under test in jsdom; mouse handlers and real layout
    // transforms/history are. No gesture or editor callback is mocked.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(vscode, 'postMessage').mockImplementation(() => {});
    office = new OfficeState({
      version: 2, cols: 12, rows: 10, tiles: Array(120).fill(TileType.FLOOR_1),
      furniture: [
        { uid: 'desk', type: 'desk', col: 2, row: 2, rotation: 0, color: { h: 40, s: 50, b: 5, c: 10 } },
        { uid: 'pc', type: 'pc', col: 3, row: 2, rotation: 0, state: 'on' },
        { uid: 'other', type: 'chair', col: 8, row: 7, rotation: 0 },
      ],
    });
    editorState = new EditorState();
    editorState.floorColor = { h: 200, s: 90, b: 0, c: 0, colorize: true };
    const getOffice = () => office;
    const panRef = { current: { x: 0, y: 0 } };
    function Harness() {
      actions = useEditorActions(getOffice, editorState);
      useEditorKeyboard(actions.isEditMode, editorState, actions.handleDeleteSelected,
        actions.handleRotateSelected, actions.handleUndo, actions.handleRedo,
        () => actions.handleEditorSelectionChange(null), actions.handleToggleEditMode);
      return <OfficeCanvas officeState={office} editorState={editorState}
        isEditMode={actions.isEditMode} editorTick={actions.editorTick} zoom={1} panRef={panRef}
        onEditorSelectionChange={actions.handleEditorSelectionChange}
        onDragMove={actions.handleDragMove}
        onExpandGrid={actions.handleExpandGrid}
        onGestureStart={actions.handleGestureStart} onGestureEnd={actions.handleGestureEnd} />;
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
    act(() => {
      actions.setLastSavedLayout(office.getLayout());
      actions.handleToggleEditMode();
    });
    canvas = host.querySelector('canvas')!;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function mouse(type: string, col: number, row: number, altKey = false) {
    act(() => canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: col * 16 + 8, clientY: row * 16 + 8, altKey,
    })));
  }

  function key(key: string, ctrlKey = false) {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true })));
  }

  function drag(col: number, row: number, alt = false) {
    mouse('mousedown', 2, 2, alt);
    mouse('mousemove', col, row, alt);
    mouse('mouseup', col, row, alt);
  }

  it('previews without mutating, then commits the whole group as exactly one undo/redo step', () => {
    const before = office.getLayout();
    mouse('mousedown', 2, 2);
    mouse('mousemove', 4, 3);
    mouse('mousemove', 5, 4);
    expect(office.getLayout()).toEqual(before);
    expect(actions.canUndo).toBe(false);
    mouse('mouseup', 5, 4);
    const moved = office.getLayout();
    expect(moved.furniture.slice(0, 2)).toMatchObject([
      { uid: 'desk', col: 5, row: 4 }, { uid: 'pc', col: 6, row: 4 },
    ]);
    expect(moved.furniture[2]).toEqual(before.furniture[2]);
    expect(actions.isDirty).toBe(true);
    key('z', true);
    expect(office.getLayout()).toEqual(before);
    expect(actions.canUndo).toBe(false);
    expect(actions.isDirty).toBe(false);
    key('y', true);
    expect(office.getLayout()).toEqual(moved);
    expect(actions.canRedo).toBe(false);
  });

  it('Alt-drags one copy, preserves original colors and uncolored PC despite Colorize, and selects the copied desk', () => {
    const before = office.getLayout();
    mouse('mousedown', 2, 2, true);
    mouse('mousemove', 4, 3, true);
    mouse('mousemove', 5, 4, true);
    expect(office.layout.furniture).toHaveLength(3);
    mouse('mouseup', 5, 4, true);
    const copied = office.getLayout();
    expect(copied.furniture).toHaveLength(5);
    expect(copied.furniture.slice(0, 3)).toEqual(before.furniture);
    expect(new Set(copied.furniture.map((f) => f.uid)).size).toBe(5);
    expect(copied.furniture.slice(3)).toMatchObject([
      { type: 'desk', col: 5, row: 4, color: before.furniture[0].color },
      { type: 'pc', col: 6, row: 4, state: 'on' },
    ]);
    expect(copied.furniture[4]).not.toHaveProperty('color');
    expect(editorState.selectedFurnitureUid).toBe(copied.furniture[3].uid);
    key('z', true);
    expect(office.getLayout()).toEqual(before);
    expect(actions.canUndo).toBe(false);
    key('y', true);
    expect(office.getLayout()).toEqual(copied);
    key('r');
    expect(office.layout.furniture.slice(3)).toMatchObject([
      { uid: copied.furniture[3].uid, col: 5, row: 4, rotation: 90 },
      { uid: copied.furniture[4].uid, col: 5, row: 5, rotation: 90 },
    ]);
    expect(office.layout.furniture.slice(0, 3)).toEqual(before.furniture);
  });

  it.each([false, true])('samples Alt at release, not just at mouse-down (start Alt=%s)', (altAtStart) => {
    mouse('mousedown', 2, 2, altAtStart);
    mouse('mousemove', 5, 4, altAtStart);
    mouse('mouseup', 5, 4, !altAtStart);
    expect(office.layout.furniture).toHaveLength(altAtStart ? 3 : 5);
    expect(office.layout.furniture[0].col).toBe(altAtStart ? 5 : 2);
  });

  it.each([false, true])('rejects an entire blocked drop after crossing valid tiles (copy=%s)', (alt) => {
    const before = office.getLayout();
    mouse('mousedown', 2, 2, alt);
    mouse('mousemove', 5, 4, alt);
    mouse('mousemove', 8, 7, alt);
    mouse('mouseup', 8, 7, alt);
    expect(office.getLayout()).toEqual(before);
    expect(actions.isDirty).toBe(false);
    expect(actions.canUndo).toBe(false);
    expect(host.querySelector('[role=alert]')?.textContent).toMatch(/overlaps/);
    expect(vscode.postMessage).not.toHaveBeenCalled();
    act(() => actions.handleSave());
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'saveLayout', layout: before });
  });

  it.each([false, true])('rejects a drop off-grid without expanding or resetting layout (copy=%s)', (alt) => {
    const before = office.getLayout();
    drag(11, 9, alt);
    expect(office.getLayout()).toEqual(before);
    expect(host.querySelector('[role=alert]')?.textContent).toMatch(/inside the grid/);
    expect(actions.canUndo).toBe(false);
  });

  it('rejects a copy overlapping its source and keeps redo available', () => {
    drag(5, 4);
    key('z', true);
    const before = office.getLayout();
    drag(3, 2, true);
    expect(office.getLayout()).toEqual(before);
    expect(actions.canUndo).toBe(false);
    expect(actions.canRedo).toBe(true);
    key('y', true);
    expect(office.layout.furniture[0]).toMatchObject({ col: 5, row: 4 });
  });

  it('hit-tests the PC above its desk and moves only that PC', () => {
    mouse('mousedown', 3, 2);
    expect(editorState.selectedFurnitureUid).toBe('pc');
    mouse('mousemove', 6, 4);
    mouse('mouseup', 6, 4);
    expect(office.layout.furniture.slice(0, 2)).toMatchObject([
      { uid: 'desk', col: 2, row: 2 }, { uid: 'pc', col: 6, row: 4 },
    ]);
  });

  it('rotates a selected desk and PC with R, with complete undo/redo', () => {
    const before = office.getLayout();
    mouse('mousedown', 2, 2);
    mouse('mouseup', 2, 2);
    expect(actions.canUndo).toBe(false);
    key('r');
    const rotated = office.getLayout();
    expect(rotated.furniture.slice(0, 2)).toMatchObject([
      { uid: 'desk', rotation: 90 }, { uid: 'pc', col: 2, row: 3, rotation: 90 },
    ]);
    key('z', true);
    expect(office.getLayout()).toEqual(before);
    expect(actions.canUndo).toBe(false);
    key('y', true);
    expect(office.getLayout()).toEqual(rotated);
  });

  it('rejects blocked R rotation without consuming undo', () => {
    office.layout.furniture[2].col = 2;
    office.layout.furniture[2].row = 3;
    const before = office.getLayout();
    mouse('mousedown', 2, 2);
    mouse('mouseup', 2, 2);
    key('r');
    expect(office.getLayout()).toEqual(before);
    expect(actions.canUndo).toBe(false);
    expect(host.querySelector('[role=alert]')?.textContent).toMatch(/overlaps/);
  });

  it.each(['mouseout', 'blur'])('cancels a furniture gesture on %s without committing a partial move', (event) => {
    const before = office.getLayout();
    mouse('mousedown', 2, 2, true);
    mouse('mousemove', 5, 4, true);
    if (event === 'blur') act(() => window.dispatchEvent(new Event('blur')));
    else mouse('mouseout', 13, 11, true);
    mouse('mouseup', 5, 4, true);
    expect(office.getLayout()).toEqual(before);
    expect(actions.canUndo).toBe(false);
    drag(5, 4);
    key('z', true);
    expect(office.getLayout()).toEqual(before);
    expect(actions.canUndo).toBe(false);
  });
});

describe('zoom keeps the office in view', () => {
  const VIEW = { width: 356, height: 716 };
  let host: HTMLDivElement;
  let root: Root;
  let office: OfficeState;
  let actions: ReturnType<typeof useEditorActions>;
  let frame: { mock: { lastCall?: unknown[] } };
  const panRef = { current: { x: 0, y: 0 } };

  beforeEach(() => {
    const ctx = { setTransform: vi.fn(), imageSmoothingEnabled: false };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: VIEW.width, bottom: VIEW.height,
      width: VIEW.width, height: VIEW.height, toJSON: () => ({}),
    });
    vi.spyOn(gameLoop, 'startGameLoop').mockImplementation((_canvas, callbacks) => {
      callbacks.render(ctx as unknown as CanvasRenderingContext2D);
      return () => {};
    });
    frame = vi.spyOn(renderer, 'renderFrame').mockImplementation(() => {});
    // Initial zoom is floor(2 * devicePixelRatio); DPR 2 reproduces zoom 4.
    vi.stubGlobal('devicePixelRatio', 2);
    office = new OfficeState({ version: 2, cols: 20, rows: 15, tiles: Array(300).fill(TileType.FLOOR_1), furniture: [] });
    for (let i = 0; i < 6; i++) office.addAgent(`a${i}`, `Agent ${i}`, 'Dev');
    panRef.current = { x: 0, y: 0 };
    const getOffice = () => office;
    function Harness() {
      actions = useEditorActions(getOffice, new EditorState());
      return <>
        <OfficeCanvas officeState={office} editorState={new EditorState()} isEditMode={false}
          editorTick={0} zoom={actions.zoom} onZoomChange={actions.handleZoomChange} panRef={panRef} />
        <ZoomControls zoom={actions.zoom} onZoomChange={actions.handleZoomChange} />
      </>;
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Office rectangle actually handed to the renderer on the latest frame. */
  function renderedOffice() {
    const args = frame.mock.lastCall!;
    const zoom = args[6] as number, x = args[7] as number, y = args[8] as number;
    return { zoom, x, y, width: 20 * TILE_SIZE * zoom, height: 15 * TILE_SIZE * zoom };
  }

  function visibleArea(r: { x: number; y: number; width: number; height: number }) {
    const w = Math.max(0, Math.min(r.x + r.width, VIEW.width) - Math.max(r.x, 0));
    const h = Math.max(0, Math.min(r.y + r.height, VIEW.height) - Math.max(r.y, 0));
    return w * h;
  }

  function charactersOnScreen(r: { zoom: number; x: number; y: number }) {
    return [...office.characters.values()].filter((c) => {
      const sx = c.x * r.zoom + r.x, sy = c.y * r.zoom + r.y;
      return sx >= 0 && sx <= VIEW.width && sy >= 0 && sy <= VIEW.height;
    }).length;
  }

  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;
  const click = (label: string) => act(() => button(label).dispatchEvent(new MouseEvent('click', { bubbles: true })));

  it('356x716 panel, 20x15 office: three minus clicks from zoom 4 to 1 leave the whole office and every agent visible', () => {
    const start = renderedOffice();
    expect(start.zoom).toBe(4);
    expect(start.x).toBeCloseTo((VIEW.width - start.width) / 2);
    const centerWorldX = (VIEW.width / 2 - start.x) / 4;

    click('−');
    click('−');
    click('−');

    const end = renderedOffice();
    expect(end.zoom).toBe(1);
    // 320x240 office fits in 356x716 and is fully drawn, not offscreen left.
    expect(end.x).toBeGreaterThanOrEqual(0);
    expect(end.x + end.width).toBeLessThanOrEqual(VIEW.width);
    expect(end.y).toBeGreaterThanOrEqual(0);
    expect(end.y + end.height).toBeLessThanOrEqual(VIEW.height);
    expect(visibleArea(end)).toBe(end.width * end.height);
    expect(charactersOnScreen(end)).toBe(6);
    // Viewport-center anchor: the same world point stays under the panel center.
    expect((VIEW.width / 2 - end.x) / 1).toBeCloseTo(centerWorldX);
    expect(button('−').disabled).toBe(true);
  });

  it('repeated button and Ctrl/Meta-wheel zoom across the full range never loses the office', () => {
    const canvas = host.querySelector('canvas')!;
    const wheel = (deltaY: number, clientX: number, clientY: number, metaKey = false) => act(() =>
      canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, clientX, clientY, ctrlKey: !metaKey, metaKey })));
    const check = () => {
      const r = renderedOffice();
      const axis = (map: number, view: number) => (map <= view ? map : view * 0.75);
      expect(visibleArea(r)).toBeGreaterThanOrEqual(axis(r.width, VIEW.width) * axis(r.height, VIEW.height) - 1e-6);
    };
    for (let i = 0; i < 8; i++) { click('+'); check(); }
    expect(renderedOffice().zoom).toBe(10);
    for (let i = 0; i < 12; i++) { wheel(100, 5, 5, i % 2 === 1); check(); }
    expect(renderedOffice().zoom).toBe(1);
    for (let i = 0; i < 12; i++) { wheel(-100, 350, 700); check(); }
    expect(renderedOffice().zoom).toBe(10);
    for (let i = 0; i < 9; i++) { click('−'); check(); }
    expect(renderedOffice().zoom).toBe(1);
    expect(charactersOnScreen(renderedOffice())).toBe(6);
  });

  it('Ctrl-wheel zoom keeps the world point under the cursor fixed', () => {
    const canvas = host.querySelector('canvas')!;
    const before = renderedOffice();
    const cursor = { x: 200, y: 300 };
    const world = { x: (cursor.x - before.x) / before.zoom, y: (cursor.y - before.y) / before.zoom };
    act(() => canvas.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -100, clientX: cursor.x, clientY: cursor.y, ctrlKey: true,
    })));
    const after = renderedOffice();
    expect(after.zoom).toBe(5);
    expect((cursor.x - after.x) / after.zoom).toBeCloseTo(world.x);
    expect((cursor.y - after.y) / after.zoom).toBeCloseTo(world.y);
  });
});
