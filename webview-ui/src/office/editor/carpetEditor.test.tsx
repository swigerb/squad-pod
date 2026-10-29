import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { OfficeState } from '../engine/officeState.js';
import { EditorState } from './editorState.js';
import { EditTool, TileType, type OfficeLayout, type SpriteData } from '../types.js';
import { OfficeCanvas } from '../components/OfficeCanvas.js';
import { useEditorActions } from '../../hooks/useEditorActions.js';
import { EditorToolbar } from '../../components/EditorToolbar.js';
import { setCarpetSprites } from '../sprites/carpetTiles.js';
import { applyCarpetPaint, applyCarpetErase, applyTilePaint } from './editorActions.js';
import { deserializeLayout, serializeLayout } from '../layout/layoutManager.js';
import { vscode } from '../../vscodeApi.js';
import { renderCarpetLayer } from '../sprites/carpetRenderer.js';

vi.mock('../sprites/spriteCache.js', () => ({ getCachedSprite: (sprite: SpriteData) => sprite }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('carpets through real canvas/editor transactions', () => {
  let host: HTMLDivElement, root: Root, canvas: HTMLCanvasElement;
  let office: OfficeState, state: EditorState, actions: ReturnType<typeof useEditorActions>;
  let before: OfficeLayout;
  const color = { h: 210, s: 80, b: -10, c: 0, colorize: true };
  const accentColor = { ...color, h: 40, b: 20 };

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(vscode, 'postMessage').mockImplementation(() => {});
    setCarpetSprites([0, 1, 2].map(() => Array.from({ length: 16 }, () => [['#111111', '#eeeeee']])));
    before = {
      version: 2, cols: 6, rows: 4, tiles: Array(24).fill(1),
      furniture: [{ uid: 'chair', type: 'chair', col: 2, row: 1, rotation: 0 }],
      tileColors: { '2,1': { h: 40, s: 50, b: 10, c: 0 } },
    };
    before.tiles[0] = TileType.WALL;
    before.tiles[1] = TileType.VOID;
    office = new OfficeState(structuredClone(before));
    state = new EditorState();
    const getOffice = () => office;
    const panRef = { current: { x: 0, y: 0 } };
    function Harness() {
      actions = useEditorActions(getOffice, state);
      return <>
        <OfficeCanvas officeState={office} editorState={state} isEditMode={actions.isEditMode}
          editorTick={actions.editorTick} zoom={1} panRef={panRef}
          onEditorTileAction={actions.handleEditorTileAction} onEditorEraseAction={actions.handleEditorEraseAction}
          onEditorEyedropper={actions.handleEyedropper}
          onGestureStart={actions.handleGestureStart} onGestureEnd={actions.handleGestureEnd} />
        <EditorToolbar editorState={state} {...actions} onToolChange={actions.handleToolChange}
          onTileTypeChange={actions.handleTileTypeChange} onFloorColorChange={actions.handleFloorColorChange}
          onWallColorChange={actions.handleWallColorChange} onFurnitureTypeChange={actions.handleFurnitureTypeChange}
          onCarpetVariantChange={actions.handleCarpetVariantChange} onCarpetColorChange={actions.handleCarpetColorChange}
          onSave={actions.handleSave} onReset={actions.handleReset} onUndo={actions.handleUndo} onRedo={actions.handleRedo}
          onDeleteSelected={actions.handleDeleteSelected} onRotateSelected={actions.handleRotateSelected}
          hasSelection={false} />
      </>;
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
    act(() => {
      actions.receiveLayout(office.layout, 'external', 'initial', 'C:\\carpet-fixture');
      actions.handleToggleEditMode();
      actions.handleToolChange(EditTool.CARPET_PAINT);
      actions.handleCarpetColorChange(color);
      actions.handleCarpetColorChange(accentColor, true);
    });
    canvas = host.querySelector('canvas')!;
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    setCarpetSprites([]);
    vi.restoreAllMocks();
  });

  function mouse(type: string, col: number, row: number, button = 0) {
    act(() => canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true, button, buttons: type === 'mouseup' ? 0 : button === 2 ? 2 : 1,
      clientX: col * 16 + 8, clientY: row * 16 + 8,
    })));
  }
  function stroke(button = 0) {
    mouse('mousedown', 2, 1, button);
    mouse('mousemove', 3, 1, button);
    mouse('mousemove', 4, 1, button);
    mouse('mouseup', 4, 1, button);
  }

  it.each([0, 1, 2])('paints style %i as one undo/redo step without changing floors, furniture or pathfinding', (variant) => {
    const walkable = structuredClone(office.walkableTiles);
    act(() => actions.handleCarpetVariantChange(variant));
    stroke();
    const painted = structuredClone(office.layout);
    expect(painted.tiles).toEqual(before.tiles);
    expect(painted.furniture).toEqual(before.furniture);
    expect(painted.tileColors).toEqual(before.tileColors);
    expect(office.walkableTiles).toEqual(walkable);
    expect(painted.carpetTiles?.filter(Boolean)).toHaveLength(3);
    for (const index of [8, 9, 10]) {
      expect(painted.carpetTiles?.[index]).toMatchObject({ variant, color, accentColor });
    }
    expect(actions.isDirty).toBe(true);
    act(() => actions.handleUndo());
    expect(office.layout).toEqual(before);
    expect(office.layout).not.toHaveProperty('carpetTiles');
    expect(actions.canUndo).toBe(false);
    act(() => actions.handleRedo());
    expect(office.layout).toEqual(painted);
    expect(actions.canRedo).toBe(false);
  });

  it('right-erases a whole stroke as one transaction, preserves floors and furniture, and supports generic erase', () => {
    stroke();
    const painted = structuredClone(office.layout);
    stroke(2);
    expect(office.layout.carpetTiles?.every((t) => t === null)).toBe(true);
    expect(office.layout.tiles).toEqual(before.tiles);
    expect(office.layout.furniture).toEqual(before.furniture);
    act(() => actions.handleUndo());
    expect(office.layout).toEqual(painted);
    act(() => actions.handleRedo());
    expect(office.layout.carpetTiles?.filter(Boolean)).toEqual([]);
    act(() => actions.handleUndo());
    act(() => actions.handleToolChange(EditTool.ERASE));
    mouse('mousedown', 2, 1); mouse('mouseup', 2, 1);
    expect(office.layout.carpetTiles?.[8]).toBeNull();
    expect(office.layout.furniture).toEqual(before.furniture);
    expect(office.layout.tiles[8]).toBe(1);
  });

  it('eyedrops the actual style and both colors, rerenders the panel, and does not change history/layout', () => {
    act(() => actions.handleCarpetVariantChange(2));
    stroke();
    const painted = structuredClone(office.layout);
    act(() => {
      actions.handleCarpetVariantChange(0);
      actions.handleCarpetColorChange({ ...color, h: 0 });
      actions.handleCarpetColorChange({ ...accentColor, h: 0 }, true);
      actions.handleToolChange(EditTool.EYEDROPPER);
    });
    mouse('mousedown', 3, 1);
    expect(state.tool).toBe(EditTool.CARPET_PAINT);
    expect(state.carpetVariant).toBe(2);
    expect(state.carpetColor).toEqual(color);
    expect(state.carpetAccentColor).toEqual(accentColor);
    expect(host.querySelector('[title="Carpet 3"]')?.getAttribute('aria-pressed')).toBe('true');
    expect((host.querySelector('[aria-label="Carpet Main hue"]') as HTMLInputElement).value).toBe('210');
    expect((host.querySelector('[aria-label="Carpet Accent hue"]') as HTMLInputElement).value).toBe('40');
    expect(office.layout).toEqual(painted);
    act(() => actions.handleUndo());
    expect(office.layout).toEqual(before);
  });

  it.each(['left', 'right', 'up', 'down'] as const)('preserves carpet style/colors/order through %s resize, serialization and undo', (direction) => {
    stroke();
    const painted = structuredClone(office.layout);
    act(() => actions.handleExpandGrid(direction));
    const resized = office.layout;
    expect(resized.carpetTiles).toHaveLength(resized.cols * resized.rows);
    const col = direction === 'left' ? 3 : 2;
    const row = direction === 'up' ? 2 : 1;
    expect(resized.carpetTiles?.[row * resized.cols + col]).toEqual(painted.carpetTiles?.[8]);
    expect(resized.carpetTiles?.filter(Boolean)).toHaveLength(3);
    expect(deserializeLayout(serializeLayout(resized))).toEqual(resized);
    act(() => actions.handleUndo());
    expect(office.layout).toEqual(painted);
    act(() => actions.handleRedo());
    expect(office.layout).toEqual(resized);
  });

  it('rejects wall/void/off-grid/missing-art strokes without undo entries, and repainting floors preserves carpets', () => {
    for (const col of [0, 1]) { mouse('mousedown', col, 0); mouse('mouseup', col, 0); }
    expect(office.layout).toEqual(before);
    expect(actions.canUndo).toBe(false);
    expect(applyCarpetPaint(before, -1, 1, { variant: 0 })).toBe(before);
    expect(applyCarpetPaint(before, 6, 0, { variant: 0 })).toBe(before);
    expect(applyCarpetErase(before, 2, 1)).toBe(before);
    setCarpetSprites([]);
    stroke();
    expect(office.layout).toEqual(before);
    expect(actions.canUndo).toBe(false);
    expect(host.querySelector('[role=alert]')?.textContent).toMatch(/unavailable/);
    const painted = applyCarpetPaint(before, 2, 1, { variant: 0, color, accentColor });
    const floor = applyTilePaint(painted, 2, 1, TileType.FLOOR_2, color);
    expect(floor.carpetTiles).toEqual(painted.carpetTiles);
    const wall = applyTilePaint(painted, 2, 1, TileType.WALL, color);
    expect(wall.carpetTiles?.[8]).toBeNull();
    expect(painted.carpetTiles?.[8]).not.toBeNull();
  });

  it('invalidates cached renders through real edit/history/expand/import/external/protected-resolution paths', () => {
    const composites = new WeakMap<HTMLCanvasElement, ReturnType<typeof vi.fn>>();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
      if (this.isConnected) return null;
      const drawImage = vi.fn();
      composites.set(this, drawImage);
      return { drawImage, imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D;
    });
    const ctx = { drawImage: vi.fn(), canvas: { width: 1280, height: 720 }, getTransform: () => ({ a: 1, d: 1 }) };
    const render = () => {
      ctx.drawImage.mockClear();
      renderCarpetLayer(ctx as unknown as CanvasRenderingContext2D, office.layout.carpetTiles,
        office.tileMap, office.layout.cols, office.layout.rows, 0, 0, 1);
      const calls = ctx.drawImage.mock.calls.flatMap(([image, ...args]) => image instanceof HTMLCanvasElement
        ? composites.get(image)!.mock.calls.map(([sprite, x, y]) => [sprite, x - 8, y - 8])
        : [[image, ...args]]);
      return structuredClone(calls);
    };
    let map = office.tileMap;
    stroke();
    expect(office.tileMap).not.toBe(map);
    const painted = structuredClone(office.layout), painting = render();
    expect(painting.length).toBeGreaterThan(0);
    expect(render()).toEqual(painting);
    map = office.tileMap;
    stroke(2);
    expect(office.tileMap).not.toBe(map);
    expect(render()).toEqual([]);
    act(() => actions.handleUndo());
    expect(render()).toEqual(painting);
    act(() => actions.handleRedo());
    expect(render()).toEqual([]);
    act(() => actions.handleUndo());
    act(() => {
      actions.handleCarpetColorChange({ ...color, h: 120 });
      actions.handleCarpetColorChange({ ...accentColor, h: 270 }, true);
    });
    stroke();
    expect(render()).not.toEqual(painting);
    act(() => actions.handleUndo());
    expect(render()).toEqual(painting);
    map = office.tileMap;
    act(() => {
      actions.handleToolChange(EditTool.WALL_PAINT);
      actions.handleEditorTileAction(2, 1);
    });
    expect(office.tileMap).not.toBe(map);
    expect(render()).not.toEqual(painting);
    act(() => actions.handleUndo());
    expect(render()).toEqual(painting);
    act(() => actions.handleExpandGrid('left'));
    expect(render()).toEqual(painting.map(([sprite, x, y]) => [sprite, x + 16, y]));
    act(() => actions.handleUndo());
    expect(render()).toEqual(painting);

    act(() => actions.handleSave());
    act(() => actions.acknowledgeSave(painted, 'saved'));
    const incoming = applyCarpetPaint(painted, 3, 1, { variant: 2, color: { ...color, h: 30 }, accentColor });
    map = office.tileMap;
    act(() => actions.receiveLayout(incoming, 'import', null, 'C:\\carpet-fixture'));
    expect(office.tileMap).not.toBe(map);
    const imported = render();
    expect(imported).not.toEqual(painting);
    map = office.tileMap;
    const external = applyCarpetPaint(painted, 4, 1, { variant: 1, color, accentColor });
    act(() => actions.receiveLayout(external, 'external', 'external', 'C:\\carpet-fixture'));
    expect(office.tileMap).toBe(map);
    expect(render()).toEqual(imported);
    act(() => actions.resolveLayout(actions.protection.state.pending[0].id, 'local'));
    expect(office.tileMap).toBe(map);
    expect(render()).toEqual(imported);
    act(() => actions.receiveLayout(painted, 'import', null, 'C:\\carpet-fixture'));
    act(() => actions.resolveLayout(actions.protection.state.pending[0].id, 'incoming'));
    expect(office.tileMap).not.toBe(map);
    expect(render()).toEqual(painting);
    act(() => actions.handleSave());
    act(() => actions.acknowledgeSave(painted, 'saved-again'));
    act(() => actions.receiveLayout(incoming, 'external', 'external-next', 'C:\\carpet-fixture'));
    expect(render()).toEqual(imported);
  });
});
