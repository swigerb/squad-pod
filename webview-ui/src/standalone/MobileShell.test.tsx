import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedTerminalPanelProps } from './OwnedTerminalPanel.js';
import { runId } from '../../../src/core/terminalFrames.js';
import { MobileShell } from './MobileShell.js';

const panel = vi.hoisted(() => ({
  props: null as OwnedTerminalPanelProps | null,
  launchRequests: [] as string[],
}));
vi.mock('./OwnedTerminalPanel.js', () => ({
  OwnedTerminalPanel: (props: OwnedTerminalPanelProps) => {
    panel.props = props;
    useEffect(() => {
      props.onLaunchHandler?.(requestId => { panel.launchRequests.push(requestId); return true; });
      return () => props.onLaunchHandler?.(null);
    }, []);
    return <div data-testid="terminal-panel" />;
  },
}));

const first = runId('mobile-shell-run-1');
const second = runId('mobile-shell-run-2');
const access = {
  authenticated: true, connected: true, available: true, ready: true, resync: false,
  runs: [{ runId: first, pid: 1, state: 'running' as const, exitCode: null }],
};
let root: Root;
let host: HTMLDivElement;
let mobileMatches = true;
let mediaChangeListeners: Array<() => void> = [];
const mediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const touchDescriptor = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');
const touchEventDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'TouchEvent');
class SyntheticTouchEvent extends Event {
  readonly changedTouches: Touch[];
  readonly touches: Touch[];
  readonly targetTouches: Touch[];
  constructor(type: string, init: EventInit & {
    changedTouches?: Touch[]; touches?: Touch[]; targetTouches?: Touch[];
  } = {}) {
    super(type, init);
    this.changedTouches = init.changedTouches ?? [];
    this.touches = init.touches ?? [];
    this.targetTouches = init.targetTouches ?? [];
  }
}
function touch(id: number, x: number, y: number): Touch {
  return { identifier: id, clientX: x, clientY: y } as Touch;
}
function dispatchTouch(target: Element, type: string, changed: Touch[], touches: Touch[], time: number) {
  const event = new SyntheticTouchEvent(type, {
    bubbles: true, cancelable: true, changedTouches: changed, touches,
  });
  Object.defineProperty(event, 'timeStamp', { value: time });
  target.dispatchEvent(event);
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('TouchEvent', SyntheticTouchEvent);
  panel.props = null;
  panel.launchRequests.length = 0;
  mobileMatches = true;
  mediaChangeListeners = [];
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
    get matches() { return mobileMatches; },
    addEventListener: (_type: string, listener: () => void) => mediaChangeListeners.push(listener),
    removeEventListener: (_type: string, listener: () => void) => {
      mediaChangeListeners = mediaChangeListeners.filter(entry => entry !== listener);
    },
  }) });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (mediaDescriptor) Object.defineProperty(window, 'matchMedia', mediaDescriptor);
  else Reflect.deleteProperty(window, 'matchMedia');
  if (touchDescriptor) Object.defineProperty(navigator, 'maxTouchPoints', touchDescriptor);
  else Reflect.deleteProperty(navigator, 'maxTouchPoints');
  if (touchEventDescriptor) Object.defineProperty(globalThis, 'TouchEvent', touchEventDescriptor);
  else Reflect.deleteProperty(globalThis, 'TouchEvent');
});
function button(name: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!found) throw new Error(`Missing mobile button: ${name}`);
  return found;
}

