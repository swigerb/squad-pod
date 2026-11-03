import { describe, expect, it } from 'vitest';
import type { OutboundMessage } from '../../../src/types.js';
import { CanvasActivity } from './activity.js';
import { decodeEvent } from '../events.js';

const roster: OutboundMessage = { type: 'existingAgents', agents: [
  { id: 'lisa-simpson', name: 'Lisa Simpson', role: 'Developer', status: 'idle',
    paletteIndex: 0, seatId: null, currentTask: null },
  { id: 'homer-simpson', name: 'Homer Simpson', role: 'Lead', status: 'idle',
    paletteIndex: 1, seatId: null, currentTask: null },
] };
function fixture() {
  const messages: OutboundMessage[] = [];
  const live = new CanvasActivity('joined-session', message => messages.push(message));
  live.snapshot([roster]);
  let id = 0;
  const send = (type: string, data: Record<string, unknown> = {}, agentId?: string) =>
    live.accept({ type, id: `event-${++id}`, timestamp: '2026-11-03T20:30:00Z', agentId, data });
  const tasks = () => live.current().find(message => message.type === 'observedTasks')!.snapshot;
  const models = () => live.current().find(message => message.type === 'liveModels')!.snapshot;
  const agents = () => live.snapshot([roster]).find(message => message.type === 'existingAgents')!.agents;
  return { live, messages, send, tasks, models, agents };
}

