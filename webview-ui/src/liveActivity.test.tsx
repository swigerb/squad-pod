import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { contextGauge } from './office/toolUtils.js';
import { createHostClientFixture } from './__tests__/hostClientFixture.js';
import type { HostClientFixture } from './__tests__/hostClientFixture.js';
import type { OutboundMessage } from '../../src/types.js';
import { setSoundEnabled } from './notificationSound.js';
import type { ObservedTask } from '../../src/observedTasks.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('live tools and context through the App boundary', () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: HostClientFixture;
  const send = (message: OutboundMessage) => act(() => client.emit(message));
  const frame = async () => { await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }); };
  const source = (state: 'following' | 'off' | 'error' | 'searching') => send({
    type: 'sourceStatus', status: {
      workspaceRoot: 'fixture', squadDir: 'fixture', teamFound: true, observer: 'watching',
      nativeWatch: false, error: null, liveActivity: { state, sessionId: 'session' },
    },
  });
  const row = (toolCallId: string, extra: Partial<ObservedTask> = {}): ObservedTask => ({
    sessionId: 'session', toolCallId, parentToolCallId: null, name: 'Same name',
    agentType: 'explore', mode: 'background', description: 'Projected description',
    state: 'running', agentId: null, fieldsTruncated: false, ...extra,
  });
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
    expect([...tools.children].map(element => element.textContent)).toEqual(['●Reading two.ts', '✓Reading one.ts']);
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

  it('retains three completed calls and displays at most five tool rows plus overflow during long runs', async () => {
    send({ type: 'agentStatus', agentId: 'ada', status: 'active' });
    for (let index = 0; index < 120; index++) {
      send({ type: 'agentToolStart', agentId: 'ada', toolId: `call-${index}`, tool: 'view', status: `Reading ${index}.ts` });
      send({ type: 'agentToolDone', agentId: 'ada', toolId: `call-${index}`, tool: 'view' });
    }
    await frame();
    const tools = () => host.querySelector('[data-agent-tools="ada"]')!;
    expect([...tools().children].map(row => row.textContent)).toEqual([
      '✓Reading 117.ts', '✓Reading 118.ts', '✓Reading 119.ts',
    ]);
    for (let index = 0; index < 12; index++) {
      send({ type: 'agentToolStart', agentId: 'ada', toolId: `active-${index}`, tool: 'edit', status: `Editing ${index}.ts` });
    }
    await frame();
    expect(tools().children).toHaveLength(6);
    expect(tools().textContent).toContain('+10 more tools');
    send({ type: 'agentToolDone', agentId: 'ada', toolId: 'active-7', tool: 'edit' });
    await frame();
    expect(tools().children).toHaveLength(6);
    expect(tools().textContent).not.toContain('●Editing 7.ts');
    send({ type: 'agentToolsClear', agentId: 'ada' });
    await frame();
    expect(host.querySelector('[data-agent-tools]')).toBeNull();
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

  it('renders CLI-opted-in live tools/context/tasks in a read-only standalone office without offering browser consent', async () => {
    act(() => root.render(<App client={client} readOnly standalone />));
    source('following');
    send({ type: 'existingAgents', agents: [{
      id: 'ada', name: 'Ada', role: 'Developer', status: 'active', currentTask: 'Fixture live task',
      currentTaskSource: 'live', paletteIndex: 0, seatId: null,
    }] });
    send({ type: 'agentToolStart', agentId: 'ada', toolId: 'live-read', tool: 'view', status: 'Reading fixture.ts' });
    send({ type: 'agentContextUsage', agentId: 'ada', contextTokens: 800, maxContextTokens: 1000 });
    send({ type: 'observedTasks', snapshot: { sessionId: 'session', limited: false,
      tasks: [row('live-task', { name: 'ada', agentType: 'general-purpose', agentId: 'ada' })] } });
    act(() => [...host.querySelectorAll('button')].find(item => item.textContent?.startsWith('Telemetry'))!.click());
    await frame();
    expect(host.querySelector('[data-agent-tools="ada"]')?.textContent).toContain('Reading fixture.ts');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('80');
    expect(host.querySelector('[data-observed-task="live-task"]')?.textContent).toContain('Roster match: ada');
    expect(host.textContent).toContain('Live CLI observer: following (session)');
    expect(host.textContent).toContain('not an owned-terminal correlation');
    expect(host.textContent).toContain('Browser settings cannot grant live-log consent');
    expect(host.querySelector('#squad-pod-live-activity')).toBeNull();
    expect(client.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setLiveActivity' }));
    send({ type: 'existingAgents', agents: [{
      id: 'ada', name: 'Ada', role: 'Developer', status: 'idle', currentTask: null,
      currentTaskSource: null, paletteIndex: 0, seatId: null,
    }] });
    send({ type: 'agentToolsClear', agentId: 'ada' });
    send({ type: 'agentContextUsage', agentId: 'ada', contextTokens: null, maxContextTokens: null });
    source('searching');
    send({ type: 'observedTasks', snapshot: { sessionId: null, limited: false, tasks: [] } });
    await frame();
    expect(host.querySelector('[data-agent-tools]')).toBeNull();
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector('[data-observed-task]')).toBeNull();
    expect(host.textContent).toContain('Searching for a current session');
  });

  it('renders distinct unattributed calls, explicit parents, metadata limits and coverage separately from usage', async () => {
    source('following');
    send({ type: 'observedTasks', snapshot: {
      sessionId: 'session', limited: true, tasks: [
        row('one'), row('two', { parentToolCallId: 'one', fieldsTruncated: true, state: 'failed' }),
        row('three', { agentType: 'general-purpose' }),
      ],
    } });
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.startsWith('Telemetry'))!;
    act(() => button.click());
    await frame();
    const section = host.querySelector('[aria-label="Observed transient tasks"]')!;
    expect(section.querySelectorAll('[data-observed-task]')).toHaveLength(3);
    expect(section.textContent?.match(/Unattributed/g)).toHaveLength(3);
    expect(section.textContent).toContain('#1 Same name - running');
    expect(section.textContent).toContain('#2 Same name - failed');
    expect(section.textContent).toContain('Parent: task #1');
    expect(section.textContent).toContain('Parent: unknown');
    expect(section.textContent).toContain('Display metadata truncated or omitted');
    expect(section.textContent).toContain('Partial coverage');
    expect(section.textContent).toContain('not durable membership or recorded usage');
    expect(host.querySelectorAll('[data-agent-label]')).toHaveLength(1);
    expect(host.querySelector('[data-agent-tools]')).toBeNull();
    act(() => [...host.querySelectorAll('button')].find(item => item.textContent === 'Clear activity')!.click());
    expect(section.querySelectorAll('[data-observed-task]')).toHaveLength(3);
  });

  it.each(['off', 'searching', 'error'] as const)('clears task rows on %s and does not restore them on status alone', async state => {
    source('following');
    send({ type: 'observedTasks', snapshot: { sessionId: 'session', limited: false, tasks: [row('one')] } });
    act(() => [...host.querySelectorAll('button')].find(item => item.textContent?.startsWith('Telemetry'))!.click());
    await frame();
    expect(host.querySelector('[data-observed-task]')).not.toBeNull();
    source(state);
    expect(host.querySelector('[data-observed-task]')).toBeNull();
    expect(host.querySelector('[aria-label="Observed transient tasks"] [role="status"]')).not.toBeNull();
    source('following');
    expect(host.querySelector('[data-observed-task]')).toBeNull();
    send({ type: 'observedTasks', snapshot: { sessionId: 'new-session', limited: false,
      tasks: [row('one', { sessionId: 'new-session', name: 'New session' })] } });
    expect(host.querySelector('[data-observed-task]')?.textContent).toContain('New session');
  });

  it('renders linked transient characters through host snapshots and clears them without changing the roster', async () => {
    source('following');
    const parent = row('parent', { agentId: 'ada' });
    const child = row('child', { parentToolCallId: 'parent', instanceId: 'instance' });
    const snapshot = (tasks: ObservedTask[]) => send({
      type: 'observedTasks', snapshot: { sessionId: 'session', limited: false, tasks },
    });
    snapshot([parent, { ...child, state: 'observed' }]);
    await frame();
    expect(host.querySelector('[data-subagent-label]')).toBeNull();
    snapshot([parent, child, { ...child, toolCallId: 'alias' }]);
    await frame();
    expect(host.querySelectorAll('[data-subagent-label]')).toHaveLength(1);
    expect(host.querySelector('[data-subagent-label]')?.getAttribute('data-parent-agent')).toBe('ada');
    expect(host.querySelector('[data-subagent-label]')?.textContent).toContain('Parent: Ada');
    expect(host.querySelectorAll('[data-agent-label]')).toHaveLength(1);
    snapshot([parent, { ...child, selectedAgentName: 'ada', agentId: 'ada' }]);
    await frame();
    expect(host.querySelector('[data-subagent-label]')).toBeNull();
    snapshot([parent, child]);
    await frame();
    source('searching');
    await frame();
    expect(host.querySelector('[data-subagent-label]')).toBeNull();
    expect(host.querySelectorAll('[data-agent-label]')).toHaveLength(1);
    source('following');
    await frame();
    expect(host.querySelector('[data-subagent-label]')).toBeNull();
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
