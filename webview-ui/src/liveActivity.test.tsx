import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { contextGauge } from './office/toolUtils.js';
import { createHostClientFixture } from './__tests__/hostClientFixture.js';
import type { HostClientFixture } from './__tests__/hostClientFixture.js';
import type { OutboundMessage } from '../../src/types.js';
import { setSoundEnabled } from './notificationSound.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('live tools and context through the App boundary', () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: HostClientFixture;
  const send = (message: OutboundMessage) => act(() => client.emit(message));
  const frame = async () => { await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }); };
  beforeEach(() => {
    client = createHostClientFixture();
    setSoundEnabled(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
    send({ type: 'layoutLoaded', layout: {
      version: 2, cols: 10, rows: 10, tiles: Array(100).fill(1), furniture: [],
    } });
    send({ type: 'existingAgents', agents: [{
      id: 'ada', name: 'Ada', role: 'Developer', status: 'idle', currentTask: null, paletteIndex: 0, seatId: null,
    }] });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('pairs duplicate tool names by toolId, renders context accessibly and clears every live surface', async () => {
    send({ type: 'agentStatus', agentId: 'ada', status: 'active' });
    send({ type: 'agentToolStart', agentId: 'ada', toolId: 'one', tool: 'view', status: 'Reading one.ts' });
    send({ type: 'agentToolStart', agentId: 'ada', toolId: 'two', tool: 'view', status: 'Reading two.ts' });
    send({ type: 'agentToolDone', agentId: 'ada', toolId: 'one', tool: 'view' });
    send({ type: 'agentContextUsage', agentId: 'ada', contextTokens: 800, maxContextTokens: 1000 });
    await frame();
    const tools = host.querySelector('[data-agent-tools="ada"]')!;
    expect(tools.textContent).toContain('Reading one.ts');
    expect(tools.textContent).toContain('Reading two.ts');
    expect([...tools.children].map(element => element.textContent)).toEqual(['✓Reading one.ts', '●Reading two.ts']);
    const gauge = host.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(gauge.title).toBe('80% context used (0.8k of 1.0k tokens)');
    expect(gauge.getAttribute('aria-label')).toBe(gauge.title);
    expect(gauge.getAttribute('aria-valuenow')).toBe('80');
    expect(gauge.style.width).toBe('40px');
    expect(gauge.style.height).toBe('4px');
    expect(gauge.firstElementChild?.getAttribute('style')).toContain('80%');
    send({ type: 'agentToolsClear', agentId: 'ada' });
    send({ type: 'agentContextUsage', agentId: 'ada', contextTokens: null, maxContextTokens: null });
    send({ type: 'agentStatus', agentId: 'ada', status: 'idle' });
    await frame();
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector('[data-agent-tools]')).toBeNull();
    expect(host.querySelector('[data-agent-tool-bubble]')).toBeNull();
  });

  it('shows only whitelist-derived live rows in the telemetry drawer', async () => {
    const secret = 'SENTINEL_SECRET_NEVER_LEAVE_PARSER';
    const rows = ['Live member started', 'Reading fixture.ts', 'Live member finished'];
    for (const [index, summary] of rows.entries()) send({ type: 'telemetryEvent', event: {
      id: `live-${index}`, timestamp: Date.now(), category: 'status', agentId: 'ada', agentName: null, summary, detail: null,
    } });
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.startsWith('Telemetry'))!;
    act(() => button.click());
    await frame();
    for (const row of rows) expect(host.textContent).toContain(row);
    expect(host.textContent).not.toContain(secret);
  });

  it('requests the host consent flow rather than optimistically enabling the checkbox', async () => {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'Settings')!;
    act(() => button.click());
    await frame();
    const checkbox = host.querySelector<HTMLInputElement>('#squad-pod-live-activity')!;
    expect(checkbox.checked).toBe(false);
    act(() => checkbox.click());
    expect(client.send).toHaveBeenCalledWith({ type: 'setLiveActivity', enabled: true });
    expect(checkbox.checked).toBe(false);
    send({ type: 'sourceStatus', status: {
      workspaceRoot: 'fixture', squadDir: 'fixture', teamFound: true, observer: 'watching',
      nativeWatch: false, error: null, liveActivity: { state: 'following', sessionId: '12345678' },
    } });
    expect(checkbox.checked).toBe(true);
    expect(host.textContent).toContain('Live source: following (12345678)');
    act(() => checkbox.click());
    expect(client.send).toHaveBeenCalledWith({ type: 'setLiveActivity', enabled: false });
  });

  it.each([
    [0, '#4ade80'], [0.5999, '#4ade80'], [0.6, '#facc15'], [0.7999, '#facc15'],
    [0.8, '#fb923c'], [0.9499, '#fb923c'], [0.95, '#ef4444'], [1, '#ef4444'], [2, '#ef4444'],
  ])('uses the exact context threshold at %s', (ratio, color) => {
    const gauge = contextGauge({ contextTokens: ratio * 1000, maxContextTokens: 1000 });
    expect(gauge.color).toBe(color);
    expect(gauge.percent).toBeLessThanOrEqual(100);
  });
});
