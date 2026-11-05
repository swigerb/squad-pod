import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STANDALONE_CONTROL_CAPABILITIES, STANDALONE_OBSERVER_CAPABILITIES,
  VSCODE_HOST_CAPABILITIES, type HostCapabilities,
} from '../../../src/core/hostCapabilities.js';
import { HostClientProvider } from '../HostClientContext.js';
import { createHostClientFixture } from '../__tests__/hostClientFixture.js';
import { LayoutDraft } from '../office/editor/layoutDraft.js';
import type { OfficeLayout } from '../office/types.js';
import { LayoutConflict } from './LayoutConflict.js';
import { SettingsModal } from './SettingsModal.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const profiles: Array<{ name: string; capabilities: HostCapabilities; standalone: boolean }> = [
  { name: 'restricted injected host', capabilities: { actions: [], recoveryState: 'unavailable' }, standalone: false },
  { name: 'import-only injected host', capabilities: { actions: ['importLayout'], recoveryState: 'unavailable' }, standalone: false },
  { name: 'export-only injected host', capabilities: {
    actions: ['exportLayout', 'exportLayoutSnapshot'], recoveryState: 'unavailable',
  }, standalone: false },
  { name: 'VS Code', capabilities: VSCODE_HOST_CAPABILITIES, standalone: false },
  { name: 'standalone control', capabilities: STANDALONE_CONTROL_CAPABILITIES, standalone: true },
  { name: 'standalone observer', capabilities: STANDALONE_OBSERVER_CAPABILITIES, standalone: true },
  { name: 'observer capabilities without standalone flag', capabilities: STANDALONE_OBSERVER_CAPABILITIES, standalone: false },
];

describe.each(profiles)('layout transfer: $name', ({ capabilities, standalone }) => {
  let host: HTMLDivElement;
  let root: Root;
  const acquireApi = vi.fn(() => { throw new Error('VS Code API must not be acquired'); });
  beforeEach(() => {
    vi.stubGlobal('acquireVsCodeApi', acquireApi);
    acquireApi.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    expect(acquireApi).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  function button(text: string) {
    const result = [...host.querySelectorAll('button')].find(item => item.textContent === text);
    expect(result, text).toBeDefined();
    return result!;
  }

  it('renders independent import/export gates and sends only supported settings actions', () => {
    const client = { ...createHostClientFixture(), capabilities };
    act(() => root.render(<HostClientProvider client={client}>
      <SettingsModal standalone={standalone} onClose={vi.fn()}
        settings={{ soundEnabled: true, debugEnabled: false, showAreas: true }}
        sourceStatus={null} onSoundChange={vi.fn()} onShowAreasChange={vi.fn()} />
    </HostClientProvider>));
    for (const [label, action, unavailable] of [
      ['Export Layout', 'exportLayout', 'Layout export is unavailable in this host.'],
      ['Import Layout', 'importLayout', 'Layout import is unavailable in this host.'],
    ] as const) {
      const supported = capabilities.actions.includes(action);
      expect(button(label).disabled).toBe(!supported);
      expect(host.textContent?.includes(unavailable)).toBe(!supported);
      act(() => button(label).click());
    }
    expect(vi.mocked(client.send).mock.calls.map(([message]) => message)).toEqual(
      ['exportLayout', 'importLayout'].filter(action => capabilities.actions.includes(
        action as 'exportLayout' | 'importLayout',
      )).map(type => ({ type })),
    );
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(client.getState).not.toHaveBeenCalled();
  });

  it('gates every recovery export without changing retained versions or resolution', () => {
    const client = { ...createHostClientFixture(), capabilities };
    const protection = new LayoutDraft();
    const layout: OfficeLayout = { version: 2, cols: 2, rows: 2, tiles: [1, 1, 1, 1], furniture: [] };
    protection.receive(layout, 'external', 'baseline', 'synthetic-workspace');
    protection.capture({ ...layout, tiles: [2, 1, 1, 1] });
    protection.receive({ ...layout, tiles: [1, 2, 1, 1] }, 'external', 'incoming');
    expect(protection.state.pending).toHaveLength(1);
    expect(protection.state.retained).toHaveLength(1);
    const before = JSON.stringify(protection.state);
    const resolve = vi.fn();
    act(() => root.render(<HostClientProvider client={client}>
      <LayoutConflict protection={protection} onResolve={resolve} />
    </HostClientProvider>));
    const supported = capabilities.actions.includes('exportLayoutSnapshot');
    const copies = [
      ['Export local draft', protection.state.draft],
      [`Export snapshot #${protection.state.pending[0].id}`, protection.state.pending[0].layout],
      [`Export retained #${protection.state.retained[0].id}`, protection.state.retained[0].layout],
    ] as const;
    act(() => host.querySelectorAll('details').forEach(details => { details.open = true; }));
    for (const [label] of copies) {
      expect(button(label).disabled).toBe(!supported);
      act(() => button(label).click());
    }
    expect(host.textContent?.includes('Recovery export is unavailable in this host.')).toBe(!supported);
    expect(vi.mocked(client.send).mock.calls.map(([message]) => message)).toEqual(
      supported ? copies.map(([, layout]) => ({ type: 'exportLayoutSnapshot', layout })) : [],
    );
    expect(host.querySelectorAll('pre')).toHaveLength(3);
    expect(host.querySelector('pre')?.textContent).toBe(JSON.stringify(protection.state.draft, null, 2));
    expect(host.textContent).toContain(capabilities.recoveryState === 'webview-state'
      ? 'Recovery uses this VS Code panel'
      : capabilities.recoveryState === 'browser-storage'
        ? 'Recovery uses browser storage scoped to this project and server instance'
        : 'This host does not provide recovery storage. Copies are held in memory only');
    expect(JSON.stringify(protection.state)).toBe(before);
    expect(resolve).not.toHaveBeenCalled();
    expect(client.getState).not.toHaveBeenCalled();
  });
});
