/// <reference types="vite/client" />
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.js';
import { createHostClientFixture, type HostClientFixture } from '../__tests__/hostClientFixture.js';
import { CANVAS_OBSERVER_CAPABILITIES } from '../../../src/core/hostCapabilities.js';
import type { OutboundMessage } from '../../../src/types.js';
import { createBrowserClient } from '../standalone/browserClient.js';
import { CANVAS_CHARTER_UNAVAILABLE, CANVAS_HOST_BUSY, createHostBridge, HOST_UNAVAILABLE } from './hostBridge.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** Structural view of standalone/src/canvas/charterOffice.fixture.ts (Node-side; resolved only at test runtime). */
interface CharterOffice {
  handle: { available?: () => { charter: boolean; usage: boolean; export: boolean } };
  request: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  state: { opens: Array<{ instanceId: string; path: string }>; lists: number; snapshots: number; metrics: number;
    openBehavior: 'open' | 'reject' | 'hang'; onOpen?: () => Promise<void>; onMetrics?: () => Promise<void> };
  agents: Array<Extract<OutboundMessage, { type: 'existingAgents' }>['agents'][number]>;
  root: string;
  cleanup: () => Promise<void>;
}
// import.meta.glob is resolved by Vite at test time but not followed by tsc, keeping the Node-only fixture out of the webview type graph.
const fixtureLoaders = import.meta.glob<{ createCharterOffice(base: string): Promise<CharterOffice> }>('../../../standalone/src/canvas/charterOffice.fixture.ts');
async function createCharterOffice(base: string): Promise<CharterOffice> {
  const loaders = Object.values(fixtureLoaders);
  if (loaders.length !== 1) throw new Error('charter office fixture not found');
  const module = await loaders[0]();
  return module.createCharterOffice(base);
}

class Socket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
}

/**
 * NA-012-CHARTER-001: one read-only Project A office, real host capability handler,
 * real browser bridge and client, and the visible App View Charter control.
 */
