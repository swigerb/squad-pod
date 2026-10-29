import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { vscode } from './vscodeApi.js';
import { isSoundEnabled } from './notificationSound.js';
import type { OutboundMessage, SourceStatus } from '../../src/types.js';

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
});