describe('joined SDK activity projection fixtures', () => {
  function dispatch(f: ReturnType<typeof fixture>, name = 'homer-simpson') {
    f.send('tool.execution_start', { toolCallId: 'dispatch', toolName: 'task', turnId: 'root-turn',
      model: 'not-an-observation', arguments: {
        name, agent_type: 'general-purpose', mode: 'sync', description: 'Implement Canvas attribution',
        prompt: 'PRIVATE_TASK_PROMPT',
      } });
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'general-purpose',
      agentDisplayName: 'general-purpose', agentDescription: 'PRIVATE_AGENT_DESCRIPTION',
      agentType: 'general-purpose', executionMode: 'sync', model: 'started-model' }, 'actor');
  }

  it('correlates a native-shaped named task to a generic SDK agent and live member activity', () => {
    const f = fixture();
    dispatch(f);
    expect(f.tasks().tasks).toEqual([expect.objectContaining({
      toolCallId: 'dispatch', name: 'homer-simpson', agentType: 'general-purpose',
      mode: 'sync', description: 'Implement Canvas attribution', instanceId: 'actor',
      agentId: 'homer-simpson', state: 'running',
    })]);
    expect(f.agents()[1]).toMatchObject({ status: 'active',
      currentTask: 'Implement Canvas attribution', currentTaskSource: 'live' });
    f.send('subagent.configured', { toolCallId: 'dispatch', model: 'configured-model' }, 'actor');
    expect(f.models().members['homer-simpson']).toMatchObject({
      model: 'configured-model', source: 'subagent.configured.model', kind: 'subagent-model',
    });
    expect(f.models().session).toBeNull();
    f.send('assistant.turn_start', { turnId: 'member-turn' }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'read', toolName: 'view', parentToolCallId: 'dispatch',
      arguments: { path: 'C:\\private-workspace\\activity.ts', prompt: 'PRIVATE_TOOL_PROMPT' } }, 'actor');
    expect(f.messages).toContainEqual({ type: 'agentToolStart', agentId: 'homer-simpson',
      toolId: 'read', tool: 'view', status: 'Reading activity.ts' });
    f.send('tool.execution_complete', { toolCallId: 'read', parentToolCallId: 'dispatch',
      result: 'PRIVATE_TOOL_RESULT', toolTelemetry: { metrics: {
        context_current_tokens: 10, context_token_limit: 100,
      } } }, 'actor');
    expect(f.messages).toContainEqual({ type: 'agentToolDone', agentId: 'homer-simpson',
      toolId: 'read', tool: 'view' });
    expect(f.live.current()).toContainEqual({ type: 'agentContextUsage', agentId: 'homer-simpson',
      contextTokens: 10, maxContextTokens: 100 });
    f.send('tool.execution_complete', { toolCallId: 'dispatch' });
    expect(f.agents()[1].status).toBe('active');
    f.send('subagent.completed', { toolCallId: 'dispatch', agentName: 'general-purpose' }, 'actor');
    expect(f.tasks().tasks[0]).toMatchObject({ state: 'completed', agentId: 'homer-simpson' });
    expect(f.agents()[1]).toMatchObject({ status: 'idle', currentTask: null, currentTaskSource: null });
    expect(f.models().members).toEqual({});
    expect(f.live.current().filter(message =>
      ['agentToolStart', 'agentContextUsage'].includes(message.type))).toEqual([]);
    expect(f.messages.filter(message => message.type === 'telemetryEvent'
      && message.event.agentId === 'homer-simpson').length).toBeGreaterThan(0);
    f.send('session.idle');
    expect(f.tasks().tasks).toEqual([]);
    expect(JSON.stringify([...f.messages, ...f.live.current()])).not.toMatch(
      /PRIVATE_|private-workspace|not-an-observation|"arguments"|"prompt"|"result"/);
    for (const message of [...f.messages, ...f.live.current()])
      expect(decodeEvent(JSON.stringify({ version: 1, kind: 'office', message }))).toEqual(message);
  });

  it.each(['subagent.completed', 'subagent.failed', 'subagent.aborted', 'cancelled', 'session.idle', 'clear'])(
    'clears correlated member tools, turns, models and gauges on %s', terminal => {
      const f = fixture();
      dispatch(f);
      f.send('assistant.turn_start', { turnId: 'turn' }, 'actor');
      f.send('session.usage_info', { currentTokens: 1, tokenLimit: 100 }, 'actor');
      f.send('tool.execution_start', { toolCallId: 'pending', toolName: 'edit',
        arguments: { path: 'C:\\private\\activity.ts' } }, 'actor');
      expect(f.agents()[1].status).toBe('active');
      expect(f.live.current()).toContainEqual({ type: 'agentToolStart', agentId: 'homer-simpson',
        toolId: 'pending', tool: 'edit', status: 'Editing activity.ts' });
      if (terminal === 'clear') f.live.clear();
      else if (terminal === 'session.idle') f.send(terminal);
      else f.send(terminal === 'cancelled' ? 'subagent.completed' : terminal,
        { toolCallId: 'dispatch', agentName: 'general-purpose', cancelled: terminal === 'cancelled' });
      expect(f.agents().every(agent => agent.status === 'idle' && agent.currentTask === null)).toBe(true);
      expect(f.models().members).toEqual({});
      expect(f.live.current().filter(message =>
        ['agentToolStart', 'agentContextUsage'].includes(message.type))).toEqual([]);
      expect(f.messages).toContainEqual({ type: 'agentToolsClear', agentId: 'homer-simpson' });
      expect(f.messages).toContainEqual({ type: 'agentContextUsage', agentId: 'homer-simpson',
        contextTokens: null, maxContextTokens: null });
    });

  it.each(['unknown', 'Homer Simpson', 'homer-simpson-extra', 'homer-simpson'.padEnd(161, 'x')])(
    'keeps non-exact spawning identity %s transient without promoting generic SDK metadata', name => {
      const f = fixture();
      dispatch(f, name);
      f.send('tool.execution_start', { toolCallId: 'read', toolName: 'view',
        parentToolCallId: 'dispatch', arguments: { path: 'file.ts' } }, 'actor');
      expect(f.tasks().tasks[0]).toMatchObject({ agentId: null, state: 'running' });
      expect(f.agents().map(agent => agent.id)).toEqual(['lisa-simpson', 'homer-simpson']);
      expect(f.agents().every(agent => agent.status === 'idle')).toBe(true);
      expect(f.messages.filter(message => message.type === 'agentToolStart')).toEqual([]);
      expect(f.models().members).toEqual({});
      expect(f.live.current().filter(message => message.type === 'agentContextUsage')).toEqual([]);
    });

  it('bounds spawn metadata and uses only basename and executable labels from tool arguments', () => {
    const f = fixture();
    f.send('tool.execution_start', { toolCallId: 'dispatch', toolName: 'task', arguments: {
      name: 'homer-simpson', agent_type: 'general-purpose', mode: 'x'.repeat(1000),
      description: 'y'.repeat(1000), prompt: 'PRIVATE',
    } });
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'general-purpose' }, 'actor');
    expect(f.tasks().tasks[0]).toMatchObject({ name: 'homer-simpson', agentId: 'homer-simpson',
      fieldsTruncated: true, mode: 'x'.repeat(160) });
    expect(f.tasks().tasks[0].description.length).toBeLessThan(1000);
    for (const [toolName, args, label] of [
      ['create', { path: 'C:\\PRIVATE\\new.ts', file_text: 'PRIVATE' }, 'Writing new.ts'],
      ['bash', { command: 'node PRIVATE --token=PRIVATE' }, 'Running: node'],
      ['powershell', { command: 'Get-Content C:\\PRIVATE' }, 'Running: Get-Content'],
    ] as const) {
      f.send('tool.execution_start', { toolCallId: toolName, toolName, arguments: args }, 'actor');
      expect(f.messages).toContainEqual({ type: 'agentToolStart', agentId: 'homer-simpson',
        toolId: toolName, tool: toolName, status: label });
    }
    expect(JSON.stringify([...f.messages, ...f.live.current()])).not.toContain('PRIVATE');
  });

  it('clears correlated activity on a roster context change and does not retain dispatch aliases', () => {
    const f = fixture();
    dispatch(f);
    f.send('tool.execution_start', { toolCallId: 'read', toolName: 'view' }, 'actor');
    f.live.snapshot([{ ...roster, agents: roster.agents.filter(agent => agent.id !== 'homer-simpson') }]);
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
    expect(f.tasks().tasks).toEqual([]);
    expect(f.models().members).toEqual({});
    expect(f.agents().every(agent => agent.status === 'idle')).toBe(true);
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'general-purpose' }, 'actor');
    expect(f.tasks().tasks[0]).toMatchObject({ state: 'running', agentId: null });
    expect(f.agents().every(agent => agent.status === 'idle')).toBe(true);
  });

  it('does not retain an unstarted named dispatch alias across root idle', () => {
    const f = fixture();
    f.send('tool.execution_start', { toolCallId: 'dispatch', toolName: 'task', arguments: {
      name: 'homer-simpson', agent_type: 'general-purpose', description: 'Pending dispatch',
    } });
    f.send('session.idle');
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'general-purpose' }, 'actor');
    f.send('assistant.turn_start', { turnId: 'late-turn' }, 'actor');
    expect(f.agents().every(agent => agent.status === 'idle')).toBe(true);
    expect(f.tasks().tasks.every(task => task.agentId === null)).toBe(true);
  });

  it.each([true, false])('reconciles exact selected identity before/after start (before=%s)', before => {
    const f = fixture();
    if (before) f.send('subagent.selected', { agentName: 'lisa-simpson' }, 'actor');
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'general-purpose' }, 'actor');
    if (!before) f.send('subagent.selected', { agentName: 'lisa-simpson' }, 'actor');
    expect(f.tasks().tasks).toEqual([expect.objectContaining({
      toolCallId: 'dispatch', instanceId: 'actor', agentId: 'lisa-simpson', state: 'running',
    })]);
    expect(f.agents()[0]).toMatchObject({ status: 'active', currentTaskSource: 'live' });
    f.send('tool.execution_start', { toolCallId: 'read', toolName: 'view' }, 'actor');
    expect(f.messages).toContainEqual({ type: 'agentToolStart', agentId: 'lisa-simpson',
      toolId: 'read', tool: 'view', status: 'Reading file' });
    f.send('tool.execution_complete', { toolCallId: 'read', model: 'runtime-model' }, 'actor');
    expect(f.messages).toContainEqual({ type: 'agentToolDone', agentId: 'lisa-simpson',
      toolId: 'read', tool: 'view' });
    expect(f.models().members['lisa-simpson']).toMatchObject({
      model: 'runtime-model', source: 'tool.execution_complete.model', kind: 'tool-call',
    });
    f.send('subagent.completed', { toolCallId: 'dispatch' }, 'actor');
    expect(f.tasks().tasks[0].state).toBe('completed');
    expect(f.agents()[0]).toMatchObject({ status: 'idle', currentTaskSource: null });
    expect(f.models().members).toEqual({});
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
  });

  it('starts without replay, recognizes exact started names, and never promotes unknown/display-name agents', () => {
    const f = fixture();
    expect(f.tasks().tasks).toEqual([]);
    for (const [i, name] of ['lisa-simpson', 'Lisa Simpson', 'unknown'].entries())
      f.send('subagent.started', { toolCallId: `call-${i}`, agentName: name }, `actor-${i}`);
    expect(f.tasks().tasks.map(task => task.agentId)).toEqual(['lisa-simpson', null, null]);
    expect(f.agents().map(agent => agent.id)).toEqual(['lisa-simpson', 'homer-simpson']);
  });

  it('ignores duplicate event IDs, duplicate tool calls and terminal restarts', () => {
    const f = fixture();
    const start = { type: 'subagent.started', id: 'same', agentId: 'actor',
      data: { toolCallId: 'dispatch', agentName: 'lisa-simpson' } };
    f.live.accept(start); f.live.accept(start);
    f.send('tool.execution_start', { toolCallId: 'tool', toolName: 'view' }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'tool', toolName: 'edit' }, 'actor');
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toHaveLength(1);
    f.send('subagent.failed', { toolCallId: 'dispatch', error: 'PRIVATE' }, 'actor');
    f.live.accept({ ...start, id: 'late-start' });
    expect(f.tasks().tasks).toHaveLength(1);
    expect(f.tasks().tasks[0].state).toBe('failed');
    expect(f.agents()[0].status).toBe('idle');
    expect(JSON.stringify(f.messages)).not.toContain('PRIVATE');
  });

  it('does not resurrect a call when its terminal event arrives before its start', () => {
    const f = fixture();
    f.send('subagent.failed', { toolCallId: 'call', agentName: 'lisa-simpson' }, 'actor');
    f.send('subagent.started', { toolCallId: 'call', agentName: 'lisa-simpson' }, 'actor');
    expect(f.tasks().tasks).toEqual([expect.objectContaining({ toolCallId: 'call', state: 'failed' })]);
    expect(f.agents()[0].status).toBe('idle');
  });

  it.each([false, true])('tombstones tool completions before late starts (root=%s)', root => {
    const f = fixture();
    const actor = root ? undefined : 'actor';
    if (root) f.send('subagent.selected', { agentName: 'lisa-simpson' });
    else f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'lisa-simpson' }, actor);
    f.send('tool.execution_complete', { toolCallId: 'late' }, actor);
    f.send('tool.execution_complete', { toolCallId: 'late' }, actor);
    f.send('tool.execution_start', { toolCallId: 'late', toolName: 'view' }, actor);
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toEqual([]);
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
  });

  it('bounds tool tombstones and retains recent completions after event-ID eviction', () => {
    const f = fixture();
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'lisa-simpson' }, 'actor');
    for (let i = 0; i < 129; i++)
      f.send('tool.execution_complete', { toolCallId: `done-${i}` }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'done-128', toolName: 'view' }, 'actor');
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toEqual([]);
    f.send('tool.execution_start', { toolCallId: 'done-0', toolName: 'view' }, 'actor');
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toEqual([
      { type: 'agentToolStart', agentId: 'lisa-simpson', toolId: 'done-0', tool: 'view', status: 'Reading file' },
    ]);
    expect(f.tasks().limited).toBe(true);
  });

  it('refreshes completion tombstones and rejects duplicate starts even after start-ID eviction', () => {
    const f = fixture();
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'lisa-simpson' }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'running', toolName: 'view' }, 'actor');
    for (let i = 0; i < 128; i++)
      f.send('tool.execution_complete', { toolCallId: `done-${i}` }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'running', toolName: 'edit' }, 'actor');
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toHaveLength(1);
    f.send('tool.execution_complete', { toolCallId: 'running' }, 'actor');
    for (let i = 0; i < 127; i++)
      f.send('tool.execution_complete', { toolCallId: `new-${i}` }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'running', toolName: 'edit' }, 'actor');
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toHaveLength(1);
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
    f.send('tool.execution_start', { toolCallId: 'old-start', toolName: 'view' }, 'actor');
    for (let i = 0; i < 127; i++)
      f.send('tool.execution_complete', { toolCallId: `refresh-${i}` }, 'actor');
    f.send('tool.execution_complete', { toolCallId: 'old-start' }, 'actor');
    f.send('tool.execution_complete', { toolCallId: 'overflow' }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'old-start', toolName: 'edit' }, 'actor');
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toHaveLength(2);
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
  });

  it('invalidates child selections on root idle until a new dispatch, while retaining the root', () => {
    const f = fixture();
    f.send('subagent.selected', { agentName: 'homer-simpson' });
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'lisa-simpson' }, 'actor');
    f.send('assistant.turn_start', { turnId: 'first' }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'old-tool', toolName: 'view' }, 'actor');
    f.send('session.idle');
    f.send('assistant.turn_start', { turnId: 'delayed' }, 'actor');
    f.send('session.usage_info', { currentTokens: 1, tokenLimit: 100 }, 'actor');
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'lisa-simpson' }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'old-tool', toolName: 'view' }, 'actor');
    expect(f.agents().map(agent => agent.status)).toEqual(['idle', 'idle']);
    expect(f.live.current().filter(message => ['agentToolStart', 'agentContextUsage'].includes(message.type))).toEqual([]);
    f.send('assistant.turn_start', { turnId: 'root-next' });
    expect(f.agents()[1].status).toBe('active');
    f.send('subagent.started', { toolCallId: 'new-dispatch', agentName: 'lisa-simpson' }, 'actor');
    f.send('assistant.turn_start', { turnId: 'new-turn' }, 'actor');
    expect(f.agents()[0].status).toBe('active');
  });

  it('attributes root tools only to an exact selection, completes once, and clears on idle or reselection', () => {
    const f = fixture();
    f.send('subagent.selected', { agentName: 'lisa-simpson' });
    f.send('tool.execution_start', { toolCallId: 'read', toolName: 'view' });
    f.send('tool.execution_start', { toolCallId: 'read', toolName: 'edit' });
    const start = { type: 'agentToolStart', agentId: 'lisa-simpson',
      toolId: 'read', tool: 'view', status: 'Reading file' };
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toEqual([start]);
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([start]);
    expect(f.agents()[0].status).toBe('active');
    f.send('tool.execution_complete', { toolCallId: 'read' });
    f.send('tool.execution_complete', { toolCallId: 'read' });
    expect(f.messages.filter(message => message.type === 'agentToolDone')).toEqual([
      { type: 'agentToolDone', agentId: 'lisa-simpson', toolId: 'read', tool: 'view' },
    ]);
    expect(f.agents()[0].status).toBe('idle');
    f.send('tool.execution_start', { toolCallId: 'pending', toolName: 'view' });
    f.send('subagent.selected', { agentName: 'unknown' });
    expect(f.messages).toContainEqual({ type: 'agentToolsClear', agentId: 'lisa-simpson' });
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
    f.send('tool.execution_start', { toolCallId: 'unknown', toolName: 'view' });
    f.send('subagent.selected', { agentName: 'Lisa Simpson' });
    f.send('tool.execution_start', { toolCallId: 'display-name', toolName: 'view' });
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
    f.send('subagent.selected', { agentName: 'homer-simpson' });
    f.send('tool.execution_start', { toolCallId: 'idle-tool', toolName: 'view' });
    f.send('session.idle');
    f.send('tool.execution_start', { toolCallId: 'idle-tool', toolName: 'view' });
    expect(f.messages).toContainEqual({ type: 'agentToolsClear', agentId: 'homer-simpson' });
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
    expect(f.agents().every(agent => agent.status === 'idle')).toBe(true);
    expect(f.tasks().tasks).toEqual([]);
  });

  it('does not attribute malformed parent identities to the exact root selection', () => {
    const f = fixture();
    f.send('subagent.selected', { agentName: 'lisa-simpson' });
    f.send('tool.execution_start', { toolCallId: 'invalid-parent', toolName: 'view',
      parentToolCallId: 'x'.repeat(161) });
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toEqual([]);
    expect(f.tasks().limited).toBe(true);
  });

  it('tombstones cleared root tools on idle even after their start tombstones were evicted', () => {
    const f = fixture();
    f.send('subagent.selected', { agentName: 'lisa-simpson' });
    f.send('tool.execution_start', { toolCallId: 'old-root-tool', toolName: 'view' });
    for (let i = 0; i < 128; i++) f.send('tool.execution_complete', { toolCallId: `done-${i}` });
    f.send('session.idle');
    f.send('tool.execution_start', { toolCallId: 'old-root-tool', toolName: 'edit' });
    expect(f.messages.filter(message => message.type === 'agentToolStart')).toHaveLength(1);
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
    expect(f.agents()[0].status).toBe('idle');
  });

  it('cleans terminal activity even when the terminal envelope omits the optional actor', () => {
    const f = fixture();
    f.send('subagent.started', { toolCallId: 'call', agentName: 'lisa-simpson' }, 'actor');
    f.send('assistant.turn_start', { turnId: 'turn' }, 'actor');
    f.send('session.usage_info', { currentTokens: 1, tokenLimit: 100 }, 'actor');
    f.send('subagent.completed', { toolCallId: 'call' });
    expect(f.agents()[0].status).toBe('idle');
    expect(f.live.current().filter(message => message.type === 'agentContextUsage')).toEqual([]);
  });

  it('emits only messages accepted by the existing browser observer codec', () => {
    const f = fixture();
    f.send('subagent.started', { toolCallId: 'call', agentName: 'lisa-simpson', model: 'runtime' }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'tool', toolName: 'view' }, 'actor');
    f.send('session.usage_info', { currentTokens: 0, tokenLimit: 100 }, 'actor');
    f.send('tool.execution_complete', { toolCallId: 'tool', model: 'runtime' }, 'actor');
    f.send('subagent.completed', { toolCallId: 'call' }, 'actor');
    for (const message of [...f.messages, ...f.live.current()]) {
      expect(decodeEvent(JSON.stringify({ version: 1, kind: 'office', message }))).toEqual(message);
    }
  });

  it('uses selected identities for turn working/idle and clears all ephemeral state on root idle', () => {
    const f = fixture();
    f.send('subagent.selected', { agentName: 'lisa-simpson' });
    f.send('assistant.turn_start', { turnId: 'turn' });
    expect(f.agents()[0].status).toBe('active');
    f.send('session.usage_info', { currentTokens: 123, tokenLimit: 1000 });
    expect(f.live.current()).toContainEqual({ type: 'agentContextUsage', agentId: 'lisa-simpson',
      contextTokens: 123, maxContextTokens: 1000 });
    f.send('assistant.turn_end', { turnId: 'turn' });
    expect(f.agents()[0].status).toBe('idle');
    f.send('session.model_change', { newModel: 'selected-runtime' });
    expect(f.models().session).toMatchObject({
      model: 'selected-runtime', kind: 'session-selection', source: 'session.model_change.newModel',
    });
    f.send('session.idle');
    expect(f.models().session).toMatchObject({ model: 'selected-runtime' });
    expect(f.tasks()).toEqual({ sessionId: 'joined-session', tasks: [], limited: false });
    expect(f.messages).toContainEqual({ type: 'agentContextUsage', agentId: 'lisa-simpson',
      contextTokens: null, maxContextTokens: null });
  });

  it('does not let scoped idle stop another member', () => {
    const f = fixture();
    f.send('subagent.started', { toolCallId: 'a', agentName: 'lisa-simpson' }, 'actor-a');
    f.send('subagent.started', { toolCallId: 'b', agentName: 'homer-simpson' }, 'actor-b');
    f.send('session.idle', {}, 'actor-a');
    expect(f.agents().map(agent => agent.status)).toEqual(['idle', 'active']);
  });

  it('reconciles an exact selected member to an unknown identity without stale tools, turns or models', () => {
    const f = fixture();
    f.send('subagent.started', { toolCallId: 'call', agentName: 'lisa-simpson', model: 'runtime' }, 'actor');
    f.send('assistant.turn_start', { turnId: 'turn' }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'tool', toolName: 'view' }, 'actor');
    f.send('subagent.selected', { agentName: 'unknown' }, 'actor');
    expect(f.agents()[0].status).toBe('idle');
    expect(f.tasks().tasks[0]).toMatchObject({ agentId: null, state: 'running' });
    expect(f.models().members).toEqual({});
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
  });

  it('retains the exact root selection across idle for subsequent turns, not prior work', () => {
    const f = fixture();
    f.send('subagent.selected', { agentName: 'lisa-simpson' });
    f.send('assistant.turn_start', { turnId: 'first' });
    f.send('session.idle');
    expect(f.agents()[0].status).toBe('idle');
    f.send('assistant.turn_start', { turnId: 'second' });
    expect(f.agents()[0].status).toBe('active');
    expect(f.tasks().tasks).toEqual([]);
  });

  it('does not resurrect completed or idle-ended turns on out-of-order duplicate starts', () => {
    const f = fixture();
    f.send('subagent.selected', { agentName: 'lisa-simpson' });
    f.send('assistant.turn_end', { turnId: 'already-ended' });
    f.send('assistant.turn_start', { turnId: 'already-ended' });
    expect(f.agents()[0].status).toBe('idle');
    f.send('assistant.turn_start', { turnId: 'idle-ended' });
    f.send('session.idle');
    f.send('assistant.turn_start', { turnId: 'idle-ended' });
    expect(f.agents()[0].status).toBe('idle');
  });

  it('projects only whitelisted completion context metrics and preserves the latest context', () => {
    const f = fixture();
    f.send('subagent.started', { toolCallId: 'call', agentName: 'lisa-simpson' }, 'actor');
    f.send('session.usage_info', { currentTokens: 1, tokenLimit: 100 }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'tool', toolName: 'view' }, 'actor');
    f.send('tool.execution_complete', { toolCallId: 'tool', toolTelemetry: { metrics: {
      context_current_tokens: 2, context_token_limit: 100, prompt: 'PRIVATE',
    } } }, 'actor');
    expect(f.live.current().filter(message => message.type === 'agentContextUsage').at(-1)).toEqual({
      type: 'agentContextUsage', agentId: 'lisa-simpson', contextTokens: 2, maxContextTokens: 100,
    });
    expect(JSON.stringify(f.messages)).not.toContain('PRIVATE');
  });

  it('keeps absent or invalid producer fields unavailable instead of creating zero metrics', () => {
    const f = fixture();
    f.send('subagent.selected', { agentName: 'lisa-simpson' });
    for (const data of [{}, { currentTokens: 0 }, { currentTokens: -1, tokenLimit: 100 },
      { currentTokens: 1, tokenLimit: 0 }, { currentTokens: Infinity, tokenLimit: 100 }])
      f.send('session.usage_info', data);
    f.send('session.model_change', {});
    expect(f.messages.filter(message => message.type === 'agentContextUsage')).toEqual([]);
    expect(f.models().session).toBeNull();
  });

  it('bounds tasks, aliases, strings and live tool queues and rejects aliased oversized IDs', () => {
    const f = fixture();
    f.send('subagent.started', { toolCallId: 'root', agentName: 'lisa-simpson' }, 'actor');
    for (let i = 0; i < 180; i++) {
      f.send('subagent.started', { toolCallId: `task-${i}`, agentName: 'x'.repeat(10000) }, `actor-${i}`);
      f.send('tool.execution_start', { toolCallId: `tool-${i}`, toolName: 'x'.repeat(10000) }, 'actor');
    }
    f.send('subagent.started', { toolCallId: 'x'.repeat(161), agentName: 'lisa-simpson' }, 'oversized');
    expect(f.tasks().tasks.length).toBeLessThanOrEqual(64);
    expect(f.tasks().limited).toBe(true);
    expect(f.live.current().filter(message => message.type === 'agentToolStart').length).toBeLessThanOrEqual(128);
    expect(JSON.stringify(f.live.current())).not.toContain('x'.repeat(161));
  });

  it('reads only allowlisted tool-start arguments, never prompts, results or other private payloads', () => {
    const f = fixture();
    const trap = () => { throw new Error('private payload accessed'); };
    const data = Object.defineProperties({ toolCallId: 'call', toolName: 'task', agentName: 'lisa-simpson' }, {
      arguments: { get: trap }, result: { get: trap }, error: { get: trap },
      prompt: { get: trap }, agentDescription: { get: trap },
    });
    const args = Object.defineProperties({ name: 'lisa-simpson', agent_type: 'general-purpose',
      mode: 'sync', description: 'Safe bounded description' }, { prompt: { get: trap }, unknown: { get: trap } });
    f.send('tool.execution_start', { toolCallId: 'call', toolName: 'task', arguments: args });
    f.send('subagent.started', data, 'actor');
    f.send('tool.execution_complete', data);
    f.send('subagent.failed', data, 'actor');
    f.live.accept(Object.defineProperty({ type: 'user.message' }, 'data', { get: trap }));
    expect(f.tasks().tasks[0].description).toBe('Safe bounded description');
    expect(JSON.stringify(f.messages)).not.toMatch(/prompt|arguments|result|private payload/);
  });

  it('clears synchronously and never replays cleared models, tools, context or task identities', () => {
    const f = fixture();
    f.send('subagent.started', { toolCallId: 'dispatch', agentName: 'lisa-simpson', model: 'model' }, 'actor');
    f.send('tool.execution_start', { toolCallId: 'tool', toolName: 'view' }, 'actor');
    f.live.clear();
    expect(f.agents().every(agent => agent.status === 'idle')).toBe(true);
    expect(f.tasks().tasks).toEqual([]);
    expect(f.models()).toEqual({ sessionId: 'joined-s', session: null, members: {} });
    expect(f.live.current().filter(message => message.type === 'agentToolStart')).toEqual([]);
  });
});
