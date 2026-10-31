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
import { getCharacterScreenBounds } from '../office/engine/characterGeometry.js';
import { createCharacter } from '../office/engine/characters.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('AgentLabels over canvas characters', () => {
  let host: HTMLDivElement;
  let root: Root;
  let office: OfficeState;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let time: number;
  const panRef = { current: { x: 30, y: 40 } };
  const onAgentClick = vi.fn();
  const client = createHostClientFixture();
  const dimensionDescriptors = {
    offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!,
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!,
  };

  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    time = 0;
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
    Object.defineProperties(HTMLElement.prototype, dimensionDescriptors);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function frame() {
    time += 100;
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => callbacks.forEach((callback) => callback(time)));
  }

  function render(zoom = 2, withCanvas = false) {
    act(() => root.render(<HostClientProvider client={client}><>
      {withCanvas && <OfficeCanvas officeState={office} editorState={new EditorState()}
        isEditMode={false} editorTick={0} zoom={zoom} panRef={panRef}
        onDeskClick={onAgentClick} />}
      <AgentLabels officeState={office} zoom={zoom} panRef={panRef} onAgentClick={onAgentClick} />
    </></HostClientProvider>));
    frame();
    frame();
  }

  function label(name = 'Homer Simpson') {
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(name));
    expect(button, `native name control for ${name}`).toBeDefined();
    return button!;
  }

  it.each([1, 2, 4])('renders readable native name controls, not DOM characters or fake animations, at zoom %s', (zoom) => {
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
    }
    expect(label().style.background).toBe('transparent');
    expect(label().parentElement!.style.background).toBe('rgba(0, 0, 0, 0.8)');
    expect(label().style.border).toBe('0px');
    expect(label().closest('[data-agent-annotation]')!.parentElement!.parentElement!.style.pointerEvents).toBe('none');
  });

  it('tracks authoritative identity, selection, movement, zoom, pan and roster removal', () => {
    office.removeAgent('marge');
    render();
    expect(label().parentElement!.style.left).toBe('190px');
    expect(label().parentElement!.style.top).toBe('194px');
    Object.assign(office.characters.get('homer')!, { name: 'Homer Updated', role: 'Reviewer', x: 90, y: 110 });
    office.selectedAgentId = 'homer';
    panRef.current = { x: 50, y: 60 };
    frame();
    expect(label('Homer Updated').textContent).toContain('Reviewer');
    expect(label('Homer Updated').style.color).toBe('rgb(251, 191, 36)');
    render(3);
    expect(label('Homer Updated').parentElement!.style.left).toBe('320px');
    expect(label('Homer Updated').parentElement!.style.top).toBe('328px');
    office.removeAgent('homer');
    frame();
    expect(host.textContent).not.toContain('Homer');
    expect(host.querySelectorAll('button')).toHaveLength(0);
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

  it.each(['constructor', 'toString', '__proto__'])('reads only own tool entries for member identity %s', id => {
    office.removeAgent('homer');
    office.removeAgent('marge');
    office.addAgent(id, 'Test Member', 'Developer');
    render();
    expect(host.querySelector('[data-agent-tools]')).toBeNull();
    act(() => root.render(<AgentLabels officeState={office} zoom={2} panRef={panRef}
      agentTools={Object.fromEntries([[id, [{ toolId: 'test-read', status: 'Read tool', done: false }]]])} />));
    frame();
    expect(host.querySelector('[data-agent-tools]')?.textContent).toContain('Read tool');
  });

  it('keeps names, tools and 40x4 gauges in non-overlapping measured annotation stacks at 2x zoom', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentAnnotation ? 120 : this.dataset.agentLabel ? 90 : this.dataset.agentToolBubble ? 120 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentAnnotation ? 58 : this.dataset.agentLabel ? 28 : this.dataset.agentToolBubble ? 18 : 0;
    });
    for (const id of ['homer', 'marge']) {
      Object.assign(office.characters.get(id)!, { x: 80, y: 100 });
      office.setAgentActive(id, true);
      office.setAgentTool(id, 'view');
      setContextUsage(office, id, { contextTokens: 600, maxContextTokens: 1000 });
    }
    render(2);
    frame();
    const boxes = [...host.querySelectorAll<HTMLElement>('[data-agent-annotation]')]
      .map(element => {
        const width = element.offsetWidth;
        return { left: parseFloat(element.style.left) - width / 2,
          top: parseFloat(element.style.top), width, height: element.offsetHeight };
      });
    expect(boxes).toHaveLength(2);
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

  it('projects member/subtask and subtask/subtask footprints together through motion and measurement changes', () => {
    let taskHeight = 20;
    let memberHeight = 20;
    vi.stubGlobal('innerHeight', 1000);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentAnnotation ? 80 : 0;
    });

    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentAnnotation?.startsWith('subtask:') ? taskHeight
        : this.dataset.agentAnnotation ? memberHeight : 0;
    });
    for (const id of ['homer', 'test-child']) {
      const character = createCharacter(id, `Test task ${id}`, 'Ephemeral', 0, null, null, 0);
      Object.assign(character, { x: 80, y: 100 });
      office.subagents.set(id, { character, parentAgentId: 'homer' });
    }
    render();
    for (let tick = 0; tick < 100; tick++) {
      taskHeight = tick % 2 ? 80 : 20;
      memberHeight = tick % 3 ? 20 : 100;
      office.characters.get('homer')!.x = 80 + Math.sin(tick / 10) * 20;
      office.subagents.get('homer')!.character.y = 100 + Math.sin(tick / 10) * 20;
      frame();
      const annotations = [...host.querySelectorAll<HTMLElement>('[data-agent-annotation]')];
      expect(annotations).toHaveLength(4); // Member and transient with identical IDs remain distinct.
      annotations.forEach((element, index) => {
        const top = parseFloat(element.style.top);
        annotations.slice(index + 1).forEach(other => {
          const otherTop = parseFloat(other.style.top);
          expect(top + element.offsetHeight <= otherTop || otherTop + other.offsetHeight <= top).toBe(true);
        });
      });
      expect(host.querySelectorAll('[data-subagent-label]')).toHaveLength(2);
      expect(host.querySelector('[data-subagent-label="test-child"]')?.textContent).toContain('Parent: Homer Simpson');
      expect(host.querySelector('[data-label-dock="true"]')).toBeNull();
    }
    office.subagents.clear();
    frame();
    expect(host.querySelector('[data-subagent-label]')).toBeNull();
  });

  it('measures summaries inside member stacks and separates changed footprints', () => {
    vi.stubGlobal('innerHeight', 1000);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentAnnotation ? 180 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentAnnotation ? (this.querySelector('[data-agent-task-bubble]') ? 90 : 30) : 0;
    });
    for (const id of ['homer', 'marge']) {
      Object.assign(office.characters.get(id)!, { x: 80, y: 100 });
      office.setAgentActive(id, true);
    }
    const show = (taskBubbles: Record<string, string>) => {
      act(() => root.render(<AgentLabels officeState={office} zoom={2} panRef={panRef} taskBubbles={taskBubbles} />));
      frame();
      frame();
      const [a, b] = [...host.querySelectorAll<HTMLElement>('[data-agent-annotation]')];
      expect(parseFloat(a.style.top) + a.offsetHeight <= parseFloat(b.style.top)
        || parseFloat(b.style.top) + b.offsetHeight <= parseFloat(a.style.top)).toBe(true);
      for (const bubble of host.querySelectorAll('[data-agent-task-bubble]')) {
        expect(bubble.closest('[data-agent-annotation]')?.getAttribute('data-agent-annotation'))
          .toBe(`member:${bubble.getAttribute('data-agent-task-bubble')}`);
      }
    };
    show({ homer: 'CLI task: Task in progress', marge: 'CLI tool: Reading a file' });
    expect(host.querySelectorAll('[data-agent-task-bubble]')).toHaveLength(2);
    show({});
    expect(host.querySelector('[data-agent-task-bubble]')).toBeNull();
    show({ homer: 'CLI task: Task in progress' });
    expect(host.querySelectorAll('[data-agent-task-bubble]')).toHaveLength(1);
  });

  it('collapses a crowded dock on Locate, moves keyboard focus to reopen, and keeps hidden labels out of the way', () => {
    vi.stubGlobal('innerWidth', 360);
    vi.stubGlobal('innerHeight', 280);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentAnnotation ? 150 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.agentAnnotation ? 100 : 0;
    });
    const locate = vi.fn();
    act(() => root.render(<AgentLabels officeState={office} zoom={3} panRef={panRef}
      onAgentClick={onAgentClick} onLocateAgent={locate} />));
    frame();
    const dock = host.querySelector<HTMLElement>('[data-label-dock="true"]')!;
    expect(dock).not.toBeNull();
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Locate Homer Simpson"]')!;
    button.focus();
    act(() => button.click());
    expect(locate).toHaveBeenCalledExactlyOnceWith('homer');
    expect(dock.style.visibility).toBe('hidden');
    for (const annotation of host.querySelectorAll<HTMLElement>('[data-agent-annotation]')) {
      expect(getComputedStyle(annotation).visibility).toBe('hidden');
    }
    const toggle = [...host.querySelectorAll('button')].find(item => item.textContent === 'Show office labels')!;
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    frame();
    expect(dock.style.visibility).toBe('hidden'); // RAF/resize must not reopen behind the user's choice.
    act(() => toggle.click());
    expect(dock.style.visibility).toBe('');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => label().click());
    expect(onAgentClick).toHaveBeenCalledOnce();
  });

  it.each([1.5, 2])('marks off-screen names honestly and offers keyboard Locate at DPR %s', (dpr) => {
        vi.stubGlobal('devicePixelRatio', dpr);
        vi.stubGlobal('innerWidth', 788);
        Object.assign(office.characters.get('homer')!, { x: 400, y: 100 });
        const locate = vi.fn();
        act(() => root.render(<AgentLabels officeState={office} zoom={3} panRef={panRef}
          onAgentClick={onAgentClick} onLocateAgent={locate} />));
        frame();
        expect(label().textContent).toContain('Off-screen right');
        const locateButton = host.querySelector<HTMLButtonElement>('[aria-label="Locate Homer Simpson"]')!;
        locateButton.focus();
        act(() => locateButton.click());
        expect(locate).toHaveBeenCalledExactlyOnceWith('homer');
        expect(onAgentClick).not.toHaveBeenCalled();
        expect(host.querySelector('[data-agent-connector="homer"]')).toBeNull();
        panRef.current.x = -700;
        frame();
        expect(label().textContent).not.toContain('Off-screen');
        expect(host.querySelector('[data-agent-connector="homer"]')).not.toBeNull();
  });

  it.each([360, 1400].flatMap(width => Array.from({ length: 10 }, (_, i) => [width, i + 1])))
      ('bounds collision-lane changes over 60s in a %spx panel at zoom %s (CSS pixels, DPR 1.5)', (width, zoom) => {
        vi.stubGlobal('devicePixelRatio', 1.5);
        vi.stubGlobal('innerWidth', width);
        vi.stubGlobal('innerHeight', 900);
        // Fixed jsdom geometry needs no spy call history for every layout measurement.
        Object.defineProperties(HTMLElement.prototype, {
          offsetWidth: { configurable: true, get(this: HTMLElement) {
            return this.dataset.agentAnnotation ? 90 : 0;
          } },
          offsetHeight: { configurable: true, get(this: HTMLElement) {
            return this.dataset.agentAnnotation ? 28 : 0;
          } },
        });
        const crowd = Array.from({ length: 6 }, (_, i) => `crowd-${i}`);
        for (let i = 0; i < 6; i++) {
          const id = `crowd-${i}`;
          office.addAgent(id, `Moving member ${i}`, 'Developer');
          Object.assign(office.characters.get(id)!, { x: 80, y: 100 });
        }
        render(zoom);
        frame(); // Real measured dimensions become available after the first DOM commit.
        const previous = new Map<string, { top: number; anchor: number }>();
        let maxLaneStep = 0;
        let worstLane: { id: string; tick: number; top: number; anchor: number } | undefined;
        for (let tick = 0; tick < 600; tick++) {
          for (let i = 0; i < 6; i++) {
            Object.assign(office.characters.get(`crowd-${i}`)!, {
              // Cross repeatedly with unchanged camera and world y, isolating lane motion.
              x: (width / 2 + Math.sin(tick / 25 + i) * 100 - panRef.current.x) / zoom,
              y: (450 - panRef.current.y) / zoom,
            });
          }
          frame();
          if (panRef.current.x !== 30 || panRef.current.y !== 40) {
            expect(panRef.current, `width=${width}, zoom=${zoom}, frame=${tick}: unchanged camera`)
              .toEqual({ x: 30, y: 40 });
          }
          // Discover live nodes each frame: cached references could hide removal/replacement.
          const labels = new Map([...host.querySelectorAll<HTMLElement>('[data-agent-label]')]
            .map(element => [element.dataset.agentLabel!, element]));
          const connectors = new Map([...host.querySelectorAll<SVGLineElement>('[data-agent-connector]')]
            .map(element => [element.dataset.agentConnector!, element]));
          for (const id of crowd) {
            const context = `width=${width}, zoom=${zoom}, DPR=1.5, frame=${tick}, member=${id}`;
            const element = labels.get(id);
            const connector = connectors.get(id);
            // Pay matcher/diagnostic cost only on failure, not thousands of successful reads.
            if (!element || !connector) {
              expect(element, `${context}: live label`).toBeDefined();
              expect(connector, `${context}: live connector`).toBeDefined();
            }
            const character = office.characters.get(id)!;
            const top = parseFloat(element!.parentElement!.style.top);
            const bounds = getCharacterScreenBounds(character, zoom, panRef.current);
            const anchor = Math.max(4, Math.min(bounds.top - 14, 900 - 28 - 4));
            if (!Number.isFinite(top)) expect(Number.isFinite(top), `${context}: finite label top (${top})`).toBe(true);
            const last = previous.get(id);
            if (last) {
              const step = Math.abs((top - last.top) - (anchor - last.anchor));
              if (step > maxLaneStep) {
                maxLaneStep = step;
                worstLane = { id, tick, top, anchor };
              }
            }
            previous.set(id, { top, anchor });
            const text = element!.textContent;
            if (!text?.includes('Developer')) expect(text, `${context}: role text`).toContain('Developer');
            const x2 = connector!.getAttribute('x2');
            const expectedX = character.x * zoom + panRef.current.x;
            if (x2 === null || !Number.isFinite(Number(x2)) || Math.abs(Number(x2) - expectedX) >= 0.005) {
              expect(x2, `${context}: connector x2 attribute`).not.toBeNull();
              expect(Number(x2), `${context}: connector x2 alignment`).toBeCloseTo(expectedX);
            }
            const y2 = connector!.getAttribute('y2');
            if (y2 === null || !Number.isFinite(Number(y2)) || Math.abs(Number(y2) - bounds.top) >= 0.005) {
              expect(y2, `${context}: connector y2 attribute`).not.toBeNull();
              expect(Number(y2), `${context}: connector y2 alignment`).toBeCloseTo(bounds.top);
            }
          }
        }
        expect(maxLaneStep, `width=${width}, zoom=${zoom}: worst lane ${JSON.stringify(worstLane)}`)
          .toBeLessThanOrEqual(12.000001);
        expect(panRef.current).toEqual({ x: 30, y: 40 });
  });
});
