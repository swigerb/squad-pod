import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { vscode } from './vscodeApi.js';
import { isSoundEnabled } from './notificationSound.js';
import type { OutboundMessage, SourceStatus } from '../../src/types.js';
import type { AssetSnapshot } from '../../src/manifestAssets.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('settings and source UI with simulated host messages', () => {
  let host: HTMLDivElement;
  let root: Root;
  const status: SourceStatus = {
    workspaceRoot: 'C:\\project', squadDir: 'C:\\project\\.squad',
    teamFound: true, observer: 'watching', nativeWatch: false, error: null,
  };
  function send(message: OutboundMessage) {
    act(() => window.dispatchEvent(new MessageEvent('message', { data: message })));
  }
  function click(text: string) {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === text);
    expect(button, text).toBeDefined();
    act(() => button!.click());
  }
  function load() {
    send({ type: 'layoutLoaded', layout: { version: 2, cols: 6, rows: 6, tiles: Array(36).fill(1), furniture: [] } });
    send({ type: 'sourceStatus', status });
  }
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(vscode, 'postMessage').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('restores both settings on startup/reload, sends changes, and persists Debug Close as off', () => {
    send({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: false });
    load();
    expect(isSoundEnabled()).toBe(false);
    click('Settings');
    const sound = host.querySelector<HTMLInputElement>('#squad-pod-sound')!;
    const debug = host.querySelector<HTMLInputElement>('#squad-pod-debug-view')!;
    expect(sound.checked).toBe(false);
    expect(debug.checked).toBe(false);
    act(() => sound.click());
    expect(isSoundEnabled()).toBe(true);
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'setSoundEnabled', enabled: true });
    act(() => debug.click());
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'setDebugEnabled', enabled: true });
    expect(host.textContent).toContain('Authoritative tool/context data is unavailable');
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<App />));
    send({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: true });
    load();
    expect(isSoundEnabled()).toBe(false);
    expect(host.textContent).toContain('Authoritative tool/context data is unavailable');
    click('Close');
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'setDebugEnabled', enabled: false });
    click('Settings');
    expect(host.querySelector<HTMLInputElement>('#squad-pod-debug-view')!.checked).toBe(false);
  });

  it('shows only host-reported observer status and labels absent producers/launch explicitly', () => {
    load();
    click('Settings');
    expect(host.textContent).toContain('Team file: Found');
    expect(host.textContent).toContain('Watching (polling)');
    expect(host.textContent).toContain('EventBus / WebSocket bridge: Not connected (no producer)');
    expect(host.textContent).toContain('Automatic launch on startup/refocus: Off (unavailable)');
    send({ type: 'sourceStatus', status: { ...status, observer: 'stopped', nativeWatch: false, error: 'Observer stopped' } });
    expect(host.textContent).toContain('File observer: Stopped');
    expect(host.querySelector('[role=alert]')?.textContent).toBe('Observer stopped');
  });

  it('onboards a missing team, removes guidance on discovery and never launches on focus', () => {
    load();
    send({ type: 'sourceStatus', status: { ...status, teamFound: false } });
    expect(host.querySelector('[aria-label="Set up Squad"]')?.textContent).toContain('No Squad team found');
    expect(host.textContent).toContain('Your saved office is kept');
    expect(host.querySelector('a')?.href).toBe('https://github.com/bradygaster/squad#readme');
    const before = vi.mocked(vscode.postMessage).mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(vscode.postMessage).toHaveBeenCalledTimes(before);
    send({ type: 'sourceStatus', status });
    expect(host.querySelector('[aria-label="Set up Squad"]')).toBeNull();
    expect(host.textContent).toContain('Squad Info');
    expect(host.textContent).toContain('Telemetry');
  });

  it('shows the no-workspace guidance before any layout and recovers after a folder opens', () => {
    send({ type: 'noWorkspace' });
    expect(host.textContent).toContain('Open a folder to get started');
    expect(host.textContent).not.toContain('Loading office');
    load();
    expect(host.textContent).not.toContain('Open a folder to get started');
    expect(host.querySelector('canvas')).not.toBeNull();
  });

  it('reacts to later layout messages alone to show and clear missing-art warnings after ready', () => {
    load();
    expect(host.textContent).not.toContain('Asset warnings');
    const furniture = [
      { uid: 'legacy', type: 'desk', col: 1, row: 1, rotation: 0 },
      { uid: 'unknown', type: 'unknown-imported-id', col: 4, row: 4, rotation: 0 },
    ];
    const layout = { version: 2, cols: 6, rows: 6, tiles: Array(36).fill(1), furniture };
    const original = JSON.stringify(layout);
    send({ type: 'layoutLoaded', layout });
    expect(host.textContent).toContain('Asset warnings (2)');
    expect(host.textContent).toContain('unknown-imported-id');
    expect(host.textContent).toContain('desk');
    expect(JSON.stringify(layout)).toBe(original);
    send({ type: 'layoutLoaded', layout: { ...layout, furniture: [] } });
    expect(host.textContent).not.toContain('Asset warnings');
    expect(vi.mocked(vscode.postMessage).mock.calls.filter(([m]) => m.type === 'saveLayout')).toEqual([]);
  });

  it('keeps unsaved editor work and undo history when asset diagnostics refresh', () => {
    load();
    click('Edit Layout');
    click('→');
    expect(host.textContent).toContain('● Save Layout');
    send({ type: 'manifestAssetsLoaded', snapshot: {
      furniture: [], floors: [], walls: [], carpets: [], directories: [], diagnostics: ['Root read budget exceeded'],
    } });
    expect(host.textContent).toContain('Root read budget exceeded');
    expect(host.textContent).toContain('● Save Layout');
    expect(vi.mocked(vscode.postMessage).mock.calls.filter(([m]) => m.type === 'saveLayout')).toEqual([]);
    click('● Save Layout');
    expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'saveLayout', layout: expect.objectContaining({ cols: 7, rows: 6, furniture: [] }),
    }));
    click('Undo');
    click('● Save Layout');
    expect(vscode.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'saveLayout', layout: expect.objectContaining({ cols: 6, rows: 6, furniture: [] }),
    }));
  });

  it('updates the live asset palette and visible diagnostics through simulated host snapshots without saving/resetting layouts', () => {
    const layout = {
      version: 2, cols: 6, rows: 6, tiles: Array(36).fill(1),
      furniture: [{ uid: 'old', type: 'unknown-old-id', col: 2, row: 2, rotation: 0 }],
    };
    const snapshot: AssetSnapshot = {
      furniture: [{
        type: 'local_TEST_TEST', label: 'Test fixture asset', width: 1, height: 1,
        sprite: [['#abcdef']], isDesk: false, category: 'decor', canPlaceOnSurfaces: false, canPlaceOnWalls: false,
      }],
      floors: [], walls: [], carpets: [], directories: ['C:\\fixture-assets'], diagnostics: ['Bad fixture manifest rejected'],
    };
    send({ type: 'manifestAssetsLoaded', snapshot });
    send({ type: 'layoutLoaded', layout });
    send({ type: 'sourceStatus', status });
    expect(host.textContent).toContain('Unavailable asset: unknown-old-id');
    expect(host.textContent).toContain('Bad fixture manifest rejected');
    click('Settings');
    click('Add Asset Directory');
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'addAssetDirectory' });
    click('Unload');
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'removeAssetDirectory', directory: 'C:\\fixture-assets' });
    send({ type: 'manifestAssetsLoaded', snapshot: { ...snapshot, directories: [], diagnostics: [] } });
    expect(host.textContent).not.toContain('Bad fixture manifest rejected');
    expect(host.textContent).toContain('Unavailable asset: unknown-old-id');
    expect(vi.mocked(vscode.postMessage).mock.calls.filter(([m]) => m.type === 'saveLayout')).toEqual([]);
    expect(layout.furniture[0]).toEqual({ uid: 'old', type: 'unknown-old-id', col: 2, row: 2, rotation: 0 });
  });
});
