import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { createHostClientFixture, type HostClientFixture } from './__tests__/hostClientFixture.js';
import type { OutboundMessage } from '../../src/types.js';
import type { ObservedTask } from '../../src/observedTasks.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const secret = 'PRIVATE_PROMPT_ARGUMENT_OUTPUT';
const row: ObservedTask = {
  sessionId: 'session-full', toolCallId: 'run', parentToolCallId: null, agentId: 'ada',
  name: secret, agentType: 'general-purpose', mode: 'background', description: secret,
  state: 'running', fieldsTruncated: false,
};

describe('source-grounded summaries through the production App', () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: HostClientFixture;
  const send = (message: OutboundMessage) => act(() => client.emit(message));
  const frame = async () => {
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  };
  const source = (state: 'following' | 'off' | 'searching' | 'error', sessionId = 'session-') => send({
    type: 'sourceStatus', status: {
      workspaceRoot: 'bubble-fixture', squadDir: 'bubble-fixture', teamFound: true, observer: 'watching',
      nativeWatch: false, error: null, liveActivity: { state, sessionId },
    },
  });
  const tasks = (tasks: ObservedTask[] = [row]) => send({
    type: 'observedTasks', snapshot: { sessionId: 'session-full', limited: false, tasks },
  });
  const bubble = () => host.querySelector('[data-agent-task-bubble="ada"]');
  beforeEach(() => {
    client = createHostClientFixture();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
    send({ type: 'layoutLoaded', layout: {
      version: 2, cols: 10, rows: 10, tiles: Array(100).fill(1), furniture: [],
    } });
    source('following');
    send({ type: 'existingAgents', agents: [{
      id: 'ada', name: 'Ada', role: 'Developer', status: 'active', currentTask: secret,
      currentTaskSource: 'live', paletteIndex: 0, seatId: null,
    }] });
    tasks();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('shows fixed task/tool phrases, never raw metadata, and falls back when a tool ends', async () => {
    await frame();
    expect(bubble()?.textContent).toBe('CLI task: Task in progress');
    send({ type: 'agentToolStart', agentId: 'ada', toolId: 'read', tool: 'view', status: secret });
    await frame();
    expect(bubble()?.textContent).toBe('CLI tool: Reading a file');
    expect(bubble()?.getAttribute('role')).toBe('note');
    expect(bubble()?.getAttribute('aria-label')).toBe('Ada: CLI tool: Reading a file');
    expect(bubble()?.textContent).not.toContain(secret);
    send({ type: 'agentToolStart', agentId: 'ada', toolId: 'edit', tool: 'edit', status: secret });
    send({ type: 'agentToolDone', agentId: 'ada', toolId: 'edit' });
    await frame();
    expect(bubble()?.textContent).toBe('CLI tool: Reading a file');
    send({ type: 'agentToolDone', agentId: 'ada', toolId: 'read' });
    await frame();
    expect(bubble()?.textContent).toBe('CLI task: Task in progress');
  });

  it.each(['off', 'searching', 'error'] as const)('clears %s sources without reviving on status alone', async state => {
    await frame();
    expect(bubble()).not.toBeNull();
    source(state);
    await frame();
    expect(bubble()).toBeNull();
    source('following');
    await frame();
    expect(bubble()).toBeNull();
  });

  it('invalidates snapshot on session switch including equal shortened display IDs', async () => {
    await frame();
    expect(bubble()).not.toBeNull();
    source('following', 'another');
    source('following');
    await frame();
    expect(bubble()).toBeNull();
    tasks([{ ...row, sessionId: 'different-full-session' }]);
    await frame();
    expect(bubble()).toBeNull();
  });

  it.each(['completed', 'failed', 'aborted'] as const)('clears %s task text immediately', async state => {
    await frame();
    tasks([{ ...row, state }]);
    await frame();
    expect(bubble()).toBeNull();
  });

  it('requires a live source rather than file hints and clears idle or removed members', async () => {
    send({ type: 'agentStatus', agentId: 'ada', status: 'active', currentTask: secret, currentTaskSource: 'file' });
    await frame();
    expect(bubble()).toBeNull();
    send({ type: 'agentStatus', agentId: 'ada', status: 'active', currentTask: secret, currentTaskSource: 'live' });
    await frame();
    expect(bubble()).not.toBeNull();
    send({ type: 'agentStatus', agentId: 'ada', status: 'idle' });
    await frame();
    expect(bubble()).toBeNull();
    send({ type: 'agentClosed', agentId: 'ada' });
    await frame();
    expect(bubble()).toBeNull();
  });

  it('lets a read-only standalone viewer suppress chatter without settings/control authority or signal loss', async () => {
    act(() => root.render(<App client={client} readOnly standalone />));
    source('following');
    tasks();
    send({ type: 'agentToolStart', agentId: 'ada', toolId: 'read', tool: 'view', status: 'Reading fixture.ts' });
    send({ type: 'agentContextUsage', agentId: 'ada', contextTokens: 800, maxContextTokens: 1000 });
    send({ type: 'agentToolPermission', agentId: 'ada', tool: 'view' });
    await frame();
    const toggle = [...host.querySelectorAll('button')].find(button => button.textContent === 'Task bubbles: On')!;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(bubble()).not.toBeNull();
    const sent = client.send.mock.calls.length;
    act(() => toggle.click());
    await frame();
    expect(bubble()).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('[data-agent-label="ada"] [aria-label="Permission required"]')).not.toBeNull();
    expect(host.querySelector('[data-agent-tools="ada"]')?.textContent).toContain('Reading fixture.ts');
    expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(client.send).toHaveBeenCalledTimes(sent);
    act(() => toggle.click());
    await frame();
    expect(bubble()).not.toBeNull();
    tasks([]);
    await frame();
    expect(bubble()).toBeNull();
  });
});
