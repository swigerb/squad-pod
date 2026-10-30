import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentLabels } from './AgentLabels.js';
import { OfficeCanvas } from '../office/components/OfficeCanvas.js';
import { OfficeState } from '../office/engine/officeState.js';
import { EditorState } from '../office/editor/editorState.js';
import { CharacterState, TileType } from '../office/types.js';
import { HostClientProvider } from '../HostClientContext.js';
import { createHostClientFixture } from '../__tests__/hostClientFixture.js';
import { setContextUsage } from '../office/toolUtils.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('AgentLabels over canvas characters', () => {
  let host: HTMLDivElement;
  let root: Root;
  let office: OfficeState;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const panRef = { current: { x: 30, y: 40 } };
  const onAgentClick = vi.fn();
  const client = createHostClientFixture();

  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    // This fixture tests DOM overlays and real canvas hit-testing, not pixels.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    onAgentClick.mockReset();
    panRef.current = { x: 30, y: 40 };
    office = new OfficeState({
      version: 2, cols: 12, rows: 10,
      tiles: Array(120).fill(TileType.FLOOR_1), furniture: [],
    });
    office.addAgent('homer', 'Homer Simpson', 'Lead');
    office.addAgent('marge', 'Marge Simpson', 'Developer');
    Object.assign(office.characters.get('homer')!, { x: 80, y: 100 });
    Object.assign(office.characters.get('marge')!, { x: 140, y: 100 });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function frame() {
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => callbacks.forEach((callback) => callback(0)));
  }

  function render(zoom = 2, withCanvas = false) {
    act(() => root.render(<HostClientProvider client={client}><>
      {withCanvas && <OfficeCanvas officeState={office} editorState={new EditorState()}
        isEditMode={false} editorTick={0} zoom={zoom} panRef={panRef}
        onDeskClick={onAgentClick} />}
      <AgentLabels officeState={office} zoom={zoom} panRef={panRef} onAgentClick={onAgentClick} />
    </></HostClientProvider>));
    frame();
  }

  function label(name = 'Homer Simpson') {
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(name));
    expect(button, `native name control for ${name}`).toBeDefined();
    return button!;
  }

  it.each([1, 2, 4])('renders only transparent name controls, not DOM characters or fake animations, at zoom %s', (zoom) => {
    office.setAgentActive('homer', true);
    office.characters.get('marge')!.state = CharacterState.WALK;
    render(zoom);
    expect(host.querySelector('style, canvas, img, [class*="avatar"]')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(2);
    expect(label().textContent).toContain('Lead');
    expect(label('Marge Simpson').textContent).toContain('Developer');
    const elements = [...host.querySelectorAll<HTMLElement>('*')];
    expect(elements.filter((element) => element.style.pointerEvents === 'auto')).toEqual([
      label(), label('Marge Simpson'),
    ]);
    for (const element of elements) {
      expect(element.style.animation).toBe('');
      // Only the small status dot may have both explicit width and height.
      if (element.style.width || element.style.height) {
        expect(element.getAttribute('role')).toBe('img');
        expect(element.style.width).toBe('6px');
        expect(element.style.height).toBe('6px');
      }
    }
    expect(label().style.background).toBe('transparent');
    expect(label().style.border).toBe('0px');
    expect(label().parentElement!.parentElement!.style.pointerEvents).toBe('none');
  });

  it('tracks authoritative identity, selection, movement, zoom, pan and roster removal', () => {
    render();
    expect(label().style.left).toBe('190px');
    expect(label().style.top).toBe('194px');
    Object.assign(office.characters.get('homer')!, { name: 'Homer Updated', role: 'Reviewer', x: 90, y: 110 });
    office.selectedAgentId = 'homer';
    panRef.current = { x: 50, y: 60 };
    frame();
    expect(label('Homer Updated').textContent).toContain('Reviewer');
    expect(label('Homer Updated').style.color).toBe('rgb(251, 191, 36)');
    render(3);
    expect(label('Homer Updated').style.left).toBe('320px');
    expect(label('Homer Updated').style.top).toBe('328px');
    office.removeAgent('homer');
    frame();
    expect(host.textContent).not.toContain('Homer');
    expect(host.querySelectorAll('button')).toHaveLength(1);
  });

  it('retains accessible active, waiting and permission indicators and tool text, clearing waiting on resume', () => {
    office.setAgentActive('homer', true);
    office.setAgentTool('homer', 'Reading charter');
    render();
    expect(label().querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Active');
    expect(host.textContent).toContain('Reading charter');
    office.showWaitingBubble('homer');
    frame();
    expect(label().querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Waiting');
    office.setAgentActive('homer', true);
    frame();
    expect(label().querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Active');
    office.showPermissionBubble('homer');
    frame();
    expect(label().querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Permission required');
    office.clearPermissionBubble('homer');
    office.setAgentActive('homer', false);
    frame();
    expect(label().querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Idle');
    expect(host.textContent).not.toContain('Reading charter');
  });

  it('opens the correct agent card once from a name click with pointer coordinates', () => {
    render();
    const parentClick = vi.fn();
    document.body.addEventListener('click', parentClick);
    act(() => label('Marge Simpson').dispatchEvent(new MouseEvent('click', {
      bubbles: true, detail: 1, clientX: 310, clientY: 186,
    })));
    document.body.removeEventListener('click', parentClick);
    expect(onAgentClick.mock.calls).toEqual([['marge', 310, 186]]);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('uses a focusable native button and anchors keyboard-generated clicks to the label instead of screen origin', () => {
    render();
    const button = label();
    expect(button.type).toBe('button');
    expect(button.tabIndex).toBe(0);
    button.focus();
    expect(document.activeElement).toBe(button);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      x: 150, y: 180, left: 150, top: 180, right: 230, bottom: 206,
      width: 80, height: 26, toJSON: () => ({}),
    });
    // jsdom does not synthesize native Enter/Space activation; a native button's
    // keyboard/assistive-technology click has detail=0.
    act(() => button.click());
    expect(onAgentClick.mock.calls).toEqual([['homer', 190, 206]]);
  });

  it('keeps canvas character hit-testing and selection alongside name navigation', () => {
    render(2, true);
    const canvas = host.querySelector('canvas')!;
    act(() => canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: 190, clientY: 220,
    })));
    expect(onAgentClick.mock.calls).toEqual([['homer', 190, 220]]);
    expect(office.selectedAgentId).toBe('homer');
    act(() => label('Marge Simpson').dispatchEvent(new MouseEvent('click', {
      bubbles: true, detail: 1, clientX: 310, clientY: 186,
    })));
    expect(onAgentClick.mock.calls).toEqual([['homer', 190, 220], ['marge', 310, 186]]);
  });

  it('isolates native Space activation from the canvas global pan shortcut', () => {
    render(2, true);
    const key = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    act(() => label().dispatchEvent(key));
    expect(key.defaultPrevented).toBe(false);
    // The global shortcut still pans when the canvas, not a button, owns input.
    const canvasKey = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    act(() => host.querySelector('canvas')!.dispatchEvent(canvasKey));
    expect(canvasKey.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space' }));
  });

  it('cancels its position update on unmount', () => {
    render();
    expect(frames.size).toBe(1);
    act(() => root.render(null));
    expect(frames.size).toBe(0);
  });

  it('reserves separate measured lanes for names, tool bubbles and 40x4 gauges at 2x zoom', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentLabel ? 90 : this.dataset.agentToolBubble ? 120 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentLabel ? 28 : this.dataset.agentToolBubble ? 18 : 0;
    });
    for (const id of ['homer', 'marge']) {
      Object.assign(office.characters.get(id)!, { x: 80, y: 100 });
      office.setAgentActive(id, true);
      office.setAgentTool(id, 'view');
      setContextUsage(office, id, { contextTokens: 600, maxContextTokens: 1000 });
    }
    render(2);
    frame();
    const boxes = [...host.querySelectorAll<HTMLElement>('[data-agent-label], [data-agent-tool-bubble], [data-agent-context]')]
      .map(element => {
        const gauge = !!element.dataset.agentContext;
        const width = gauge ? 40 : element.offsetWidth;
        return { left: parseFloat(element.style.left) - (element.dataset.agentLabel ? width / 2 : 0),
          top: parseFloat(element.style.top), width, height: gauge ? 4 : element.offsetHeight };
      });
    expect(boxes).toHaveLength(6);
    boxes.forEach((a, index) => {
      boxes.slice(index + 1).forEach(b => {
        expect(a.left < b.left + b.width && a.left + a.width > b.left
          && a.top < b.top + b.height && a.top + a.height > b.top).toBe(false);
      });
    });
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
    office.setAgentActive('homer', false);
    frame();
    expect(host.querySelector('[data-agent-context="homer"]')).toBeNull();
  });
});
