import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { setSoundEnabled } from './notificationSound.js';
import type { OutboundMessage } from '../../src/types.js';
import type { OfficeLayout } from './office/types.js';
import { createHostClientFixture } from './__tests__/hostClientFixture.js';
import type { HostClientFixture } from './__tests__/hostClientFixture.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const layout: OfficeLayout = {
  version: 1,
  cols: 5,
  rows: 5,
  tiles: Array(25).fill(1),
  furniture: [
    { uid: 'desk-1', type: 'desk', col: 1, row: 1, rotation: 0 },
    { uid: 'chair-1', type: 'chair', col: 1, row: 2, rotation: 0 },
    { uid: 'desk-2', type: 'desk', col: 3, row: 1, rotation: 0 },
    { uid: 'chair-2', type: 'chair', col: 3, row: 2, rotation: 0 },
  ],
};

describe('roster snapshot ordering at the App host boundary', () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: HostClientFixture;

  function send(message: OutboundMessage) {
    act(() => client.emit(message));
  }

  async function nextFrame() {
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }

  function agentLabel() {
    return [...host.querySelectorAll('button')]
      .find((button) => button.querySelector('[role="img"]'));
  }

  beforeEach(() => {
    client = createHostClientFixture();
    setSoundEnabled(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    setSoundEnabled(true);
    vi.restoreAllMocks();
  });

  it.each([
    ['file', 'File activity hint'],
    ['live', 'Live task'],
    [undefined, 'Observed activity'],
  ] as const)('labels reconnect snapshot provenance %s and clears it on idle', async (currentTaskSource, label) => {
    send({ type: 'layoutLoaded', layout });
    send({ type: 'existingAgents', agents: [{
      id: 'test-agent', name: 'TestBot', role: 'Developer', paletteIndex: 0, seatId: null,
      status: 'active', currentTask: 'Synthetic description', currentTaskSource,
    }] });
    await nextFrame();
    expect(host.querySelector('[data-agent-tools="test-agent"]')?.textContent)
      .toContain(`${label}: Synthetic description`);
    send({ type: 'agentStatus', agentId: 'test-agent', status: 'idle', currentTask: null, currentTaskSource: null });
    await nextFrame();
    expect(host.textContent).not.toContain('Synthetic description');
  });

  it('buffers roster-first activity in order, then reconciles later snapshots and removals', async () => {
    const roster = (name: string, role: string, currentTask: string | null, status: 'active' | 'idle') => ({
      type: 'existingAgents' as const,
      agents: [{
        id: 'fixture-agent',
        name,
        role,
        paletteIndex: 7,
        seatId: 'chair-2',
        status,
        currentTask,
      }],
    });

    send(roster('Fixture Agent', 'Developer', 'initial observed task', 'active'));
    expect(agentLabel()).toBeUndefined();
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'waiting' });
    send({ type: 'agentToolPermission', agentId: 'fixture-agent', tool: 'test permission' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentToolPermissionClear', agentId: 'fixture-agent' });
    send({ type: 'agentToolsClear', agentId: 'fixture-agent' });
    send({
      type: 'agentToolStart',
      agentId: 'fixture-agent',
      tool: 'fixture-tool',
      status: 'Fixture activity after reconnect',
    });
    send({
      type: 'layoutLoaded',
      layout,
      revision: 'roster-first',
      source: 'external',
      workspaceRoot: 'workspace-A',
    });
    await nextFrame();

    expect(agentLabel()?.textContent).toContain('Fixture Agent');
    expect(agentLabel()?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Active');
    expect(host.textContent).toContain('Fixture activity after reconnect');
    expect(host.textContent).not.toContain('initial observed task');
    expect(vi.mocked(client.send).mock.calls.map(([message]) => message.type)).not.toContain('telemetryEvent');

    send(roster('Renamed Fixture Agent', 'Lead Developer', 'latest observed task', 'active'));
    await nextFrame();
    expect(agentLabel()?.textContent).toContain('Renamed Fixture Agent');
    expect(agentLabel()?.textContent).toContain('Lead Developer');
    expect(host.textContent).toContain('Observed activity: latest observed task');
    expect(host.textContent).not.toContain('Fixture activity after reconnect');

    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'waiting' });
    await nextFrame();
    expect(agentLabel()?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Waiting');
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    await nextFrame();
    expect(agentLabel()?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Active');

    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });
    send({ type: 'agentToolsClear', agentId: 'fixture-agent' });
    await nextFrame();
    expect(agentLabel()?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Idle');
    expect(host.textContent).not.toContain('Observed activity:');

    send({ type: 'existingAgents', agents: [] });
    await nextFrame();
    expect(agentLabel()).toBeUndefined();
    expect(host.textContent).not.toContain('latest observed task');
  });
});
