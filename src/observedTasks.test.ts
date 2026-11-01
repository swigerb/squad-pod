import { describe, expect, it } from 'vitest';
import { MAX_RECENT_TASKS, ObservedTasks, transientSubagents, type ObservedTask, type ObservedTaskSnapshot } from './observedTasks.js';
import { parseLiveEvent } from './copilotSessionActivity.js';

const row = (toolCallId: string, extra: Partial<ObservedTask> = {}): ObservedTask => ({
  sessionId: 'session', toolCallId, parentToolCallId: null, name: 'Same name',
  agentType: 'explore', mode: 'background', description: '', state: 'running',
  fieldsTruncated: false, agentId: null, ...extra,
});
const snapshot = (...tasks: ObservedTask[]): ObservedTaskSnapshot => ({ sessionId: 'session', tasks, limited: false });
const parent = row('parent', { agentId: 'ada' });

describe('authoritative instance identity and transient hierarchy', () => {
  it('uses explicit parent calls only and distinguishes duplicate names by call identity', () => {
    const calls = snapshot(parent, row('one', { parentToolCallId: 'parent' }),
      row('two', { parentToolCallId: 'parent' }), row('unknown'), row('fake-parent', { parentToolCallId: 'ada' }));
    const children = transientSubagents(calls, ['ada']);
    expect(children).toHaveLength(2);
    expect(new Set(children.map(child => child.id)).size).toBe(2);
    expect(children.map(child => child.parentAgentId)).toEqual(['ada', 'ada']);
  });

  it('deduplicates authoritative instance aliases, never display names, and a terminal alias wins', () => {
    const one = row('one', { parentToolCallId: 'parent', instanceId: 'opaque-instance' });
    const two = row('two', { parentToolCallId: 'parent', instanceId: 'opaque-instance' });
    expect(transientSubagents(snapshot(parent, one, two), ['ada'])).toHaveLength(1);
    for (const state of ['completed', 'failed', 'aborted'] as const) {
      expect(transientSubagents(snapshot(parent, one, { ...two, state }), ['ada'])).toEqual([]);
    }
    expect(transientSubagents({ ...snapshot(parent, one), sessionId: 'different' }, ['ada'])).toEqual([]);
  });

  it('reconciles only selected custom identities to the roster, including later roster arrival', () => {
    const child = row('child', { parentToolCallId: 'parent', name: 'grace', selectedAgentName: 'grace' });
    expect(transientSubagents(snapshot(parent, child), ['ada'])).toHaveLength(1);
    expect(transientSubagents(snapshot(parent, child), ['ada', 'grace'])).toEqual([]);
    expect(transientSubagents(snapshot(parent, { ...child, selectedAgentName: undefined }), ['ada', 'grace']))
      .toHaveLength(1);
    expect(transientSubagents(snapshot(parent, { ...child, selectedAgentName: 'grace-ish' }), ['ada', 'grace']))
      .toHaveLength(1);
  });

  it('rejects cycles, missing parents, ended parents and cross-session links', () => {
    const child = row('child', { parentToolCallId: 'parent' });
    for (const badParent of [
      { ...parent, state: 'completed' as const }, { ...parent, sessionId: 'other' },
      { ...parent, agentId: null, parentToolCallId: 'child' },
    ]) { expect(transientSubagents(snapshot(badParent, child), ['ada'])).toEqual([]); }
    expect(transientSubagents(snapshot(child), ['ada'])).toEqual([]);
  });

  it('does not undo host ambiguity rejection on selected identities or late roster arrival', () => {
    const selectedParent = { ...parent, agentId: null, selectedAgentName: 'ada' };
    const child = row('child', { parentToolCallId: 'parent' });
    expect(transientSubagents(snapshot(selectedParent, child), ['Ada', 'ada'])).toEqual([]);
    expect(transientSubagents(snapshot(selectedParent, child), ['ada'])).toHaveLength(1);
    expect(transientSubagents(snapshot(parent, { ...child, selectedAgentName: 'grace' }), ['ada', 'Grace', 'grace']))
      .toHaveLength(1);
  });

  it('propagates terminal state to instance aliases before completed rows age out', () => {
    const inventory = new ObservedTasks();
    const accept = (type: string, id: string, instance?: string) => inventory.accept({
      type, toolCallId: id, parentToolCallId: id === 'parent' ? '' : 'parent', toolName: 'task', squad: false, instanceId: instance,
      ...(type === 'tool.execution_start' ? { task: { name: id, agent_type: 'explore', mode: 'background', description: '' } } : {}),
    }, 'session', id === 'parent' ? 'ada' : null);
    for (const id of ['parent', 'one', 'alias']) {
      accept('tool.execution_start', id);
      accept('subagent.started', id, id === 'parent' ? 'lead' : 'instance');
    }
    expect(transientSubagents(inventory.snapshot('session'), ['ada'])).toHaveLength(1);
    accept('subagent.completed', 'one');
    expect(inventory.snapshot('session').tasks.find(task => task.toolCallId === 'alias')?.state).toBe('completed');
    for (let i = 0; i <= MAX_RECENT_TASKS; i++) {
      accept('tool.execution_start', `other-${i}`);
      accept('subagent.started', `other-${i}`, `other-instance-${i}`);
      accept('subagent.completed', `other-${i}`);
    }
    expect(inventory.snapshot('session').tasks.some(task => task.toolCallId === 'one')).toBe(false);
    expect(transientSubagents(inventory.snapshot('session'), ['ada'])).toEqual([]);
  });

  it.each([
    ['completed', 'subagent.completed'],
    ['failed', 'subagent.failed'],
    ['aborted', 'subagent.aborted'],
  ] as const)('does not revive a late alias after a retained %s instance is evicted', (state, terminalEvent) => {
    const inventory = new ObservedTasks();
    const accept = (type: string, id: string, instance?: string) => inventory.accept({
      type, toolCallId: id, parentToolCallId: id === 'parent' ? '' : 'parent', toolName: 'task', squad: false, instanceId: instance,
      ...(type === 'tool.execution_start' ? { task: { name: id, agent_type: 'explore', mode: 'background', description: '' } } : {}),
    }, 'session', id === 'parent' ? 'ada' : null);

    accept('tool.execution_start', 'parent');
    accept('subagent.started', 'parent', 'parent-instance');
    accept('tool.execution_start', 'call-a');
    accept('subagent.started', 'call-a', 'shared-instance');
    accept(terminalEvent, 'call-a');
    accept('tool.execution_start', 'call-b');
    accept('subagent.started', 'call-b', 'shared-instance');
    expect(inventory.snapshot('session').tasks.find(task => task.toolCallId === 'call-b')?.state).toBe(state);
    accept('tool.execution_start', 'call-c');
    accept('subagent.started', 'call-c', 'independent-instance');

    for (let i = 0; i < MAX_RECENT_TASKS - 1; i++) {
      accept('tool.execution_start', `unrelated-${i}`);
      accept('subagent.started', `unrelated-${i}`, `unrelated-instance-${i}`);
      accept('subagent.completed', `unrelated-${i}`);
    }

    const tasks = inventory.snapshot('session').tasks;
    expect(tasks.some(task => task.toolCallId === 'call-a')).toBe(false);
    expect(tasks.find(task => task.toolCallId === 'call-b')?.state).toBe(state);
    expect(transientSubagents(inventory.snapshot('session'), ['ada'])).toEqual([{
      id: JSON.stringify(['session', 'instance', 'independent-instance']),
      parentAgentId: 'ada',
      name: 'call-c',
    }]);
  });

  it('clears retained instance state when the inventory is reset', () => {
    const inventory = new ObservedTasks();
    const accept = (type: string, id: string, instance?: string) => inventory.accept({
      type, toolCallId: id, parentToolCallId: id === 'parent' ? '' : 'parent', toolName: 'task', squad: false, instanceId: instance,
      ...(type === 'tool.execution_start' ? { task: { name: id, agent_type: 'explore', mode: 'background', description: '' } } : {}),
    }, 'session', id === 'parent' ? 'ada' : null);
    accept('tool.execution_start', 'parent');
    accept('subagent.started', 'parent', 'parent-instance');
    accept('tool.execution_start', 'call-a');
    accept('subagent.started', 'call-a', 'shared-instance');
    accept('subagent.completed', 'call-a');

    inventory.clear();
    accept('tool.execution_start', 'parent');
    accept('subagent.started', 'parent', 'parent-instance');
    accept('tool.execution_start', 'call-b');
    accept('subagent.started', 'call-b', 'shared-instance');

    expect(inventory.snapshot('session').tasks.find(task => task.toolCallId === 'call-b')?.state).toBe('running');
  });

  it.each([true, false])('correlates selected custom agents by envelope instance ID (selection first: %s)', first => {
    const inventory = new ObservedTasks();
    const accept = (type: string, data: object, agentId?: string, rosterId: string | null = null) => {
      const event = parseLiveEvent(JSON.stringify({ type, data, agentId }))!;
      inventory.accept(event, 'session', rosterId);
    };
    const select = () => accept('subagent.selected', { agentName: 'grace', agentDisplayName: 'Not identity' }, 'instance', 'grace');
    accept('tool.execution_start', { toolCallId: 'call', toolName: 'task',
      arguments: { name: 'Untrusted display', agent_type: 'explore' } });
    if (first) { select(); }
    accept('subagent.started', { toolCallId: 'call', agentName: 'explore' }, 'instance');
    if (!first) { select(); }
    expect(inventory.snapshot('session').tasks[0]).toMatchObject({
      instanceId: 'instance', selectedAgentName: 'grace', agentId: 'grace', state: 'running',
    });
    accept('subagent.selected', { agentName: 'ada' }, 'unrelated', 'ada');
    expect(inventory.snapshot('session').tasks[0].agentId).toBe('grace');
    accept('subagent.completed', { toolCallId: 'call', cancelled: true }, 'instance');
    expect(inventory.snapshot('session').tasks[0].state).toBe('aborted');
    accept('subagent.started', { toolCallId: 'call' }, 'different-instance');
    expect(inventory.snapshot('session').tasks[0].instanceId).toBe('instance');
    inventory.clear();
    expect(inventory.snapshot(null).tasks).toEqual([]);
  });

  it('omits invalid/overlong producer identities rather than truncating them into roster aliases', () => {
    for (const [agentId, agentName] of [[' instance', 'ada'], ['instance', 'ada\n'], ['instance', 'x'.repeat(161)]]) {
      const event = parseLiveEvent(JSON.stringify({ type: 'subagent.selected', agentId, data: { agentName } }))!;
      expect(event.identityOmitted).toBe(true);
      expect(event.selectedAgentName).toBeUndefined();
    }
    const root = parseLiveEvent(JSON.stringify({ type: 'subagent.selected', data: { agentName: 'ada' } }))!;
    expect(root.selectedAgentName).toBeUndefined();
  });
});