describe('Canvas charter fault isolation across members of one office', () => {
  let office: CharterOffice;
  let host: HTMLDivElement;
  let root: Root;
  let fixture: HostClientFixture;
  let browser: ReturnType<typeof createBrowserClient>;
  let statuses: string[];
  let reported: string[];
  let disposed: boolean;

  beforeEach(async () => {
    office = await createCharterOffice(process.cwd());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    statuses = [];
    reported = [];
    disposed = false;
    let rerender: (status: string) => void = () => {};
    const status = (value: string) => { statuses.push(value); rerender(value); };
    const bridge = createHostBridge((url, init) => office.request(url, init), () => disposed,
      reason => reported.push(reason), office.handle.available!());
    browser = createBrowserClient(status, () => new Socket() as unknown as WebSocket,
      'http://127.0.0.1:1234', undefined, true, bridge);
    const base = createHostClientFixture();
    fixture = { ...base, capabilities: CANVAS_OBSERVER_CAPABILITIES, canvasHost: browser.canvasHost,
      send: vi.fn(message => { base.send(message); if (message.type === 'openSquadAgent') browser.send(message); }) };
    function Shell() {
      const [value, setValue] = useState('');
      rerender = setValue;
      return <><span role="status" data-testid="host-status">{value}</span><App client={fixture} canvas readOnly /></>;
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Shell />));
    const emit = (message: OutboundMessage) => act(() => fixture.emit(message));
    emit({ type: 'layoutLoaded', layout: { version: 2, cols: 20, rows: 15, tiles: Array(300).fill(1), furniture: [] },
      revision: 'canvas', source: 'external', workspaceRoot: 'project-a' });
    emit({ type: 'sourceStatus', status: { workspaceRoot: 'project-a', squadDir: 'project-a/.squad', teamFound: true,
      observer: 'watching', nativeWatch: false, error: null, liveActivity: { state: 'off', sessionId: null } } });
    emit({ type: 'existingAgents', agents: office.agents });
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    const toggle = [...host.querySelectorAll('button')].find(button => button.textContent === 'Show office labels');
    act(() => toggle!.click());
  });
  afterEach(async () => {
    act(() => root.unmount());
    host.remove();
    browser.dispose();
    vi.restoreAllMocks();
    await office.cleanup();
  });

  function select(id: string) {
    const label = host.querySelector<HTMLButtonElement>(`[data-agent-label="${id}"]`);
    expect(label, id).not.toBeNull();
    act(() => label!.click());
    const request = vi.mocked(fixture.send).mock.calls.map(([message]) => message)
      .filter(message => message.type === 'requestAgentDetail').at(-1);
    expect(request?.agentId).toBe(id);
    const agent = office.agents.find(a => a.id === id)!;
    act(() => fixture.emit({ type: 'agentDetailLoaded', requestId: request?.requestId, detail: {
      id, name: agent.name, role: agent.role, workspaceRoot: 'project-a', status: 'idle', currentTask: null,
      charterSummary: null, charterContent: null, charterStatus: id === 'amber-a' ? 'available' : 'unavailable',
      expertise: null, responsibilities: null, boundaries: null, recentActivity: [], lastActiveAt: 0,
      lastActiveAtStatus: 'unobserved',
    } }));
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === 'View Charter');
    expect(button, `${id} View Charter`).toBeDefined();
    return button!;
  }
  async function view(id: string, count: number) {
    const button = select(id);
    expect(button.disabled, `${id} reachable`).toBe(false);
    act(() => button.click());
    await act(async () => { await vi.waitFor(() => expect(statuses.length + office.state.opens.length).toBe(count)); });
  }

  it('opens Amber, reports Cedar as a member refusal, and leaves Amber reachable and openable without reload', async () => {
    await view('amber-a', 1);
    expect(office.state.opens.map(open => open.path)).toEqual(['project-a/.squad/agents/amber-a/charter.md']);
    expect(statuses).toEqual([]);

    await view('cedar-a', 2);
    expect(statuses).toEqual([CANVAS_CHARTER_UNAVAILABLE]);
    expect(reported).toEqual([CANVAS_CHARTER_UNAVAILABLE]);
    expect(host.querySelector('[data-testid="host-status"]')?.textContent).toBe(CANVAS_CHARTER_UNAVAILABLE);
    expect(office.state.opens).toHaveLength(1);
    expect(office.handle.available!().charter).toBe(true);
    expect(browser.canvasHost!.charter).toBe(true);

    await view('amber-a', 3);
    expect(office.state.opens.map(open => open.path)).toEqual([
      'project-a/.squad/agents/amber-a/charter.md', 'project-a/.squad/agents/amber-a/charter.md']);
    expect(office.state.lists).toBe(2);
    expect(JSON.stringify(statuses) + host.textContent).not.toContain(office.root);
  });

  it('still disables View Charter for every member after a genuine Editor rejection, without retry', async () => {
    office.state.openBehavior = 'reject';
    await view('amber-a', 2);
    expect(statuses).toEqual([HOST_UNAVAILABLE]);
    expect(reported).toEqual([HOST_UNAVAILABLE]);
    expect(office.handle.available!().charter).toBe(false);
    expect(browser.canvasHost!.charter).toBe(false);
    expect(select('amber-a').disabled).toBe(true);
    expect(select('cedar-a').disabled).toBe(true);
    expect(office.state.opens).toHaveLength(1);
    expect(JSON.stringify(statuses) + host.textContent).not.toContain('SECRET');
  });

  const gate = () => { let open!: () => void; const wait = new Promise<void>(resolve => { open = resolve; }); return { wait: () => wait, open }; };
  const amberPath = 'project-a/.squad/agents/amber-a/charter.md';
  function expectAllAvailable() {
    expect(office.handle.available!()).toEqual({ charter: true, usage: true, export: false });
    expect([browser.canvasHost!.charter, browser.canvasHost!.usage]).toEqual([true, true]);
    expect(select('amber-a').disabled).toBe(false);
    expect(select('cedar-a').disabled).toBe(false);
  }

  it('#232 A: a double-click on Amber View Charter opens one Editor with no error and keeps View Charter enabled', async () => {
    const editor = gate();
    office.state.onOpen = editor.wait;
    const button = select('amber-a');
    act(() => { button.click(); button.click(); });
    await act(async () => { await vi.waitFor(() => expect(office.state.opens).toHaveLength(1)); });
    editor.open();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(office.state.opens.map(open => open.path)).toEqual([amberPath]);
    expect([office.state.snapshots, office.state.lists]).toEqual([1, 1]);
    expect(statuses).toEqual([]);
    expect(reported).toEqual([]);
    expectAllAvailable();
    office.state.onOpen = undefined;
    await view('amber-a', 2);
    expect(statuses).toEqual([]);
  });

  it('#232 B: View Charter while a usage Refresh is in flight sends nothing and keeps every capability', async () => {
    const metrics = gate();
    office.state.onMetrics = metrics.wait;
    const usage = browser.canvasHost!.getUsage();
    await vi.waitFor(() => expect(office.state.metrics).toBe(1));
    const amber = select('amber-a'); act(() => amber.click());
    await act(async () => { await vi.waitFor(() => expect(statuses).toHaveLength(1)); });
    expect(statuses).toEqual([CANVAS_HOST_BUSY]);
    expect(reported).toEqual([CANVAS_HOST_BUSY]);
    expect(host.querySelector('[data-testid="host-status"]')?.textContent).toBe(CANVAS_HOST_BUSY);
    expect([office.state.snapshots, office.state.lists, office.state.opens.length]).toEqual([0, 0, 0]);
    metrics.open();
    await expect(usage).resolves.toEqual([{ label: 'User-initiated API requests', value: 3, unit: 'requests' }]);
    expectAllAvailable();
    await view('amber-a', 2);
    expect(office.state.opens.map(open => open.path)).toEqual([amberPath]);
  });

  it('#232 C: usage Refresh while a charter open is in flight is refused without disabling usage', async () => {
    const editor = gate();
    office.state.onOpen = editor.wait;
    const amber = select('amber-a'); act(() => amber.click());
    await act(async () => { await vi.waitFor(() => expect(office.state.opens).toHaveLength(1)); });
    const panel = () => {
      if (!host.querySelector('[aria-label="Joined-session usage"]')) {
        act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Telemetry')!.click());
      }
      return host.querySelector<HTMLElement>('[aria-label="Joined-session usage"]')!;
    };
    const usage = panel();
    expect(usage).not.toBeNull();
    const refresh = () => [...usage.querySelectorAll('button')].find(b => b.textContent === 'Refresh joined-session usage')!;
    act(() => refresh().click());
    await act(async () => { await vi.waitFor(() => expect(reported).toHaveLength(1)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(usage.querySelector('[role="status"]')?.textContent).toBe(CANVAS_HOST_BUSY);
    expect(usage.querySelector('[role="alert"]')).toBeNull();
    expect(refresh().disabled).toBe(false);
    expect(office.state.metrics).toBe(0);
    editor.open();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(reported).toEqual([CANVAS_HOST_BUSY]);
    expect(statuses).toEqual([]);
    expectAllAvailable();
    const again = panel();
    act(() => [...again.querySelectorAll('button')].find(b => b.textContent === 'Refresh joined-session usage')!.click());
    await act(async () => { await vi.waitFor(() => expect(office.state.metrics).toBe(1)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(again.textContent).toContain('User-initiated API requests: 3 requests');
  });

  it('#232 another viewer of the same instance gets a typed server busy refusal and keeps its capabilities', async () => {
    const editor = gate();
    office.state.onOpen = editor.wait;
    const amber = select('amber-a'); act(() => amber.click());
    await act(async () => { await vi.waitFor(() => expect(office.state.opens).toHaveLength(1)); });
    const otherReports: string[] = [];
    const other = createHostBridge((url, init) => office.request(url, init), () => false,
      reason => otherReports.push(reason), office.handle.available!());
    await expect(other.openCharter('amber-a')).rejects.toThrow(CANVAS_HOST_BUSY);
    await expect(other.getUsage()).rejects.toThrow(CANVAS_HOST_BUSY);
    expect(otherReports).toEqual([CANVAS_HOST_BUSY, CANVAS_HOST_BUSY]);
    expect([other.charter, other.usage]).toEqual([true, true]);
    expect([office.state.snapshots, office.state.opens.length, office.state.metrics]).toEqual([1, 1, 0]);
    editor.open();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(statuses).toEqual([]);
    expectAllAvailable();
    await expect(other.openCharter('amber-a')).resolves.toBeUndefined();
    expect(office.state.opens).toHaveLength(2);
  });
  it('treats a refusal that lands after disposal as a host failure, not a member refusal', async () => {
    const button = select('cedar-a');
    const pending = office.request;
    office.request = async (url, init) => { const reply = await pending(url, init); disposed = true; return reply; };
    act(() => button.click());
    await act(async () => { await vi.waitFor(() => expect(statuses).toHaveLength(1)); });
    expect(statuses).toEqual([HOST_UNAVAILABLE]);
    expect(reported).toEqual([HOST_UNAVAILABLE]);
    expect(browser.canvasHost!.charter).toBe(false);
  });
});
