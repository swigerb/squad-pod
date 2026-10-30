import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { HostClientProvider } from '../../HostClientContext.js';
import { createHostClientFixture } from '../../__tests__/hostClientFixture.js';
import { useEditorActions } from '../../hooks/useEditorActions.js';
import { OfficeState } from '../engine/officeState.js';
import { buildDynamicCatalog } from '../layout/furnitureCatalog.js';
import { EditorState } from './editorState.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => buildDynamicCatalog([]));

it('commits each valid variant rotation as exactly one undo entry and surfaces invalid plans without history changes', () => {
  buildDynamicCatalog(['front', 'side'].map((orientation) => ({
    type: `pa_${orientation}`, label: 'Fixture', groupId: 'pa_fixture', groupType: 'rotation' as const,
    orientation: orientation as 'front' | 'side', width: orientation === 'front' ? 1 : 2, height: 1,
    sprite: [['#ffffff']], isDesk: false, category: 'chairs',
    canPlaceOnSurfaces: false, canPlaceOnWalls: false,
  })));
  const office = new OfficeState({
    version: 2, cols: 4, rows: 4, tiles: Array(16).fill(1),
    furniture: [{ uid: 'seat', type: 'pa_front', col: 1, row: 1, rotation: 0,
      assetFootprint: { width: 1, height: 1 }, assetRole: 'seat' }],
  });
  const editor = new EditorState();
  let actions: ReturnType<typeof useEditorActions>;
  function Harness() {
    actions = useEditorActions(() => office, editor, undefined);
    return <button onClick={actions.handleRotateSelected}>Rotate</button>;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    act(() => root.render(<HostClientProvider client={createHostClientFixture()}><Harness /></HostClientProvider>));
    act(() => {
      actions.receiveLayout(office.getLayout(), 'external', 'groups-base');
      actions.handleToggleEditMode();
      actions.handleEditorSelectionChange('seat');
    });
    const before = structuredClone(office.layout);
    act(() => host.querySelector('button')!.click());
    expect(office.layout.furniture[0]).toMatchObject({ type: 'pa_side', rotation: 0, assetFootprint: { width: 2, height: 1 } });
    expect(actions!.canUndo).toBe(true);
    const after = structuredClone(office.layout);
    act(() => actions.handleUndo());
    expect(office.layout).toEqual(before);
    expect(actions!.canUndo).toBe(false);
    expect(actions!.canRedo).toBe(true);
    act(() => actions.handleRedo());
    expect(office.layout).toEqual(after);
    expect(actions!.canUndo).toBe(true);

    act(() => actions.handleUndo());
    office.layout.furniture[0].col = 3;
    const invalidBefore = structuredClone(office.layout);
    expect(actions!.canUndo).toBe(false);
    act(() => host.querySelector('button')!.click());
    expect(editor.transformError).toMatch(/inside the grid/);
    expect(office.layout).toEqual(invalidBefore);
    expect(actions!.canUndo).toBe(false);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
