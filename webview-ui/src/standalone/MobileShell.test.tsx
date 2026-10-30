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
const mediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const touchDescriptor = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  panel.props = null;
  panel.launchRequests.length = 0;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
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
});
