import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ManifestFurniture } from '../../../../src/manifestAssets.js';
import { HostClientProvider } from '../../HostClientContext.js';
import { createHostClientFixture } from '../../__tests__/hostClientFixture.js';
import { useEditorActions } from '../../hooks/useEditorActions.js';
import { OfficeState } from '../engine/officeState.js';
import { buildDynamicCatalog } from '../layout/furnitureCatalog.js';
import { EditorState } from './editorState.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const sprite = [['#ffffff']];
const asset = (type: string, extra: Partial<ManifestFurniture> = {}): ManifestFurniture => ({
  type,
  label: type,
  groupId: 'pa_pc',
  groupType: 'state',
  orientation: 'front',
  state: 'off',
  width: 1,
  height: 1,
  sprite,
  isDesk: false,
  category: 'electronics',
  canPlaceOnSurfaces: true,
  canPlaceOnWalls: false,
  rotationScheme: '3-way-mirror',
  ...extra,
});

function setup(types = ['pa_pc_front_off']) {
  buildDynamicCatalog([
    asset('pa_pc_front_off'),
    asset('pa_pc_front_on', { state: 'on' }),
    asset('pa_pc_side_off', { orientation: 'side', mirrorSide: true }),
    asset('pa_pc_side_on', { orientation: 'side', state: 'on', mirrorSide: true }),
    asset('pa_pc_back_off', { orientation: 'back' }),
  ]);
  const layout = {
    version: 2,
    cols: 8,
    rows: 8,
    tiles: Array(64).fill(1),
    furniture: types.map((type, index) => ({
      uid: `item-${index}`,
      type,
      col: 1 + index,
      row: 1,
      rotation: 0,
      assetFootprint: { width: 1, height: 1 },
      state: 'legacy-state-preserved',
      color: { h: 150, s: 50, b: 0, c: 0 },
    })),
  };
  const office = new OfficeState(layout);
  const editor = new EditorState();
  let actions: ReturnType<typeof useEditorActions>;
  function Harness() {
    actions = useEditorActions(() => office, editor, undefined);
    return <button onClick={actions.handleToggleState}>Toggle</button>;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(
    <HostClientProvider client={createHostClientFixture()}><Harness /></HostClientProvider>,
  ));
  act(() => {
    actions.receiveLayout(office.getLayout(), 'external', 'furniture-state-base');
    actions.handleToggleEditMode();
    actions.handleEditorSelectionChange('item-0');
  });
  return {
    office,
    editor,
    host,
    root,
    actions: () => actions!,
    close: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => buildDynamicCatalog([]));

describe('stateful furniture editor actions', () => {
  it('toggles type in one undoable layout change and preserves legacy state, color, and identity', () => {
    const test = setup();
    try {
      expect(test.actions().canToggleSelectedState).toBe(true);
      expect(test.actions().isSelectedFurnitureOn).toBe(false);
      const before = structuredClone(test.office.getLayout());

      act(() => test.actions().handleToggleState());
      expect(test.office.layout.furniture[0]).toMatchObject({
        uid: 'item-0',
        type: 'pa_pc_front_on',
        state: 'legacy-state-preserved',
        color: { h: 150, s: 50, b: 0, c: 0 },
      });
      expect(test.actions().canUndo).toBe(true);
      const after = structuredClone(test.office.getLayout());

      act(() => test.actions().handleUndo());
      expect(test.office.getLayout()).toEqual(before);
      expect(test.actions().canRedo).toBe(true);
      act(() => test.actions().handleRedo());
      expect(test.office.getLayout()).toEqual(after);
      expect(test.actions().isSelectedFurnitureOn).toBe(true);
    } finally {
      test.close();
    }
  });

  it('does not record undo when the selected item has no complete state pair', () => {
    const test = setup(['unpaired-furniture']);
    try {
      expect(test.actions().canToggleSelectedState).toBe(false);
      act(() => {
        test.actions().handleToggleState();
        test.actions().handleEditorSelectionChange(null);
      });
      expect(test.office.layout.furniture[0].type).toBe('unpaired-furniture');
      expect(test.actions().canUndo).toBe(false);
      expect(test.actions().canRedo).toBe(false);
    } finally {
      test.close();
    }
  });

  it('rotates an on item to the matching on variant and falls back when a target is unpaired', () => {
    const test = setup(['pa_pc_front_on']);
    try {
      act(() => test.actions().handleRotateSelected());
      expect(test.office.layout.furniture[0].type).toBe('pa_pc_side_on');
      act(() => test.actions().handleRotateSelected());
      expect(test.office.layout.furniture[0].type).toBe('pa_pc_back_off');
      act(() => test.actions().handleUndo());
      expect(test.office.layout.furniture[0].type).toBe('pa_pc_side_on');
    } finally {
      test.close();
    }
  });
});
