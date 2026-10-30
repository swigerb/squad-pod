import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from '../../components/EditorToolbar.js';
import { HostClientProvider } from '../../HostClientContext.js';
import { createHostClientFixture } from '../../__tests__/hostClientFixture.js';
import { useEditorActions } from '../../hooks/useEditorActions.js';
import { OfficeCanvas } from '../components/OfficeCanvas.js';
import { OfficeState } from '../engine/officeState.js';
import { EditorState } from './editorState.js';
import { EditTool, TileType, type FloorColor } from '../types.js';
import { buildDynamicCatalog } from '../layout/furnitureCatalog.js';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';
import { clearColorizeCache } from '../colorize.js';

vi.mock('../colorize.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../colorize.js')>();
  return { ...actual, clearColorizeCache: vi.fn(actual.clearColorizeCache) };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('furniture color controls and eyedrop', () => {
  let host: HTMLDivElement;
  let root: Root;
  let office: OfficeState;
  let editorState: EditorState;
  let actions: ReturnType<typeof useEditorActions>;
  let canvas: HTMLCanvasElement;
  const client = createHostClientFixture();
  const deskColor: FloorColor = { h: 40, s: 50, b: 5, c: 10 };
  const pcColor: FloorColor = { h: 200, s: 60, b: 15, c: 2, colorize: true };
  const fixtureSprite = (color: string) => Array.from({ length: 16 }, () => Array(16).fill(color));
  const assets: ManifestFurniture[] = [
    { type: 'pa_COLOR_DESK', label: 'Color Desk', width: 2, height: 1, sprite: fixtureSprite('#805020'), isDesk: true, category: 'desks', canPlaceOnSurfaces: false, canPlaceOnWalls: false },
    { type: 'pa_COLOR_PC', label: 'Color PC', width: 1, height: 1, sprite: fixtureSprite('#3060a0'), isDesk: false, category: 'electronics', canPlaceOnSurfaces: true, canPlaceOnWalls: false },
    { type: 'pa_COLOR_CHAIR', label: 'Color Chair', width: 1, height: 1, sprite: fixtureSprite('#405060'), isDesk: false, category: 'chairs', canPlaceOnSurfaces: false, canPlaceOnWalls: false },
  ];

  beforeEach(() => {
    buildDynamicCatalog(assets);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
    });
    office = new OfficeState({
      version: 2, cols: 12, rows: 10, tiles: Array(120).fill(TileType.FLOOR_1),
      furniture: [
        { uid: 'desk', type: 'pa_COLOR_DESK', col: 2, row: 2, rotation: 0, assetFootprint: { width: 2, height: 1 }, color: deskColor },
        { uid: 'pc', type: 'pa_COLOR_PC', col: 3, row: 2, rotation: 0, assetFootprint: { width: 1, height: 1 }, color: pcColor },
        { uid: 'uncolored-chair', type: 'pa_COLOR_CHAIR', col: 8, row: 7, rotation: 0, assetFootprint: { width: 1, height: 1 } },
      ],
    });
    editorState = new EditorState();
    const getOfficeState = () => office;
    const panRef = { current: { x: 0, y: 0 } };

    function Harness() {
      actions = useEditorActions(getOfficeState, editorState, undefined);
      const selectedFurnitureColor = office.layout.furniture
        .find((furniture) => furniture.uid === editorState.selectedFurnitureUid)?.color ?? null;
      return (
        <>
          <OfficeCanvas
            officeState={office}
            editorState={editorState}
            isEditMode={actions.isEditMode}
            editorTick={actions.editorTick}
            zoom={1}
            panRef={panRef}
            onEditorTileAction={actions.handleEditorTileAction}
            onEditorEraseAction={actions.handleEditorEraseAction}
            onEditorEyedropper={actions.handleEyedropper}
            onEditorFurnitureColorPick={actions.handleFurnitureColorPick}
            furnitureColorPickTarget={actions.furnitureColorPickTarget}
            onEditorSelectionChange={actions.handleEditorSelectionChange}
            onDragMove={actions.handleDragMove}
            onGestureStart={actions.handleGestureStart}
            onGestureEnd={actions.handleGestureEnd}
          />
          <EditorToolbar
            editorState={editorState}
            isEditMode={actions.isEditMode}
            onToolChange={actions.handleToolChange}
            onTileTypeChange={actions.handleTileTypeChange}
            onFloorColorChange={actions.handleFloorColorChange}
            onWallColorChange={actions.handleWallColorChange}
            onFurnitureTypeChange={actions.handleFurnitureTypeChange}
            furniturePaletteColor={actions.furniturePaletteColor}
            selectedFurnitureColor={selectedFurnitureColor}
            onFurniturePaletteColorChange={actions.handleFurniturePaletteColorChange}
            onSelectedFurnitureColorChange={actions.handleSelectedFurnitureColorChange}
            onFurnitureColorPickToggle={actions.handleFurnitureColorPickToggle}
            furnitureColorPickTarget={actions.furnitureColorPickTarget}
            onColorGestureStart={actions.handleGestureStart}
            onColorGestureEnd={actions.handleGestureEnd}
            activePetTypes={office.getActivePetTypes()}
            onPetToggle={actions.handlePetToggle}
            onCarpetVariantChange={actions.handleCarpetVariantChange}
            onCarpetColorChange={actions.handleCarpetColorChange}
            areas={office.layout.areas ?? []}
            areaMappings={office.layout.areaMappings}
            directories={[]}
            selectedAreaLabel={editorState.selectedAreaLabel}
            transformError={editorState.transformError}
            onAreaAdd={actions.handleAreaAdd}
            onAreaRename={actions.handleAreaRename}
            onAreaColorChange={actions.handleAreaColorChange}
            onAreaRemove={actions.handleAreaRemove}
            onAreaMappingChange={actions.handleAreaMappingChange}
            onAreaSelect={actions.handleAreaSelect}
            onSave={actions.handleSave}
            onReset={actions.handleReset}
            onUndo={actions.handleUndo}
            onRedo={actions.handleRedo}
            onDeleteSelected={actions.handleDeleteSelected}
            onRotateSelected={actions.handleRotateSelected}
            canUndo={actions.canUndo}
            canRedo={actions.canRedo}
            isDirty={actions.isDirty}
            hasSelection={editorState.selectedFurnitureUid !== null}
          />
        </>
      );
    }

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<HostClientProvider client={client}><Harness /></HostClientProvider>));
    act(() => {
      actions.receiveLayout(office.getLayout(), 'external', 'furniture-color-base');
      actions.handleToggleEditMode();
    });
    canvas = host.querySelector('canvas')!;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    buildDynamicCatalog([]);
    vi.restoreAllMocks();
  });

  function mouse(type: string, col: number, row: number) {
    act(() => canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: col * 16 + 8, clientY: row * 16 + 8,
    })));
  }

  function selectFurniture(col: number, row: number) {
    mouse('mousedown', col, row);
    mouse('mouseup', col, row);
  }

  function rangeChange(label: string, value: number) {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    expect(input, label).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('clears the shared color cache before every selected-color slider rebuild', () => {
    selectFurniture(2, 2);
    const rebuild = vi.spyOn(office, 'rebuildFromLayout');
    vi.mocked(clearColorizeCache).mockClear();
    rangeChange('Selected Furniture Color hue', 75);
    rangeChange('Selected Furniture Color hue', 95);

    expect(clearColorizeCache).toHaveBeenCalledTimes(2);
    expect(rebuild).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 2; index++) {
      expect(vi.mocked(clearColorizeCache).mock.invocationCallOrder[index])
        .toBeLessThan(rebuild.mock.invocationCallOrder[index]);
    }
    expect(office.layout.furniture[0].color).toEqual({ ...deskColor, h: 95 });
  });

  it('clears the shared color cache before rebuilding the eyedropped selection', () => {
    selectFurniture(2, 2);
    const rebuild = vi.spyOn(office, 'rebuildFromLayout');
    vi.mocked(clearColorizeCache).mockClear();
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="furniture-color-pick-selected"]')!.click());
    mouse('mousedown', 3, 2);

    expect(clearColorizeCache).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearColorizeCache).mock.invocationCallOrder[0])
      .toBeLessThan(rebuild.mock.invocationCallOrder[0]);
    expect(office.layout.furniture[0].color).toEqual(pcColor);
  });

  it('applies one undo step per selected-color slider gesture and removes color keys exactly', () => {
    selectFurniture(2, 2);
    const slider = host.querySelector<HTMLInputElement>('input[aria-label="Selected Furniture Color hue"]')!;
    const setRange = (value: number) => rangeChange('Selected Furniture Color hue', value);
    act(() => slider.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    setRange(75);
    setRange(95);
    act(() => slider.dispatchEvent(new Event('pointerup', { bubbles: true })));

    expect(office.layout.furniture[0].color).toEqual({ ...deskColor, h: 95 });
    expect(actions.canUndo).toBe(true);
    act(() => actions.handleUndo());
    expect(office.layout.furniture[0].color).toEqual(deskColor);
    expect(actions.canUndo).toBe(false);
    expect(actions.canRedo).toBe(true);
    act(() => actions.handleRedo());
    expect(office.layout.furniture[0].color).toEqual({ ...deskColor, h: 95 });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Clear selected furniture color"]')!.click());
    expect(office.layout.furniture[0]).not.toHaveProperty('color');
    act(() => actions.handleUndo());
    expect(office.layout.furniture[0].color).toEqual({ ...deskColor, h: 95 });
  });

  it('samples the surface item onto the selected furniture as a separate color-only undo entry', () => {
    selectFurniture(2, 2);
    const hue = host.querySelector<HTMLInputElement>('input[aria-label="Selected Furniture Color hue"]')!;
    act(() => hue.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    rangeChange('Selected Furniture Color hue', 75);
    act(() => hue.dispatchEvent(new Event('pointerup', { bubbles: true })));
    const sliderColor = { ...deskColor, h: 75 };

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="furniture-color-pick-selected"]')!.click());
    expect(actions.furnitureColorPickTarget).toBe('selected');
    mouse('mousedown', 3, 2);

    expect(office.layout.furniture[0].color).toEqual(pcColor);
    expect(office.layout.furniture[1].color).toEqual(pcColor);
    expect(actions.furnitureColorPickTarget).toBeNull();
    act(() => actions.handleUndo());
    expect(office.layout.furniture[0].color).toEqual(sliderColor);
    expect(actions.canUndo).toBe(true);
  });

  it('lets the regular Eyedrop tool copy furniture color without changing the existing tool fallbacks', () => {
    selectFurniture(2, 2);
    act(() => actions.handleToolChange(EditTool.EYEDROPPER));
    mouse('mousedown', 3, 2);
    expect(office.layout.furniture[0].color).toEqual(pcColor);
    expect(editorState.tool).toBe(EditTool.EYEDROPPER);
    act(() => actions.handleUndo());
    expect(office.layout.furniture[0].color).toEqual(deskColor);
  });

  it('uses the palette for newly placed furniture and preserves an explicitly uncolored source', () => {
    act(() => actions.handleToolChange(EditTool.FURNITURE_PLACE));
    expect(host.querySelector('[data-testid="furniture-palette-color"]')).not.toBeNull();
    rangeChange('New Furniture Color hue', 120);
    act(() => host.querySelector<HTMLButtonElement>('button[title="Color Chair"]')!.click());
    mouse('mousedown', 10, 7);
    const placed = office.layout.furniture.find((item) => item.col === 10 && item.row === 7);
    expect(placed?.color).toEqual(actions.furniturePaletteColor);

    act(() => actions.handleDragMove('uncolored-chair', 9, 7, true));
    const copy = office.layout.furniture.find((item) => item.uid !== 'uncolored-chair'
      && item.col === 9 && item.row === 7);
    expect(copy).toBeDefined();
    expect(copy).not.toHaveProperty('color');
    expect(office.layout.furniture.find((item) => item.uid === 'uncolored-chair')).not.toHaveProperty('color');

    act(() => actions.handleDragMove('desk', 1, 6, true));
    const coloredCopy = office.layout.furniture.find((item) => item.uid !== 'desk'
      && item.col === 1 && item.row === 6);
    expect(coloredCopy?.color).toEqual(deskColor);
  });

  it('does not add furniture colors or dirty the layout when the palette is only adjusted', () => {
    const before = JSON.stringify(office.getLayout());
    act(() => actions.handleToolChange(EditTool.FURNITURE_PLACE));
    rangeChange('New Furniture Color hue', 90);
    expect(JSON.stringify(office.getLayout())).toBe(before);
    expect(actions.isDirty).toBe(false);
    expect(office.getLayout().furniture.every((item) => !Object.prototype.hasOwnProperty.call(item, 'color')
      || item.color !== undefined)).toBe(true);
  });
});