describe('standalone mobile shell', () => {
  it('keeps shell toggle and owned-run cards synchronized with selection', async () => {
    await act(async () => root.render(<MobileShell office={<div>office</div>} />));
    expect(host.querySelector('[data-mobile-view]')?.getAttribute('data-mobile-view')).toBe('office');
    await act(async () => panel.props?.onAccessChange?.(access));
    await act(async () => button('Owned terminal 1, running, process 1').click());
    expect(host.querySelector('[data-mobile-view]')?.getAttribute('data-mobile-view')).toBe('terminal');
    expect(panel.props?.selectedRunId).toBe(first);
    expect(button('Owned terminal 1, running, process 1').getAttribute('aria-pressed')).toBe('true');
    await act(async () => button('Show office').click());
    expect(host.querySelector('[data-mobile-view]')?.getAttribute('data-mobile-view')).toBe('office');
    await act(async () => button('Show terminal').click());
    expect(host.querySelector('[data-mobile-view]')?.getAttribute('data-mobile-view')).toBe('terminal');
  });

  it('opens only the run from its correlated launch result, not a broadcast inventory', async () => {
    await act(async () => root.render(<MobileShell office={<div>office</div>} />));
    await act(async () => panel.props?.onAccessChange?.(access));
    await act(async () => button('Launch owned terminal').click());
    expect(panel.launchRequests).toHaveLength(1);
    const requestId = panel.launchRequests[0];
    expect(requestId).toMatch(/^[a-f0-9]{32}$/);
    const broadcast = {
      ...access,
      runs: [...access.runs, { runId: second, pid: 2, state: 'running' as const, exitCode: null }],
    };
    await act(async () => panel.props?.onAccessChange?.(broadcast));
    expect(host.querySelector('[data-mobile-view]')?.getAttribute('data-mobile-view')).toBe('office');
    expect(panel.props?.selectedRunId).toBe(first);
    await act(async () => panel.props?.onLaunchResult?.(requestId, { ok: true, runId: second }));
    expect(host.querySelector('[data-mobile-view]')?.getAttribute('data-mobile-view')).toBe('terminal');
    expect(panel.props?.selectedRunId).toBe(second);
  });

  it('clears a correlated busy rejection and permits a later deliberate launch', async () => {
    await act(async () => root.render(<MobileShell office={<div>office</div>} />));
    await act(async () => panel.props?.onAccessChange?.(access));
    await act(async () => button('Launch owned terminal').click());
    const firstRequest = panel.launchRequests[0];
    expect(button('Launch owned terminal').disabled).toBe(true);
    await act(async () => panel.props?.onLaunchResult?.(firstRequest, {
      ok: false, message: 'Owned action in progress.',
    }));
    expect(host.textContent).toContain('Launch failed: Owned action in progress.');
    expect(button('Launch owned terminal').disabled).toBe(false);
    expect(host.querySelector<HTMLElement>('[data-mobile-view]')?.dataset.mobileView).toBe('office');
    await act(async () => button('Launch owned terminal').click());
    expect(panel.launchRequests).toHaveLength(2);
    expect(panel.launchRequests[1]).not.toBe(firstRequest);
    await act(async () => panel.props?.onAccessChange?.({
      ...access,
      runs: [...access.runs, { runId: second, pid: 2, state: 'running', exitCode: null }],
    }));
    await act(async () => panel.props?.onLaunchResult?.(panel.launchRequests[1], { ok: true, runId: second }));
    expect(panel.props?.selectedRunId).toBe(second);
    expect(host.querySelector<HTMLElement>('[data-mobile-view]')?.dataset.mobileView).toBe('terminal');
  });

  it('commits edge swipes in both directions after cancelling the child gesture', async () => {
    await act(async () => root.render(<MobileShell office={<div data-testid="office">office</div>} />));
    const stage = host.querySelector<HTMLElement>('.observer-mobile-stage')!;
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, toJSON: () => ({}),
    } as DOMRect);
    const office = host.querySelector('[data-testid="office"]')!;
    const swipe = (startX: number, endX: number, time: number) => {
      const start = touch(1, startX, 430);
      const end = touch(1, endX, 430);
      dispatchTouch(office, 'touchstart', [start], [start], time);
      dispatchTouch(office, 'touchmove', [end], [end], time + 20);
      dispatchTouch(office, 'touchend', [end], [], time + 40);
    };

    await act(async () => swipe(385, 160, 10));
    expect(stage.dataset.mobileView).toBe('terminal');
    await act(async () => swipe(5, 230, 100));
    expect(stage.dataset.mobileView).toBe('office');
  });

  it('leaves controls, terminal selection surfaces and vertical scrolling out of edge navigation', async () => {
    await act(async () => root.render(<MobileShell office={<div>
      <button data-testid="control">Control</button>
      <textarea data-testid="selection" data-mobile-gesture-optout />
      <div data-testid="scroll">Scroll surface</div>
    </div>} />));
    const stage = host.querySelector<HTMLElement>('.observer-mobile-stage')!;
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, toJSON: () => ({}),
    } as DOMRect);
    for (const id of ['control', 'selection', 'scroll']) {
      const target = host.querySelector(`[data-testid="${id}"]`)!;
      const start = touch(1, 385, 200);
      const end = touch(1, id === 'scroll' ? 380 : 160, id === 'scroll' ? 300 : 200);
      await act(async () => {
        dispatchTouch(target, 'touchstart', [start], [start], 10);
        dispatchTouch(target, 'touchmove', [end], [end], 30);
        dispatchTouch(target, 'touchend', [end], [], 50);
      });
      expect(stage.dataset.mobileView).toBe('office');
      expect(host.querySelector<HTMLElement>('.observer-pages-track')?.style.transform).toBe('translateX(0)');
    }
  });

  it('settles a genuine cancelled edge gesture without changing pages', async () => {
    await act(async () => root.render(<MobileShell office={<div data-testid="office">office</div>} />));
    const stage = host.querySelector<HTMLElement>('.observer-mobile-stage')!;
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, toJSON: () => ({}),
    } as DOMRect);
    const target = host.querySelector('[data-testid="office"]')!;
    const start = touch(1, 385, 200);
    const end = touch(1, 160, 200);
    await act(async () => {
      dispatchTouch(target, 'touchstart', [start], [start], 10);
      dispatchTouch(target, 'touchmove', [end], [end], 30);
      dispatchTouch(target, 'touchcancel', [end], [], 50);
      dispatchTouch(target, 'touchend', [end], [], 60);
    });

    expect(stage.dataset.mobileView).toBe('office');
    expect(host.querySelector<HTMLElement>('.observer-pages-track')?.style.transform).toBe('translateX(0)');
  });

  it('settles a claimed swipe when a second finger arrives and both lift', async () => {
      await act(async () => root.render(<MobileShell office={<div data-testid="office">office</div>} />));
      const stage = host.querySelector<HTMLElement>('.observer-mobile-stage')!;
      vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, toJSON: () => ({}),
      } as DOMRect);
      const target = host.querySelector('[data-testid="office"]')!;
      const track = host.querySelector<HTMLElement>('.observer-pages-track')!;
      for (const view of ['office', 'terminal']) {
        if (view === 'terminal') await act(async () => button('Show terminal').click());
        const start = touch(1, view === 'office' ? 385 : 5, 200);
        const moved = touch(1, view === 'office' ? 305 : 85, 200);
        const extra = touch(2, 200, 200);
        await act(async () => {
          dispatchTouch(target, 'touchstart', [start], [start], 10);
          dispatchTouch(target, 'touchmove', [moved], [moved], 30);
        });
        expect(track.style.transition).toBe('none');
        expect(track.style.transform).toBe(view === 'office' ? 'translateX(-80px)' : 'translateX(-310px)');
        await act(async () => {
          dispatchTouch(target, 'touchstart', [extra], [moved, extra], 40);
          dispatchTouch(target, 'touchend', [moved], [extra], 50);
          dispatchTouch(target, 'touchend', [extra], [], 60);
        });
        expect(stage.dataset.mobileView).toBe(view);
        expect(track.style.transition).toBe('transform 180ms ease-out');
        expect(track.style.transform).toBe(view === 'office' ? 'translateX(0)' : 'translateX(-50%)');
      }
  });

  it('resets the page track on desktop and restores it when returning to mobile', async () => {
    mobileMatches = false;
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
    await act(async () => root.render(<MobileShell office={<div>office</div>} />));
    await act(async () => panel.props?.onAccessChange?.(access));
    await act(async () => panel.props?.onSelectionChange?.(first));
    const track = host.querySelector<HTMLElement>('.observer-pages-track')!;
    expect(track.style.transform).toBe('translateX(0)');

    mobileMatches = true;
    await act(async () => mediaChangeListeners.forEach(listener => listener()));
    expect(track.style.transform).toBe('translateX(-50%)');
    mobileMatches = false;
    await act(async () => mediaChangeListeners.forEach(listener => listener()));
    expect(track.style.transform).toBe('translateX(0)');
  });
});
