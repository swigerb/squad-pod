import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { createHostClientFixture } from './__tests__/hostClientFixture.js';
import { OfficeState } from './office/engine/officeState.js';
import type { LayoutRecovery } from './office/editor/layoutDraft.js';
import type { OfficeLayout } from './office/types.js';
import type { OutboundMessage } from '../../src/types.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('mounted office state ownership (synthetic independent hosts)', () => {
  const views: ReturnType<typeof view>[] = [];
  function view() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const client = createHostClientFixture();
    let recovery: LayoutRecovery | undefined;
    vi.mocked(client.getState).mockImplementation(() => recovery);
    vi.spyOn(client, 'setState').mockImplementation(value => {
      recovery = structuredClone(value) as LayoutRecovery;
      return value;
    });
    let root: Root | null = null;
    const mount = () => {
      root = createRoot(host);
      act(() => root!.render(<App client={client} />));
    };
    const unmount = () => {
      act(() => root?.unmount());
      root = null;
    };
    const emit = (message: OutboundMessage) => act(() => client.emit(message));
    const button = (text: string) => {
      const found = [...host.querySelectorAll('button')].find(item => item.textContent === text);
      expect(found, text).toBeDefined();
      return found!;
    };
    return {
      host, client, mount, unmount, emit, button,
      click: (text: string) => act(() => button(text).click()),
      recovery: () => structuredClone(recovery),
    };
  }
  const layout = (cols: number): OfficeLayout => ({
    version: 2, cols, rows: 15, tiles: Array(cols * 15).fill(1), furniture: [],
  });
  const initialize = (office: ReturnType<typeof view>, cols: number, name: string) => {
    office.emit({ type: 'sourceStatus', status: {
      workspaceRoot: name, squadDir: `${name}/.squad`, teamFound: true,
      observer: 'watching', nativeWatch: false, error: null,
    } });
    office.emit({ type: 'layoutLoaded', layout: layout(cols), revision: name, workspaceRoot: name });
    office.emit({ type: 'existingAgents', agents: [{
      id: name, name, role: 'Developer', paletteIndex: 0, seatId: null,
      status: 'idle', currentTask: null,
    }] });
  };
  const frame = async () => {
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
  };
  const instance = (context: unknown): OfficeState => {
    expect(context).toBeInstanceOf(OfficeState);
    return context as OfficeState;
  };
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    for (const office of views.splice(0)) {
      office.unmount();
      office.host.remove();
    }
    vi.restoreAllMocks();
  });

  it('separates real canvas rosters, editor tools, layout history, recovery and outbound messages', async () => {
    const rebuild = vi.spyOn(OfficeState.prototype, 'rebuildFromLayout');
    const a = view(), b = view();
    views.push(a, b);
    a.mount();
    initialize(a, 20, 'alpha');
    b.mount();
    expect(b.host.textContent).toContain('Loading office...');
    initialize(b, 25, 'beta');
    await frame();
    const stateA = instance(rebuild.mock.contexts[0]);
    const stateB = instance(rebuild.mock.contexts[1]);
    expect(stateA).not.toBe(stateB);
    expect([...stateA.characters.keys()]).toEqual(['alpha']);
    expect([...stateB.characters.keys()]).toEqual(['beta']);
    expect(a.host.querySelector('[data-agent-label="alpha"]')).not.toBeNull();
    expect(a.host.querySelector('[data-agent-label="beta"]')).toBeNull();
    expect(b.host.querySelector('[data-agent-label="beta"]')).not.toBeNull();
    expect(b.host.querySelector('[data-agent-label="alpha"]')).toBeNull();
    a.click('Edit Layout');
    b.click('Edit Layout');
    a.click('♥Pets');
    expect(a.host.querySelector('[title="Pets"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(b.host.querySelector('[title="Select"]')?.getAttribute('aria-pressed')).toBe('true');
    a.click('→');
    expect(stateA.layout.cols).toBe(21);
    expect(stateB.layout.cols).toBe(25);
    expect(a.recovery()?.draft?.cols).toBe(21);
    expect(b.recovery()?.draft?.cols).toBe(25);
    const untouchedB = b.recovery();
    b.click('Undo');
    expect(b.recovery()).toEqual(untouchedB);
    b.click('↓');
    expect(b.recovery()?.draft?.rows).toBe(16);
    a.click('Undo');
    expect(a.recovery()?.draft).toEqual(layout(20));
    expect(b.recovery()?.draft?.rows).toBe(16);
    a.click('Redo');
    a.click('● Save Layout');
    b.click('● Save Layout');
    const saves = (office: typeof a) => vi.mocked(office.client.send).mock.calls
      .map(([message]) => message).filter(message => message.type === 'saveLayout');
    expect(saves(a)).toEqual([expect.objectContaining({
      workspaceRoot: 'alpha', layout: expect.objectContaining({ cols: 21, rows: 15 }),
    })]);
    expect(saves(b)).toEqual([expect.objectContaining({
      workspaceRoot: 'beta', layout: expect.objectContaining({ cols: 25, rows: 16 }),
    })]);
    act(() => a.host.querySelector<HTMLButtonElement>('[data-agent-label="alpha"]')!.click());
    expect(a.client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'requestAgentDetail', agentId: 'alpha',
    }));
    expect(b.client.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'requestAgentDetail' }));
    for (const office of [a, b]) {
      expect(office.client.subscribe).toHaveBeenCalledOnce();
      expect(office.client.events.slice(0, 2)).toEqual(['subscribe', 'send:webviewReady']);
    }
  });

  it('keeps the surviving office live across peer source loss, unmount, fresh mount and recovery-read failure', async () => {
    const rebuild = vi.spyOn(OfficeState.prototype, 'rebuildFromLayout');
    const a = view(), b = view();
    views.push(a, b);
    a.mount();
    initialize(a, 20, 'alpha');
    b.mount();
    initialize(b, 25, 'beta');
    const stateA = instance(rebuild.mock.contexts[0]);
    const stateB = instance(rebuild.mock.contexts[1]);
    a.click('Edit Layout');
    a.click('♥Pets');
    a.click('→');
    b.click('Edit Layout');
    b.click('→');
    const survivingRecovery = b.recovery();
    a.emit({ type: 'sourceStatus', status: {
      workspaceRoot: 'alpha', squadDir: 'alpha/.squad', teamFound: false,
      observer: 'stopped', nativeWatch: false, error: null,
    } });
    a.emit({ type: 'existingAgents', agents: [] });
    expect(stateA.characters.size).toBe(0);
    expect([...stateB.characters.keys()]).toEqual(['beta']);
    expect(b.recovery()).toEqual(survivingRecovery);
    a.unmount();
    a.emit({ type: 'agentCreated', agent: { id: 'disposed', name: 'Disposed', role: 'Test', paletteIndex: 0 } });
    expect(stateA.characters.size).toBe(0);
    b.emit({ type: 'agentStatus', agentId: 'beta', status: 'active' });
    expect(stateB.characters.get('beta')?.active).toBe(true);
    b.click('Undo');
    expect(stateB.layout.cols).toBe(25);
    a.mount();
    expect(a.host.textContent).toContain('Loading office...');
    initialize(a, 20, 'alpha');
    const freshA = instance(rebuild.mock.contexts.at(-1));
    expect(freshA).not.toBe(stateA);
    expect(freshA).not.toBe(stateB);
    expect(freshA.layout.cols).toBe(21);
    expect(stateB.layout.cols).toBe(25);
    a.click('Edit Layout');
    expect(a.host.querySelector('[title="Select"]')?.getAttribute('aria-pressed')).toBe('true');
    a.unmount();
    vi.mocked(a.client.getState).mockImplementation(() => { throw new Error('synthetic recovery failure'); });
    vi.mocked(a.client.subscribe).mockClear();
    vi.mocked(a.client.send).mockClear();
    a.mount();
    expect(a.host.textContent).toContain('synthetic recovery failure');
    expect(a.client.subscribe).not.toHaveBeenCalled();
    expect(a.client.send).not.toHaveBeenCalled();
    b.click('Redo');
    expect(stateB.layout.cols).toBe(26);
    b.click('● Save Layout');
    expect(b.client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'saveLayout', workspaceRoot: 'beta', layout: expect.objectContaining({ cols: 26 }),
    }));
    await frame();
    expect(b.host.querySelector('[data-agent-label="beta"]')).not.toBeNull();
    expect(b.client.subscribe).toHaveBeenCalledOnce();
  });
});
