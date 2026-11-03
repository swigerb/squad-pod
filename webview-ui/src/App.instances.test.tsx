import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { createHostClientFixture } from './__tests__/hostClientFixture.js';
import { OfficeState } from './office/engine/officeState.js';
import * as gameLoop from './office/engine/gameLoop.js';
import * as renderer from './office/engine/renderer.js';
import type { LayoutRecovery } from './office/editor/layoutDraft.js';
import type { OfficeLayout, SpriteData } from './office/types.js';
import { CARPET_DEFAULT_COLOR, CARPET_DEFAULT_ACCENT_COLOR } from './constants.js';
import type { OutboundMessage } from '../../src/types.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('mounted office state ownership (synthetic independent hosts)', () => {
  const views: ReturnType<typeof view>[] = [];
  function view(strict = false) {
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
      act(() => root!.render(strict ? <StrictMode><App client={client} /></StrictMode> : <App client={client} />));
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
  const initialize = (office: ReturnType<typeof view>, cols: number, name: string, initial = layout(cols)) => {
    office.emit({ type: 'sourceStatus', status: {
      workspaceRoot: name, squadDir: `${name}/.squad`, teamFound: true,
      observer: 'watching', nativeWatch: false, error: null,
    } });
    office.emit({ type: 'layoutLoaded', layout: initial, revision: name, workspaceRoot: name });
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

  it('routes manifest carpets and real toolbar previews/availability to their own same-realm office', () => {
    const rebuild = vi.spyOn(OfficeState.prototype, 'rebuildFromLayout');
    const a = view(), b = view();
    views.push(a, b);
    a.mount(); initialize(a, 20, 'alpha');
    b.mount(); initialize(b, 20, 'beta');
    const stateA = instance(rebuild.mock.contexts[0]);
    const stateB = instance(rebuild.mock.contexts[1]);
    const sheet = (reverse: boolean): SpriteData[] => Array.from({ length: 16 },
      () => [reverse ? ['#eeeeee', '#111111'] : ['#111111', '#eeeeee']]);
    const load = (target: typeof a, carpets: SpriteData[][]) => target.emit({
      type: 'manifestAssetsLoaded',
      snapshot: { carpets, floors: [], walls: [], furniture: [], pets: [], directories: [], diagnostics: [] },
    });

    load(a, [sheet(false)]);
    load(b, [sheet(true), sheet(true)]);
    expect(stateA.carpetAssets.revision).toBe(1);
    expect(stateB.carpetAssets.revision).toBe(1);
    const previewA = vi.spyOn(stateA.carpetAssets, 'getCarpetPreview');
    const previewB = vi.spyOn(stateB.carpetAssets, 'getCarpetPreview');
    a.click('Edit Layout'); b.click('Edit Layout');
    a.click('▦Carpet'); b.click('▦Carpet');
    const style = (target: typeof a, n: number) => target.host.querySelector<HTMLButtonElement>(`[title="Carpet ${n}"]`)!;
    expect(style(a, 1).disabled).toBe(false);
    expect(style(a, 2).disabled).toBe(true);
    expect(style(b, 2).disabled).toBe(false);
    const resultA = previewA.mock.results.find((_, i) => previewA.mock.calls[i][0] === 0)!.value;
    const resultB = previewB.mock.results.find((_, i) => previewB.mock.calls[i][0] === 0)!.value;
    expect(resultA.flat().filter(Boolean).slice(0, 2)).toEqual(['#941919', '#dba35a']);
    expect(resultB.flat().filter(Boolean).slice(0, 2)).toEqual(['#dba35a', '#941919']);
    const stableB = stateB.carpetAssets.getCarpetSprite(0, 4);
    load(a, []);
    expect(style(a, 1).disabled).toBe(true);
    expect(a.host.textContent).toContain('Carpet style unavailable');
    expect(style(b, 1).disabled).toBe(false);
    expect(b.host.textContent).not.toContain('Carpet style unavailable');
    expect(stateB.carpetAssets.revision).toBe(1);
    expect(stateB.carpetAssets.getCarpetSprite(0, 4)).toBe(stableB);
    for (let i = 0; i < previewB.mock.calls.length; i++) {
      if (previewB.mock.calls[i][0] === 0) expect(previewB.mock.results[i].value).toEqual(resultB);
    }
    load(a, [sheet(false)]);
    expect(style(a, 1).disabled).toBe(false);
    expect(stateB.carpetAssets.getCarpetPreview(0, CARPET_DEFAULT_COLOR, CARPET_DEFAULT_ACCENT_COLOR)).toEqual(resultB);
  });

  it('routes floor/wall snapshots and real floor picker previews to the owning office', () => {
    const previewPixels = new WeakMap<HTMLCanvasElement, string[]>();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
      if (!this.closest('button[title^="Floor "]')) return null;
      const pixels: string[] = [];
      previewPixels.set(this, pixels);
      const ctx = {
        fillStyle: '', imageSmoothingEnabled: false,
        clearRect: () => { pixels.length = 0; },
        fillRect: () => { pixels.push(ctx.fillStyle); },
      };
      return ctx as unknown as CanvasRenderingContext2D;
    });
    const rebuild = vi.spyOn(OfficeState.prototype, 'rebuildFromLayout');
    const a = view(), b = view();
    views.push(a, b);
    a.mount(); initialize(a, 20, 'alpha');
    b.mount(); initialize(b, 20, 'beta');
    const stateA = instance(rebuild.mock.contexts[0]);
    const stateB = instance(rebuild.mock.contexts[1]);
    const stateColor = { h: 35, s: 40, b: 15, c: 0 };
    const load = (target: typeof a, hex: string | null) => target.emit({
      type: 'manifestAssetsLoaded',
      snapshot: {
        floors: hex ? Array.from({ length: 9 }, () => [[hex]]) : [],
        walls: hex ? Array.from({ length: 16 }, () => [[hex]]) : [],
        carpets: [], furniture: [], pets: [], directories: [], diagnostics: [],
      },
    });
    load(a, '#20406080'); load(b, '#a0c0e040');
    expect(stateA.floorAssets.revision).toBe(stateB.floorAssets.revision);
    expect(stateA.wallAssets.revision).toBe(stateB.wallAssets.revision);
    const previewA = vi.spyOn(stateA.floorAssets, 'getFloorSprite');
    const previewB = vi.spyOn(stateB.floorAssets, 'getFloorSprite');
    a.click('Edit Layout'); b.click('Edit Layout');
    a.click('▦Floor'); b.click('▦Floor');
    expect(a.host.querySelector('[title^="Floor 10"]')).not.toBeNull();
    expect(b.host.querySelector('[title^="Floor 10"]')).not.toBeNull();
    expect(previewA.mock.results.some(result => result.value[0][0] === '#20406080')).toBe(true);
    expect(previewB.mock.results.some(result => result.value[0][0] === '#a0c0e040')).toBe(true);
    const pixels = (target: typeof a) => previewPixels.get(target.host.querySelector<HTMLCanvasElement>('[title^="Floor 10"] canvas')!);
    expect(pixels(a)).toEqual(['#20406080']);
    expect(pixels(b)).toEqual(['#a0c0e040']);
    const floorB = stateB.floorAssets.getColorizedFloorSprite(0, stateColor);
    const wallB = stateB.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, stateColor).sprite;
    load(a, null);
    expect(stateA.floorAssets.hasFloorSprites()).toBe(false);
    expect(stateA.wallAssets.hasWallSprites()).toBe(false);
    load(a, '#123456');
    expect(pixels(a)).toEqual(['#123456']);
    expect(pixels(b)).toEqual(['#a0c0e040']);
    expect(stateB.floorAssets.revision).toBe(1);
    expect(stateB.wallAssets.revision).toBe(1);
    expect(stateB.floorAssets.getColorizedFloorSprite(0, stateColor)).toBe(floorB);
    expect(stateB.wallAssets.getColorizedWallSprite([0], 1, 1, 0, 0, stateColor).sprite).toBe(wallB);
    expect(previewB.mock.results.every(result => result.value[0][0] === '#a0c0e040')).toBe(true);
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
    b.emit({ type: 'agentStatus', agentId: 'beta', status: 'active' });
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

  it('scopes real canvas pan handlers, clears held keys on focus transfer and cleans up StrictMode mounts', () => {
    const added = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const removed = vi.spyOn(HTMLCanvasElement.prototype, 'removeEventListener');
    const ctx = { setTransform: vi.fn(), imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 150, width: 200, height: 150, toJSON: () => ({}),
    });
    const frames = new Map<HTMLCanvasElement, () => void>();
    vi.spyOn(gameLoop, 'startGameLoop').mockImplementation((canvas, callbacks) => {
      const render = () => callbacks.render(ctx);
      frames.set(canvas, render);
      return () => { if (frames.get(canvas) === render) frames.delete(canvas); };
    });
    const draw = vi.spyOn(renderer, 'renderFrame').mockImplementation(() => {});
    const a = view(true), b = view(true);
    views.push(a, b);
    a.mount(); initialize(a, 20, 'alpha');
    b.mount(); initialize(b, 25, 'beta');
    const canvasA = a.host.querySelector('canvas')!;
    const canvasB = b.host.querySelector('canvas')!;
    const pan = (canvas: HTMLCanvasElement) => {
      frames.get(canvas)!();
      return draw.mock.lastCall!.slice(8, 10);
    };
    const space = (canvas: HTMLCanvasElement, type = 'keydown') => {
      const event = new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      act(() => canvas.dispatchEvent(event));
      return event;
    };
    const mouse = (canvas: HTMLCanvasElement, type: string, x: number, button = 0) => {
      act(() => canvas.dispatchEvent(new MouseEvent(type, { button, bubbles: true, clientX: x, clientY: 60 })));
    };
    const beforeA = pan(canvasA), beforeB = pan(canvasB);
    act(() => canvasA.focus());
    expect(space(canvasB).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(canvasA);
    expect(space(canvasA).defaultPrevented).toBe(true);
    act(() => canvasB.focus());
    // Returning by pointer must not resurrect A's held Space.
    mouse(canvasA, 'mousedown', 60);
    mouse(canvasA, 'mousemove', 80);
    mouse(canvasA, 'mouseup', 80);
    expect(pan(canvasA)).toEqual(beforeA);
    expect(pan(canvasB)).toEqual(beforeB);
    space(canvasA);
    mouse(canvasA, 'mousedown', 60);
    mouse(canvasA, 'mousemove', 80);
    mouse(canvasA, 'mouseup', 80);
    space(canvasA, 'keyup');
    expect(pan(canvasA)).toEqual([Number(beforeA[0]) + 20, beforeA[1]]);
    expect(pan(canvasB)).toEqual(beforeB);
    a.click('Settings');
    act(() => canvasB.focus());
    expect(space(canvasB).defaultPrevented).toBe(true);
    mouse(canvasB, 'mousedown', 60);
    mouse(canvasB, 'mousemove', 70);
    mouse(canvasB, 'mouseup', 70);
    expect(pan(canvasB)).toEqual([Number(beforeB[0]) + 10, beforeB[1]]);
    a.unmount();
    expect(frames.has(canvasA)).toBe(false);
    for (const type of ['keydown', 'keyup', 'blur']) {
      const listeners = (spy: typeof added | typeof removed, canvas: HTMLCanvasElement) =>
        spy.mock.calls.filter(([event], index) => event === type && spy.mock.contexts[index] === canvas).length;
      expect(listeners(added, canvasA)).toBeGreaterThanOrEqual(2);
      expect(listeners(added, canvasA) - listeners(removed, canvasA)).toBe(0);
      expect(listeners(added, canvasB) - listeners(removed, canvasB)).toBe(1);
    }
    space(canvasB, 'keyup');
    // Middle-button and wheel navigation still work after peer disposal.
    mouse(canvasB, 'mousedown', 60, 1);
    mouse(canvasB, 'mousemove', 70, 1);
    mouse(canvasB, 'mouseup', 70, 1);
    expect(pan(canvasB)).toEqual([Number(beforeB[0]) + 20, beforeB[1]]);
    act(() => canvasB.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaX: 60 })));
    expect(pan(canvasB)).toEqual([Number(beforeB[0]) - 40, beforeB[1]]);
    expect(frames.size).toBe(1);
  });

  it.each([false, true])('routes focused editor input and survives owner disposal (StrictMode=%s)', strict => {
    const rebuild = vi.spyOn(OfficeState.prototype, 'rebuildFromLayout');
    const a = view(strict), b = view(strict);
    views.push(a, b);
    const furnished = (cols: number): OfficeLayout => ({
      ...layout(cols), furniture: [{ uid: 'chair', type: 'chair', col: 2, row: 2, rotation: 0 }],
    });
    a.mount(); initialize(a, 20, 'alpha', furnished(20));
    b.mount(); initialize(b, 25, 'beta', furnished(25));
    const stateA = instance(rebuild.mock.contexts[0]);
    const stateB = instance(rebuild.mock.contexts[1]);
    a.click('Edit Layout'); b.click('Edit Layout');
    const canvasA = a.host.querySelector('canvas')!;
    const canvasB = b.host.querySelector('canvas')!;
    const key = (target: Element, key: string, ctrlKey = false) => {
      const event = new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true });
      act(() => target.dispatchEvent(event));
      return event;
    };
    const select = (canvas: HTMLCanvasElement) => act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 80, clientY: 80 }));
      canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 80, clientY: 80 }));
    });
    select(canvasA); select(canvasB);
    expect(a.host.querySelector('[title="Delete (Del)"]')).not.toBeNull();
    expect(b.host.querySelector('[title="Delete (Del)"]')).not.toBeNull();
    a.click('→'); a.click('↓'); b.click('→'); b.click('↓');
    const peer = b.recovery();
    // Focus alone (as from Tab), without a pointer event, transfers ownership.
    act(() => canvasA.focus());
    key(canvasA, 'z', true);
    expect(stateA.layout).toMatchObject({ cols: 21, rows: 15 });
    expect(b.recovery()).toEqual(peer);
    expect(b.host.querySelector('[title="Delete (Del)"]')).not.toBeNull();
    key(canvasA, 'Delete');
    expect(stateA.layout.furniture).toEqual([]);
    expect(stateB.layout.furniture).toHaveLength(1);
    expect(b.host.querySelector('[title="Delete (Del)"]')).not.toBeNull();
    act(() => canvasB.focus());
    key(canvasB, 'z', true);
    expect(stateB.layout).toMatchObject({ cols: 26, rows: 15 });
    expect(stateA.layout.furniture).toEqual([]);
    key(canvasB, 'y', true);
    expect(stateB.layout.rows).toBe(16);

    for (const tag of ['input', 'textarea', 'select', 'div']) {
      const control = document.createElement(tag);
      if (tag === 'div') { control.setAttribute('contenteditable', ''); control.tabIndex = 0; }
      b.host.querySelector('.office-panel')!.append(control);
      act(() => control.focus());
      const before = b.recovery();
      expect(key(control, 'z', true).defaultPrevented).toBe(false);
      expect(key(control, 'Delete').defaultPrevented).toBe(false);
      expect(b.recovery()).toEqual(before);
      control.remove();
    }
    // A modal blocks only its office, even when focus is programmatically on its canvas.
    a.click('Settings');
    act(() => canvasA.focus());
    const beforeModal = a.recovery();
    expect(key(canvasA, 'z', true).defaultPrevented).toBe(false);
    expect(a.recovery()).toEqual(beforeModal);
    act(() => canvasB.focus());
    key(canvasB, 'z', true);
    expect(stateB.layout.rows).toBe(15);
    a.unmount();
    act(() => canvasB.focus());
    key(canvasB, 'z', true);
    expect(stateB.layout).toMatchObject({ cols: 25, rows: 15 });
    key(canvasB, 'y', true);
    expect(stateB.layout).toMatchObject({ cols: 26, rows: 15 });
    b.click('● Save Layout');
    expect(b.client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'saveLayout', workspaceRoot: 'beta', layout: expect.objectContaining({ cols: 26, rows: 15 }),
    }));
  });

  it('keeps generated settings label/control identity local to its office', () => {
    const a = view(), b = view();
    views.push(a, b);
    a.mount(); initialize(a, 20, 'alpha');
    b.mount(); initialize(b, 25, 'beta');
    a.click('Settings'); b.click('Settings');
    const label = (office: typeof a) => [...office.host.querySelectorAll('label')]
      .find(item => item.textContent === 'Show Named Areas')!;
    expect(label(a).htmlFor).not.toBe(label(b).htmlFor);
    expect(b.host.contains(label(b).control)).toBe(true);
    act(() => label(b).click());
    expect(b.client.send).toHaveBeenCalledWith({ type: 'setShowAreas', enabled: true });
    expect(a.client.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setShowAreas' }));
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
