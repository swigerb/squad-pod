import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserClient } from './browserClient.js';
import { connectOffice } from '../../../src/core/officeChannel.js';
import { LayoutDraft } from '../office/editor/layoutDraft.js';
import type { OfficeLayout } from '../office/types.js';
import { defaultPreferences } from '../../../standalone/src/officePreferences.js';
import type { CanvasHostBridge } from '../../../src/core/canvasHost.js';

class Socket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  open() { this.readyState = 1; this.onopen?.(); }
}
afterEach(() => vi.useRealTimers());
describe('production browser HostClient adapter', () => {
  const layout: OfficeLayout = { version: 2, cols: 2, rows: 2, tiles: [1, 1, 1, 1], furniture: [] };
  it('routes Canvas charter and recovery exports through the host and imports only as an opted-in draft', async () => {
    const bridge: CanvasHostBridge = { charter: true, usage: true, export: true,
      openCharter: vi.fn(async () => undefined), getUsage: vi.fn(async () => []),
      exportLayout: vi.fn(async () => 'squad-pod-layout-11111111-1111-1111-1111-111111111111.json'),
      importLayout: vi.fn(async () => layout),
    };
    const status = vi.fn();
    const createSocket = () => new Socket() as unknown as WebSocket;
    const observer = createBrowserClient(status, createSocket, 'http://127.0.0.1:1234', undefined, bridge);
    const control = createBrowserClient(status, createSocket, 'http://127.0.0.1:1234',
      { recoveryKey: 'fixture', storage: { getItem: () => null, setItem: vi.fn() } }, bridge);
    const received = vi.fn();
    const stop = control.subscribe(received);
    try {
      observer.send({ type: 'openSquadAgent', agentId: 'test-bot' });
      expect(bridge.openCharter).toHaveBeenCalledExactlyOnceWith('test-bot');
      observer.send({ type: 'exportLayoutSnapshot', layout });
      expect(bridge.exportLayout).not.toHaveBeenCalled();
      await expect(observer.canvasHost!.importLayout('office.json')).rejects.toThrow();
      expect(bridge.importLayout).not.toHaveBeenCalled();
      control.send({ type: 'exportLayoutSnapshot', layout });
      await vi.waitFor(() => expect(status).toHaveBeenCalledWith(
        "Layout JSON exported to this session's workspace files: squad-pod-layout-11111111-1111-1111-1111-111111111111.json"));
      expect(bridge.exportLayout).toHaveBeenCalledExactlyOnceWith(JSON.stringify(layout, null, 2));
      await control.canvasHost!.importLayout('office.json');
      expect(received).toHaveBeenLastCalledWith({ type: 'layoutLoaded', layout, revision: null, workspaceRoot: '', source: 'import' });
      expect(received.mock.calls.flat().some(m => m.type === 'layoutSaved')).toBe(false);
    } finally { stop(); observer.dispose(); control.dispose(); }
  });
  it('advertises only existing observer reads and keeps writes, recovery and navigation unavailable', () => {
    const status = vi.fn();
    const ws = new Socket();
    const createSocket = vi.fn(() => ws as unknown as WebSocket);
    const client = createBrowserClient(status, createSocket, 'http://127.0.0.1:1234');
    expect(client.capabilities).toEqual({
      actions: ['getSettings', 'requestAgentDetail'], recoveryState: 'unavailable',
    });
    expect(createSocket).not.toHaveBeenCalled();
    const unsubscribe = connectOffice(client, vi.fn());
    try {
      ws.open();
      expect(createSocket).toHaveBeenCalledExactlyOnceWith('ws://127.0.0.1:1234/office');
      expect(client.getState()).toBeUndefined();
      expect(() => client.setState({})).toThrow('disabled in this read-only observer');
      const count = ws.send.mock.calls.length;
      const unsupported = [
        { type: 'saveLayout' as const, layout },
        { type: 'addAssetDirectory' as const },
        { type: 'importLayout' as const },
        { type: 'exportLayout' as const },
        { type: 'focusAgent' as const, agentId: 'fixture' },
      ];
      for (const message of unsupported) {
        expect(client.capabilities.actions).not.toContain(message.type);
        client.send(message);
        expect(status).toHaveBeenLastCalledWith('Read-only: this operation is unavailable; nothing was saved or launched.');
      }
      expect(ws.send).toHaveBeenCalledTimes(count);
    } finally { unsubscribe(); client.dispose(); }
  });

  it('describes opted-in control without enabling native actions or bypassing readiness', () => {
    const f = controlled();
    try {
      expect([...f.client.capabilities.actions].sort()).toEqual([
        'getSettings', 'requestAgentDetail',
        'saveLayout', 'saveAgentSeats', 'setSoundEnabled', 'setDebugEnabled', 'setShowAreas',
        'importLayout', 'exportLayout', 'exportLayoutSnapshot',
      ].sort());
      expect(f.client.capabilities.recoveryState).toBe('browser-storage');
      expect(Object.isFrozen(f.client.capabilities)).toBe(true);
      expect(Object.isFrozen(f.client.capabilities.actions)).toBe(true);
      f.client.send({ type: 'saveLayout', layout });
      expect(f.sockets[0].send).not.toHaveBeenCalled();
      expect(f.received).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'layoutError', error: expect.stringContaining('not ready'),
      }));
      f.ready();
      const count = f.sockets[0].send.mock.calls.length;
      f.client.send({ type: 'openSquadAgent', agentId: 'fixture' });
      f.client.send({ type: 'removeAssetDirectory', directory: 'fixture' });
      expect(f.sockets[0].send).toHaveBeenCalledTimes(count);
    } finally { f.unsubscribe(); f.client.dispose(); }
  });

  it('clears task-derived displays on disconnect without granting authority or replaying old snapshots', async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const client = createBrowserClient(vi.fn(), () => {
      const ws = new Socket(); sockets.push(ws); return ws as unknown as WebSocket;
    }, 'http://127.0.0.1:1234');
    const received = vi.fn();
    const unsubscribe = connectOffice(client, received);
    try {
      sockets[0].open();
      sockets[0].onmessage?.({ data: JSON.stringify({ version: 1, kind: 'office',
        message: { type: 'observedTasks', snapshot: { sessionId: 'fixture', limited: false, tasks: [] } } }) });
      sockets[0].onclose?.();
      expect(received).toHaveBeenLastCalledWith({
        type: 'observedTasks', snapshot: { sessionId: null, tasks: [], limited: false },
      });
      const count = received.mock.calls.length;
      await vi.advanceTimersByTimeAsync(500);
      sockets[1].open();
      expect(received).toHaveBeenCalledTimes(count);
      expect(sockets[1].send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
        version: 1, kind: 'office', message: { type: 'webviewReady' },
      }));
    } finally { unsubscribe(); client.dispose(); }
  });
  it('accepts whitelisted live observation frames without granting consent or terminal/control authority', () => {
    const ws = new Socket();
    const client = createBrowserClient(vi.fn(), () => ws as unknown as WebSocket, 'http://127.0.0.1:1234');
    const received = vi.fn();
    const unsubscribe = connectOffice(client, received);
    try {
      ws.open();
      const messages = [
        { type: 'agentToolStart', agentId: 'ada', toolId: 'one', tool: 'view', status: 'Reading fixture.ts' },
        { type: 'agentToolDone', agentId: 'ada', toolId: 'one', tool: 'view' },
        { type: 'agentContextUsage', agentId: 'ada', contextTokens: 800, maxContextTokens: 1000 },
        { type: 'observedTasks', snapshot: { sessionId: 'fixture', limited: false, tasks: [] } },
        { type: 'agentToolsClear', agentId: 'ada' },
        { type: 'agentContextUsage', agentId: 'ada', contextTokens: null, maxContextTokens: null },
      ];
      for (const message of messages) {
        ws.onmessage?.({ data: JSON.stringify({ version: 1, kind: 'office', message }) });
        expect(received).toHaveBeenLastCalledWith(message);
      }
      const count = ws.send.mock.calls.length;
      client.send({ type: 'setLiveActivity', enabled: true });
      client.send({ type: 'setShowAreas', enabled: true });
      expect(ws.send).toHaveBeenCalledTimes(count);
    } finally { unsubscribe(); client.dispose(); }
  });
  function controlled(storage = new Map<string, string>()) {
    const sockets: Socket[] = [];
    const preferenceDraft = vi.fn();
    const storageApi = { getItem: (key: string) => storage.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }) };
    const client = createBrowserClient(vi.fn(), () => {
      const ws = new Socket(); sockets.push(ws); return ws as unknown as WebSocket;
    }, 'http://127.0.0.1:1234', {
      recoveryKey: 'squad-office:server-1:project-1',
      storage: storageApi, onPreferenceDraft: preferenceDraft,
    });
    const received = vi.fn();
    const unsubscribe = connectOffice(client, received);
    const frame = (value: unknown) => sockets.at(-1)!.onmessage?.({ data: JSON.stringify(value) });
    const ready = () => {
      sockets.at(-1)!.open();
      frame({ version: 1, kind: 'controlState', preferencesRevision: null, preferences: defaultPreferences() });
    };
    return { client, sockets, storage, storageApi, preferenceDraft, received, unsubscribe, frame, ready };
  }

  it('downloads the validated visible draft locally without sending a server mutation', () => {
    vi.useFakeTimers();
    const f = controlled();
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:office-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    try {
      const protection = new LayoutDraft();
      protection.receive(layout, 'external', 'a'.repeat(64), 'project-1');
      f.client.setState(protection.state);
      f.client.send({ type: 'exportLayout' });
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
      const anchor = download.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe('squad-pod-layout.json');
      expect(anchor.href).toBe('blob:office-export');
      expect(f.sockets[0].send).not.toHaveBeenCalled();
      vi.runOnlyPendingTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:office-export');
      const invalid = { ...layout, sourcePath: '../private' };
      f.client.send({ type: 'exportLayoutSnapshot', layout: invalid });
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(f.received).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'layoutError', error: 'No valid layout draft to export.',
      }));
    } finally { download.mockRestore(); vi.unstubAllGlobals(); f.unsubscribe(); f.client.dispose(); }
  });

  it('imports only explicit browser files within existing schema and size limits without saving', async () => {
    const f = controlled();
    let input: HTMLInputElement | undefined;
    const select = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { input = this; });
    const before = f.client.getState();
    async function choose(value: unknown, size = 100) {
      f.client.send({ type: 'importLayout' });
      expect(input?.type).toBe('file');
      expect(input?.accept).toBe('.json,application/json');
      Object.defineProperty(input, 'files', { value: [{ size, text: () => Promise.resolve(JSON.stringify(value)) }] });
      input!.dispatchEvent(new Event('change'));
      await Promise.resolve();
      await Promise.resolve();
    }
    try {
      await choose(layout);
      expect(f.received).toHaveBeenLastCalledWith({
        type: 'layoutLoaded', layout, revision: null, workspaceRoot: '', source: 'import',
      });
      await choose({ ...layout, sourcePath: '../private' });
      expect(f.received).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'layoutError', error: 'Invalid or unreadable import; existing draft retained.',
      }));
      await choose(layout, 2 * 1024 * 1024 + 1);
      expect(f.received).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'layoutError', error: 'Import exceeds 2 MiB; draft retained.',
      }));
      expect(f.sockets[0].send).not.toHaveBeenCalled();
      expect(f.client.getState()).toEqual(before);
    } finally { select.mockRestore(); f.unsubscribe(); f.client.dispose(); }
  });

  it('retains failed preference changes for explicit export/retry and surfaces recovery quota failure', () => {
    const f = controlled();
    try {
      f.ready();
      f.client.send({ type: 'setShowAreas', enabled: true });
      f.frame({ version: 1, kind: 'office', message: { type: 'layoutError', error: 'Storage failed' } });
      expect(f.preferenceDraft).toHaveBeenLastCalledWith({ type: 'setShowAreas', enabled: true });
      const raw = f.storage.get('squad-office:server-1:project-1:preferences')!;
      expect(JSON.parse(raw)).toEqual({ type: 'setShowAreas', enabled: true });
      expect(raw).not.toMatch(/token|credential|cookie/i);
      f.client.discardPreferenceDraft();
      expect(f.preferenceDraft).toHaveBeenLastCalledWith(null);
      f.storageApi.setItem.mockImplementationOnce(() => { throw new Error('fixture quota'); });
      const count = f.sockets[0].send.mock.calls.length;
      f.client.send({ type: 'setDebugEnabled', enabled: true });
      expect(f.sockets[0].send).toHaveBeenCalledTimes(count);
      expect(f.preferenceDraft).toHaveBeenLastCalledWith({ type: 'setDebugEnabled', enabled: true });
      expect(f.received).toHaveBeenCalledWith(expect.objectContaining({ type: 'layoutError', error: expect.stringContaining('export') }));
    } finally { f.unsubscribe(); f.client.dispose(); }
  });

  it('retains a disconnected seat attempt across reconnect and reload without replaying it', async () => {
    vi.useFakeTimers();
    const f = controlled();
    const draft = { type: 'saveAgentSeats' as const, seats: { 'test-agent-1': 'attempted-seat' } };
    const key = 'squad-office:server-1:project-1:preferences';
    try {
      f.client.send(draft);
      expect(f.sockets[0].send).not.toHaveBeenCalled();
      expect(JSON.parse(f.storage.get(key)!)).toEqual(draft);
      f.ready();
      expect(f.sockets[0].send).toHaveBeenCalledTimes(1);
      f.frame({ version: 1, kind: 'office', message: { type: 'existingAgents', agents: [{
        id: 'test-agent-1', name: 'Test', role: 'Developer', paletteIndex: 0,
        seatId: null, status: 'idle', currentTask: null,
      }] } });
      f.sockets[0].readyState = 3;
      f.sockets[0].onclose?.();
      f.client.send(draft);
      expect(JSON.parse(f.storage.get(key)!)).toEqual(draft);
      expect(f.preferenceDraft).toHaveBeenLastCalledWith(draft);
      expect(f.received.mock.calls.at(-2)![0]).toMatchObject({
        type: 'existingAgents', agents: [expect.objectContaining({ seatId: null })],
      });
      await vi.advanceTimersByTimeAsync(500);
      f.ready();
      expect(f.sockets[1].send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
        version: 1, kind: 'office', message: { type: 'webviewReady' },
      }));
      f.unsubscribe(); f.client.dispose();
      const restored = controlled(f.storage);
      try {
        expect(restored.preferenceDraft).toHaveBeenLastCalledWith(draft);
        restored.ready();
        expect(restored.sockets[0].send).toHaveBeenCalledTimes(1);
        expect(JSON.parse(f.storage.get(key)!)).toEqual(draft);
      } finally { restored.unsubscribe(); restored.client.dispose(); }
    } finally { f.unsubscribe(); f.client.dispose(); }
  });

  it('rejects and reconciles a second preference while preserving the first in-flight draft', () => {
    const f = controlled();
    const key = 'squad-office:server-1:project-1:preferences';
    try {
      f.ready();
      f.frame({ version: 1, kind: 'office', message: { type: 'existingAgents', agents: [{
        id: 'test-agent-1', name: 'Test', role: 'Developer', paletteIndex: 0,
        seatId: null, status: 'idle', currentTask: null,
      }] } });
      const first = { type: 'setShowAreas' as const, enabled: true };
      f.client.send(first);
      f.client.send({ type: 'saveAgentSeats', seats: { 'test-agent-1': 'rejected-seat' } });
      expect(f.sockets[0].send).toHaveBeenCalledTimes(2);
      expect(JSON.parse(f.storage.get(key)!)).toEqual(first);
      expect(f.preferenceDraft).toHaveBeenLastCalledWith(first);
      expect(f.received.mock.calls.at(-2)![0]).toMatchObject({
        type: 'existingAgents', agents: [expect.objectContaining({ seatId: null })],
      });
      expect(f.received).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'layoutError', error: expect.stringContaining('rejected, not retained'),
      }));
      f.client.discardPreferenceDraft();
      expect(JSON.parse(f.storage.get(key)!)).toEqual(first);
      const preferences = defaultPreferences();
      preferences.settings.showAreas = true;
      f.frame({ version: 1, kind: 'controlState', preferencesRevision: 'b'.repeat(64), preferences });
      f.frame({ version: 1, kind: 'controlResult', requestId: 1,
        messages: [{ type: 'settingsLoaded', ...preferences.settings }] });
      expect(f.preferenceDraft).toHaveBeenLastCalledWith(null);
      expect(JSON.parse(f.storage.get(key)!)).toBeNull();
      expect(f.sockets[0].send).toHaveBeenCalledTimes(2);
    } finally { f.unsubscribe(); f.client.dispose(); }
  });

  it('only acknowledges a matching in-flight save and never replays mutations after disconnect', async () => {
    vi.useFakeTimers();
    const f = controlled();
    try {
      f.ready();
      f.received.mockClear();
      f.client.send({ type: 'saveLayout', layout, expectedRevision: null, workspaceRoot: 'selected-project' });
      const sent = JSON.parse(f.sockets[0].send.mock.calls.at(-1)![0] as string);
      expect(sent).toMatchObject({ kind: 'control', requestId: 1, expectedRevision: null });
      f.frame({ version: 1, kind: 'controlResult', requestId: 99, messages: [{ type: 'layoutSaved', layout, revision: 'a'.repeat(64) }] });
      expect(f.received).not.toHaveBeenCalled();
      f.sockets[0].onclose?.();
      expect(f.received).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'layoutError', error: expect.stringContaining('Draft retained') }));
      await vi.advanceTimersByTimeAsync(500);
      f.ready();
      expect(f.sockets[1].send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ version: 1, kind: 'office', message: { type: 'webviewReady' } }));
      const count = f.received.mock.calls.length;
      f.frame({ version: 1, kind: 'controlResult', requestId: 1, messages: [{ type: 'layoutSaved', layout, revision: 'a'.repeat(64) }] });
      expect(f.received).toHaveBeenCalledTimes(count);
      f.client.send({ type: 'setShowAreas', enabled: true });
      f.frame({ version: 1, kind: 'controlState', preferencesRevision: 'b'.repeat(64),
        preferences: { ...defaultPreferences(), settings: { soundEnabled: false, debugEnabled: false, showAreas: true } } });
      f.frame({ version: 1, kind: 'controlResult', requestId: 2, messages: [{ type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: true }] });
      expect(f.received).toHaveBeenLastCalledWith({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: true });
    } finally { f.unsubscribe(); f.client.dispose(); }
  });

  it('updates seats and settings from the same authoritative revision before a detail-interleaved seat write', () => {
    const f = controlled();
    try {
      f.ready();
      const agents = ['test-agent-1', 'test-agent-2'].map(id => ({
        id, name: id, role: 'Developer', paletteIndex: 0, seatId: 'old-seat', status: 'idle', currentTask: null,
      }));
      f.frame({ version: 1, kind: 'office', message: { type: 'existingAgents', agents } });
      f.client.send({ type: 'requestAgentDetail', agentId: 'test-agent-1', requestId: 'detail-a' });
      f.frame({ version: 1, kind: 'controlState', preferencesRevision: 'a'.repeat(64),
        preferences: { ...defaultPreferences(), agents: { 'test-agent-2': { seatId: 'viewer-b-seat' } } } });
      expect(f.received).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'existingAgents', agents: [
          expect.objectContaining({ id: 'test-agent-1', seatId: null }),
          expect.objectContaining({ id: 'test-agent-2', seatId: 'viewer-b-seat' }),
        ],
      }));
      const last = f.received.mock.calls.at(-1)![0] as { agents: Array<{ id: string; seatId: string | null }> };
      const seats = Object.fromEntries(last.agents.filter(agent => agent.seatId).map(agent => [agent.id, agent.seatId!]));
      seats['test-agent-1'] = 'viewer-a-seat';
      f.client.send({ type: 'saveAgentSeats', seats });
      expect(JSON.parse(f.sockets[0].send.mock.calls.at(-1)![0] as string)).toMatchObject({
        expectedRevision: 'a'.repeat(64),
        message: { seats: { 'test-agent-1': 'viewer-a-seat', 'test-agent-2': 'viewer-b-seat' } },
      });
    } finally { f.unsubscribe(); f.client.dispose(); }
  });

  it('retains recoverable layout drafts in project/server-scoped storage without credentials', () => {
    const f = controlled();
    try {
      const protection = new LayoutDraft();
      protection.receive(layout, 'external', 'a'.repeat(64), 'project-1');
      protection.capture({ ...layout, pets: [{ id: 'test-pet', petType: 0 }] });
      f.client.setState(protection.state);
      const raw = f.storage.get('squad-office:server-1:project-1')!;
      expect(JSON.parse(raw).draft.pets).toEqual([{ id: 'test-pet', petType: 0 }]);
      expect(raw).not.toMatch(/token|credential|cookie/i);
      expect(new LayoutDraft(f.client.getState()).dirty).toBe(true);
      expect(f.storage.size).toBe(1);
      expect(() => f.client.setState({ invalid: true })).toThrow('malformed');
      expect(f.storage.get('squad-office:server-1:project-1')).toBe(raw);
    } finally { f.unsubscribe(); f.client.dispose(); }
  });

  it('surfaces disconnected changes and single-flight rejection rather than queueing them', () => {
    const f = controlled();
    try {
      f.client.send({ type: 'saveLayout', layout, expectedRevision: null, workspaceRoot: 'project-1' });
      expect(f.sockets[0].send).not.toHaveBeenCalled();
      expect(f.received).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'layoutError', error: expect.stringContaining('not sent') }));
      f.ready();
      f.client.send({ type: 'setShowAreas', enabled: true });
      f.client.send({ type: 'setDebugEnabled', enabled: true });
      expect(f.sockets[0].send).toHaveBeenCalledTimes(2);
      expect(f.received).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'layoutError', error: expect.stringContaining('unresolved') }));
    } finally { f.unsubscribe(); f.client.dispose(); }
  });

  it('subscribes before initial and reconnect snapshots without launching anything', async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const status = vi.fn();
    const client = createBrowserClient(status, url => {
      expect(url).toBe('ws://127.0.0.1:1234/office');
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }, 'http://127.0.0.1:1234');
    const received = vi.fn();
    const unsubscribe = connectOffice(client, received);
    expect(sockets[0].send).not.toHaveBeenCalled();
    sockets[0].open();
    const ready = JSON.stringify({ version: 1, kind: 'office', message: { type: 'webviewReady' } });
    expect(sockets[0].send).toHaveBeenCalledExactlyOnceWith(ready);
    sockets[0].onmessage?.({ data: JSON.stringify({ version: 1, kind: 'office', message: {
      type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: false,
    } }) });
    expect(received).toHaveBeenCalledOnce();
    sockets[0].onclose?.();
    await vi.advanceTimersByTimeAsync(500);
    sockets[1].open();
    expect(sockets[1].send).toHaveBeenCalledExactlyOnceWith(ready);
    unsubscribe();
    client.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].close).toHaveBeenCalledOnce();
  });

  it('surfaces blocked writes, invalid frames, disconnected reads and unavailable recovery', () => {
    const socket = new Socket();
    const status = vi.fn();
    const client = createBrowserClient(status, () => socket as unknown as WebSocket, 'http://127.0.0.1:1234');
    const unsubscribe = client.subscribe(() => {});
    client.send({ type: 'saveAgentSeats', seats: {} });
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('nothing was saved'));
    expect(socket.send).not.toHaveBeenCalled();
    client.send({ type: 'getSettings' });
    expect(status).toHaveBeenLastCalledWith('Disconnected - request not sent');
    socket.open();
    socket.onmessage?.({ data: '{"version":2,"kind":"office","message":{}}' });
    expect(socket.close).toHaveBeenCalledWith(1002, 'Invalid server frame');
    expect(() => client.setState({})).toThrow('disabled');
    expect(client.getState()).toBeUndefined();
    unsubscribe();
    client.dispose();
  });
});
